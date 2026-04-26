import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
current_src = str(BASE_DIR / "src")
sys.path.insert(0, current_src)

try:
    import plextract
    print(f"[DEBUG] ПУТЬ К МОДУЛЮ: {plextract.__file__}")
    if "6lab" not in plextract.__file__:
        print("[WARNING] ВНИМАНИЕ: Python все еще берет код не из 6lab!")
    from plextract.extract import extract
    print("[SUCCESS] Модуль plextract найден и готов к работе")
except ImportError as e:
    print(f"[ERROR] Не удалось импортировать plextract: {e}")
    sys.exit(1)

import time
import json
import shutil
import uuid
import psycopg2
from datetime import datetime
from psycopg2.extras import Json, RealDictCursor
from dotenv import load_dotenv
from PIL import Image 
print("[DEBUG] Библиотека Image подгружена успешно")

#sys.path.append(str(BASE_DIR / "src"))
# Загружаем настройки из переменных окружения
# Сначала пробуем загрузить из .env файла (для локальной разработки)
# Путь к .env файлу бэкенда:
ENV_PATH = Path(r"C:\Users\Kiruma Souchi\Desktop\6lab\diplom-work1\project-backend\.env")
if ENV_PATH.exists():
    load_dotenv(ENV_PATH)
    print(f"[DEBUG] Загружен .env файл: {ENV_PATH}")
else:
    print("[DEBUG] .env файл не найден, используем переменные окружения")

DB_URL = os.getenv("DATABASE_URL")
STORAGE_DIR = os.getenv("STORAGE_DIR", r"C:\Users\Kiruma Souchi\Desktop\6lab\diplom-work1\project-backend\storage")

if DB_URL:
    DB_URL = DB_URL.replace("postgresql+psycopg2://", "postgresql://")

def get_connection():
    return psycopg2.connect(DB_URL)

