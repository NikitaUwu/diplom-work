"""
Local pipeline orchestration for chart data extraction.
"""

import json
import os
from pathlib import Path

from ..utils import correct_coordinates, logger

# Import lineformer first to register custom MMDetection modules.
# This must happen before importing ChartDete.
try:
    import lineformer

    logger.info("LineFormer imported successfully - custom MMDetection modules registered")
except ImportError as e:
    logger.error(f"Failed to import lineformer: {e}")
    raise

from .chartdete import ChartDete
from .lineformer import LineFormer
from .trocr import OCRModel


_LINEFORMER: LineFormer | None = None
_CHARTDETE: ChartDete | None = None
_OCR_MODEL: OCRModel | None = None


def _default_device() -> str:
    try:
        import torch

        return "cuda:0" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def _resolve_device(env_key: str) -> str:
    raw_value = os.getenv(env_key) or os.getenv("PLEXTRACT_DEVICE")
    value = (raw_value or "").strip()
    return value or _default_device()


def _unique_texts(values: list[str]) -> list[str]:
    seen = set()
    cleaned: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        text = value.strip()
        if not text or text in seen:
            continue
        seen.add(text)
        cleaned.append(text)
    return cleaned


def _ocr_paths(ocr_model: OCRModel, paths: list[str], kind: str) -> dict[str, str]:
    if not paths:
        return {}
    return dict(ocr_model.inference_batch(paths, kind=kind))


def _get_models() -> tuple[LineFormer, ChartDete, OCRModel]:
    global _LINEFORMER, _CHARTDETE, _OCR_MODEL

    lineformer_device = _resolve_device("LINEFORMER_DEVICE")
    chartdete_device = _resolve_device("CHARTDETE_DEVICE")
    trocr_device = _resolve_device("TROCR_DEVICE")

    if _LINEFORMER is None:
        logger.info(f"Initializing LineFormer on device {lineformer_device}")
        _LINEFORMER = LineFormer(device=lineformer_device)
    else:
        logger.info("Reusing cached LineFormer instance.")

    if _CHARTDETE is None:
        logger.info(f"Initializing ChartDete on device {chartdete_device}")
        _CHARTDETE = ChartDete(device=chartdete_device)
    else:
        logger.info("Reusing cached ChartDete instance.")

    if _OCR_MODEL is None:
        logger.info(f"Initializing TrOCR on device {trocr_device}")
        _OCR_MODEL = OCRModel(device=trocr_device)
    else:
        logger.info("Reusing cached OCRModel instance.")

    return _LINEFORMER, _CHARTDETE, _OCR_MODEL


