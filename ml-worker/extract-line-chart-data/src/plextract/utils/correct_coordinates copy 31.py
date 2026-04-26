import json
import os
import itertools
import numpy as np
from scipy.stats import linregress
from scipy.signal import medfilt

def clean_ocr_value(v):
    if not v: return None
    s = str(v).replace(",", ".").replace("'", ".").replace("`", ".").replace('"', ".")
    s = s.replace("O", "0").replace("o", "0").replace("l", "1")
    cleaned = "".join(c for c in s.replace(" ", "") if c.isdigit() or c in ".-")
    try:
        val = float(cleaned)
        # Специфичные исправления для Zitron (логарифм)
        if 1.1 <= val <= 1.19: val = 1.7
        if 2.2 <= val <= 2.29: val = 2.5
        return val
    except: return None

def smooth_data(points, window=5):
    if len(points) < 8: return [points]
    points.sort(key=lambda p: p['x'])
    
    segments = []
    curr = [points[0]]
    for i in range(1, len(points)):
        # Если дыра слишком большая, разрываем сегмент
        if points[i]['x'] - points[i-1]['x'] > max(40, (points[-1]['x'] - points[0]['x']) * 0.1):
            if len(curr) > 5: segments.append(curr)
            curr = []
        curr.append(points[i])
    if len(curr) > 5: segments.append(curr)

    final_results = []
    for seg in segments:
        xs = np.array([p['x'] for p in seg])
        ys = np.array([p['y'] for p in seg])

        if max(xs) - min(xs) > 1e-5:
            # 1. ФИЗИЧЕСКИЙ ФИЛЬТР (Удаление диагоналей КПД)
            slope, _, r_val, _, _ = linregress(xs, ys)
            if slope > 0 and r_val > 0.5:
                print(f"  [REJECT] Удалена растущая диагональ (наклон: {slope:.3f})")
                continue
            if ys[-1] > ys[0] + (abs(ys[0]) * 0.15):
                print("  [REJECT] Удалена линия (конец выше начала)")
                continue

            # 2. МАТЕМАТИЧЕСКОЕ СГЛАЖИВАНИЕ (Убиваем V-образные провалы от текста)
            # График вентилятора - это парабола. Строим полином 2-й степени.
            if len(xs) > 10:
                # Фильтруем явные "пики" перед построением полинома
                window_size = min(11, len(ys) if len(ys) % 2 != 0 else len(ys) - 1)
                if window_size >= 3:
                    local_median = medfilt(ys, kernel_size=window_size)
                    # Оставляем только те точки, которые не отлетают от медианы больше чем на 15%
                    valid_mask = np.abs(ys - local_median) < (np.abs(local_median) * 0.15 + 1e-9)
                    
                    if np.sum(valid_mask) > 5:
                        # Строим идеальную параболу по "хорошим" точкам
                        coefs = np.polyfit(xs[valid_mask], ys[valid_mask], 2)
                        poly = np.poly1d(coefs)
                        
                        # Заменяем кривые Y на идеальные расчетные Y
                        ys = poly(xs)

        final_results.append([{"x": float(x), "y": float(y)} for x, y in zip(xs, ys)])
    
    return final_results

