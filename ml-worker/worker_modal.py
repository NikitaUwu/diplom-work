from __future__ import annotations

import json
import os
import shutil
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import psycopg2
from psycopg2.extras import Json, RealDictCursor
from dotenv import load_dotenv

from plextract import extract


# Чтобы меньше ловить Windows-ошибок кодировок при вызовах CLI
os.environ.setdefault("PYTHONUTF8", "1")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")


@dataclass
class Job:
    chart_id: int
    user_id: int
    original_path: str


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


def _fetch_one_and_mark_processing(conn) -> Optional[Job]:
    """
    Берём одну задачу (status='uploaded') и атомарно переводим в processing.
    SKIP LOCKED позволяет запускать несколько воркеров без конфликтов.
    """
    with conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, user_id, original_path
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
                "UPDATE charts SET status = %s WHERE id = %s",
                ("processing", chart_id),
            )

            return Job(
                chart_id=chart_id,
                user_id=int(row["user_id"]),
                original_path=str(row["original_path"]),
            )


def _mark_done(conn, chart_id: int, result_json: Dict[str, Any], n_panels: int, n_series: int) -> None:
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


def _mark_error(conn, chart_id: int, message: str) -> None:
    with conn:
        with conn.cursor() as cur:
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


def _find_converted_data_json(search_root: Path) -> Path:
    # У plextract часто получается вложенность output/output/...
    candidates = [p for p in search_root.rglob("data.json") if "converted_datapoints" in p.parts]
    if not candidates:
        raise RuntimeError("converted_datapoints/data.json not found in extracted artifacts")
    # Берём первый найденный (для 1 изображения это нормально)
    return candidates[0]


def _parse_points(payload: Any) -> Dict[str, List[Tuple[float, float]]]:
    """
    Приводим выход plextract к виду:
      { "series_0": [(x,y), ...], ... }
    Делаем максимально терпимо к формату точек.
    """
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


def _to_backend_result(series_points: Dict[str, List[Tuple[float, float]]]) -> Dict[str, Any]:
    """
    Минимальный формат для бэка: одна панель, несколько серий.
    Потом, когда будете делать multi-panel/legend, расширите.
    """
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

    # Ищем итоговый converted_datapoints/data.json где угодно внутри run_root
    data_path = _find_converted_data_json(run_root)
    with data_path.open("r", encoding="utf-8") as f:
        payload = json.load(f)

    series_points = _parse_points(payload)
    result_json = _to_backend_result(series_points)

    n_panels = 1
    n_series = len(series_points)
    return result_json, n_panels, n_series


def main() -> int:
    load_dotenv(Path(__file__).with_name(".env"))

    poll_interval = float(os.getenv("POLL_INTERVAL", "2"))
    work_dir = Path(os.getenv("WORK_DIR", str(Path.cwd() / "runs" / "worker"))).resolve()
    work_dir.mkdir(parents=True, exist_ok=True)

    conn = _connect()
    print("[WORKER] started; work_dir =", work_dir)

    while True:
        job = _fetch_one_and_mark_processing(conn)
        if not job:
            time.sleep(poll_interval)
            continue

        chart_id = job.chart_id

        try:
            original_path = Path(job.original_path)
            if not original_path.exists():
                raise RuntimeError(f"Original file not found: {original_path}")

            result_json, n_panels, n_series = _run_plextract(chart_id, original_path, work_dir)
            _mark_done(conn, chart_id, result_json, n_panels, n_series)

            print(f"[WORKER] chart {chart_id}: DONE (series={n_series})")
        except Exception as e:
            _mark_error(conn, chart_id, str(e))
            print(f"[WORKER] chart {chart_id}: ERROR -> {e}")


if __name__ == "__main__":
    raise SystemExit(main())
