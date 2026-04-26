import os
import sys
import shutil
import time
import traceback
import json

# --- ИСПРАВЛЕНИЕ ПУТЕЙ ---
# Получаем папку, где лежит ЭТОТ скрипт (extract-line-chart-data)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Формируем полные пути к папкам внутри проекта
SRC_DIR = os.path.join(BASE_DIR, "src")
LOCAL_DIR = os.path.join(SRC_DIR, "plextract", "local")
UTILS_DIR = os.path.join(SRC_DIR, "plextract", "utils")

# Жесткие пути к данным (чтобы работало из любой консоли)
INPUT_DIR_ABS = os.path.join(BASE_DIR, "examples", "input")
OUTPUT_DIR_ABS = os.path.join(BASE_DIR, "examples", "output")

# ==========================================
# 1. LINEFORMER: BASELINE (NO FILTERS)
# ==========================================
LINEFORMER_CODE = r'''"""
Local LineFormer wrapper.
VERSION: BASELINE (Raw Image -> Resize -> Model). No filters.
"""

import os
import json
import cv2
import numpy as np
import traceback
import torch
from pathlib import Path
from huggingface_hub import snapshot_download

from ..utils import logger

class LineFormer:
    def __init__(self, device: str = "cuda:0"):
        print("DEBUG: ---> LineFormer BASELINE (NO FILTERS) initialized! <---")
        try:
            from lineformer import infer
            
            model_dir = Path.home() / ".cache" / "plextract" / "lineformer"
            if not model_dir.exists():
                snapshot_download("tdsone/lineformer", local_dir=str(model_dir))
            
            ckpt = str(model_dir / "iter_3000.pth")
            config = str(model_dir / "lineformer_swin_t_config.py")
            
            infer.load_model(config, ckpt, device)
            
        except Exception as e:
            logger.error(f"Failed to load LineFormer: {e}")
            raise

    def inference(self, input_path: str, output_dir: str) -> None:
        from lineformer import infer
        from lineformer import line_utils

        img_name = Path(input_path).name
        results_base_folder = Path(output_dir) / img_name / "lineformer"
        
        print(f"DEBUG: Processing {img_name}")

        try:
            os.makedirs(results_base_folder, exist_ok=True)
            img = cv2.imread(input_path)
            if img is None: return

            # --- ONLY RESIZE (VRAM PROTECTION) ---
            h, w = img.shape[:2]
            MAX_DIM = 1024
            
            img_for_model = img
            scale = 1.0

            if max(h, w) > MAX_DIM:
                scale = MAX_DIM / max(h, w)
                new_w = int(w * scale)
                new_h = int(h * scale)
                print(f"DEBUG: Resizing RAW image to {new_w}x{new_h} for VRAM safety")
                img_for_model = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)
            
            cv2.imwrite(str(results_base_folder / "debug_00_RAW_INPUT.png"), img_for_model)

            if torch.cuda.is_available():
                torch.cuda.empty_cache()

            # --- INFERENCE ---
            print("DEBUG: Running Inference on RAW image...")
            lines_small = infer.get_dataseries(img_for_model, to_clean=False)
            print(f"DEBUG: Found {len(lines_small)} lines.")

            # --- SCALE BACK ---
            orig_h, orig_w = img.shape[:2]
            model_h, model_w = img_for_model.shape[:2]
            
            scale_x = orig_w / model_w if model_w > 0 else 1
            scale_y = orig_h / model_h if model_h > 0 else 1

            line_dataseries = []
            for line in lines_small:
                scaled_line = []
                for point in line:
                    scaled_line.append({
                        "x": point["x"] * scale_x,
                        "y": point["y"] * scale_y
                    })
                line_dataseries.append(scaled_line)

            # --- VISUALIZE ---
            img_vis = img.copy()
            points_array = line_utils.points_to_array(line_dataseries)
            # FIX: Int32 cast for OpenCV
            points_int = [np.array(p, dtype=np.int32) for p in points_array]

            if len(points_int) > 0:
                img_vis = line_utils.draw_lines(img_vis, points_int)
            
            cv2.imwrite(str(results_base_folder / "s_prediction.png"), img_vis)

            with open(results_base_folder / "coordinates.json", "w") as f:
                json.dump(line_dataseries, f)

        except Exception as e:
            logger.error(f"Failed: {e}")
            traceback.print_exc()
            raise
'''

# ==============================================================================
# MAIN
# ==============================================================================
def overwrite_file(path, content):
    print(f"Updating: {path}")
    with open(path, "w", encoding="utf-8") as f: f.write(content)

def clean_pycache(root_dir):
    for root, dirs, files in os.walk(root_dir):
        if "__pycache__" in dirs:
            shutil.rmtree(os.path.join(root, "__pycache__"))

def main():
    overwrite_file(os.path.join(LOCAL_DIR, "lineformer.py"), LINEFORMER_CODE)
    
    clean_pycache(SRC_DIR)
    
    # Хак путей для импорта
    if SRC_DIR not in sys.path: sys.path.insert(0, SRC_DIR)

    print(f"\n--- RUNNING BASELINE (RAW) PIPELINE ---")
    print(f"Input: {INPUT_DIR_ABS}")
    
    # Проверка существования папок
    if not os.path.exists(INPUT_DIR_ABS):
        print(f"ERROR: Input directory not found: {INPUT_DIR_ABS}")
        return

    from plextract import extract
    try:
        # ПЕРЕДАЕМ АБСОЛЮТНЫЕ ПУТИ
        extract(input_dir=INPUT_DIR_ABS, output_dir=OUTPUT_DIR_ABS, backend="local")
        print("\nSUCCESS!")
    except Exception as e:
        print(f"CRASH: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    main()