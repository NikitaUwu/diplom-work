import os
import json
import cv2
import numpy as np
from pathlib import Path
from huggingface_hub import snapshot_download
from ..utils import logger

# Можно будет в будущем дополнить предобработку и сделать ее более гибкой
class LineFormer:
    def __init__(self, device: str = "cuda:0"):
        from lineformer import infer
        logger.info("Loading LineFormer (Robust Production Edition)...")
        model_dir = Path(os.getenv("LINEFORMER_MODEL_DIR", str(Path.home() / ".cache" / "plextract" / "lineformer"))).expanduser()
        ckpt = Path(os.getenv("LINEFORMER_CHECKPOINT", str(model_dir / "iter_1800.pth"))).expanduser()
        config = Path(os.getenv("LINEFORMER_CONFIG", str(model_dir / "lineformer_swin_t_config.py"))).expanduser()
        if not ckpt.exists() or not config.exists():
            snapshot_download("tdsone/lineformer", local_dir=str(model_dir))
        if not ckpt.exists():
            raise FileNotFoundError(f"LineFormer checkpoint not found: {ckpt}")
        if not config.exists():
            raise FileNotFoundError(f"LineFormer config not found: {config}")
        infer.load_model(str(config), str(ckpt), device)
        preprocessing_env = os.getenv("LINEFORMER_USE_PREPROCESSING", "1").strip().lower()
        self.use_preprocessing = preprocessing_env not in {"0", "false", "no", "off"}
        logger.info(f"LineFormer checkpoint: {ckpt}")
        logger.info(f"LineFormer preprocessing enabled: {self.use_preprocessing}")

    def _preprocess_image(self, img: np.ndarray, results_path: Path):
        #преобразование в скан серый
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        #Увеличиваем контраст, сдвигаем яркость в сторону тёмных тонов, но для каждого
        #графика лучше по своему, делать. Или сделать несколько и сделать переключаемые режимы.
        gray = cv2.addWeighted(gray, 1.5, gray, 0, -50) 
        #Адаптивная бинаризация, THRESH_BINARY_INV - инвертируем, чтобы линии остались белыми
        #а фон черный(я посмотрел, так получается лучше(наверное))
        thresh = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
                                     cv2.THRESH_BINARY_INV, 25, 7)
        #Морфологическое открытие для удаления мелкого шума и тд.
        #Ядро 3x3 сохраняет тонкие линии, но убирает одиночные пиксели
        #Хотя это лучше переделать и придумать что-то еще, бывает стирает нужные кривые, а нам этого не надо
        kernel_clean = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        clean_lines = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel_clean, iterations=1)
        #Выделяет элементы сетки (горизонтальные и вертикальные линии)
        #Длинные горизонтальные ядра (50x1) выделяют горизонтальные линии сетки
        grid_h = cv2.morphologyEx(clean_lines, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (50, 1)))
        #Длинные вертикальные ядра (1x50) выделяют вертикальные линии сетки
        #(Лучшего значения я не знаю, в разных графиках разные значения, может быть можно будет придумать, какую нибудь адаптивную вещь)
        grid_v = cv2.morphologyEx(clean_lines, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, 50)))
        grid_mask = cv2.add(grid_h, grid_v)
        
        #Преобразование обратно в BGR и инверсия цветов
        #Типо линии становятся тёмными на светлом фоне
        final_input = cv2.cvtColor(clean_lines, cv2.COLOR_GRAY2BGR)
        final_input = cv2.bitwise_not(final_input)
        
        #Удаляем сетку через inpainting(можно, будет еще посмотреть, есть куча дополнений, и сделать еще лучше)
        final_input = cv2.inpaint(final_input, grid_mask, 1, cv2.INPAINT_TELEA)

        #Удаляем всякие заголовки и прочее мешающие элементы
        h, w = final_input.shape[:2]
        final_input[:int(h*0.15), :] = [255, 255, 255]
        final_input[int(h*0.88):, :] = [255, 255, 255]

        #Сохранение того изображения, которое отправляется в модель
        #Через это можно также сделать дебаг по каждому этапу предобработки
        #и у нас будет куча изображений на которых этапы предобработки.
        cv2.imwrite(str(results_path / "debug_preprocessed.png"), final_input)
        return final_input

    def inference(self, input_path: str, output_dir: str, use_preprocessing: bool | None = None) -> None:
        from lineformer import infer
        from lineformer import line_utils

        img_name = Path(input_path).name
        results_base_folder = Path(output_dir) / img_name / "lineformer"
        os.makedirs(results_base_folder, exist_ok=True)
        effective_use_preprocessing = self.use_preprocessing if use_preprocessing is None else use_preprocessing

        try:
            img = cv2.imread(input_path)
            model_input = img
            if effective_use_preprocessing:
                model_input = self._preprocess_image(img, results_base_folder)
            else:
                cv2.imwrite(str(results_base_folder / "debug_preprocessed.png"), img)
            raw_lines = infer.get_dataseries(model_input, to_clean=False)

            filtered_lines = []
            for line in raw_lines:
                if len(line) < 40: continue 
                
                pts = np.array([[p['x'], p['y']] for p in line])
                pts = pts[pts[:, 0].argsort()]
                
                y_start = np.mean(pts[:10, 1])
                y_end = np.mean(pts[-10:, 1])
                
                if y_end < y_start - 100:
                    print(f"  [REJECT] Удалена диагональ КПД/Мощности: {img_name}")
                    continue

                x_spread = max(pts[:, 0]) - min(pts[:, 0])
                if x_spread < 50: continue 

                filtered_lines.append(line)

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