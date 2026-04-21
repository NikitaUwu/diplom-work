from __future__ import annotations

import json
import os
import re
import shutil
import socket
import sys
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from queue import Queue
from typing import Any, Dict, List, Optional, Tuple

import psycopg2
from dotenv import load_dotenv
from psycopg2.extras import Json, RealDictCursor

try:
    import paho.mqtt.client as mqtt
except ImportError:
    mqtt = None

# Чтобы меньше ловить Windows-ошибок кодировок при вызовах CLI
os.environ.setdefault("PYTHONUTF8", "1")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")


def _configure_stdio_for_windows() -> None:
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if stream is None or not hasattr(stream, "reconfigure"):
            continue
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


_configure_stdio_for_windows()

from plextract import extract

VALUE_EPS = 1e-9
SCREEN_EPS = 1e-4
_HAS_PROCESSING_JOBS_TABLE: Optional[bool] = None

ERROR_INPUT_FILE_MISSING = "input_file_missing"
ERROR_STORAGE_PERMISSION_DENIED = "storage_permission_denied"
ERROR_PIPELINE_OUTPUT_INVALID = "pipeline_output_invalid"
ERROR_MODAL_BACKEND_UNAVAILABLE = "modal_backend_unavailable"
ERROR_NETWORK_TIMEOUT = "network_timeout"
ERROR_UNEXPECTED_WORKER_ERROR = "unexpected_worker_error"


def _env_bool(name: str, default: str = "0") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


def _worker_id() -> str:
    return os.getenv("WORKER_ID", f"{socket.gethostname()}:{os.getpid()}")


@dataclass
class Job:
    chart_id: int
    original_path: str
    processing_job_id: Optional[int] = None
    message_id: Optional[str] = None


@dataclass
class MqttTransport:
    client: Any
    request_topic: str
    accepted_topic: str
    heartbeat_topic: str
    completed_topic: str
    failed_topic: str
    heartbeat_interval_seconds: float


class PipelineError(Exception):
    def __init__(
        self,
        message: str,
        artifacts: dict[str, str] | None = None,
        *,
        error_code: str | None = None,
        retryable: bool | None = None,
    ):
        super().__init__(message)
        self.artifacts = artifacts or {}
        self.error_code = error_code
        self.retryable = retryable


def _normalize_db_url(url: str) -> str:
    # SQLAlchemy URL -> psycopg2 URL
    return url.replace("postgresql+psycopg2://", "postgresql://", 1)


def _connect():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise RuntimeError("DATABASE_URL is not set (check ml-worker/.env)")
    db_url = _normalize_db_url(db_url)
    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    return conn


def _has_processing_jobs_table(conn) -> bool:
    global _HAS_PROCESSING_JOBS_TABLE
    if _HAS_PROCESSING_JOBS_TABLE is not None:
        return _HAS_PROCESSING_JOBS_TABLE

    try:
        with conn.cursor() as cur:
            cur.execute("SELECT to_regclass('public.processing_jobs')")
            row = cur.fetchone()
            _HAS_PROCESSING_JOBS_TABLE = bool(row and row[0])
    except Exception:
        _HAS_PROCESSING_JOBS_TABLE = False

    return _HAS_PROCESSING_JOBS_TABLE


def _latest_processing_job_id(cur, chart_id: int) -> Optional[int]:
    cur.execute(
        """
        SELECT id
        FROM processing_jobs
        WHERE chart_id = %s
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        """,
        (chart_id,),
    )
    row = cur.fetchone()
    if not row:
        return None
    if isinstance(row, dict):
        raw_id = row.get("id")
    else:
        raw_id = row[0]
    return int(raw_id) if raw_id is not None else None


def _mark_processing_job_started(cur, job_id: Optional[int], message_id: Optional[str]) -> None:
    if not job_id:
        return

    cur.execute(
        """
        UPDATE processing_jobs
        SET status = %s,
            error_message = NULL,
            worker_id = %s,
            started_at = COALESCE(started_at, NOW()),
            message_id = COALESCE(message_id, %s)
        WHERE id = %s
        """,
        ("processing", _worker_id(), message_id, job_id),
    )


def _mark_processing_job_done(cur, job_id: Optional[int], result_json: Dict[str, Any]) -> None:
    if not job_id:
        return

    cur.execute(
        """
        UPDATE processing_jobs
        SET status = %s,
            result_payload = %s,
            error_message = NULL,
            finished_at = NOW(),
            worker_id = COALESCE(worker_id, %s)
        WHERE id = %s
        """,
        ("done", Json(result_json), _worker_id(), job_id),
    )


def _mark_processing_job_error(cur, job_id: Optional[int], message: str, result_json: Optional[Dict[str, Any]] = None) -> None:
    if not job_id:
        return

    cur.execute(
        """
        UPDATE processing_jobs
        SET status = %s,
            error_message = %s,
            result_payload = %s,
            finished_at = NOW(),
            worker_id = COALESCE(worker_id, %s)
        WHERE id = %s
        """,
        ("error", message[:2000], Json(result_json) if result_json is not None else None, _worker_id(), job_id),
    )


