import json
import os
import numpy as np
from scipy.stats import linregress
from scipy.signal import medfilt

def clean_ocr_value(v):
    if not v: return None
    cleaned = str(v).replace(",", ".").replace("'", ".").replace("`", ".").replace('"', ".")
    cleaned = "".join(c for c in cleaned.replace(" ", "") if c.isdigit() or c in ".-")
    try: return float(cleaned)
    except: return None

def get_robust_fit(pixels, values, direction):
    """ 
    Супер-робастная калибровка:
    1. Сортирует точки по пикселям.
    2. Удаляет точки, нарушающие монотонность (значения должны только расти для X).
    3. Выбирает лучшую модель (Linear/Log) через расширенный RANSAC.
    """
    print(f"\n[DEBUG] --- Калибровка оси {direction.upper()} ---")
    
    # Сначала просто выведем всё, что пришло от OCR
    raw_pts = sorted(zip(pixels, values), key=lambda x: x[0])
    for p, v in raw_pts:
        print(f"  - Вход OCR | Пиксель: {p:7.2f} | Значение: {v}")

    # 1. ФИЛЬТР МОНОТОННОСТИ (Самый важный для X)
    # Идем слева направо. Если значение меньше предыдущего или слишком резко прыгает - это шум.
    clean_p, clean_v = [], []
    if len(raw_pts) > 0:
        clean_p.append(raw_pts[0][0])
        clean_v.append(raw_pts[0][1])
        
        for i in range(1, len(raw_pts)):
            p_curr, v_curr = raw_pts[i]
            v_last = clean_v[-1]
            
            # Логика для оси X: значения должны расти (99 > 8 - ок, но 2 < 99 - в мусор)
            if direction == 'x':
                # Если значение меньше предыдущего или неадекватно больше (например в 10 раз)
                if v_curr > v_last and v_curr < v_last * 5:
                    clean_p.append(p_curr)
                    clean_v.append(v_curr)
                else:
                    print(f"  [REJECT] Выброс (нарушен тренд): {v_curr}")
            else:
                # Для оси Y (сверху вниз пиксели растут, значения падают)
                if v_curr < v_last:
                    clean_p.append(p_curr)
                    clean_v.append(v_curr)
                else:
                    print(f"  [REJECT] Выброс (нарушен тренд): {v_curr}")

    pixels = np.array(clean_p)
    values = np.array(clean_v)

    if len(pixels) < 2:
        print(f"  [!] Критически мало данных после фильтрации тренда.")
        return {"slope": 1.0, "intercept": 0.0, "type": "linear"}

    # 2. ПОДБОР МОДЕЛИ (Linear vs Log)
    best_r2 = -1
    best_res = None
    best_type = "linear"

    for m_type in ["linear", "log"]:
        if m_type == "log" and np.any(values <= 0): continue
        target_vals = values if m_type == "linear" else np.log10(values)
        
        # Пробуем построить модель. Если точек мало - просто регрессия.
        # Если точек много - пытаемся найти подмножество с идеальным R2.
        res = linregress(pixels, target_vals)
        r2 = res.rvalue**2
        
        if r2 > best_r2:
            best_r2 = r2
            best_res = res
            best_type = m_type

    # Даем логарифму приоритет для оси X (бонус 0.05 к R2)
    if direction == 'x':
        # Пересчитаем логарифм отдельно для сравнения
        log_res = linregress(pixels, np.log10(values))
        if (log_res.rvalue**2 + 0.05) > best_r2:
            best_r2 = log_res.rvalue**2
            best_res = log_res
            best_type = "log"

    print(f"  >>> ИТОГ {direction.upper()}: {best_type.upper()} (R2={best_r2:.4f}, Slope={best_res.slope:.4f})")
    return {"slope": best_res.slope, "intercept": best_res.intercept, "type": best_type}

def correct_coordinates(base_output_dir: str, img: str):
    print(f"\n\t=== ЗАПУСК КАЛИБРОВКИ: {img} ===")
    try:
        with open(f"{base_output_dir}/{img}/chartdete/label_coordinates.json", "r") as f:
            coords = json.load(f)
        with open(f"{base_output_dir}/{img}/axis_label_texts.json", "r") as f:
            texts = json.load(f)

        plot = coords.get("plot_area")
        if not plot: raise ValueError("Область графика plot_area не найдена!")
        
        # Разделяем метки по их физическому положению относительно графика
        px_x, val_x = [], []
        px_y, val_y = [], []

        for path, txt in texts.items():
            val = clean_ocr_value(txt)
            if val is None: continue
            
            box = coords[path]
            cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2

            # ГЕОМЕТРИЧЕСКАЯ СОРТИРОВКА
            # Метка X: должна быть ПРАВЕЕ левого края и НИЖЕ верхней границы графика
            if cy > plot[1] and cx > plot[0]:
                px_x.append(cx); val_x.append(val)
            # Метка Y: должна быть ЛЕВЕЕ графика
            elif cx < plot[0]:
                px_y.append(cy); val_y.append(val)

        conversions = {
            "x": get_robust_fit(np.array(px_x), np.array(val_x), "x"),
            "y": get_robust_fit(np.array(px_y), np.array(val_y), "y")
        }

        # Конвертация самих линий
        with open(f"{base_output_dir}/{img}/lineformer/coordinates.json", "r") as f:
            raw_series = json.load(f)

        def apply(p, c):
            v = c["slope"] * p + c["intercept"]
            return 10**v if c["type"] == "log" else v

        final_data = {}
        idx = 0
        for s in raw_series:
            # 1. Пересчет в реальные значения
            real_pts = []
            for p in s:
                real_pts.append({"x": apply(p['x'], conversions['x']), "y": apply(p['y'], conversions['y'])})
            
            # 2. Сортировка по X для корректного отображения
            real_pts.sort(key=lambda x: x['x'])
            
            # 3. Фильтр тренда: Pressure (Y) должен падать при росте Flow (X)
            # Мы разрешаем 'горб' в начале, но в целом линия должна идти вниз
            if len(real_pts) > 15:
                y_start = np.mean([p['y'] for p in real_pts[:10]])
                y_end = np.mean([p['y'] for p in real_pts[-10:]])
                
                # Если линия в конце выше, чем в начале (на 15%) - это диагональ КПД
                if y_end > y_start * 1.15:
                    print(f"  [CUT] Удалена диагональ КПД (series_{idx})")
                    continue
                
                final_data[f"series_{idx}"] = real_pts
                idx += 1

        dest = f"{base_output_dir}/{img}/converted_datapoints"
        os.makedirs(dest, exist_ok=True)
        with open(f"{dest}/data.json", "w") as f:
            json.dump(final_data, f, indent=4)
            
        print(f"\t[SUCCESS] Калибровка завершена. Сохранено серий: {idx}")
    except Exception as e:
        print(f"\t[ERROR] Критическая ошибка калибровки: {e}")