def get_robust_fit(pixels, values, direction):
    print(f"\n[DEBUG] Калибровка оси {direction.upper()}:")
    raw_pts = sorted(list(set(zip(pixels, values))), key=lambda x: x[0])
    for p, v in raw_pts: print(f"  - Пиксель: {p:7.2f} | Значение: {v}")

    if len(raw_pts) < 2: return {"slope": 1.0, "intercept": 0.0, "type": "linear"}

    best_inliers, best_r2 = 0, -1
    best_res, best_type = None, "linear"

    for m_type in ["linear", "log"]:
        target_vals = []
        valid_pts = []
        for p, v in raw_pts:
            if m_type == "log" and v <= 0: continue
            target_vals.append(np.log10(v) if m_type == "log" else v)
            valid_pts.append(p)
            
        if len(valid_pts) < 2: continue
        
        p_arr = np.array(valid_pts)
        v_arr = np.array(target_vals)

        # Комбинаторный RANSAC: перебираем все пары точек
        for i, j in itertools.combinations(range(len(p_arr)), 2):
            p_pair = np.array([p_arr[i], p_arr[j]])
            v_pair = np.array([v_arr[i], v_arr[j]])
            
            slope = (v_pair[1] - v_pair[0]) / (p_pair[1] - p_pair[0] + 1e-9)
            intercept = v_pair[0] - slope * p_pair[0]
            
            # Считаем инлаеров (точки, которые ложатся на эту линию)
            inlier_indices = []
            for k, p_test in enumerate(p_arr):
                v_pred = slope * p_test + intercept
                # Толерантность: 5% отклонения
                if abs(v_pred - v_arr[k]) < max(0.05 * abs(v_arr[k]), 0.1):
                    inlier_indices.append(k)
                    
            if len(inlier_indices) >= 2:
                # Переобучаем на всех инлаерах
                res_inliers = linregress(p_arr[inlier_indices], v_arr[inlier_indices])
                if len(inlier_indices) > best_inliers or (len(inlier_indices) == best_inliers and res_inliers.rvalue**2 > best_r2):
                    best_inliers = len(inlier_indices)
                    best_r2 = res_inliers.rvalue**2
                    best_res = res_inliers
                    best_type = m_type

    # Страховка для логарифмической оси X
    if direction == 'x' and best_type == 'linear':
        log_targets = [np.log10(v) for p, v in raw_pts if v > 0]
        if len(log_targets) >= 2:
            log_p = [p for p, v in raw_pts if v > 0]
            res_log = linregress(log_p, log_targets)
            if res_log.rvalue**2 > 0.85:
                best_type, best_res, best_r2 = "log", res_log, res_log.rvalue**2

    # Fallback
    if best_res is None:
        best_res = linregress([x[0] for x in raw_pts], [x[1] for x in raw_pts])
        
    print(f"  >>> ВЫБРАНО: {best_type.upper()} (R2={best_r2:.4f}, Инлаеров={best_inliers}/{len(raw_pts)})")
    return {"slope": best_res.slope, "intercept": best_res.intercept, "type": best_type}

def correct_coordinates(base_output_dir: str, img: str):
    print(f"\t--- Калибровка: {img} ---")
    try:
        with open(f"{base_output_dir}/{img}/chartdete/label_coordinates.json", "r") as f:
            coords = json.load(f)
        with open(f"{base_output_dir}/{img}/axis_label_texts.json", "r") as f:
            texts = json.load(f)

        plot = coords.get("plot_area")
        if not plot: raise ValueError("Plot area missing")

        px_x, val_x, px_y, val_y = [], [], [], []

        for path, txt in texts.items():
            val = clean_ocr_value(txt)
            if val is None: continue
            
            box = coords[path]
            cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2

            if cy > plot[1] + (plot[3]-plot[1])*0.5 and "xlabel" in path:
                px_x.append(cx); val_x.append(val)
            elif cx < plot[0] + (plot[2]-plot[0])*0.5 and "ylabel" in path:
                px_y.append(cy); val_y.append(val)

        conversions = {
            "x": get_robust_fit(np.array(px_x), np.array(val_x), "x"),
            "y": get_robust_fit(np.array(px_y), np.array(val_y), "y")
        }

        with open(f"{base_output_dir}/{img}/lineformer/coordinates.json", "r") as f:
            raw_series = json.load(f)

        def apply(p, c):
            v = c["slope"] * p + c["intercept"]
            return 10**v if c["type"] == "log" else v

        final_data = {}
        idx = 0
        for s in raw_series:
            real_pts = [{"x": apply(p['x'], conversions['x']), "y": apply(p['y'], conversions['y'])} for p in s]
            for seg in smooth_data(real_pts):
                final_data[f"series_{idx}"] = seg
                idx += 1

        dest = f"{base_output_dir}/{img}/converted_datapoints"
        os.makedirs(dest, exist_ok=True)
        with open(f"{dest}/data.json", "w") as f:
            json.dump(final_data, f, indent=4)
        print(f"\t[SUCCESS] Done.")
    except Exception as e:
        print(f"\t[ERROR] {e}")