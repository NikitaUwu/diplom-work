import os

# Путь к твоему ML модулю
TARGET_DIR = r"C:\Users\Kiruma Souchi\Desktop\6lab\diplom-work\ml-worker\extract-line-chart-data"

# Что нам интересно увидеть
INCLUDE_EXTENSIONS = {'.py', '.env', '.yaml'}
EXCLUDE_DIRS = {'venv', '.git', '__pycache__', 'examples', 'input', 'output', 'runs'}

def collect_ml_structure(root_dir, output_file):
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(f"Detailed ML Structure: {root_dir}\n" + "="*50 + "\n")
        
        for root, dirs, files in os.walk(root_dir):
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
            level = root.replace(root_dir, '').count(os.sep)
            indent = ' ' * 4 * level
            f.write(f"{indent}{os.path.basename(root)}/\n")
            
            for file in files:
                if any(file.endswith(ext) for ext in INCLUDE_EXTENSIONS):
                    f.write(f"{indent}    {file}\n")
        
        f.write("\n" + "="*50 + "\nFILE CONTENTS\n" + "="*50 + "\n")
        
        # Читаем только ключевые файлы управления
        keys = ["__init__.py", "extract.py", "utils.py"] # добавим если найдем
        for root, dirs, files in os.walk(root_dir):
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
            for file in files:
                # Читаем __init__.py в папках и файлы в корне src
                if file in keys or ("src" in root and file.endswith(".py") and len(file) < 30):
                    file_path = os.path.join(root, file)
                    if os.path.getsize(file_path) < 50 * 1024:
                        f.write(f"\n--- FILE: {os.path.relpath(file_path, root_dir)} ---\n")
                        with open(file_path, 'r', encoding='utf-8', errors='ignore') as cf:
                            f.write(cf.read())

if __name__ == "__main__":
    collect_ml_structure(TARGET_DIR, "ml_detailed_structure.txt")
    print("Готово! Файл ml_detailed_structure.txt создан.")