def run_pipeline(input_dir: str, output_dir: str) -> None:
    """
    Run the full chart data extraction pipeline locally.

    Args:
        input_dir: Directory containing input chart images
        output_dir: Directory to save all outputs
    """
    logger.info("Running local pipeline...")
    logger.info(f"  Input: {input_dir}")
    logger.info(f"  Output: {output_dir}")

    os.makedirs(output_dir, exist_ok=True)

    input_files = sorted(os.listdir(input_dir))
    logger.debug(f"Found input files: {input_files}")

    logger.info("Creating output folders...")
    for file in input_files:
        file_dir = Path(output_dir) / file
        os.makedirs(file_dir / "chartdete", exist_ok=True)
        os.makedirs(file_dir / "lineformer", exist_ok=True)

    logger.info("Extracting lines from images using LineFormer...")
    lineformer, chartdete, ocr_model = _get_models()
    for img in input_files:
        img_path = os.path.join(input_dir, img)
        lineformer.inference(img_path, output_dir)

    logger.info("Detecting chart elements using ChartDete...")
    chartdete.inference(input_dir, output_dir)

    logger.info("Running OCR on axis labels, legend labels and chart text...")
    axis_label_paths_by_dir: dict[str, list[str]] = {}
    legend_label_paths_by_dir: dict[str, list[str]] = {}
    series_label_paths_by_dir: dict[str, list[str]] = {}
    footer_label_paths_by_dir: dict[str, list[str]] = {}
    axis_title_paths_by_dir: dict[str, list[str]] = {}
    chart_title_paths_by_dir: dict[str, list[str]] = {}

    for plot_img_dir in sorted(os.listdir(output_dir)):
        chartdete_dir = Path(output_dir) / plot_img_dir / "chartdete"
        if not chartdete_dir.exists():
            continue

        for label_img in sorted(os.listdir(chartdete_dir)):
            if label_img.endswith(".json"):
                continue

            full_path = str(chartdete_dir / label_img)

            if label_img.startswith("legend_label") or label_img == "legend_label_left.jpg":
                legend_label_paths_by_dir.setdefault(plot_img_dir, []).append(full_path)
            elif label_img.startswith("footer_label"):
                footer_label_paths_by_dir.setdefault(plot_img_dir, []).append(full_path)
            elif label_img.startswith("mark_label") or label_img.startswith("value_label"):
                series_label_paths_by_dir.setdefault(plot_img_dir, []).append(full_path)
            elif label_img.startswith("chart_title") or label_img.startswith("legend_title"):
                chart_title_paths_by_dir.setdefault(plot_img_dir, []).append(full_path)
            elif "cropped_xtitle" in label_img or "cropped_ytitle" in label_img:
                axis_title_paths_by_dir.setdefault(plot_img_dir, []).append(full_path)
            elif "label" in label_img:
                axis_label_paths_by_dir.setdefault(plot_img_dir, []).append(full_path)

    axis_label_text_map = _ocr_paths(
        ocr_model,
        [path for paths in axis_label_paths_by_dir.values() for path in paths],
        kind="axis",
    )

    legend_label_text_map_by_dir: dict[str, dict[str, str]] = {}
    for img_dir, paths in legend_label_paths_by_dir.items():
        legend_label_text_map_by_dir[img_dir] = _ocr_paths(ocr_model, paths, kind="series")

    series_label_text_map_by_dir: dict[str, dict[str, str]] = {}
    for img_dir, paths in series_label_paths_by_dir.items():
        series_label_text_map_by_dir[img_dir] = _ocr_paths(ocr_model, paths, kind="series")

    footer_label_text_map_by_dir: dict[str, dict[str, str]] = {}
    for img_dir, paths in footer_label_paths_by_dir.items():
        footer_label_text_map_by_dir[img_dir] = _ocr_paths(ocr_model, paths, kind="series")

    axis_title_text_map_by_dir: dict[str, dict[str, str]] = {}
    for img_dir, paths in axis_title_paths_by_dir.items():
        axis_title_text_map_by_dir[img_dir] = _ocr_paths(ocr_model, paths, kind="title")

    chart_title_text_map_by_dir: dict[str, dict[str, str]] = {}
    for img_dir, paths in chart_title_paths_by_dir.items():
        chart_title_text_map_by_dir[img_dir] = _ocr_paths(ocr_model, paths, kind="title")

    for img_dir in sorted(os.listdir(output_dir)):
        img_path = Path(output_dir) / img_dir
        if not img_path.is_dir():
            continue

        axis_path = img_path / "axis_label_texts.json"
        axis_dir_paths = axis_label_paths_by_dir.get(img_dir, [])
        with open(axis_path, "w", encoding="utf-8") as f:
            json.dump(
                {p: axis_label_text_map.get(p, "") for p in axis_dir_paths},
                f,
                ensure_ascii=False,
            )

        legend_path = img_path / "legend_label_texts.json"
        legend_texts = _unique_texts(
            [
                legend_label_text_map_by_dir.get(img_dir, {}).get(p, "").strip()
                for p in legend_label_paths_by_dir.get(img_dir, [])
            ]
        )
        with open(legend_path, "w", encoding="utf-8") as f:
            json.dump(legend_texts, f, ensure_ascii=False)

        series_path = img_path / "series_label_texts.json"
        series_texts = _unique_texts(
            [
                series_label_text_map_by_dir.get(img_dir, {}).get(p, "").strip()
                for p in series_label_paths_by_dir.get(img_dir, [])
            ]
        )
        with open(series_path, "w", encoding="utf-8") as f:
            json.dump(series_texts, f, ensure_ascii=False)

        footer_path = img_path / "footer_label_texts.json"
        footer_texts = _unique_texts(
            [
                footer_label_text_map_by_dir.get(img_dir, {}).get(p, "").strip()
                for p in footer_label_paths_by_dir.get(img_dir, [])
            ]
        )
        with open(footer_path, "w", encoding="utf-8") as f:
            json.dump(footer_texts, f, ensure_ascii=False)

        axis_titles_path = img_path / "axis_titles.json"
        titles = {"x_title": "", "y_title": ""}
        for p in axis_title_paths_by_dir.get(img_dir, []):
            t = axis_title_text_map_by_dir.get(img_dir, {}).get(p, "").strip()
            if "xtitle" in p:
                titles["x_title"] = t
            elif "ytitle" in p:
                titles["y_title"] = t
        with open(axis_titles_path, "w", encoding="utf-8") as f:
            json.dump(titles, f, ensure_ascii=False)

        chart_titles_path = img_path / "chart_title_texts.json"
        chart_titles = _unique_texts(
            [
                chart_title_text_map_by_dir.get(img_dir, {}).get(p, "").strip()
                for p in chart_title_paths_by_dir.get(img_dir, [])
            ]
        )
        with open(chart_titles_path, "w", encoding="utf-8") as f:
            json.dump(chart_titles, f, ensure_ascii=False)

    logger.info("Correcting coordinates...")
    for img in input_files:
        correct_coordinates(output_dir, img)

    logger.info("Local pipeline complete!")