def process_job(chart_id, original_path):
    print(f"\n[WORKER] >>> Обработка графика ID: {chart_id}")
    print(f"[DEBUG] original_path из БД: {original_path}")
    print(f"[DEBUG] STORAGE_DIR: {STORAGE_DIR}")

    # Строим полный путь относительно STORAGE_DIR
    src_file = Path(STORAGE_DIR) / original_path
    print(f"[DEBUG] Полный путь к файлу: {src_file}")

    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    work_dir = BASE_DIR / "runs" / f"job_{chart_id}_{run_id}"
    input_dir = work_dir / "input"
    output_dir = work_dir / "output"

    input_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        if not src_file.exists():
            raise FileNotFoundError(f"Файл не найден: {src_file}")
        
        # --- НОВЫЙ БЛОК: УМЕНЬШЕНИЕ КАРТИНКИ ДЛЯ GPU ---
        dst_path = input_dir / src_file.name
        with Image.open(src_file) as img:
            # Превращаем в RGB (на случай если это PNG с прозрачностью)
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
            
            # Если картинка больше 800 пикселей — уменьшаем
            MAX_SIZE = 800 
            if max(img.size) > MAX_SIZE:
                img.thumbnail((MAX_SIZE, MAX_SIZE), Image.LANCZOS)
                print(f"[RESIZE] Картинка уменьшена до {img.size} для экономии VRAM")
            
            img.save(dst_path, "JPEG", quality=95)
        # -----------------------------------------------

        print(f"[WORKER] Запуск нейросетей на GPU...")
        extract(input_dir=str(input_dir), output_dir=str(output_dir), backend="local")

        data_files = list(output_dir.rglob("data.json"))
        if not data_files:
            raise Exception("Пайплайн не создал data.json")

        data_path = Path(data_files[0])
        with open(data_path, 'r', encoding='utf-8') as f:
            points_data = json.load(f)

        series_list = []
        for sid, points in points_data.items():
            series_list.append({
                "id": sid,
                "name": sid,
                "points": [[p['x'], p['y']] for p in points]
            })

        x_unit, y_unit = "X", "Y"
        meta_path = data_path.parent / "chart_metadata.json"
        if meta_path.exists():
            with open(meta_path, 'r', encoding='utf-8') as f:
                meta = json.load(f)
                x_unit = (meta.get("x_unit") or "X").strip() or "X"
                y_unit = (meta.get("y_unit") or "Y").strip() or "Y"
        else:
            # Fallback: axis_titles.json с ключами x_title, y_title (результат ChartDete + OCR)
            img_dir = data_path.parent.parent
            axis_path = img_dir / "axis_titles.json"
            if axis_path.exists():
                with open(axis_path, 'r', encoding='utf-8') as f:
                    at = json.load(f)
                    x_unit = (at.get("x_title") or "X").strip() or "X"
                    y_unit = (at.get("y_title") or "Y").strip() or "Y"

        result_json = {
            "panels": [{
                "id": "panel_0",
                "series": series_list,
                "x_unit": x_unit,
                "y_unit": y_unit,
            }],
            "artifacts": {}
        }

        # === СОХРАНЕНИЕ АРТЕФАКТОВ В STORAGE ===
        # 1. prediction.png от LineFormer (визуализация найденных линий)
        predictions = list(output_dir.rglob("lineformer/prediction.png"))
        if predictions:
            pred_path = src_file.parent / f"prediction_{src_file.stem}.png"
            shutil.copy2(predictions[0], pred_path)
            result_json["artifacts"]["lineformer_prediction"] = pred_path.relative_to(STORAGE_DIR).as_posix()
            print(f"[WORKER] prediction.png сохранен: {result_json['artifacts']['lineformer_prediction']}")

        # 2. plot.png (восстановленный график)
        plots = list(output_dir.rglob("converted_datapoints/plot.png"))
        if plots:
            plot_path = src_file.parent / f"plot_{src_file.stem}.png"
            shutil.copy2(plots[0], plot_path)
            result_json["artifacts"]["restored_plot"] = plot_path.relative_to(STORAGE_DIR).as_posix()
            print(f"[WORKER] plot.png сохранен: {result_json['artifacts']['restored_plot']}")

        # 3. predictions.jpg от ChartDete (детекция элементов)
        chartdete_preds = list(output_dir.rglob("chartdete/predictions.jpg"))
        if chartdete_preds:
            cd_path = src_file.parent / f"chartdete_{src_file.stem}.jpg"
            shutil.copy2(chartdete_preds[0], cd_path)
            result_json["artifacts"]["chartdete_predictions"] = cd_path.relative_to(STORAGE_DIR).as_posix()
            print(f"[WORKER] chartdete predictions сохранен: {result_json['artifacts']['chartdete_predictions']}")

        print(f"[WORKER] Все артефакты: {list(result_json['artifacts'].keys())}")

        # Очищаем кеш видеокарты после работы
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        return result_json, len(series_list)

    except Exception as e:
        print(f"[ERROR] {e}")
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        raise e

from datetime import datetime

def main():
    if not DB_URL:
        print("[ERROR] DATABASE_URL не найден в .env!")
        return

    print(f"[WORKER] Воркер запущен. Ожидание задач из базы...")
    
    while True:
        conn = None
        try:
            conn = get_connection()
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Берем одну задачу
                cur.execute("""
                    SELECT id, original_path FROM charts 
                    WHERE status = 'uploaded' 
                    ORDER BY created_at ASC 
                    FOR UPDATE SKIP LOCKED 
                    LIMIT 1
                """)
                job = cur.fetchone()

                if job:
                    chart_id = job['id']
                    print(f"\n[JOB] Нашел задачу {chart_id}. Начинаю...")
                    
                    cur.execute("UPDATE charts SET status = 'processing' WHERE id = %s", (chart_id,))
                    conn.commit()

                    try:
                        res_json, n_series = process_job(chart_id, job['original_path'])
                        
                        cur.execute("""
                            UPDATE charts SET 
                                status = 'done', 
                                result_json = %s, 
                                n_series = %s,
                                processed_at = NOW()
                            WHERE id = %s
                        """, (Json(res_json), n_series, chart_id))
                        conn.commit()
                        print(f"[SUCCESS] Задача {chart_id} готова!")

                    except Exception as ex:
                        conn.rollback()
                        cur.execute("UPDATE charts SET status = 'error', error_message = %s WHERE id = %s", 
                                   (str(ex), chart_id))
                        conn.commit()
                
            conn.close()
        except Exception as e:
            print(f"[DB_ERROR] {repr(e)}")
            if conn: conn.close()
        
        time.sleep(5) 

if __name__ == "__main__":
    main()