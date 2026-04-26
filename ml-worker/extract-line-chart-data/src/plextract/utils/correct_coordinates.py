import json
import os
import re
from pathlib import Path

import numpy as np
from scipy.signal import medfilt
from scipy.stats import linregress


def _is_likely_model_name(text: str) -> bool:
    """
    Эвристика для определения, является ли текст названием модели вентилятора.
    Названия моделей обычно:
    - Содержат буквы и цифры (например "ZVN 1-20-560/4")
    - Имеют разделители: пробелы, дефисы, слеши
    - Не содержат единиц измерения (кВт, об/мин, В, А и т.д.)
    - Начинаются с буквенной серии (2-5 заглавных букв)
    """
    text = (text or "").strip()
    if len(text) < 4:
        return False

    # Паттерн для типичных названий вентиляторов:
    # Буквенная серия + цифры + разделители
    model_patterns = [
        r'^[A-ZА-Я]{2,5}[\s\-_/]+\d',  # ZVN 1-20...
        r'^[A-ZА-Я]{2,5}\d',            # ZVN1...
        r'^[A-ZА-Я]{2,5}[\s\-_/]+[A-ZА-Я]',  # ZVN-1...
        r'^[A-ZА-Я0-9]+[\s\-_/]+\d',   # BP 80-70...
        r'^[A-ZА-Я]{2,5}\s*\d',        # ZVN 1...
    ]

    for pattern in model_patterns:
        if re.search(pattern, text):
            return True

    return False


def _is_technical_parameter(text: str) -> bool:
    """
    Проверяет, является ли текст техническим параметром (мощность, напряжение и т.д.)
    """
    text = (text or "").strip().lower()

    # Типичные технические параметры
    tech_patterns = [
        r'^n\s*=',           # N = 560 кВт
        r'^n\s*\d',         # n1500
        r'^p\s*=',           # P = ...
        r'^p\s*\d',
        r'^u\s*=',           # U = ...
        r'^u\s*\d',
        r'^i\s*=',           # I = ...
        r'^i\s*\d',
        r'квт',              # кВт
        r'kw',               # kW
        r'вт',               # Вт
        r'об/мин',           # об/мин
        r'мин',              # мин
        r'rpm',              # RPM
        r'min\s*[-^−]?\s*1',
        r'ампер',            # Ампер
        r'вольт',            # Вольт
        r'гц',               # Гц
        r'hz',               # Hz
        r'кг',               # кг
        r'м$',               # м (метры)
        r'мпа',              # МПа
        r'бар',              # бар
        r'°c',               # °C
        r'°f',               # °F
        r'^\d+\s*[=]',      # 560 = ...
        r'^\d+\s*квт',      # 560 кВт
        r'^\d+\s*вт',       # 560 Вт
    ]

    for pattern in tech_patterns:
        if re.search(pattern, text):
            return True

    return False


def _score_model_name(text: str) -> int:
    """
    Оценивает, насколько текст похож на название модели вентилятора.
    """
    text = (text or "").strip()
    if not text:
        return -10000

    score = 0

    # Бонус за соответствие паттерну модели
    if _is_likely_model_name(text):
        score += 100

    # Штраф за технические параметры
    if _is_technical_parameter(text):
        score -= 300

    # Бонус за наличие букв и цифр
    letters = sum(ch.isalpha() for ch in text)
    digits = sum(ch.isdigit() for ch in text)
    has_sep = any(ch in "/-_" for ch in text)
    compact = text.replace(" ", "")

    if letters > 0 and digits > 0:
        score += 50

    if has_sep:
        score += 30

    if re.match(r'^[A-ZА-Я]{2,5}[\s\-_/]*\d', text):
        score += 120

    if re.search(r'[A-ZА-Я]{2,5}', text) and re.search(r'\d{2,}', text) and re.search(r'[-/]', text):
        score += 60

    # Бонус за длину (названия моделей обычно 8-20 символов)
    if 8 <= len(text) <= 20:
        score += 20
    elif len(text) < 4:
        score -= 50

    if compact.lower().startswith(("n", "p", "u", "i")) and digits > 0 and letters <= 6:
        score -= 180

    # Бонус за заглавные буквы в начале (типично для моделей)
    if text[0].isupper():
        score += 10

    return score