def _fetch_one_and_mark_processing(conn) -> Optional[Job]:
    """
    Берём одну задачу (status='uploaded') и атомарно переводим в processing.
    SKIP LOCKED позволяет запускать несколько воркеров без конфликтов.
    """
    with conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, original_path
                FROM charts
                WHERE status = %s
                ORDER BY created_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
                """,
                ("uploaded",),
            )
            row = cur.fetchone()
            if not row:
                return None

            chart_id = int(row["id"])
            cur.execute(
                """
                UPDATE charts
                SET status = %s,
                    error_message = NULL
                WHERE id = %s
                """,
                ("processing", chart_id),
            )

            processing_job_id: Optional[int] = None
            if _has_processing_jobs_table(conn):
                processing_job_id = _latest_processing_job_id(cur, chart_id)
                _mark_processing_job_started(cur, processing_job_id, None)

            return Job(
                chart_id=chart_id,
                original_path=str(row["original_path"]),
                processing_job_id=processing_job_id,
            )


def _claim_chart_from_mqtt(conn, payload: Dict[str, Any]) -> Optional[Job]:
    try:
        chart_id = int(payload.get("chartId"))
    except (TypeError, ValueError):
        return None

    raw_job_id = payload.get("jobId")
    raw_message_id = payload.get("messageId")
    processing_job_id = None
    if raw_job_id is not None:
        try:
            processing_job_id = int(raw_job_id)
        except (TypeError, ValueError):
            processing_job_id = None

    message_id = str(raw_message_id).strip() if raw_message_id is not None else None

    with conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                UPDATE charts
                SET status = %s,
                    error_message = NULL
                WHERE id = %s
                  AND status = %s
                RETURNING id, original_path
                """,
                ("processing", chart_id, "uploaded"),
            )
            row = cur.fetchone()
            if not row:
                return None

            if _has_processing_jobs_table(conn):
                if processing_job_id is None:
                    processing_job_id = _latest_processing_job_id(cur, chart_id)
                _mark_processing_job_started(cur, processing_job_id, message_id)

            return Job(
                chart_id=int(row["id"]),
                original_path=str(row["original_path"]),
                processing_job_id=processing_job_id,
                message_id=message_id,
            )


