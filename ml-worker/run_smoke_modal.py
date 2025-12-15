from __future__ import annotations

import json
import shutil
import uuid
from datetime import datetime
from pathlib import Path

from plextract import extract

IMG_EXTS = {".png", ".jpg", ".jpeg"}


def main() -> int:
    # Рабочая папка: та, из которой ты запускаешь скрипт.
    # Ожидаем, что здесь есть общий input/ с тестовыми картинками.
    cwd = Path.cwd()
    base_input = cwd / "input"

    if not base_input.exists():
        print(f"[ERROR] Не найдена папка: {base_input}")
        print("Создай её и положи туда хотя бы одно изображение с линейным графиком.")
        return 1

    images = [p for p in base_input.iterdir() if p.is_file() and p.suffix.lower() in IMG_EXTS]
    if not images:
        print(f"[ERROR] В папке {base_input} нет изображений .png/.jpg/.jpeg")
        return 1

    # Уникальная папка запуска
    run_tag = datetime.now().strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:8]
    run_root = cwd / "runs" / run_tag
    run_input = run_root / "input"
    run_output = run_root / "output"

    run_input.mkdir(parents=True, exist_ok=False)
    run_output.mkdir(parents=True, exist_ok=False)

    # Копируем входные файлы в run_input, чтобы запуск был изолированным
    print("[INFO] Копирую входные файлы в:", run_input)
    for p in images:
        shutil.copy2(p, run_input / p.name)

    print("\n[INFO] Запускаю plextract (backend='modal')...")
    print("       input_dir =", run_input)
    print("       output_dir =", run_output)

    # Важно: передаём абсолютные/явные пути, чтобы не зависеть от текущей папки
    ret = extract(input_dir=str(run_input), output_dir=str(run_output), backend="modal")
    print("[INFO] extract() вернул:", ret)

    # Ищем converted_datapoints/data.json внутри run_output
    data_files = [p for p in run_output.rglob("data.json") if "converted_datapoints" in p.parts]
    if not data_files:
        print("\n[ERROR] Не нашёл converted_datapoints/data.json в", run_output)
        print("Смотри содержимое run_output и логи выше.")
        return 2

    print("\n[INFO] Найдены результаты:")
    for p in data_files:
        print("  -", p)

    # Печать краткой структуры первого data.json
    sample = data_files[0]
    with sample.open("r", encoding="utf-8") as f:
        payload = json.load(f)

    print("\n[INFO] Пример содержимого data.json (верхний уровень):")
    if isinstance(payload, dict):
        keys = list(payload.keys())
        print("keys =", keys)
        series_keys = [k for k in keys if k.startswith("series")]
        if series_keys:
            print("series keys =", series_keys)
            v0 = payload.get(series_keys[0])
            if isinstance(v0, list):
                print(f"{series_keys[0]} points =", len(v0))
    else:
        print("Тип data.json:", type(payload))

    print(f"\n[OK] Run сохранён в: {run_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
