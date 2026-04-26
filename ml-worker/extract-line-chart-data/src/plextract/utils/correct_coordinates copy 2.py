import json
import os
import numpy as np
from scipy.stats import linregress
from scipy.signal import medfilt
import matplotlib.pyplot as plt

def clean_ocr_value(v):
    """Очистка текста: заменяем запятые/кавычки на точки и убираем пробелы"""
    if not v: return None
    cleaned = str(v).replace(",", ".").replace("'", ".").replace("`", ".").replace('"', ".")
    cleaned = cleaned.replace(" ", "")
    cleaned = "".join(c for c in cleaned if c.isdigit() or c in ".-")
    try:
        return float(cleaned)
    except ValueError:
        return None

def smooth_data(points, window=7):
    """
    Профессиональное сглаживание:
    1. Удаление вертикальных "хвостов" (детектор осей/текста).
    2. Медианный фильтр.
    3. Скользящее среднее.
    """
    if len(points) < 10:
        return points
    
    # Сортируем по X
    points.sort(key=lambda p: p['x'])
    
    xs = np.array([p['x'] for p in points])
    ys = np.array([p['y'] for p in points])

    # --- НОВЫЙ БЛОК: Детектор вертикальных аномалий (Slope Filter) ---
    valid_indices = []
    
    # Считаем типичный наклон линии. 
    # Если на старте наклон почти вертикальный (dy >> dx), это шум.
    for i in range(len(xs)):
        if i < 5: # Проверка начала линии (самое проблемное место)
            # Смотрим наклон к следующей точке
            dx = abs(xs[i+1] - xs[i]) if i+1 < len(xs) else 1
            dy = abs(ys[i+1] - ys[i]) if i+1 < len(ys) else 0
            # Если линия слишком "крутая" (почти вертикальная), пропускаем точку
            if dy / (dx + 1e-6) > 10.0: # Порог наклона (10 = ~85 градусов)
                continue
        valid_indices.append(i)

    if len(valid_indices) < 5: return points
    
    xs = xs[valid_indices]
    ys = ys[valid_indices]
    # ----------------------------------------------------------------

    # Применяем фильтры
    actual_window = window if len(ys) > window else (len(ys) // 2 * 2 - 1)
    if actual_window < 3: actual_window = 3

    # Убираем резкие выбросы
    ys_fixed = medfilt(ys, kernel_size=actual_window)
    
    # Делаем линию плавной (Скользящее среднее)
    smoothed_ys = np.convolve(ys_fixed, np.ones(window)/window, mode='same')
    
    # Чиним края после конволюции
    smoothed_ys[:window] = ys_fixed[:window]
    smoothed_ys[-window:] = ys_fixed[-window:]
    
    return [{"x": float(x), "y": float(y)} for x, y in zip(xs, smoothed_ys)]

def sort_and_check_labels(label_coordinates: dict, axis_label_texts: dict, img_key: str):
    print("\tNow starting to sort and check labels...")
    ocr_values = {}
    for k, v in axis_label_texts.items():
        if "plot_area" in k: continue
        val = clean_ocr_value(v)
        if val is not None: ocr_values[k] = val

    xaggr, yaggr = {}, {}
    for k, val in ocr_values.items():
        if k not in label_coordinates: continue
        coord = label_coordinates[k]
        if "xlabel" in k: xaggr[k] = {"coord": coord, "val": val}
        elif "ylabel" in k: yaggr[k] = {"coord": coord, "val": val}

    print(f"\t[OK] Собрано меток: X={len(xaggr)}, Y={len(yaggr)}")
    return {"xs": xaggr, "ys": yaggr}

def calc_conversion(coord_val_map: dict):
    print("Calculating conversions with Scale Detection...")

    def get_best_fit(coord_map: dict, direction="x"):
        if len(coord_map) < 2: return {"slope": 1.0, "intercept": 0.0, "type": "linear"}

        print(f"\n[DEBUG] Точки для оси {direction.upper()}:")
        raw_data = []
        for k, v in coord_map.items():
            coord = v["coord"]
            center = (coord[0] + coord[2]) / 2 if direction == "x" else (coord[1] + coord[3]) / 2
            raw_data.append({"pixel": center, "val": v["val"]})

        raw_data.sort(key=lambda x: x["pixel"])
        
        clean_data = []
        if len(raw_data) >= 2:
            clean_data.append(raw_data[0])
            for i in range(1, len(raw_data)):
                cur, last = raw_data[i], clean_data[-1]
                if (direction == "x" and cur["val"] > last["val"]) or (direction == "y" and cur["val"] < last["val"]):
                    clean_data.append(cur)
                else:
                    print(f"  [REJECT] Выброс OCR: {cur['val']}")

        if len(clean_data) < 2: clean_data = raw_data

        pixels = np.array([x["pixel"] for x in clean_data])
        values = np.array([x["val"] for x in clean_data])
        for d in clean_data: print(f"  - Использую: {d['val']:7} | Пиксель: {d['pixel']:.2f}")

        res_lin = linregress(pixels, values)
        r_lin = res_lin.rvalue ** 2

        r_log = -1
        res_log = None
        if np.all(values > 0):
            try:
                res_log = linregress(pixels, np.log10(values))
                r_log = res_log.rvalue ** 2
            except: pass

        if r_log > r_lin and r_log > 0.95:
            print(f"  >>> ЛОГАРИФМИЧЕСКАЯ ШКАЛА (R2={r_log:.4f})")
            return {"slope": res_log.slope, "intercept": res_log.intercept, "type": "log"}
        else:
            print(f"  >>> ЛИНЕЙНАЯ ШКАЛА (R2={r_lin:.4f})")
            return {"slope": res_lin.slope, "intercept": res_lin.intercept, "type": "linear"}

    return {"x": get_best_fit(coord_val_map["xs"], "x"), "y": get_best_fit(coord_val_map["ys"], "y")}

def convert_data_points(conversions, base_output_dir: str, img: str, label_coordinates: dict):
    print("Converting and Smoothing data points...")
    coords_path = f"{base_output_dir}/{img}/lineformer/coordinates.json"
    with open(coords_path, "r") as f:
        all_lineseries = json.load(f)

    def apply_scale(pixel, conv):
        if conv["type"] == "log":
            return 10 ** (conv["slope"] * pixel + conv["intercept"])
        return conv["slope"] * pixel + conv["intercept"]

    converted_lineseries = {}
    for series_index, lineseries in enumerate(all_lineseries):
        # 1. Пересчитываем координаты
        raw_points = []
        for pt in lineseries:
            raw_points.append({"x": apply_scale(pt["x"], conversions["x"]), 
                               "y": apply_scale(pt["y"], conversions["y"])})
        
        # 2. СГЛАЖИВАНИЕ (Убираем зубцы)
        smoothed = smooth_data(raw_points, window=7) # window=7 — оптимально для шумов
        converted_lineseries[f"series_{series_index}"] = smoothed

    dest_folder = f"{base_output_dir}/{img}/converted_datapoints"
    os.makedirs(dest_folder, exist_ok=True)
    with open(f"{dest_folder}/data.json", "w") as f:
        json.dump(converted_lineseries, f, indent=4)

    # Отрисовка чистого графика
    plt.figure(figsize=(10, 6))
    for name, pts in converted_lineseries.items():
        plt.plot([p["x"] for p in pts], [p["y"] for p in pts], label=name, linewidth=1.5)
    
    if conversions["x"]["type"] == "log": plt.xscale('log')
    if conversions["y"]["type"] == "log": plt.yscale('log')
    plt.grid(True, which="both", ls="-", alpha=0.3)
    plt.legend()
    plt.savefig(f"{dest_folder}/plot.png")
    plt.close()

def correct_coordinates(base_output_dir: str, img: str):
    print("\tCorrecting coordinates for:", base_output_dir, img)
    try:
        with open(f"{base_output_dir}/{img}/chartdete/label_coordinates.json", "r") as f:
            label_coordinates = json.load(f)
        with open(f"{base_output_dir}/{img}/axis_label_texts.json", "r") as f:
            axis_label_texts = json.load(f)

        coord_val_map = sort_and_check_labels(label_coordinates, axis_label_texts, img)
        conversions = calc_conversion(coord_val_map)
        convert_data_points(conversions, base_output_dir, img, label_coordinates)
        print(f"\t[SUCCESS] Data is smooth and calibrated.")
    except Exception as e:
        print(f"\t[ERROR] Smoothing/Calibration failed: {e}")