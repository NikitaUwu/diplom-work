import json
import os
import numpy as np
from scipy.stats import linregress
from scipy.signal import medfilt

def clean_ocr_value(v):
    if not v: return None
    # Базовая очистка мусора
    cleaned = str(v).replace(",", ".").replace("'", ".").replace("`", ".").replace('"', ".")
    # Фиксы букв, похожих на цифры
    cleaned = cleaned.replace(" ", "").replace("O", "0").replace("o", "0").replace("l", "1")
    cleaned = "".join(c for c in cleaned if c.isdigit() or c in ".-")
    try: 
        val = float(cleaned)
        # Специфичные исправления ошибок OCR для логарифмических шкал Zitron
        if 1.1 <= val <= 1.19: val = 1.7
        if 2.2 <= val <= 2.29: val = 2.5
        return val
    except: 
        return None

def smooth_data_pixels(points, window=5):
    """Сглаживание и обрезка хвостов выполняется в ПИКСЕЛЯХ"""
    if len(points) < 8: return [points]
    points.sort(key=lambda p: p['x'])
    
    segments = []
    curr = [points[0]]
    for i in range(1, len(points)):
        dx = points[i]['x'] - points[i-1]['x']
        # Разрываем линию, если по оси X огромная дыра (больше 25 пикселей)
        if dx > 25:
            if len(curr) > 5: segments.append(curr)
            curr = []
        curr.append(points[i])
    if len(curr) > 5: segments.append(curr)

    final_results = []
    for seg in segments:
        xs = np.array([p['x'] for p in seg])
        ys = np.array([p['y'] for p in seg])

        # --- ЗАЩИТА ОТ КРЮКОВ (Как у красной линии) ---
        if len(xs) > 15:
            # Смотрим на поведение последних 5 точек
            tail_dx = xs[-1] - xs[-5]
            tail_dy = ys[-1] - ys[-5]
            
            # В координатах картинки: Y растет вниз. 
            # Если tail_dy < 0 (хвост загнулся вверх) 
            # ИЛИ dy почти 0 при большом dx (резкий горизонтальный скачок вправо)
            if tail_dy < 0 or (tail_dx > 10 and abs(tail_dy) < 3):
                # Просто отрезаем этот мусорный хвостик
                xs = xs[:-5]
                ys = ys[:-5]

        # Применяем медианный фильтр для гладкости
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
        
        # Перебор с отбрасыванием одной точки (Leave-One-Out)
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
            # 1. Выполняем очистку и сглаживание в ПИКСЕЛЯХ
            pixel_segments = smooth_data_pixels(s)
            
            for seg in pixel_segments:
                # 2. Переводим чистые пиксели в физические величины
                real_pts = [{"x": apply(p['x'], conversions['x']), "y": apply(p['y'], conversions['y'])} for p in seg]
                
                # 3. ФИЗИЧЕСКИЙ ФИЛЬТР
                ys = [p['y'] for p in real_pts]
                if len(ys) > 1 and ys[-1] > ys[0] + (abs(ys[0]) * 0.05):
                    # Если физическое давление в конце больше чем в начале -> это КПД/Мощность, удаляем!
                    continue
                    
                final_data[f"series_{idx}"] = real_pts
                idx += 1

        dest = f"{base_output_dir}/{img}/converted_datapoints"
        os.makedirs(dest, exist_ok=True)
        with open(f"{dest}/data.json", "w") as f:
            json.dump(final_data, f, indent=4)
        print(f"\t[SUCCESS] Done.")
    except Exception as e:
        print(f"\t[ERROR] {e}")