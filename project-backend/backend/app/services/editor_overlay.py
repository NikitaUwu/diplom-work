from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import re
from typing import Any, Optional


REPO_ROOT = Path(__file__).resolve().parents[4]
WORKER_RUNS_ROOT = REPO_ROOT / "ml-worker" / "runs" / "worker"
VALUE_EPS = 1e-9
SCREEN_EPS = 1e-4


def _load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _pick_latest(paths: list[Path]) -> Optional[Path]:
    if not paths:
        return None
    return max(paths, key=lambda path: path.stat().st_mtime)


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
        .replace("\u2212", "-")
        .replace("\u2013", "-")
        .replace("\u2014", "-")
    )
    match = re.search(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?", normalized)
    if not match:
        return None

    try:
        return float(match.group(0))
    except ValueError:
        return None


def _extract_plot_area(search_root: Path) -> Optional[tuple[float, float, float, float]]:
    label_paths = [path for path in search_root.rglob("label_coordinates.json") if "chartdete" in path.parts]
    label_path = _pick_latest(label_paths)
    if label_path:
        try:
            payload = _load_json(label_path)
            plot_area = _normalize_box(payload.get("plot_area"))
            if plot_area:
                return plot_area
        except Exception:
            pass

    box_paths = [path for path in search_root.rglob("bounding_boxes.json") if "chartdete" in path.parts]
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
    label_paths = [path for path in search_root.rglob("label_coordinates.json") if "chartdete" in path.parts]
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


def _build_overlay_from_search_root(search_root: Path) -> Optional[dict[str, Any]]:
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


def _latest_worker_output_root(chart_id: int) -> Optional[Path]:
    chart_runs_root = WORKER_RUNS_ROOT / f"chart_{chart_id}"
    if not chart_runs_root.is_dir():
        return None

    runs = [path for path in chart_runs_root.iterdir() if path.is_dir()]
    latest_run = _pick_latest(runs)
    if not latest_run:
        return None

    search_root = latest_run / "output"
    if not search_root.is_dir():
        return None
    return search_root


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _to_float_pair(item: Any) -> Optional[tuple[float, float]]:
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


def _parse_point_series(value: Any) -> list[tuple[float, float]]:
    if not isinstance(value, list):
        return []

    out: list[tuple[float, float]] = []
    for item in value:
        point = _to_float_pair(item)
        if point is None:
            continue
        out.append(point)
    return out


def _parse_named_series_payload(payload: Any) -> list[list[tuple[float, float]]]:
    if not isinstance(payload, dict):
        return []

    def _series_sort_key(name: str) -> tuple[int, str]:
        match = re.search(r"(\d+)$", name)
        return (int(match.group(1)), name) if match else (10**9, name)

    out: list[list[tuple[float, float]]] = []
    for key in sorted((str(key) for key in payload.keys()), key=_series_sort_key):
        series = _parse_point_series(payload.get(key))
        if series:
            out.append(series)
    return out


def _extract_converted_series(search_root: Path) -> list[list[tuple[float, float]]]:
    candidates = [path for path in search_root.rglob("data.json") if "converted_datapoints" in path.parts]
    source_path = _pick_latest(candidates)
    if not source_path:
        return []

    try:
        payload = _load_json(source_path)
    except Exception:
        return []

    return _parse_named_series_payload(payload)


def _extract_lineformer_series(search_root: Path) -> list[list[tuple[float, float]]]:
    candidates = [path for path in search_root.rglob("coordinates.json") if "lineformer" in path.parts]
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

        out: list[list[tuple[float, float]]] = []
        for item in payload:
            series = _parse_point_series(item)
            if series:
                out.append(series)
        return out

    return _parse_named_series_payload(payload)


def _normalize_axis_samples(raw_samples: Any) -> list[dict[str, float]]:
    if not isinstance(raw_samples, list):
        return []

    parsed: list[dict[str, float]] = []
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

    out: list[dict[str, float]] = []
    for sample in parsed:
        prev = out[-1] if out else None
        if prev and abs(prev["value"] - sample["value"]) <= VALUE_EPS:
            out[-1] = sample
            continue
        if prev and sample["screen"] <= prev["screen"] + SCREEN_EPS:
            continue
        out.append(sample)
    return out


def _build_axis_warp(domain: tuple[float, float], raw_samples: Any) -> Optional[dict[str, list[float]]]:
    d0, d1 = float(domain[0]), float(domain[1])
    if abs(d1 - d0) <= VALUE_EPS:
        return None

    samples = _normalize_axis_samples(raw_samples)
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


def _axis_screen_to_value(screen: float, domain: tuple[float, float], warp: Optional[dict[str, list[float]]]) -> float:
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


def _sort_and_compact_points(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    points.sort(key=lambda item: (item[0], item[1]))
    compacted: list[tuple[float, float, int]] = []

    for x, y in points:
        if compacted and abs(compacted[-1][0] - x) <= VALUE_EPS:
            prev_x, prev_y, count = compacted[-1]
            compacted[-1] = (prev_x, (prev_y * count + y) / (count + 1), count + 1)
        else:
            compacted.append((x, y, 1))

    return [(x, y) for x, y, _ in compacted]


def _map_lineformer_series_to_axis_points(
    lineformer_series: list[list[tuple[float, float]]],
    overlay: dict[str, Any],
) -> list[list[tuple[float, float]]]:
    plot_area = overlay.get("plot_area") if isinstance(overlay, dict) else None
    if not isinstance(plot_area, dict):
        return []

    try:
        left = float(plot_area["left"])
        top = float(plot_area["top"])
        right = float(plot_area["right"])
        bottom = float(plot_area["bottom"])
        x_domain = (float(overlay["x_domain"][0]), float(overlay["x_domain"][1]))
        y_domain = (float(overlay["y_domain"][0]), float(overlay["y_domain"][1]))
    except (KeyError, TypeError, ValueError, IndexError):
        return []

    span_x = right - left
    span_y = bottom - top
    if span_x <= VALUE_EPS or span_y <= VALUE_EPS:
        return []

    warp_x = _build_axis_warp(x_domain, overlay.get("x_axis_samples"))
    warp_y = _build_axis_warp(y_domain, overlay.get("y_axis_samples"))

    out: list[list[tuple[float, float]]] = []
    for series in lineformer_series:
        mapped: list[tuple[float, float]] = []
        for px, py in series:
            screen_x = (px - left) / span_x
            screen_y = (bottom - py) / span_y
            x = _axis_screen_to_value(screen_x, x_domain, warp_x)
            y = _axis_screen_to_value(screen_y, y_domain, warp_y)
            mapped.append((x, y))

        compacted = _sort_and_compact_points(mapped)
        if compacted:
            out.append(compacted)

    return out


def _extract_result_series_points(result_json: dict[str, Any]) -> list[list[tuple[float, float]]]:
    panels = result_json.get("panels")
    if not isinstance(panels, list):
        return []

    out: list[list[tuple[float, float]]] = []
    for panel in panels:
        if not isinstance(panel, dict):
            continue
        series_list = panel.get("series")
        if not isinstance(series_list, list):
            continue
        for series in series_list:
            if not isinstance(series, dict):
                continue
            points = _parse_point_series(series.get("points"))
            out.append(points)
    return out


def _replace_result_series_points(result_json: dict[str, Any], series_points: list[list[tuple[float, float]]]) -> dict[str, Any]:
    panels = result_json.get("panels")
    if not isinstance(panels, list):
        return result_json

    total_series = 0
    for panel in panels:
        if isinstance(panel, dict) and isinstance(panel.get("series"), list):
            total_series += len(panel["series"])

    if total_series != len(series_points):
        return result_json

    out = deepcopy(result_json)
    series_index = 0
    for panel in out.get("panels", []):
        if not isinstance(panel, dict):
            continue
        series_list = panel.get("series")
        if not isinstance(series_list, list):
            continue
        for series in series_list:
            if not isinstance(series, dict):
                continue
            next_points = series_points[series_index]
            series["points"] = [[x, y] for x, y in next_points]
            series.pop("curve_points", None)
            series_index += 1
    return out


def _series_lists_match(current_series: list[list[tuple[float, float]]], reference_series: list[list[tuple[float, float]]]) -> bool:
    if len(current_series) != len(reference_series):
        return False

    for current, reference in zip(current_series, reference_series):
        if len(current) != len(reference):
            return False
        if not current:
            continue

        sample_indexes = sorted({0, len(current) // 4, len(current) // 2, (3 * len(current)) // 4, len(current) - 1})
        for idx in sample_indexes:
            cx, cy = current[idx]
            rx, ry = reference[idx]
            if abs(cx - rx) > 1e-6 or abs(cy - ry) > 1e-6:
                return False

    return True


def ensure_editor_alignment(chart_id: int, result_json: dict[str, Any]) -> dict[str, Any]:
    search_root = _latest_worker_output_root(chart_id)
    if not search_root:
        return result_json

    raw_meta = result_json.get("ml_meta")
    raw_overlay = raw_meta.get("editor_overlay") if isinstance(raw_meta, dict) else None

    has_axis_samples = (
        isinstance(raw_overlay, dict)
        and isinstance(raw_overlay.get("x_axis_samples"), list)
        and len(raw_overlay.get("x_axis_samples")) >= 2
        and isinstance(raw_overlay.get("y_axis_samples"), list)
        and len(raw_overlay.get("y_axis_samples")) >= 2
    )

    enriched = deepcopy(result_json)
    overlay = raw_overlay if has_axis_samples else None
    if not overlay:
        overlay_meta = _build_overlay_from_search_root(search_root)
        if overlay_meta:
            base_meta = enriched.get("ml_meta")
            if not isinstance(base_meta, dict):
                base_meta = {}
            base_meta.update(overlay_meta)
            enriched["ml_meta"] = base_meta
            overlay = base_meta.get("editor_overlay") if isinstance(base_meta, dict) else None

    base_meta = enriched.get("ml_meta")
    if not isinstance(base_meta, dict):
        base_meta = {}

    point_source = str(base_meta.get("point_source") or "").strip().lower()
    if point_source == "lineformer_coordinates" or not isinstance(overlay, dict):
        enriched["ml_meta"] = base_meta
        return enriched

    lineformer_series = _extract_lineformer_series(search_root)
    if not lineformer_series:
        enriched["ml_meta"] = base_meta
        return enriched

    mapped_lineformer_points = _map_lineformer_series_to_axis_points(lineformer_series, overlay)
    if not mapped_lineformer_points:
        enriched["ml_meta"] = base_meta
        return enriched

    current_series = _extract_result_series_points(enriched)
    converted_series = _extract_converted_series(search_root)
    if not current_series or not converted_series:
        enriched["ml_meta"] = base_meta
        return enriched

    if _series_lists_match(current_series, converted_series):
        enriched = _replace_result_series_points(enriched, mapped_lineformer_points)
        base_meta = enriched.get("ml_meta")
        if not isinstance(base_meta, dict):
            base_meta = {}
        base_meta["point_source"] = "lineformer_coordinates"
        enriched["ml_meta"] = base_meta

    return enriched
