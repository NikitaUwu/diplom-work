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
from datetime import datetime
from dotenv import load_dotenv
from PIL import Image
print("[DEBUG] Библиотека Image подгружена успешно")

# Загружаем настройки из переменных окружения
ENV_PATH = Path(r"C:\Users\Kiruma Souchi\Desktop\6lab\diplom-work1\project-backend\.env")
if ENV_PATH.exists():
    load_dotenv(ENV_PATH)
    print(f"[DEBUG] Загружен .env файл: {ENV_PATH}")
else:
    print("[DEBUG] .env файл не найден, используем переменные окружения")

STORAGE_DIR = os.getenv("STORAGE_DIR", r"C:\Users\Kiruma Souchi\Desktop\6lab\diplom-work1\project-backend\storage")

# === НАСТРОЙКИ ДЛЯ ЛОКАЛЬНОЙ РАБОТЫ ===
# Папка куда кладем исходные картинки (входные данные)
INPUT_FOLDER = Path(r"C:\Users\Kiruma Souchi\Desktop\6lab\diplom-work1\ml-worker\extract-line-chart-data\input")
# Папка куда сохраняем результаты
OUTPUT_FOLDER = Path(r"C:\Users\Kiruma Souchi\Desktop\6lab\diplom-work1\ml-worker\extract-line-chart-data\output")

INPUT_FOLDER.mkdir(parents=True, exist_ok=True)
OUTPUT_FOLDER.mkdir(parents=True, exist_ok=True)

print(f"[LOCAL] Входная папка: {INPUT_FOLDER}")
print(f"[LOCAL] Выходная папка: {OUTPUT_FOLDER}")


def process_image(image_path):
    """Обрабатывает одну картинку и сохраняет результат"""
    
    print(f"\n{'='*60}")
    print(f"[WORKER] >>> Обработка: {image_path.name}")
    print(f"[WORKER] Полный путь: {image_path}")

    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    work_dir = BASE_DIR / "runs" / f"job_{image_path.stem}_{run_id}"
    input_dir = work_dir / "input"
    output_dir = work_dir / "output"

    input_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        # Копируем исходную картинку в рабочую папку
        dst_path = input_dir / image_path.name
        shutil.copy2(image_path, dst_path)

        # Уменьшаем картинку для GPU
        with Image.open(dst_path) as img:
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")

            MAX_SIZE = 800
            if max(img.size) > MAX_SIZE:
                img.thumbnail((MAX_SIZE, MAX_SIZE), Image.LANCZOS)
                print(f"[RESIZE] Картинка уменьшена до {img.size} для экономии VRAM")
                img.save(dst_path, "JPEG", quality=95)

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

        # === СОХРАНЕНИЕ АРТЕФАКТОВ ===
        # 1. prediction.png от LineFormer
        predictions = list(output_dir.rglob("lineformer/prediction.png"))
        if predictions:
            pred_path = OUTPUT_FOLDER / f"prediction_{image_path.stem}.png"
            shutil.copy2(predictions[0], pred_path)
            result_json["artifacts"]["lineformer_prediction"] = str(pred_path)
            print(f"[WORKER] prediction.png сохранен: {pred_path}")

        # 2. plot.png (восстановленный график)
        plots = list(output_dir.rglob("converted_datapoints/plot.png"))
        if plots:
            plot_path = OUTPUT_FOLDER / f"plot_{image_path.stem}.png"
            shutil.copy2(plots[0], plot_path)
            result_json["artifacts"]["restored_plot"] = str(plot_path)
            print(f"[WORKER] plot.png сохранен: {plot_path}")

        # 3. predictions.jpg от ChartDete
        chartdete_preds = list(output_dir.rglob("chartdete/predictions.jpg"))
        if chartdete_preds:
            cd_path = OUTPUT_FOLDER / f"chartdete_{image_path.stem}.jpg"
            shutil.copy2(chartdete_preds[0], cd_path)
            result_json["artifacts"]["chartdete_predictions"] = str(cd_path)
            print(f"[WORKER] chartdete predictions сохранен: {cd_path}")

        # Сохраняем JSON с результатами
        result_path = OUTPUT_FOLDER / f"result_{image_path.stem}.json"
        with open(result_path, 'w', encoding='utf-8') as f:
            json.dump(result_json, f, indent=2, ensure_ascii=False)
        print(f"[WORKER] Результат сохранен: {result_path}")

        print(f"[WORKER] Все артефакты: {list(result_json['artifacts'].keys())}")
        print(f"[SUCCESS] Обработка завершена!")

        # Очищаем кеш видеокарты
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        return True

    except Exception as e:
        print(f"[ERROR] Ошибка обработки: {e}")
        import traceback
        traceback.print_exc()
        
        # Сохраняем ошибку в файл
        error_path = OUTPUT_FOLDER / f"error_{image_path.stem}.txt"
        with open(error_path, 'w', encoding='utf-8') as f:
            f.write(str(e))
        
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        return False


def main():
    print(f"\n{'='*60}")
    print("[LOCAL MODE] Воркер запущен в локальном режиме (без БД)")
    print(f"{'='*60}")
    print(f"\nПоложите картинки в папку: {INPUT_FOLDER}")
    print(f"Результаты появятся в: {OUTPUT_FOLDER}")
    print(f"\nОжидание новых файлов... (Ctrl+C для остановки)\n")

    processed_files = set()

    while True:
        try:
            # Ищем картинки во входной папке
            image_extensions = {'.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif'}
            all_files = list(INPUT_FOLDER.iterdir())
            image_files = [f for f in all_files if f.suffix.lower() in image_extensions]

            for image_path in image_files:
                if image_path.name in processed_files:
                    continue

                print(f"\n[NEW] Найден новый файл: {image_path.name}")
                
                success = process_image(image_path)
                
                if success:
                    processed_files.add(image_path.name)
                    # Перемещаем обработанный файл в архив
                    archive_folder = INPUT_FOLDER / "processed"
                    archive_folder.mkdir(exist_ok=True)
                    shutil.move(str(image_path), str(archive_folder / image_path.name))
                    print(f"[ARCHIVE] Файл перемещен в {archive_folder}")
                else:
                    print(f"[ERROR] Не удалось обработать {image_path.name}")

            time.sleep(2)

        except KeyboardInterrupt:
            print("\n\n[STOP] Воркер остановлен пользователем")
            break
        except Exception as e:
            print(f"[ERROR] Ошибка в главном цикле: {e}")
            time.sleep(5)


if __name__ == "__main__":
    main()
