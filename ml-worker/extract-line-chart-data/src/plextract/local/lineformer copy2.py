import os
import json
import cv2
import numpy as np
from pathlib import Path
from huggingface_hub import snapshot_download
from ..utils import logger

class LineFormer:
    def __init__(self, device: str = "cuda:0"):
        from lineformer import infer
        logger.info("Loading LineFormer (Robust Production Edition)...")
        model_dir = Path.home() / ".cache" / "plextract" / "lineformer"
        if not model_dir.exists():
            snapshot_download("tdsone/lineformer", local_dir=str(model_dir))
        ckpt = str(model_dir / "iter_3000.pth")
        config = str(model_dir / "lineformer_swin_t_config.py")
        infer.load_model(config, ckpt, device)

    def _preprocess_image(self, img: np.ndarray, results_path: Path):
        """
        Возвращаем надежный препроцессинг с Inpaint (удаление сетки без разрушения линий).
        """
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        gray = cv2.addWeighted(gray, 1.5, gray, 0, -50) 

        thresh = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
                                     cv2.THRESH_BINARY_INV, 25, 7)

        # Склеиваем пунктиры
        kernel_connect = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel_connect, iterations=1)
        
        # Удаляем мелкую пыль
        kernel_clean = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
        clean_lines = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel_clean)
        
        # Выделяем сетку
        grid_h = cv2.morphologyEx(clean_lines, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (50, 1)))
        grid_v = cv2.morphologyEx(clean_lines, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, 50)))
        grid_mask = cv2.add(grid_h, grid_v)
        
        final_input = cv2.cvtColor(clean_lines, cv2.COLOR_GRAY2BGR)
        final_input = cv2.bitwise_not(final_input)
        
        # Inpaint - аккуратно "замазывает" сетку
        final_input = cv2.inpaint(final_input, grid_mask, 1, cv2.INPAINT_TELEA)

        h, w = final_input.shape[:2]
        final_input[:int(h*0.15), :] = [255, 255, 255]
        final_input[int(h*0.88):, :] = [255, 255, 255]

        cv2.imwrite(str(results_path / "debug_preprocessed.png"), final_input)
        return final_input

    def _deduplicate_lines(self, lines, px_threshold=12):
        """
        Склеивает и удаляет дубликаты линий.
        px_threshold: максимальное расхождение в пикселях по оси Y, чтобы считать линию дублем.
        """
        if not lines: return []
        
        # Сортируем линии по длине (сначала самые длинные и информативные)
        lines = sorted(lines, key=len, reverse=True)
        unique_lines = []
        
        for line in lines:
            if not unique_lines:
                unique_lines.append(line)
                continue
            
            pts = np.array([[p['x'], p['y']] for p in line])
            pts = pts[pts[:, 0].argsort()] # Сортируем по X
            
            is_duplicate = False
            for u_line in unique_lines:
                u_pts = np.array([[p['x'], p['y']] for p in u_line])
                u_pts = u_pts[u_pts[:, 0].argsort()]
                
                # Ищем зону перекрытия по X
                min_x = max(pts[0, 0], u_pts[0, 0])
                max_x = min(pts[-1, 0], u_pts[-1, 0])
                
                if min_x < max_x - 30: # Если линии перекрываются хотя бы на 30 пикселей
                    # Выбираем точки текущей линии, попавшие в зону перекрытия
                    mask = (pts[:, 0] >= min_x) & (pts[:, 0] <= max_x)
                    test_x = pts[mask, 0]
                    test_y = pts[mask, 1]
                    
                    # Интерполируем Y из уже сохраненной уникальной линии
                    ref_y = np.interp(test_x, u_pts[:, 0], u_pts[:, 1])
                    
                    # Если среднее расстояние по Y меньше порога - это дубликат толстой линии
                    if np.mean(np.abs(test_y - ref_y)) < px_threshold:
                        is_duplicate = True
                        break
                        
            if not is_duplicate:
                unique_lines.append(line)
                
        return unique_lines

    def inference(self, input_path: str, output_dir: str) -> None:
        from lineformer import infer
        from lineformer import line_utils

        img_name = Path(input_path).name
        results_base_folder = Path(output_dir) / img_name / "lineformer"
        os.makedirs(results_base_folder, exist_ok=True)

        try:
            img = cv2.imread(input_path)
            processed_img = self._preprocess_image(img, results_base_folder)
            raw_lines = infer.get_dataseries(processed_img, to_clean=False)

            # ==========================================
            # НАЧАЛО ИЗМЕНЕННОГО БЛОКА
            # ==========================================
            filtered_lines = []
            for line in raw_lines:
                # 1. Отбрасываем слишком короткие куски (мусор)
                if len(line) < 40: continue 
                
                pts = np.array([[p['x'], p['y']] for p in line])
                pts = pts[pts[:, 0].argsort()]
                
                # 2. Отбрасываем вертикальные линии (оси)
                x_spread = max(pts[:, 0]) - min(pts[:, 0])
                if x_spread < 50: continue 

                filtered_lines.append(line)

            # 3. Дедупликация (склейка жирных линий, разбитых на несколько)
            filtered_lines = self._deduplicate_lines(filtered_lines)
            # ==========================================
            # КОНЕЦ ИЗМЕНЕННОГО БЛОКА
            # ==========================================

            img_viz = img.copy()
            if filtered_lines:
                img_viz = line_utils.draw_lines(img_viz, line_utils.points_to_array(filtered_lines))

            cv2.imwrite(str(results_base_folder / "prediction.png"), img_viz)
            with open(results_base_folder / "coordinates.json", "w") as f:
                json.dump(filtered_lines, f)

            logger.info(f"LineFormer: Success. Kept {len(filtered_lines)} lines.")
            
        except Exception as e:
            logger.error(f"Failed: {e}")
            raise