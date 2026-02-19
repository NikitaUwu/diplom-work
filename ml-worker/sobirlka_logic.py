import os

# Ищем только эти файлы
TARGET_FILES = ['main.py', 'worker.py', 'inference.py', 'predict.py', 'pipeline.py', 'requirements.txt']

def collect_ml_core(root_dir):
    with open("ml_logic.txt", "w", encoding="utf-8") as out:
        for root, dirs, files in os.walk(root_dir):
            # Пропускаем лишние папки сразу
            if any(x in root for x in ['venv', 'data', 'datasets', 'models', '__pycache__']):
                continue
                
            for file in files:
                if file in TARGET_FILES or file.endswith('.py'):
                    file_path = os.path.join(root, file)
                    # Читаем только если файл меньше 30 КБ (настоящий код обычно такой)
                    if os.path.getsize(file_path) < 30 * 1024:
                        out.write(f"\n--- FILE: {file} ---\n")
                        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                            out.write(f.read())
                        out.write("\n" + "="*30 + "\n")

collect_ml_core(".")
print("Готово! Посмотри файл ml_logic.txt")