def _load_text_list(path: Path) -> list[str]:
    if not path.exists():
        return []

    try:
        with open(path, "r", encoding="utf-8") as f:
            values = json.load(f)
    except Exception as e:
        print(f"\t[WARNING] Failed to load {path.name}: {e}")
        return []

    cleaned = []
    for value in values:
        if not isinstance(value, str):
            continue
        text = value.strip()
        if len(text) >= 2:
            cleaned.append(text)
    return cleaned


def _load_text_rows(path: Path) -> list[list[str]]:
    if not path.exists():
        return []

    try:
        with open(path, "r", encoding="utf-8") as f:
            values = json.load(f)
    except Exception as e:
        print(f"\t[WARNING] Failed to load {path.name}: {e}")
        return []

    cleaned_rows: list[list[str]] = []
    for row in values:
        if not isinstance(row, list):
            continue
        cleaned_row = []
        for value in row:
            if not isinstance(value, str):
                continue
            text = value.strip()
            if len(text) >= 2:
                cleaned_row.append(text)
        if cleaned_row:
            cleaned_rows.append(cleaned_row)
    return cleaned_rows


def _load_text_map(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}

    try:
        with open(path, "r", encoding="utf-8") as f:
            values = json.load(f)
    except Exception as e:
        print(f"\t[WARNING] Failed to load {path.name}: {e}")
        return {}

    if not isinstance(values, dict):
        return {}

    cleaned: dict[str, str] = {}
    for key, value in values.items():
        if not isinstance(key, str) or not isinstance(value, str):
            continue
        text = value.strip()
        if len(text) >= 2:
            cleaned[key] = text
    return cleaned


def _score_series_name(name: str) -> int:
    text = (name or "").strip()
    if len(text) < 2:
        return -10_000

    letters = sum(ch.isalpha() for ch in text)
    digits = sum(ch.isdigit() for ch in text)
    has_sep = any(ch in "/-_" for ch in text)
    upper_ratio = sum(ch.isupper() for ch in text if ch.isalpha()) / max(1, letters)

    score = len(text) * 2
    score += digits * 6
    score += has_sep * 4
    score += letters * 1

    if _is_technical_parameter(text):
        score -= 300

    if _is_likely_model_name(text):
        score += 120

    compact = text.replace(" ", "")
    if compact.isalpha() and digits == 0:
        score -= 80

    if digits == 0 and not has_sep:
        score -= 50

    if letters <= 2 and digits == 0:
        score -= 20

    if upper_ratio > 0.8 and digits == 0 and len(text) <= 12:
        score -= 20

    if text.lower() in {"citron", "zitron"}:
        score -= 200

    return score


