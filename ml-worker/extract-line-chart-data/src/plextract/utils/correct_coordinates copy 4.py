import json
import os
import numpy as np
from scipy.stats import linregress
from scipy.signal import medfilt
import matplotlib.pyplot as plt

def clean_ocr_value(v):
    if not v: return None
    cleaned = str(v).replace(",", ".").replace("'", ".").replace("`", ".").replace('"', ".")
    cleaned = cleaned.replace(" ", "")
    cleaned = "".join(c for c in cleaned if c.isdigit() or c in ".-")
    try: return float(cleaned)
    except: return None

def smooth_data(points, window=5):
    if len(points) < 8: return [points]
    points.sort(key=lambda p: p['x'])
    
    segments = []
    curr = [points[0]]
    for i in range(1, len(points)):
        dx = points[i]['x'] - points[i-1]['x']
        # Если дыра больше 40 пикселей - разрываем
        if dx > 40:
            if len(curr) > 5: segments.append(curr)
            curr = []
        curr.append(points[i])
    if len(curr) > 5: segments.append(curr)

    final_results = []
    for seg in segments:
        xs = np.array([p['x'] for p in seg])
        ys = np.array([p['y'] for p in seg])

        if ys[-1] > ys[0] + (abs(ys[0]) * 0.3):
            continue
            
        actual_w = window if len(ys) > window else (len(ys)//2*2-1)
        if actual_w >= 3: ys = medfilt(ys, kernel_size=actual_w)
        final_results.append([{"x": float(x), "y": float(y)} for x, y in zip(xs, ys)])
    return final_results

def get_robust_fit(pixels, values, direction):
    print(f"\n[DEBUG] Точки для оси {direction.upper()}:")
    for p, v in zip(pixels, values):
        print(f"  - Пиксель: {p:7.2f} | Значение: {v}")

    if len(pixels) < 2: return {"slope": 1.0, "intercept": 0.0, "type": "linear"}

    best_r2 = -1
    best_res = None
    best_type = "linear"

    for m_type in ["linear", "log"]:
        if m_type == "log" and np.any(values <= 0): continue
        target_vals = values if m_type == "linear" else np.log10(values)
        
        for i in range(len(pixels)):
            p_sub = np.delete(pixels, i)
            v_sub = np.delete(target_vals, i)
            res = linregress(p_sub, v_sub)
            if res.rvalue**2 > best_r2:
                best_r2 = res.rvalue**2
                best_res = res
                best_type = m_type

    print(f"  >>> ВЫБРАНО: {best_type.upper()} (R2={best_r2:.4f})")
    return {"slope": best_res.slope, "intercept": best_res.intercept, "type": best_type}

def correct_coordinates(base_output_dir: str, img: str):
    print(f"\t--- Калибровка: {img} ---")
    try:
        with open(f"{base_output_dir}/{img}/chartdete/label_coordinates.json", "r") as f:
            coords = json.load(f)
        with open(f"{base_output_dir}/{img}/axis_label_texts.json", "r") as f:
            texts = json.load(f)

        plot = coords.get("plot_area") # [x1, y1, x2, y2, conf]
        if not plot: raise ValueError("Plot area missing")

        px_x, val_x = [], []
        px_y, val_y = [], []

        for path, txt in texts.items():
            val = clean_ocr_value(txt)
            if val is None: continue
            
            box = coords[path]
            cx = (box[0] + box[2]) / 2
            cy = (box[1] + box[3]) / 2

            # X-метки должны быть НИЖЕ середины графика
            if cy > plot[1] + (plot[3]-plot[1])*0.5 and "xlabel" in path:
                px_x.append(cx)
                val_x.append(val)
            # Y-метки должны быть ЛЕВЕЕ середины графика
            elif cx < plot[0] + (plot[2]-plot[0])*0.5 and "ylabel" in path:
                px_y.append(cy)
                val_y.append(val)

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