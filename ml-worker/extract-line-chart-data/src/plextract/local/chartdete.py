"""
Local ChartDete wrapper for detecting chart elements.
"""

import importlib.util
import json
import os
from pathlib import Path

import cv2
import numpy as np
from huggingface_hub import snapshot_download

from ..utils import logger


class ChartDete:
    def __init__(self, device: str = "cuda:0"):
        from mmdet.apis import init_detector

        logger.info("Loading ChartDete model...")

        model_dir = Path.home() / ".cache" / "plextract" / "chartdete"
        if not model_dir.exists():
            logger.info("Downloading ChartDete weights from HuggingFace...")
            snapshot_download("tdsone/chartdete", local_dir=str(model_dir))

        config_file = str(model_dir / "cascade_rcnn_swin-t_fpn_LGF_VCE_PCE_coco_focalsmoothloss.py")
        checkpoint_file = str(model_dir / "checkpoint.pth")

        logger.info(f"Loading config from {config_file}")
        spec = importlib.util.spec_from_file_location("chartdete_config", config_file)
        config_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(config_module)
        logger.info("Config loaded - custom MMDetection modules registered")

        self.model = init_detector(config_file, checkpoint_file, device=device)
        self.device = device
        logger.info("Successfully loaded ChartDete!")

    def inference(self, input_dir: str, output_dir: str) -> None:
        from mmdet.apis import inference_detector

        logger.info("Running ChartDete...")

        inputs = sorted(os.listdir(input_dir))
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

                with open(results_base_folder / "bounding_boxes.json", "w") as f:
                    json.dump(results_labelled, f)

                image = cv2.imread(img_path)
                if image is None:
                    logger.error(f"Error loading image: {img_path}")
                    continue

                bounding_boxes = results_labelled
                confidence_threshold = 0.9
                label_coordinates = {}
                h_img, w_img = image.shape[:2]

                plot_areas = sorted(
                    bounding_boxes.get("plot_area", []), key=lambda el: el[4], reverse=True
                )
                if plot_areas:
                    label_coordinates["plot_area"] = plot_areas[0]

                clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))

                def crop_bounding_boxes(image, boxes, threshold, h_img, w_img):
                    cropped_images = []
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

                def save_text_crops(
                    label_name,
                    boxes,
                    threshold=0.5,
                    pad_w_ratio=0.12,
                    pad_h_ratio=0.25,
                    h_img=None,
                    w_img=None,
                ):
                    cropped_paths = []
                    if h_img is None or w_img is None:
                        h_img, w_img = image.shape[:2]
                    for i, box in enumerate(boxes):
                        x1, y1, x2, y2, confidence = box
                        if confidence < threshold:
                            continue

                        box_w = max(1, x2 - x1)
                        box_h = max(1, y2 - y1)
                        pad_w = int(box_w * pad_w_ratio)
                        pad_h = int(box_h * pad_h_ratio)
                        nx1 = max(0, int(x1) - pad_w)
                        ny1 = max(0, int(y1) - pad_h)
                        nx2 = min(w_img, int(x2) + pad_w)
                        ny2 = min(h_img, int(y2) + pad_h)

                        if nx2 <= nx1 + 2 or ny2 <= ny1 + 2:
                            continue

                        cropped_image = image[ny1:ny2, nx1:nx2]
                        path = str(results_base_folder / f"{label_name}_{i}.jpg")
                        gray_crop = cv2.cvtColor(cropped_image, cv2.COLOR_BGR2GRAY)
                        enlarged = cv2.resize(
                            gray_crop, (0, 0), fx=2, fy=2, interpolation=cv2.INTER_LANCZOS4
                        )
                        contrast_crop = clahe.apply(enlarged)
                        cv2.imwrite(path, contrast_crop)
                        cropped_paths.append(path)
                    return cropped_paths

                def _split_by_whitespace_gaps(gray_crop, min_gap=8):
                    binary = cv2.threshold(
                        gray_crop, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
                    )[1]
                    col_counts = (binary > 0).sum(axis=0)
                    active_cols = np.where(col_counts > max(1, binary.shape[0] * 0.02))[0]

                    if active_cols.size == 0:
                        return [("full", 0, gray_crop.shape[1])]

                    col_groups = []
                    start = active_cols[0]
                    prev = active_cols[0]
                    for col in active_cols[1:]:
                        if col - prev > min_gap:
                            col_groups.append((start, prev))
                            start = col
                        prev = col
                    col_groups.append((start, prev))

                    if len(col_groups) == 1:
                        return [("full", 0, gray_crop.shape[1])]

                    result = []
                    for idx, (s, e) in enumerate(col_groups):
                        pad = max(2, int((e - s) * 0.05))
                        x1 = max(0, s - pad)
                        x2 = min(gray_crop.shape[1], e + pad)
                        if x2 > x1 + 5:
                            result.append((f"col_{idx}", x1, x2))
                    return result

                def save_footer_crops(h_img, w_img):
                    footer_paths = []
                    plot_areas_local = sorted(
                        bounding_boxes.get("plot_area", []), key=lambda el: el[4], reverse=True
                    )
                    if not plot_areas_local:
                        return footer_paths

                    footer_top = max(int(plot_areas_local[0][3]) + 10, int(h_img * 0.76))
                    footer_bottom = h_img - 5
                    footer_left = max(0, int(w_img * 0.0))
                    footer_right = min(w_img, int(w_img * 1.0))

                    if footer_bottom <= footer_top + 20 or footer_right <= footer_left + 20:
                        return footer_paths

                    footer_crop = image[footer_top:footer_bottom, footer_left:footer_right]
                    gray = cv2.cvtColor(footer_crop, cv2.COLOR_BGR2GRAY)
                    blur = cv2.GaussianBlur(gray, (3, 3), 0)
                    binary = cv2.threshold(
                        blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
                    )[1]

                    row_counts = (binary > 0).sum(axis=1)
                    active_rows = np.where(row_counts > max(3, binary.shape[1] * 0.01))[0]
                    if active_rows.size == 0:
                        path = str(results_base_folder / "footer_label_0.jpg")
                        enlarged = cv2.resize(
                            gray, (0, 0), fx=3, fy=3, interpolation=cv2.INTER_LANCZOS4
                        )
                        contrast_crop = clahe.apply(enlarged)
                        cv2.imwrite(path, contrast_crop)
                        footer_paths.append(path)
                        return footer_paths

                    groups = []
                    start = active_rows[0]
                    prev = active_rows[0]
                    for row in active_rows[1:]:
                        if row - prev > 5:
                            groups.append((start, prev))
                            start = row
                        prev = row
                    groups.append((start, prev))

                    for idx, (start, end) in enumerate(groups):
                        y1 = max(0, start - 6)
                        y2 = min(gray.shape[0], end + 7)
                        if y2 <= y1 + 2:
                            continue

                        line_crop = gray[y1:y2, :]
                        col_splits = _split_by_whitespace_gaps(line_crop, min_gap=12)
                        for col_name, col_x1, col_x2 in col_splits:
                            col_crop = line_crop[:, col_x1:col_x2]
                            enlarged = cv2.resize(
                                col_crop, (0, 0), fx=4, fy=4, interpolation=cv2.INTER_LANCZOS4
                            )
                            contrast_crop = clahe.apply(enlarged)
                            out_path = str(results_base_folder / f"footer_label_{idx}_{col_name}.jpg")
                            cv2.imwrite(out_path, contrast_crop)
                            footer_paths.append(out_path)

                    return footer_paths

                def save_legend_area_crops(h_img, w_img):
                    legend_paths = []
                    plot_areas_local = sorted(
                        bounding_boxes.get("plot_area", []), key=lambda el: el[4], reverse=True
                    )
                    if not plot_areas_local:
                        return legend_paths

                    plot_y_max = plot_areas_local[0][3]
                    legend_areas = sorted(
                        bounding_boxes.get("legend_area", []), key=lambda el: el[4], reverse=True
                    )
                    if not legend_areas:
                        return legend_paths

                    row_idx_global = 0
                    for box in legend_areas:
                        if len(box) < 4:
                            continue
                        x1, y1, x2, y2 = box[:4]
                        x1, y1 = int(x1), int(y1)
                        x2, y2 = int(x2), int(y2)

                        if y1 < plot_y_max:
                            continue

                        if x2 <= x1 + 10 or y2 <= y1 + 10:
                            continue

                        leg_crop = image[y1:y2, x1:x2]
                        gray = cv2.cvtColor(leg_crop, cv2.COLOR_BGR2GRAY)

                        binary = cv2.threshold(
                            gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
                        )[1]
                        row_counts = (binary > 0).sum(axis=1)
                        active_rows = np.where(row_counts > max(2, binary.shape[1] * 0.01))[0]

                        if active_rows.size == 0:
                            row_groups = [(0, gray.shape[0] - 1)]
                        else:
                            row_groups = []
                            start = active_rows[0]
                            prev = active_rows[0]
                            for row in active_rows[1:]:
                                if row - prev > 5:
                                    row_groups.append((start, prev))
                                    start = row
                                prev = row
                            row_groups.append((start, prev))

                        for start, end in row_groups:
                            row_y1 = max(0, start - 4)
                            row_y2 = min(gray.shape[0], end + 5)
                            if row_y2 <= row_y1 + 2:
                                continue

                            row_crop = gray[row_y1:row_y2, :]
                            col_splits = _split_by_whitespace_gaps(row_crop, min_gap=10)
                            for col_name, col_x1, col_x2 in col_splits:
                                col_crop = row_crop[:, col_x1:col_x2]
                                enlarged = cv2.resize(
                                    col_crop, (0, 0), fx=4, fy=4, interpolation=cv2.INTER_LANCZOS4
                                )
                                contrast_crop = clahe.apply(enlarged)
                                out_path = str(results_base_folder / f"legend_area_{row_idx_global}_{col_name}.jpg")
                                cv2.imwrite(out_path, contrast_crop)
                                legend_paths.append(out_path)
                                label_coordinates[out_path] = [
                                    float(x1 + col_x1),
                                    float(y1 + row_y1),
                                    float(x1 + col_x2),
                                    float(y1 + row_y2),
                                    box[4] if len(box) >= 5 else 0.0,
                                ]
                            row_idx_global += 1

                    return legend_paths

                cropped_x_labels = crop_bounding_boxes(
                    image, bounding_boxes["xlabel"], confidence_threshold, h_img, w_img
                )
                cropped_y_labels = crop_bounding_boxes(
                    image, bounding_boxes["ylabel"], confidence_threshold, h_img, w_img
                )
                cropped_x_titles = crop_bounding_boxes(
                    image, bounding_boxes.get("x_title", []), 0.5, h_img, w_img
                )
                cropped_y_titles = crop_bounding_boxes(
                    image, bounding_boxes.get("y_title", []), 0.5, h_img, w_img
                )

                for i, cropped_image in enumerate(cropped_x_labels):
                    path = str(results_base_folder / f"cropped_xlabels_{i}.jpg")
                    gray_crop = cv2.cvtColor(cropped_image, cv2.COLOR_BGR2GRAY)
                    enlarged = cv2.resize(gray_crop, (0, 0), fx=2, fy=2, interpolation=cv2.INTER_LANCZOS4)
                    contrast_crop = clahe.apply(enlarged)
                    cv2.imwrite(path, contrast_crop)
                    label_coordinates[path] = bounding_boxes["xlabel"][i]

                for i, cropped_image in enumerate(cropped_y_labels):
                    path = str(results_base_folder / f"cropped_ylabels_{i}.jpg")
                    gray_crop = cv2.cvtColor(cropped_image, cv2.COLOR_BGR2GRAY)
                    enlarged = cv2.resize(gray_crop, (0, 0), fx=2, fy=2, interpolation=cv2.INTER_LANCZOS4)
                    contrast_crop = clahe.apply(enlarged)
                    cv2.imwrite(path, contrast_crop)
                    label_coordinates[path] = bounding_boxes["ylabel"][i]

                for i, cropped_image in enumerate(cropped_x_titles):
                    path = str(results_base_folder / f"cropped_xtitle_{i}.jpg")
                    gray_crop = cv2.cvtColor(cropped_image, cv2.COLOR_BGR2GRAY)
                    enlarged = cv2.resize(gray_crop, (0, 0), fx=2, fy=2, interpolation=cv2.INTER_LANCZOS4)
                    contrast_crop = clahe.apply(enlarged)
                    cv2.imwrite(path, contrast_crop)

                for i, cropped_image in enumerate(cropped_y_titles):
                    path = str(results_base_folder / f"cropped_ytitle_{i}.jpg")
                    gray_crop = cv2.cvtColor(cropped_image, cv2.COLOR_BGR2GRAY)
                    enlarged = cv2.resize(gray_crop, (0, 0), fx=2, fy=2, interpolation=cv2.INTER_LANCZOS4)
                    contrast_crop = clahe.apply(enlarged)
                    cv2.imwrite(path, contrast_crop)

                footer_paths = save_footer_crops(h_img, w_img)
                legend_area_paths = save_legend_area_crops(h_img, w_img)

                for label_name, threshold, pad_w_ratio, pad_h_ratio in [
                    ("legend_label", 0.5, 0.12, 0.28),
                    ("mark_label", 0.35, 0.16, 0.30),
                    ("value_label", 0.35, 0.16, 0.30),
                    ("chart_title", 0.45, 0.10, 0.22),
                    ("legend_title", 0.45, 0.10, 0.22),
                ]:
                    text_boxes = bounding_boxes.get(label_name, [])
                    if text_boxes:
                        save_text_crops(
                            label_name,
                            text_boxes,
                            threshold=threshold,
                            pad_w_ratio=pad_w_ratio,
                            pad_h_ratio=pad_h_ratio,
                            h_img=h_img,
                            w_img=w_img,
                        )
                if footer_paths:
                    for idx, path in enumerate(footer_paths):
                        label_coordinates[path] = [0, 0, 0, 0, 1.0]

                plot_areas = bounding_boxes.get("plot_area", [])
                legend_patches = bounding_boxes.get("legend_patch", [])

                logger.info(f"  Found legend_patch: {len(legend_patches)} items")
                logger.info(f"  Plot area: {plot_areas[0] if plot_areas else 'N/A'}")

                plot_left = plot_areas[0][0] if plot_areas else w_img * 0.3
                logger.info(f"  Left chart boundary: x={plot_left:.1f}")

                if plot_left > 20:
                    nx1 = max(0, int(plot_left) - 150)
                    ny1 = int(plot_areas[0][1]) if plot_areas else 0
                    nx2 = int(plot_left)
                    ny2 = int(plot_areas[0][3]) if plot_areas else h_img

                    if nx2 > nx1 + 10 and ny2 > ny1 + 10:
                        legend_crop = image[ny1:ny2, nx1:nx2]
                        path = str(results_base_folder / "legend_label_left.jpg")
                        logger.info(
                            f"    Cropping legend area on the left: [{nx1}:{ny2}, {nx1}:{nx2}] -> {path}"
                        )

                        gray_crop = cv2.cvtColor(legend_crop, cv2.COLOR_BGR2GRAY)
                        enlarged = cv2.resize(gray_crop, (0, 0), fx=2, fy=2, interpolation=cv2.INTER_LANCZOS4)
                        contrast_crop = clahe.apply(enlarged)
                        cv2.imwrite(path, contrast_crop)
                        label_coordinates[path] = [nx1, ny1, nx2, ny2, 1.0]
                        logger.info(f"  Left legend saved to {path}")

                with open(results_base_folder / "label_coordinates.json", "w") as f:
                    json.dump(label_coordinates, f)

                logger.info(f"ChartDete: Processed {Path(img_path).name}")

            except Exception as e:
                logger.error(f"ChartDete failed for {img_path}: {e}")
                raise
