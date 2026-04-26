"""
Local ChartDete wrapper for detecting chart elements.
"""

import os
import json
import cv2
import importlib.util
from pathlib import Path
from huggingface_hub import snapshot_download

from ..utils import logger


class ChartDete:
    def __init__(self, device: str = "cuda:0"):
        """Initialize ChartDete model."""
        from mmdet.apis import init_detector

        logger.info("Loading ChartDete model...")

        # Download model weights if not present
        model_dir = Path.home() / ".cache" / "plextract" / "chartdete"
        if not model_dir.exists():
            logger.info("Downloading ChartDete weights from HuggingFace...")
            snapshot_download("tdsone/chartdete", local_dir=str(model_dir))

        config_file = str(model_dir / "cascade_rcnn_swin-t_fpn_LGF_VCE_PCE_coco_focalsmoothloss.py")
        checkpoint_file = str(model_dir / "checkpoint.pth")

        # Import config file to register custom modules (CascadeRoIHead_LGF, etc.)
        logger.info(f"Loading config from {config_file}")
        spec = importlib.util.spec_from_file_location("chartdete_config", config_file)
        config_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(config_module)
        logger.info("Config loaded - custom MMDetection modules registered")

        self.model = init_detector(config_file, checkpoint_file, device=device)
        self.device = device
        logger.info("Successfully loaded ChartDete!")

    def inference(self, input_dir: str, output_dir: str) -> None:
        """
        Detect chart elements in all images in input_dir.
        
        Args:
            input_dir: Directory containing input images
            output_dir: Directory to save results
        """
        from mmdet.apis import inference_detector

        logger.info("Running ChartDete...")

        inputs = os.listdir(input_dir)
        img_paths = [os.path.join(input_dir, img) for img in inputs]
        results_base_folders = [Path(output_dir) / img / "chartdete" for img in inputs]

        for img_path, results_base_folder in zip(img_paths, results_base_folders):
            try:
                predictions = inference_detector(self.model, img_path)

                result_path = str(results_base_folder / "predictions.jpg")

                self.model.show_result(
                    img_path,
                    predictions,
                    out_file=result_path,
                )

                results_labelled = {}
                labels = [
                    "x_title",
                    "y_title",
                    "plot_area",
                    "other",
                    "xlabel",
                    "ylabel",
                    "chart_title",
                    "x_tick",
                    "y_tick",
                    "legend_patch",
                    "legend_label",
                    "legend_title",
                    "legend_area",
                    "mark_label",
                    "value_label",
                    "y_axis_area",
                    "x_axis_area",
                    "tick_grouping",
                ]
                for res, label in zip(predictions, labels):
                    results_labelled[label] = res.tolist()

                # Save coordinates to json
                with open(results_base_folder / "bounding_boxes.json", "w") as f:
                    json.dump(results_labelled, f)

                # Load image for cropping
                image = cv2.imread(img_path)

                if image is None:
                    logger.error(f"Error loading image: {img_path}")
                    continue

                bounding_boxes = results_labelled
                confidence_threshold = 0.9
                label_coordinates = {}

                plot_areas = sorted(
                    bounding_boxes["plot_area"], key=lambda el: el[4], reverse=True
                )

                if plot_areas:
                    highest_conf_pa = plot_areas[0]
                    label_coordinates["plot_area"] = highest_conf_pa

                # Function to crop bounding boxes
                def crop_bounding_boxes(image, boxes, threshold):
                    cropped_images = []
                    h_img, w_img = image.shape[:2]
                    for box in boxes:
                        x1, y1, x2, y2, confidence = box
                        if confidence >= threshold:
                            pad_w = int((x2 - x1) * 0.1)
                            pad_h = int((y2 - y1) * 0.1)
                            nx1 = max(0, int(x1) - pad_w)
                            ny1 = max(0, int(y1) - pad_h)
                            nx2 = min(w_img, int(x2) + pad_w)
                            ny2 = min(h_img, int(y2) + pad_h)
                            cropped_image = image[ny1:ny2, nx1:nx2]
                            cropped_images.append(cropped_image)
                    return cropped_images

                # Crop bounding boxes from both 'xlabel' and 'ylabel'
                cropped_x_labels = crop_bounding_boxes(
                    image, bounding_boxes["xlabel"], confidence_threshold
                )
                cropped_y_labels = crop_bounding_boxes(
                    image, bounding_boxes["ylabel"], confidence_threshold
                )
                clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
                # Save cropped images
                for i, cropped_image in enumerate(cropped_x_labels):
                    path = str(results_base_folder / f"cropped_xlabels_{i}.jpg")
                    
                    # 1. В серый цвет
                    gray_crop = cv2.cvtColor(cropped_image, cv2.COLOR_BGR2GRAY)
                    # 2. Увеличиваем в 2 раза (чтобы мелкие цифры стали четче)
                    enlarged = cv2.resize(gray_crop, (0,0), fx=2, fy=2, interpolation=cv2.INTER_LANCZOS4)
                    # 3. Улучшаем контраст
                    contrast_crop = clahe.apply(enlarged)
                    final_crop = cv2.cvtColor(contrast_crop, cv2.COLOR_GRAY2BGR)
                    cv2.imwrite(path, contrast_crop)
                    label_coordinates[path] = bounding_boxes["xlabel"][i]

                for i, cropped_image in enumerate(cropped_y_labels):
                    path = str(results_base_folder / f"cropped_ylabels_{i}.jpg")

                    # Повторяем ту же магию для оси Y
                    gray_crop = cv2.cvtColor(cropped_image, cv2.COLOR_BGR2GRAY)
                    enlarged = cv2.resize(gray_crop, (0,0), fx=2, fy=2, interpolation=cv2.INTER_LANCZOS4)
                    contrast_crop = clahe.apply(enlarged)
                    final_crop = cv2.cvtColor(contrast_crop, cv2.COLOR_GRAY2BGR)
                    cv2.imwrite(path, contrast_crop)
                    label_coordinates[path] = bounding_boxes["ylabel"][i]

                # Вырезаем области легенды (текст СЛЕВА от графика)
                # Ищем все bounding boxes слева от plot_area
                plot_areas = bounding_boxes.get("plot_area", [])
                legend_patches = bounding_boxes.get("legend_patch", [])
                h_img, w_img = image.shape[:2]
                
                logger.info(f"  Найдено legend_patch: {len(legend_patches)} шт")
                logger.info(f"  Plot area: {plot_areas[0] if plot_areas else 'N/A'}")
                
                # Определяем левую границу plot_area
                plot_left = plot_areas[0][0] if plot_areas else w_img * 0.3
                logger.info(f"  Левая граница графика: x={plot_left:.1f}")
                
                # Вырезаем область СЛЕВА от графика для OCR легенды
                if plot_left > 20:  # Если есть место слева
                    nx1 = max(0, int(plot_left) - 150)  # 150px слева от графика
                    ny1 = int(plot_areas[0][1]) if plot_areas else 0  # От верха графика
                    nx2 = int(plot_left)  # До границы графика
                    ny2 = int(plot_areas[0][3]) if plot_areas else h_img  # До низа графика
                    
                    # Убедимся что область имеет смысл
                    if nx2 > nx1 + 10 and ny2 > ny1 + 10:
                        legend_crop = image[ny1:ny2, nx1:nx2]
                        path = str(results_base_folder / "legend_label_left.jpg")
                        logger.info(f"    Вырезаем область легенды слева: [{nx1}:{ny2}, {nx1}:{nx2}] -> {path}")
                        
                        # Улучшаем для OCR
                        gray_crop = cv2.cvtColor(legend_crop, cv2.COLOR_BGR2GRAY)
                        enlarged = cv2.resize(gray_crop, (0,0), fx=2, fy=2, interpolation=cv2.INTER_LANCZOS4)
                        contrast_crop = clahe.apply(enlarged)
                        cv2.imwrite(path, contrast_crop)
                        label_coordinates[path] = [nx1, ny1, nx2, ny2, 1.0]
                        logger.info(f"  Legend слева: сохранено в {path}")

                with open(results_base_folder / "label_coordinates.json", "w") as f:
                    json.dump(label_coordinates, f)

                logger.info(f"ChartDete: Processed {Path(img_path).name}")

            except Exception as e:
                logger.error(f"ChartDete failed for {img_path}: {e}")
                raise