def _mark_done(
    conn,
    chart_id: int,
    result_json: Dict[str, Any],
    n_panels: int,
    n_series: int,
    processing_job_id: Optional[int] = None,
) -> None:
    with conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE charts
                SET status = %s,
                    result_json = %s,
                    n_panels = %s,
                    n_series = %s,
                    processed_at = NOW(),
                    error_message = NULL
                WHERE id = %s
                """,
                ("done", Json(result_json), n_panels, n_series, chart_id),
            )
            if _has_processing_jobs_table(conn):
                _mark_processing_job_done(cur, processing_job_id, result_json)


def _mark_error(
    conn,
    chart_id: int,
    message: str,
    result_json: Optional[Dict[str, Any]] = None,
    processing_job_id: Optional[int] = None,
) -> None:
    with conn:
        with conn.cursor() as cur:
            if result_json is None:
                cur.execute(
                    """
                    UPDATE charts
                    SET status = %s,
                        error_message = %s,
                        processed_at = NOW()
                    WHERE id = %s
                    """,
                    ("error", message[:2000], chart_id),
                )
            else:
                cur.execute(
                    """
                    UPDATE charts
                    SET status = %s,
                        error_message = %s,
                        processed_at = NOW(),
                        result_json = %s
                    WHERE id = %s
                    """,
                    ("error", message[:2000], Json(result_json), chart_id),
                )

            if _has_processing_jobs_table(conn):
                _mark_processing_job_error(cur, processing_job_id, message, result_json)


def _get_storage_dir_from_original(original_path: Path) -> Path:
    """
    Где хранить артефакты.
    1) Если задан STORAGE_DIR в env — используем его
    2) Иначе берём корень storage из пути оригинала

    Текущий формат original_path:
    storage/user_<id>/<chart_id>/<filename>
    """
    env = os.getenv("STORAGE_DIR")
    if env:
        return Path(env).resolve()

    resolved = original_path.resolve()
    if len(resolved.parents) < 3:
        raise RuntimeError(f"Cannot infer storage dir from original path: {resolved}")

    # parents[0] = .../<chart_id>
    # parents[1] = .../user_<id>
    # parents[2] = .../storage
    return resolved.parents[2]


def _first_match(root: Path, pattern: str, must_contain_part: str) -> Optional[Path]:
    candidates = [p for p in root.rglob(pattern) if must_contain_part in p.parts]
    return candidates[0] if candidates else None


def _pick_latest(paths: list[Path]) -> Optional[Path]:
    if not paths:
        return None
    return max(paths, key=lambda p: p.stat().st_mtime)


def _load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _normalize_box(raw_box: Any) -> Optional[tuple[float, float, float, float]]:
    if not isinstance(raw_box, (list, tuple)) or len(raw_box) < 4:
        return None

    try:
        left = float(raw_box[0])
        top = float(raw_box[1])
        right = float(raw_box[2])
        bottom = float(raw_box[3])
    except (TypeError, ValueError):
        return None

    if right <= left or bottom <= top:
        return None

    return left, top, right, bottom


def _parse_numeric_label(raw_text: Any) -> Optional[float]:
    if raw_text is None:
        return None

    text = str(raw_text).strip()
    if not text:
        return None

    normalized = (
        text.replace(" ", "")
        .replace(",", ".")
        .replace("−", "-")
        .replace("–", "-")
        .replace("—", "-")
    )
    match = re.search(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?", normalized)
    if not match:
        return None

    try:
        return float(match.group(0))
    except ValueError:
        return None


def _fit_axis_domain(
    samples: list[tuple[float, float]],
    *,
    axis_start_px: float,
    axis_end_px: float,
) -> Optional[tuple[float, float]]:
    if len(samples) < 2:
        return None

    coords = [coord for coord, _ in samples]
    values = [value for _, value in samples]

    mean_coord = sum(coords) / len(coords)
    mean_value = sum(values) / len(values)
    denom = sum((coord - mean_coord) ** 2 for coord in coords)
    if denom <= 1e-12:
        return None

    slope = sum((coord - mean_coord) * (value - mean_value) for coord, value in samples) / denom
    if abs(slope) <= 1e-12:
        return None

    intercept = mean_value - slope * mean_coord
    start_value = slope * axis_start_px + intercept
    end_value = slope * axis_end_px + intercept

    if not (float("-inf") < start_value < float("inf") and float("-inf") < end_value < float("inf")):
        return None

    if abs(start_value - end_value) <= 1e-12:
        return None

    return start_value, end_value


def _build_axis_screen_samples(
    samples: list[tuple[float, float]],
    *,
    axis_start_px: float,
    axis_end_px: float,
) -> list[dict[str, float]]:
    span = axis_end_px - axis_start_px
    if abs(span) <= 1e-12:
        return []

    out: list[dict[str, float]] = []
    last_screen = float("-inf")
    seen_values: set[float] = set()

    normalized_samples = []
    for coord, value in samples:
        screen = (coord - axis_start_px) / span
        if not (-0.25 <= screen <= 1.25):
            continue
        normalized_samples.append((float(value), min(1.0, max(0.0, screen))))

    normalized_samples.sort(key=lambda item: (item[0], item[1]))

    for value, screen in normalized_samples:
        if value in seen_values:
            continue
        if screen <= last_screen + 1e-4:
            continue
        out.append({"value": float(value), "screen": float(screen)})
        last_screen = screen
        seen_values.add(value)

    return out


def _extract_plot_area(search_root: Path) -> Optional[tuple[float, float, float, float]]:
    label_paths = [p for p in search_root.rglob("label_coordinates.json") if "chartdete" in p.parts]
    label_path = _pick_latest(label_paths)
    if label_path:
        try:
            payload = _load_json(label_path)
            plot_area = _normalize_box(payload.get("plot_area"))
            if plot_area:
                return plot_area
        except Exception:
            pass

    box_paths = [p for p in search_root.rglob("bounding_boxes.json") if "chartdete" in p.parts]
    box_path = _pick_latest(box_paths)
    if not box_path:
        return None

    try:
        payload = _load_json(box_path)
    except Exception:
        return None

    raw_candidates = payload.get("plot_area")
    if not isinstance(raw_candidates, list):
        return None

    best_box: Optional[tuple[float, float, float, float]] = None
    best_confidence = float("-inf")

    for candidate in raw_candidates:
        box = _normalize_box(candidate)
        if not box:
            continue

        confidence = 0.0
        if isinstance(candidate, (list, tuple)) and len(candidate) >= 5:
            try:
                confidence = float(candidate[4])
            except (TypeError, ValueError):
                confidence = 0.0

        if confidence >= best_confidence:
            best_box = box
            best_confidence = confidence

    return best_box


def _extract_axis_samples(search_root: Path, axis: str) -> list[tuple[float, float]]:
    label_paths = [p for p in search_root.rglob("label_coordinates.json") if "chartdete" in p.parts]
    label_path = _pick_latest(label_paths)
    text_paths = list(search_root.rglob("axis_label_texts.json"))
    text_path = _pick_latest(text_paths)
    if not label_path or not text_path:
        return []

    try:
        label_payload = _load_json(label_path)
        text_payload = _load_json(text_path)
    except Exception:
        return []

    if not isinstance(label_payload, dict) or not isinstance(text_payload, dict):
        return []

    text_by_name = {Path(str(key)).name.lower(): value for key, value in text_payload.items()}
    prefix = "cropped_xlabels_" if axis == "x" else "cropped_ylabels_"

    samples: list[tuple[float, float]] = []
    for key, raw_box in label_payload.items():
        filename = Path(str(key)).name.lower()
        if not filename.startswith(prefix):
            continue

        value = _parse_numeric_label(text_by_name.get(filename))
        box = _normalize_box(raw_box)
        if value is None or not box:
            continue

        coord = (box[0] + box[2]) / 2 if axis == "x" else (box[1] + box[3]) / 2
        samples.append((coord, value))

    samples.sort(key=lambda item: item[0])
    return samples


def _build_editor_overlay_meta(search_root: Path, artifacts: dict[str, str]) -> Optional[dict[str, Any]]:
    plot_area = _extract_plot_area(search_root)
    if not plot_area:
        return None

    x_samples = _extract_axis_samples(search_root, "x")
    y_samples = _extract_axis_samples(search_root, "y")
    if len(x_samples) < 2 or len(y_samples) < 2:
        return None

    left, top, right, bottom = plot_area
    x_domain = _fit_axis_domain(x_samples, axis_start_px=left, axis_end_px=right)
    y_domain = _fit_axis_domain(y_samples, axis_start_px=bottom, axis_end_px=top)
    if not x_domain or not y_domain:
        return None

    y_domain_sorted = (min(y_domain[0], y_domain[1]), max(y_domain[0], y_domain[1]))
    x_axis_samples = _build_axis_screen_samples(x_samples, axis_start_px=left, axis_end_px=right)
    y_axis_samples = _build_axis_screen_samples(y_samples, axis_start_px=bottom, axis_end_px=top)
    if len(x_axis_samples) < 2 or len(y_axis_samples) < 2:
        return None

    return {
        "editor_overlay": {
            "artifact_key": "original",
            "plot_area": {
                "left": left,
                "top": top,
                "right": right,
                "bottom": bottom,
            },
            "x_domain": [x_domain[0], x_domain[1]],
            "y_domain": [y_domain_sorted[0], y_domain_sorted[1]],
            "x_ticks": [sample["value"] for sample in x_axis_samples],
            "y_ticks": [sample["value"] for sample in y_axis_samples],
            "x_axis_samples": x_axis_samples,
            "y_axis_samples": y_axis_samples,
        }
    }


def _collect_and_copy_artifacts(run_root: Path, original_path: Path | str, storage_dir: Path) -> dict[str, str]:
    """
    Копируем артефакты в ту же папку, где лежит оригинал:
    storage/user_<id>/<chart_id>/...

    Возвращаем мапу: {key: "relative/path/from/storage"}
    """
    storage_dir = storage_dir.resolve()

    original_path = Path(original_path)
    if not original_path.is_absolute():
        original_path = (storage_dir / original_path).resolve()
    else:
        original_path = original_path.resolve()

    dest_base = original_path.parent.resolve()

    if dest_base != storage_dir and storage_dir not in dest_base.parents:
        raise RuntimeError("Invalid artifact destination path")

    dest_base.mkdir(parents=True, exist_ok=True)

    artifacts: dict[str, str] = {}

    # Ищем строго внутри run_root/output
    search_root = run_root / "output"
    if not search_root.exists():
        return artifacts

    # lineformer/prediction.png
    lf_candidates = [p for p in search_root.rglob("prediction.png") if "lineformer" in p.parts]
    src = _pick_latest(lf_candidates)
    if src:
        dst_dir = dest_base / "lineformer"
        dst_dir.mkdir(parents=True, exist_ok=True)
        dst = dst_dir / src.name
        shutil.copy2(src, dst)
        artifacts["lineformer_prediction"] = dst.relative_to(storage_dir).as_posix()

    # chartdete/predictions.*
    cd_candidates = [p for p in search_root.rglob("predictions.*") if "chartdete" in p.parts]
    src = _pick_latest(cd_candidates)
    if src:
        dst_dir = dest_base / "chartdete"
        dst_dir.mkdir(parents=True, exist_ok=True)
        dst = dst_dir / src.name
        shutil.copy2(src, dst)
        artifacts["chartdete_predictions"] = dst.relative_to(storage_dir).as_posix()

    # converted_datapoints/plot.png
    plot_candidates = [p for p in search_root.rglob("plot.png") if "converted_datapoints" in p.parts]
    src = _pick_latest(plot_candidates)
    if src:
        dst_dir = dest_base / "converted_datapoints"
        dst_dir.mkdir(parents=True, exist_ok=True)
        dst = dst_dir / src.name
        shutil.copy2(src, dst)
        artifacts["converted_plot"] = dst.relative_to(storage_dir).as_posix()

    return artifacts


def _find_converted_data_json(search_root: Path) -> Path:
    candidates = [p for p in search_root.rglob("data.json") if "converted_datapoints" in p.parts]
    if not candidates:
        raise RuntimeError("converted_datapoints/data.json not found in extracted artifacts")
    return candidates[0]


def _parse_points(payload: Any) -> Dict[str, List[Tuple[float, float]]]:
    if not isinstance(payload, dict):
        raise RuntimeError("Unexpected data.json format: expected JSON object")

    out: Dict[str, List[Tuple[float, float]]] = {}

    for key, value in payload.items():
        if not str(key).startswith("series"):
            continue
        if not isinstance(value, list):
            continue

        pts: List[Tuple[float, float]] = []
        for item in value:
            x = y = None

            if isinstance(item, (list, tuple)) and len(item) >= 2:
                x, y = item[0], item[1]
            elif isinstance(item, dict):
                x = item.get("x", item.get("X"))
                y = item.get("y", item.get("Y"))

            if x is None or y is None:
                continue

            try:
                pts.append((float(x), float(y)))
            except Exception:
                continue

        if pts:
            out[str(key)] = pts

    if not out:
        raise RuntimeError("No series_* points found in data.json")
    return out


def _to_float_pair(item: Any) -> Optional[Tuple[float, float]]:
    if isinstance(item, dict):
        raw_x = item.get("x", item.get("X"))
        raw_y = item.get("y", item.get("Y"))
    elif isinstance(item, (list, tuple)) and len(item) >= 2:
        raw_x, raw_y = item[0], item[1]
    else:
        return None

    try:
        return float(raw_x), float(raw_y)
    except (TypeError, ValueError):
        return None


def _parse_point_series(value: Any) -> List[Tuple[float, float]]:
    if not isinstance(value, list):
        return []

    out: List[Tuple[float, float]] = []
    for item in value:
        point = _to_float_pair(item)
        if point is None:
            continue
        out.append(point)
    return out


def _extract_lineformer_series(search_root: Path) -> List[List[Tuple[float, float]]]:
    candidates = [p for p in search_root.rglob("coordinates.json") if "lineformer" in p.parts]
    source_path = _pick_latest(candidates)
    if not source_path:
        return []

    try:
        payload = _load_json(source_path)
    except Exception:
        return []

    if isinstance(payload, list):
        direct_series = _parse_point_series(payload)
        if direct_series:
            return [direct_series]

        out: List[List[Tuple[float, float]]] = []
        for item in payload:
            series = _parse_point_series(item)
            if series:
                out.append(series)
        return out

    if not isinstance(payload, dict):
        return []

    def _series_sort_key(name: str) -> Tuple[int, str]:
        match = re.search(r"(\d+)$", name)
        return (int(match.group(1)), name) if match else (10**9, name)

    out: List[List[Tuple[float, float]]] = []
    for key in sorted((str(key) for key in payload.keys()), key=_series_sort_key):
        series = _parse_point_series(payload.get(key))
        if series:
            out.append(series)
    return out


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _normalize_overlay_axis_samples(raw_samples: Any) -> List[Dict[str, float]]:
    if not isinstance(raw_samples, list):
        return []

    parsed: List[Dict[str, float]] = []
    for item in raw_samples:
        if not isinstance(item, dict):
            continue
        try:
            value = float(item.get("value"))
            screen = _clamp(float(item.get("screen")), 0.0, 1.0)
        except (TypeError, ValueError):
            continue
        parsed.append({"value": value, "screen": screen})

    parsed.sort(key=lambda sample: (sample["value"], sample["screen"]))

    out: List[Dict[str, float]] = []
    for sample in parsed:
        prev = out[-1] if out else None
        if prev and abs(prev["value"] - sample["value"]) <= VALUE_EPS:
            out[-1] = sample
            continue
        if prev and sample["screen"] <= prev["screen"] + SCREEN_EPS:
            continue
        out.append(sample)
    return out


def _build_axis_warp(domain: Tuple[float, float], raw_samples: Any) -> Optional[Dict[str, List[float]]]:
    d0, d1 = float(domain[0]), float(domain[1])
    if abs(d1 - d0) <= VALUE_EPS:
        return None

    samples = _normalize_overlay_axis_samples(raw_samples)
    if len(samples) < 2:
        return None

    data_knots = [d0]
    screen_knots = [0.0]

    for sample in samples:
        value = sample["value"]
        screen = sample["screen"]
        if value <= d0 + VALUE_EPS or value >= d1 - VALUE_EPS:
            continue
        if screen <= screen_knots[-1] + SCREEN_EPS or screen >= 1.0 - SCREEN_EPS:
            continue
        data_knots.append(value)
        screen_knots.append(screen)

    data_knots.append(d1)
    screen_knots.append(1.0)
    return {"data_knots": data_knots, "screen_knots": screen_knots}


def _axis_screen_to_value(screen: float, domain: Tuple[float, float], warp: Optional[Dict[str, List[float]]]) -> float:
    d0, d1 = float(domain[0]), float(domain[1])
    s = _clamp(float(screen), 0.0, 1.0)

    if not warp:
        return d0 + s * (d1 - d0)

    data_knots = warp.get("data_knots") or []
    screen_knots = warp.get("screen_knots") or []
    if len(data_knots) < 2 or len(data_knots) != len(screen_knots):
        return d0 + s * (d1 - d0)

    for idx in range(len(screen_knots) - 1):
        if s <= screen_knots[idx + 1] + VALUE_EPS:
            sa = screen_knots[idx]
            sb = screen_knots[idx + 1]
            a = data_knots[idx]
            b = data_knots[idx + 1]
            t = 0.0 if abs(sb - sa) <= VALUE_EPS else (s - sa) / (sb - sa)
            return a + t * (b - a)

    return data_knots[-1]


def _sort_and_compact_points(points: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
    points.sort(key=lambda item: (item[0], item[1]))
    compacted: List[Tuple[float, float, int]] = []

    for x, y in points:
        if compacted and abs(compacted[-1][0] - x) <= VALUE_EPS:
            prev_x, prev_y, count = compacted[-1]
            compacted[-1] = (prev_x, (prev_y * count + y) / (count + 1), count + 1)
        else:
            compacted.append((x, y, 1))

    return [(x, y) for x, y, _ in compacted]


def _map_lineformer_series_to_axis_points(
    lineformer_series: List[List[Tuple[float, float]]],
    overlay_meta: Dict[str, Any],
) -> Dict[str, List[Tuple[float, float]]]:
    overlay = overlay_meta.get("editor_overlay") if isinstance(overlay_meta, dict) else None
    plot_area = overlay.get("plot_area") if isinstance(overlay, dict) else None
    if not isinstance(plot_area, dict):
        return {}

    try:
        left = float(plot_area["left"])
        top = float(plot_area["top"])
        right = float(plot_area["right"])
        bottom = float(plot_area["bottom"])
        x_domain = (float(overlay["x_domain"][0]), float(overlay["x_domain"][1]))
        y_domain = (float(overlay["y_domain"][0]), float(overlay["y_domain"][1]))
    except (KeyError, TypeError, ValueError, IndexError):
        return {}

    span_x = right - left
    span_y = bottom - top
    if span_x <= VALUE_EPS or span_y <= VALUE_EPS:
        return {}

    warp_x = _build_axis_warp(x_domain, overlay.get("x_axis_samples"))
    warp_y = _build_axis_warp(y_domain, overlay.get("y_axis_samples"))

    out: Dict[str, List[Tuple[float, float]]] = {}
    for idx, series in enumerate(lineformer_series):
        mapped: List[Tuple[float, float]] = []
        for px, py in series:
            screen_x = (px - left) / span_x
            screen_y = (bottom - py) / span_y
            x = _axis_screen_to_value(screen_x, x_domain, warp_x)
            y = _axis_screen_to_value(screen_y, y_domain, warp_y)
            mapped.append((x, y))

        compacted = _sort_and_compact_points(mapped)
        if compacted:
            out[f"series_{idx}"] = compacted

    return out


def _to_backend_result(series_points: Dict[str, List[Tuple[float, float]]]) -> Dict[str, Any]:
    series_list = []
    for sid, pts in series_points.items():
        series_list.append(
            {
                "id": sid,
                "name": sid,
                "style": None,
                "points": pts,
            }
        )

    panel = {
        "id": "panel_0",
        "x_scale": "linear",
        "y_scale": "linear",
        "x_unit": None,
        "y_unit": None,
        "series": series_list,
    }

    return {"panels": [panel], "ml_meta": None}


def _run_plextract(chart_id: int, original_path: Path, work_dir: Path) -> Tuple[Dict[str, Any], int, int]:
    run_tag = datetime.now().strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:8]

    run_root = work_dir / f"chart_{chart_id}" / run_tag
    input_dir = run_root / "input"
    output_dir = run_root / "output"

    input_dir.mkdir(parents=True, exist_ok=False)
    output_dir.mkdir(parents=True, exist_ok=False)

    # Копируем 1 файл в input_dir (изолируем запуск)
    shutil.copy2(original_path, input_dir / original_path.name)

    # Запуск через Modal
    extract(input_dir=str(input_dir), output_dir=str(output_dir), backend="modal")

    # Копируем артефакты в папку задачи рядом с оригиналом
    storage_dir = _get_storage_dir_from_original(original_path)
    artifacts = _collect_and_copy_artifacts(run_root, original_path, storage_dir)

    # Пытаемся достать data.json и распарсить точки
    overlay_meta = _build_editor_overlay_meta(run_root / "output", artifacts)
    point_source = "converted_datapoints"

    series_points: Dict[str, List[Tuple[float, float]]] = {}
    if overlay_meta:
        try:
            lineformer_series = _extract_lineformer_series(run_root / "output")
            series_points = _map_lineformer_series_to_axis_points(lineformer_series, overlay_meta)
            if series_points:
                point_source = "lineformer_coordinates"
        except Exception:
            series_points = {}

    if not series_points:
        try:
            data_path = _find_converted_data_json(run_root)
            with data_path.open("r", encoding="utf-8") as f:
                payload = json.load(f)
            series_points = _parse_points(payload)
        except Exception as e:
            raise PipelineError(
                str(e),
                artifacts,
                error_code=ERROR_PIPELINE_OUTPUT_INVALID,
                retryable=False,
            )

    result_json = _to_backend_result(series_points)
    result_json["artifacts"] = artifacts
    if overlay_meta:
        base_meta = result_json.get("ml_meta")
        if not isinstance(base_meta, dict):
            base_meta = {}
        base_meta.update(overlay_meta)
        base_meta["point_source"] = point_source
        result_json["ml_meta"] = base_meta

    n_panels = 1
    n_series = len(series_points)
    print("[WORKER] artifacts:", artifacts)
    return result_json, n_panels, n_series


def _mqtt_subscription_topic(topic: str) -> str:
    shared_group = os.getenv("MQTT_SHARED_GROUP", "").strip()
    if not shared_group:
        return topic
    return f"$share/{shared_group}/{topic}"


def _start_mqtt_transport(job_queue: Queue) -> MqttTransport:
    if mqtt is None:
        raise RuntimeError("MQTT is enabled, but paho-mqtt is not installed.")

    request_topic = os.getenv("MQTT_PROCESS_REQUEST_TOPIC", "charts/process/request")
    accepted_topic = os.getenv("MQTT_PROCESS_ACCEPTED_TOPIC", "charts/process/accepted")
    heartbeat_topic = os.getenv("MQTT_PROCESS_HEARTBEAT_TOPIC", "charts/process/heartbeat")
    completed_topic = os.getenv("MQTT_PROCESS_COMPLETED_TOPIC", "charts/process/completed")
    failed_topic = os.getenv("MQTT_PROCESS_FAILED_TOPIC", "charts/process/failed")
    heartbeat_interval_seconds = float(os.getenv("PROCESSING_HEARTBEAT_INTERVAL_SECONDS", "10"))
    host = os.getenv("MQTT_HOST", "localhost")
    port = int(os.getenv("MQTT_PORT", "1883"))
    username = os.getenv("MQTT_USERNAME")
    password = os.getenv("MQTT_PASSWORD")
    client_id_prefix = os.getenv("MQTT_CLIENT_ID_PREFIX", "diplom-worker")
    client_id = f"{client_id_prefix}-{uuid.uuid4().hex[:12]}"
    subscription_topic = _mqtt_subscription_topic(request_topic)

    client = mqtt.Client(client_id=client_id, clean_session=True)
    if username:
        client.username_pw_set(username, password or None)

    def on_connect(client, userdata, flags, rc):
        if rc == 0:
            client.subscribe(subscription_topic, qos=1)
            print(f"[WORKER] MQTT connected; subscribed to {subscription_topic}")
        else:
            print(f"[WORKER] MQTT connect failed with rc={rc}")

    def on_disconnect(client, userdata, rc):
        if rc != 0:
            print(f"[WORKER] MQTT disconnected unexpectedly with rc={rc}")

    def on_message(client, userdata, message):
        try:
            payload = json.loads(message.payload.decode("utf-8"))
        except Exception as exc:
            print(f"[WORKER] MQTT message decode error: {exc}")
            return

        if isinstance(payload, dict):
            job_queue.put(payload)

    client.on_connect = on_connect
    client.on_disconnect = on_disconnect
    client.on_message = on_message
    client.connect(host, port, keepalive=60)
    client.loop_start()
    print(f"[WORKER] MQTT transport started for {host}:{port}")
    return MqttTransport(
        client=client,
        request_topic=request_topic,
        accepted_topic=accepted_topic,
        heartbeat_topic=heartbeat_topic,
        completed_topic=completed_topic,
        failed_topic=failed_topic,
        heartbeat_interval_seconds=max(1.0, heartbeat_interval_seconds),
    )


def _publish_mqtt_event(transport: MqttTransport, topic: str, payload: Dict[str, Any]) -> None:
    serialized = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    info = transport.client.publish(topic, serialized, qos=1)
    if hasattr(info, "wait_for_publish"):
        info.wait_for_publish()

    rc = getattr(info, "rc", 0)
    if mqtt is not None and rc != mqtt.MQTT_ERR_SUCCESS:
        raise RuntimeError(f"MQTT publish failed with rc={rc} for topic {topic}")


def _job_from_mqtt_payload(payload: Dict[str, Any]) -> Optional[Job]:
    try:
        chart_id = int(payload.get("chartId"))
    except (TypeError, ValueError):
        return None

    original_path = str(payload.get("originalPath") or "").strip()
    raw_job_id = payload.get("jobId")
    raw_message_id = payload.get("messageId")

    processing_job_id = None
    if raw_job_id is not None:
        try:
            processing_job_id = int(raw_job_id)
        except (TypeError, ValueError):
            processing_job_id = None

    message_id = str(raw_message_id).strip() if raw_message_id is not None else None

    return Job(
        chart_id=chart_id,
        original_path=original_path,
        processing_job_id=processing_job_id,
        message_id=message_id,
    )


def _mqtt_event_message_id(job: Job, event_type: str) -> str:
    if event_type == "heartbeat":
        base = job.message_id or (f"job-{job.processing_job_id}" if job.processing_job_id is not None else f"chart-{job.chart_id}")
        return f"{base}:heartbeat:{uuid.uuid4().hex[:12]}"
    if job.message_id:
        return f"{job.message_id}:{event_type}"
    if job.processing_job_id is not None:
        return f"job-{job.processing_job_id}:{event_type}"
    return f"chart-{job.chart_id}:{event_type}"


def _mqtt_event_base(job: Job, event_type: str) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "schemaVersion": 1,
        "messageId": _mqtt_event_message_id(job, event_type),
        "chartId": job.chart_id,
        "workerId": _worker_id(),
    }
    if job.processing_job_id is not None:
        payload["jobId"] = job.processing_job_id
    if job.message_id:
        payload["requestMessageId"] = job.message_id
    return payload


def _publish_accepted_event(transport: MqttTransport, job: Job) -> None:
    payload = _mqtt_event_base(job, "accepted")
    _publish_mqtt_event(transport, transport.accepted_topic, payload)


def _publish_heartbeat_event(transport: MqttTransport, job: Job) -> None:
    payload = _mqtt_event_base(job, "heartbeat")
    _publish_mqtt_event(transport, transport.heartbeat_topic, payload)


def _publish_completed_event(
    transport: MqttTransport,
    job: Job,
    result_json: Dict[str, Any],
    n_panels: int,
    n_series: int,
) -> None:
    payload = _mqtt_event_base(job, "completed")
    payload["resultJson"] = result_json
    payload["nPanels"] = n_panels
    payload["nSeries"] = n_series
    _publish_mqtt_event(transport, transport.completed_topic, payload)


def _publish_failed_event(
    transport: MqttTransport,
    job: Job,
    message: str,
    *,
    error_code: Optional[str] = None,
    retryable: Optional[bool] = None,
    result_json: Optional[Dict[str, Any]] = None,
) -> None:
    payload = _mqtt_event_base(job, "failed")
    payload["errorMessage"] = message[:2000]
    if error_code:
        payload["errorCode"] = error_code
    if retryable is not None:
        payload["retryable"] = retryable
    if result_json is not None:
        payload["resultJson"] = result_json
    _publish_mqtt_event(transport, transport.failed_topic, payload)


def _heartbeat_publisher_loop(
    transport: MqttTransport,
    job: Job,
    stop_event: threading.Event,
) -> None:
    while not stop_event.wait(transport.heartbeat_interval_seconds):
        try:
            _publish_heartbeat_event(transport, job)
        except Exception as exc:
            print(f"[WORKER] chart {job.chart_id}: HEARTBEAT publish failed -> {exc}")


def _classify_worker_failure(exc: Exception) -> Tuple[str, bool]:
    if isinstance(exc, PipelineError):
        if exc.error_code is not None or exc.retryable is not None:
            return exc.error_code or ERROR_PIPELINE_OUTPUT_INVALID, bool(exc.retryable)

    message = str(exc).strip()
    normalized = message.lower()

    if "original file not found" in normalized or "original file path is missing" in normalized:
        return ERROR_INPUT_FILE_MISSING, False

    if isinstance(exc, PermissionError) or "permission denied" in normalized:
        return ERROR_STORAGE_PERMISSION_DENIED, False

    if "timeout" in normalized or "timed out" in normalized:
        return ERROR_NETWORK_TIMEOUT, True

    if (
        "temporar" in normalized
        or "connection refused" in normalized
        or "connection reset" in normalized
        or "service unavailable" in normalized
        or "too many requests" in normalized
        or "rate limit" in normalized
        or "modal" in normalized
        or " 502" in normalized
        or " 503" in normalized
        or " 504" in normalized
    ):
        return ERROR_MODAL_BACKEND_UNAVAILABLE, True

    if "network" in normalized:
        return ERROR_NETWORK_TIMEOUT, True

    if isinstance(exc, PipelineError):
        return ERROR_PIPELINE_OUTPUT_INVALID, False

    return ERROR_UNEXPECTED_WORKER_ERROR, False


def _process_job(job: Job, work_dir: Path) -> Tuple[Dict[str, Any], int, int]:
    raw_original_path = (job.original_path or "").strip()
    if raw_original_path in {"", "."}:
        raise PipelineError(
            "Original file path is missing",
            error_code=ERROR_INPUT_FILE_MISSING,
            retryable=False,
        )

    original_path = Path(raw_original_path)
    if not original_path.is_file():
        raise PipelineError(
            f"Original file not found: {original_path}",
            error_code=ERROR_INPUT_FILE_MISSING,
            retryable=False,
        )

    return _run_plextract(job.chart_id, original_path, work_dir)


def _run_polling_loop(conn, work_dir: Path, poll_interval: float) -> None:
    while True:
        job = _fetch_one_and_mark_processing(conn)
        if not job:
            time.sleep(poll_interval)
            continue

        chart_id = job.chart_id
        try:
            result_json, n_panels, n_series = _process_job(job, work_dir)
            _mark_done(conn, chart_id, result_json, n_panels, n_series, processing_job_id=job.processing_job_id)
            print(f"[WORKER] chart {chart_id}: DONE (series={n_series})")

        except PipelineError as exc:
            _mark_error(conn, chart_id, str(exc), result_json={"artifacts": exc.artifacts}, processing_job_id=job.processing_job_id)
            print(f"[WORKER] chart {chart_id}: ERROR (with artifacts) -> {exc}")

        except Exception as exc:
            _mark_error(conn, chart_id, str(exc), processing_job_id=job.processing_job_id)
            print(f"[WORKER] chart {chart_id}: ERROR -> {exc}")


def _run_mqtt_loop(job_queue: Queue, transport: MqttTransport, work_dir: Path) -> None:
    while True:
        mqtt_payload = job_queue.get()
        if not isinstance(mqtt_payload, dict):
            continue

        job = _job_from_mqtt_payload(mqtt_payload)
        if not job:
            print("[WORKER] MQTT payload skipped: missing chartId")
            continue

        heartbeat_stop = threading.Event()
        heartbeat_thread: Optional[threading.Thread] = None

        try:
            _publish_accepted_event(transport, job)
            heartbeat_thread = threading.Thread(
                target=_heartbeat_publisher_loop,
                args=(transport, job, heartbeat_stop),
                daemon=True,
            )
            heartbeat_thread.start()
            result_json, n_panels, n_series = _process_job(job, work_dir)
            heartbeat_stop.set()
            if heartbeat_thread.is_alive():
                heartbeat_thread.join(timeout=2.0)
            _publish_completed_event(transport, job, result_json, n_panels, n_series)
            print(f"[WORKER] chart {job.chart_id}: DONE via MQTT (series={n_series})")

        except PipelineError as exc:
            heartbeat_stop.set()
            if heartbeat_thread is not None and heartbeat_thread.is_alive():
                heartbeat_thread.join(timeout=2.0)
            error_code, retryable = _classify_worker_failure(exc)
            _publish_failed_event(
                transport,
                job,
                str(exc),
                error_code=error_code,
                retryable=retryable,
                result_json={"artifacts": exc.artifacts},
            )
            print(f"[WORKER] chart {job.chart_id}: ERROR via MQTT (with artifacts) -> {exc}")

        except Exception as exc:
            heartbeat_stop.set()
            if heartbeat_thread is not None and heartbeat_thread.is_alive():
                heartbeat_thread.join(timeout=2.0)
            error_code, retryable = _classify_worker_failure(exc)
            _publish_failed_event(
                transport,
                job,
                str(exc),
                error_code=error_code,
                retryable=retryable,
            )
            print(f"[WORKER] chart {job.chart_id}: ERROR via MQTT -> {exc}")
        finally:
            heartbeat_stop.set()
            if heartbeat_thread is not None and heartbeat_thread.is_alive():
                heartbeat_thread.join(timeout=2.0)


def main() -> int:
    load_dotenv(Path(__file__).with_name(".env"))

    poll_interval = float(os.getenv("POLL_INTERVAL", "2"))
    work_dir = Path(os.getenv("WORK_DIR", str(Path.cwd() / "runs" / "worker"))).resolve()
    work_dir.mkdir(parents=True, exist_ok=True)

    mqtt_enabled = _env_bool("MQTT_ENABLED", "0")
    print("[WORKER] started; work_dir =", work_dir)

    if mqtt_enabled:
        mqtt_jobs: Queue = Queue()
        transport = _start_mqtt_transport(mqtt_jobs)
        print("[WORKER] running in MQTT mode")
        _run_mqtt_loop(mqtt_jobs, transport, work_dir)
        return 0

    conn = _connect()
    print("[WORKER] running in polling mode")
    _run_polling_loop(conn, work_dir, poll_interval)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