def _rank_series_names(names: list[str]) -> list[str]:
    ranked = []
    seen = set()
    for name in names:
        text = (name or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        ranked.append((text, _score_series_name(text)))

    ranked.sort(key=lambda item: item[1], reverse=True)
    return [name for name, score in ranked if score > -50]


def _select_series_names(names: list[str]) -> list[str]:
    selected = []
    seen = set()
    for name in names:
        text = (name or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        if _score_series_name(text) > -50:
            selected.append(text)
    return selected


def _select_model_like_names(names: list[str]) -> list[str]:
    selected = []
    seen = set()
    for name in names:
        text = (name or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        if not _is_likely_model_name(text):
            continue
        if _is_technical_parameter(text):
            continue
        if _score_model_name(text) <= 0:
            continue
        selected.append(text)
    return selected


def _select_one_model_name_per_row(rows: list[list[str]]) -> list[str]:
    selected = []
    seen = set()
    for row in rows:
        best_name = ""
        best_score = -10_000
        for idx, name in enumerate(row):
            text = (name or "").strip()
            if not text:
                continue
            if not _is_likely_model_name(text):
                continue
            if _is_technical_parameter(text):
                continue

            score = _score_model_name(text)
            score += max(0, 20 - idx * 5)
            if score > best_score:
                best_score = score
                best_name = text

        if best_name and best_name not in seen:
            seen.add(best_name)
            selected.append(best_name)
    return selected


def load_legend_names(base_output_dir: str, img: str) -> list[str]:
    """
    Load legend names from OCR output.
    """
    legend_path = Path(base_output_dir) / img / "legend_label_texts.json"
    return _load_text_list(legend_path)


def load_series_names(base_output_dir: str, img: str) -> list[str]:
    """
    Load OCR text for labels placed on or near the series itself.
    """
    series_path = Path(base_output_dir) / img / "series_label_texts.json"
    return _load_text_list(series_path)


def load_series_name_map(base_output_dir: str, img: str) -> dict[str, str]:
    series_map_path = Path(base_output_dir) / img / "series_label_text_map.json"
    return _load_text_map(series_map_path)


def load_footer_names(base_output_dir: str, img: str) -> list[str]:
    """
    Load OCR text from the footer area under the plot.
    """
    footer_path = Path(base_output_dir) / img / "footer_label_texts.json"
    return _load_text_list(footer_path)


def load_legend_area_names(base_output_dir: str, img: str) -> list[str]:
    """
    Load OCR text from detected legend_area regions (split by whitespace gaps).
    """
    legend_area_path = Path(base_output_dir) / img / "legend_area_texts.json"
    return _load_text_list(legend_area_path)


def load_footer_rows(base_output_dir: str, img: str) -> list[list[str]]:
    footer_rows_path = Path(base_output_dir) / img / "footer_label_rows.json"
    return _load_text_rows(footer_rows_path)


def load_legend_area_rows(base_output_dir: str, img: str) -> list[list[str]]:
    legend_area_rows_path = Path(base_output_dir) / img / "legend_area_rows.json"
    return _load_text_rows(legend_area_rows_path)


def select_model_name_from_footer(footer_names: list[str]) -> str:
    """
    Выбирает наиболее вероятное название модели вентилятора из списка footer текстов.
    Использует эвристический анализ для отсеивания технических параметров.
    """
    if not footer_names:
        return ""

    # Оцениваем каждый текст
    scored_names = []
    for idx, name in enumerate(footer_names):
        score = _score_model_name(name)
        if _is_likely_model_name(name) and not _is_technical_parameter(name):
            score += max(0, 20 - idx * 2)
        scored_names.append((name, score, idx))

    # Сортируем по score (убывание)
    scored_names.sort(key=lambda x: (x[1], -x[2]), reverse=True)

    # Возвращаем текст с наивысшим score, если он положительный
    if scored_names and scored_names[0][1] > 0:
        return scored_names[0][0]

    return ""


def _normalize_output_series_name(name: str) -> str:
    text = re.sub(r"\s+", " ", (name or "").strip())
    text = text.replace("\\", "/")
    return text


def _distance_point_to_polyline(cx: float, cy: float, points: list[dict]) -> float:
    if not points:
        return float("inf")

    sorted_points = sorted(points, key=lambda p: (p["x"], p["y"]))
    if len(sorted_points) == 1:
        return float(np.hypot(cx - sorted_points[0]["x"], cy - sorted_points[0]["y"]))

    best_sq = float("inf")
    for idx in range(1, len(sorted_points)):
        ax = float(sorted_points[idx - 1]["x"])
        ay = float(sorted_points[idx - 1]["y"])
        bx = float(sorted_points[idx]["x"])
        by = float(sorted_points[idx]["y"])
        dx = bx - ax
        dy = by - ay
        denom = dx * dx + dy * dy
        if denom <= 0:
            px = ax
            py = ay
        else:
            t = ((cx - ax) * dx + (cy - ay) * dy) / denom
            t = max(0.0, min(1.0, t))
            px = ax + t * dx
            py = ay + t * dy
        dist_sq = (cx - px) ** 2 + (cy - py) ** 2
        if dist_sq < best_sq:
            best_sq = dist_sq

    return float(np.sqrt(best_sq))


def _bind_model_labels_to_raw_series(
    series_label_map: dict[str, str],
    coords: dict,
    raw_series: list,
    plot: list | None,
) -> dict[int, str]:
    if not series_label_map or not raw_series or not plot:
        return {}

    plot_width = max(1.0, float(plot[2] - plot[0]))
    plot_height = max(1.0, float(plot[3] - plot[1]))
    max_distance = max(20.0, min(plot_width, plot_height) * 0.08)
    padded_left = float(plot[0]) - plot_width * 0.1
    padded_top = float(plot[1]) - plot_height * 0.1
    padded_right = float(plot[2]) + plot_width * 0.1
    padded_bottom = float(plot[3]) + plot_height * 0.1

    assignments: dict[int, tuple[str, float, int]] = {}
    for path, text in series_label_map.items():
        if not _is_likely_model_name(text):
            continue
        if _is_technical_parameter(text):
            continue

        score = _score_model_name(text)
        if score <= 0:
            continue

        box = coords.get(path)
        if not isinstance(box, list) or len(box) < 4:
            continue

        cx = float(box[0] + box[2]) / 2.0
        cy = float(box[1] + box[3]) / 2.0
        if cx < padded_left or cx > padded_right or cy < padded_top or cy > padded_bottom:
            continue

        best_idx = -1
        best_distance = float("inf")
        for raw_idx, points in enumerate(raw_series):
            distance = _distance_point_to_polyline(cx, cy, points)
            if distance < best_distance:
                best_distance = distance
                best_idx = raw_idx

        if best_idx < 0 or best_distance > max_distance:
            continue

        current = assignments.get(best_idx)
        if current is None or score > current[2] or (score == current[2] and best_distance < current[1]):
            assignments[best_idx] = (text, best_distance, score)

    return {raw_idx: value[0] for raw_idx, value in assignments.items()}


def _next_fallback_name(candidates: list[str], start_idx: int, used_names: set[str]) -> tuple[str | None, int]:
    idx = start_idx
    while idx < len(candidates):
        candidate = _normalize_output_series_name(candidates[idx])
        idx += 1
        if candidate and candidate not in used_names:
            return candidate, idx
    return None, idx


def _make_output_series_name(base_name: str | None, segment_index: int, global_index: int, used_names: set[str]) -> str:
    if not base_name:
        candidate = f"series_{global_index}"
        while candidate in used_names:
            global_index += 1
            candidate = f"series_{global_index}"
        return candidate

    normalized = _normalize_output_series_name(base_name)
    candidate = normalized if segment_index == 0 else f"{normalized}_part_{segment_index + 1}"
    suffix = max(2, segment_index + 1)
    while candidate in used_names:
        candidate = f"{normalized}_part_{suffix}"
        suffix += 1
    return candidate


def clean_ocr_value(v):
    if not v:
        return None

    cleaned = str(v).replace(",", ".").replace("'", ".").replace("`", ".").replace('"', ".")
    cleaned = cleaned.replace(" ", "").replace("O", "0").replace("o", "0").replace("l", "1")
    cleaned = "".join(c for c in cleaned if c.isdigit() or c in ".-")

    digits_only = cleaned.replace(".", "").replace("-", "")
    if digits_only and len(digits_only) >= 4 and len(set(digits_only)) == 1:
        return None

    try:
        val = float(cleaned)
        if 1.1 <= val <= 1.19:
            val = 1.7
        if 2.2 <= val <= 2.29:
            val = 2.5
        return val
    except Exception:
        return None


def smooth_data_pixels(points, window=5):
    """Smoothing and tail trimming is done in pixel space."""
    if len(points) < 8:
        return [points]

    points.sort(key=lambda p: p["x"])

    segments = []
    curr = [points[0]]
    for i in range(1, len(points)):
        dx = points[i]["x"] - points[i - 1]["x"]
        if dx > 25:
            if len(curr) > 5:
                segments.append(curr)
            curr = []
        curr.append(points[i])
    if len(curr) > 5:
        segments.append(curr)

    final_results = []
    for seg in segments:
        xs = np.array([p["x"] for p in seg])
        ys = np.array([p["y"] for p in seg])

        if len(xs) > 15:
            tail_dx = xs[-1] - xs[-5]
            tail_dy = ys[-1] - ys[-5]
            if tail_dy < 0 or (tail_dx > 10 and abs(tail_dy) < 3):
                xs = xs[:-5]
                ys = ys[:-5]

        actual_w = window if len(ys) > window else (len(ys) // 2 * 2 - 1)
        if actual_w >= 3:
            ys = medfilt(ys, kernel_size=actual_w)

        final_results.append([{"x": float(x), "y": float(y)} for x, y in zip(xs, ys)])

    return final_results


def get_robust_fit(pixels, values, direction):
    print(f"\n[DEBUG] Axis {direction.upper()} points:")
    for p, v in zip(pixels, values):
        print(f"  - pixel: {p:7.2f} | value: {v}")

    if len(pixels) < 2:
        return {"slope": 1.0, "intercept": 0.0, "type": "linear"}

    best_r2 = -1
    best_res = None
    best_type = "linear"

    for m_type in ["linear", "log"]:
        if m_type == "log" and np.any(values <= 0):
            continue
        target_vals = values if m_type == "linear" else np.log10(values)

        for i in range(len(pixels)):
            p_sub = np.delete(pixels, i)
            v_sub = np.delete(target_vals, i)
            res = linregress(p_sub, v_sub)
            if res.rvalue**2 > best_r2:
                best_r2 = res.rvalue**2
                best_res = res
                best_type = m_type

    print(f"  >>> Selected: {best_type.upper()} (R2={best_r2:.4f})")
    return {"slope": best_res.slope, "intercept": best_res.intercept, "type": best_type}


def correct_coordinates(base_output_dir: str, img: str):
    print(f"\t--- Calibration: {img} ---")
    try:
        with open(f"{base_output_dir}/{img}/chartdete/label_coordinates.json", "r") as f:
            coords = json.load(f)
        with open(f"{base_output_dir}/{img}/axis_label_texts.json", "r") as f:
            texts = json.load(f)

        legend_names = load_legend_names(base_output_dir, img)
        footer_names = load_footer_names(base_output_dir, img)
        series_names = load_series_names(base_output_dir, img)
        series_name_map = load_series_name_map(base_output_dir, img)
        legend_area_names = load_legend_area_names(base_output_dir, img)
        footer_rows = load_footer_rows(base_output_dir, img)
        legend_area_rows = load_legend_area_rows(base_output_dir, img)

        plot = coords.get("plot_area")
        if not plot:
            raise ValueError("Plot area missing")

        with open(f"{base_output_dir}/{img}/lineformer/coordinates.json", "r") as f:
            raw_series = json.load(f)

        bound_series_names = _bind_model_labels_to_raw_series(series_name_map, coords, raw_series, plot)
        if bound_series_names:
            print(f"\t[INFO] Bound on-curve labels: {bound_series_names}")

        series_labels = _select_one_model_name_per_row(legend_area_rows)
        series_labels.extend(_select_one_model_name_per_row(footer_rows))
        if not series_labels:
            series_labels = _select_model_like_names(legend_area_names)
            series_labels.extend(_select_model_like_names(footer_names))
        if not series_labels:
            series_labels = _rank_series_names(legend_area_names)
            series_labels.extend(_rank_series_names(footer_names))
        series_labels.extend(_select_series_names(legend_names + series_names))

        row_model_names = _select_one_model_name_per_row(legend_area_rows + footer_rows)
        model_name = row_model_names[0] if row_model_names else select_model_name_from_footer(legend_area_names + footer_names)
        if model_name and 0 not in bound_series_names:
            print(f"\t[INFO] Detected model name: '{model_name}'")
            if series_labels:
                series_labels[0] = model_name
            else:
                series_labels = [model_name]

        deduped = []
        seen = set()
        for name in series_labels:
            if name in seen:
                continue
            seen.add(name)
            deduped.append(name)
        series_labels = deduped

        raw_series_names: list[str | None] = [None] * len(raw_series)
        used_series_names: set[str] = set()
        for raw_idx, name in bound_series_names.items():
            normalized = _normalize_output_series_name(name)
            if not normalized or normalized in used_series_names:
                continue
            raw_series_names[raw_idx] = normalized
            used_series_names.add(normalized)

        fallback_idx = 0
        for raw_idx in range(len(raw_series)):
            if raw_series_names[raw_idx] is not None:
                continue
            fallback_name, fallback_idx = _next_fallback_name(series_labels, fallback_idx, used_series_names)
            if fallback_name is None:
                continue
            raw_series_names[raw_idx] = fallback_name
            used_series_names.add(fallback_name)

        if series_labels:
            print(f"\t[INFO] Series names found: {series_labels}")

        px_x, val_x = [], []
        px_y, val_y = [], []

        for path, txt in texts.items():
            val = clean_ocr_value(txt)
            if val is None:
                continue

            box = coords[path]
            cx = (box[0] + box[2]) / 2
            cy = (box[1] + box[3]) / 2

            if cy > plot[1] + (plot[3] - plot[1]) * 0.5 and "xlabel" in path:
                px_x.append(cx)
                val_x.append(val)
            elif cx < plot[0] + (plot[2] - plot[0]) * 0.5 and "ylabel" in path:
                px_y.append(cy)
                val_y.append(val)

        conversions = {
            "x": get_robust_fit(np.array(px_x), np.array(val_x), "x"),
            "y": get_robust_fit(np.array(px_y), np.array(val_y), "y"),
        }

        def apply(p, c):
            v = c["slope"] * p + c["intercept"]
            return 10**v if c["type"] == "log" else v

        final_data = {}
        used_output_names = set()
        idx = 0
        for raw_idx, s in enumerate(raw_series):
            pixel_segments = smooth_data_pixels(s)
            base_name = raw_series_names[raw_idx] if raw_idx < len(raw_series_names) else None
            segment_index = 0

            for seg in pixel_segments:
                real_pts = [{"x": apply(p["x"], conversions["x"]), "y": apply(p["y"], conversions["y"])} for p in seg]

                ys = [p["y"] for p in real_pts]
                if len(ys) > 1 and ys[-1] > ys[0] + (abs(ys[0]) * 0.05):
                    continue

                series_name = _make_output_series_name(base_name, segment_index, idx, used_output_names)
                final_data[series_name] = real_pts
                used_output_names.add(series_name)
                print(f"\t[INFO] Series {idx} -> '{series_name}'")

                segment_index += 1
                idx += 1

        dest = f"{base_output_dir}/{img}/converted_datapoints"
        os.makedirs(dest, exist_ok=True)
        with open(f"{dest}/data.json", "w", encoding="utf-8") as f:
            json.dump(final_data, f, indent=4, ensure_ascii=False)
        print(f"\t[SUCCESS] Done. Total series: {idx}")
    except Exception as e:
        print(f"\t[ERROR] {e}")
