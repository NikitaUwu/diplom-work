"""
Local TrOCR wrapper for OCR on chart text regions.
"""

from __future__ import annotations

import re

import torch
from PIL import Image, ImageEnhance, ImageOps
from transformers import TrOCRProcessor, VisionEncoderDecoderModel

from ..utils import logger


class OCRModel:
    def __init__(self, device: str = "cpu"):
        """Initialize TrOCR model."""
        logger.info("Loading TrOCR model...")

        self.device = torch.device(device)
        self.processor = TrOCRProcessor.from_pretrained("microsoft/trocr-base-printed")
        self.model = VisionEncoderDecoderModel.from_pretrained("microsoft/trocr-base-printed")
        self.model.to(self.device)
        self.model.eval()

        logger.info(f"TrOCR device: {self.device}")
        logger.info("Successfully loaded TrOCR!")

    @staticmethod
    def _resample_filter():
        return getattr(Image, "Resampling", Image).LANCZOS

    @staticmethod
    def _normalize_text(text: str, kind: str = "generic") -> str:
        text = re.sub(r"\s+", " ", (text or "").strip())
        if not text:
            return ""

        if kind in {"series", "legend", "title"}:
            text = text.replace("–", "-").replace("—", "-")
            text = re.sub(r"[^0-9A-Za-zА-Яа-яЁё/\\._,\-\s]+", "", text)
            text = re.sub(r"\s+", " ", text).strip()
            if not text:
                return ""

            # Common OCR confusion: Z -> 2 at the start of model names.
            text = re.sub(r"^[2](?=[A-ZА-Я])", "Z", text)
            text = re.sub(r"(?i)^citron\b", "", text).strip()
            text = re.sub(r"(?i)^zitron\b", "", text).strip()

            compact = text.replace(" ", "")
            if len(compact) >= 4 and len(set(compact)) == 1 and compact[0].isdigit():
                return ""

            letters = sum(ch.isalpha() for ch in text)
            digits = sum(ch.isdigit() for ch in text)
            if letters == 0:
                return ""
            if digits > 0 and letters < 2 and len(compact) <= 8:
                return ""
            return text

        if kind == "axis":
            cleaned = re.sub(r"[^0-9A-Za-z.,\-+]", "", text)
            if not cleaned:
                return ""
            digits_only = cleaned.replace(".", "").replace(",", "").replace("-", "").replace("+", "")
            if digits_only and len(digits_only) >= 4 and len(set(digits_only)) == 1:
                return ""
            return cleaned

        return text

    @staticmethod
    def _score_text(text: str, kind: str = "generic") -> int:
        if not text:
            return -10_000

        letters = sum(ch.isalpha() for ch in text)
        digits = sum(ch.isdigit() for ch in text)
        score = len(text) + letters * 4 - digits * 2

        if kind in {"series", "legend", "title"}:
            if letters == 0:
                score -= 500
            if re.fullmatch(r"[\d\s,.\-_/+]+", text):
                score -= 500

        if kind == "axis":
            if digits == 0:
                score -= 200
            if len(text) <= 1:
                score -= 100

        return score

    @staticmethod
    def _enhance_for_text(image: Image.Image) -> Image.Image:
        resized = image.resize((image.width * 2, image.height * 2), OCRModel._resample_filter())
        gray = ImageOps.grayscale(resized)
        gray = ImageOps.autocontrast(gray)
        gray = ImageEnhance.Contrast(gray).enhance(1.8)
        gray = ImageEnhance.Sharpness(gray).enhance(1.4)
        return gray.convert("RGB")

    @staticmethod
    def _binarize_for_text(image: Image.Image) -> Image.Image:
        resized = image.resize((image.width * 3, image.height * 3), OCRModel._resample_filter())
        gray = ImageOps.grayscale(resized)
        gray = ImageOps.autocontrast(gray)
        threshold = gray.point(lambda p: 255 if p > 180 else 0)
        return threshold.convert("RGB")

    def _decode(self, image: Image.Image, kind: str = "generic") -> str:
        pixel_values = self.processor(image, return_tensors="pt").pixel_values.to(self.device)
        with torch.inference_mode():
            generated_ids = self.model.generate(
                pixel_values,
                max_new_tokens=24,
                num_beams=5 if kind in {"series", "legend", "title"} else 1,
                early_stopping=True,
            )
        return self.processor.batch_decode(generated_ids, skip_special_tokens=True)[0]

    def inference(self, path: str, kind: str = "generic") -> tuple[str, str]:
        """
        Run OCR on a single image.
        """
        image = Image.open(path).convert("RGB")

        candidates = [image]
        if kind in {"series", "legend", "title"} or min(image.size) < 256:
            candidates.append(self._enhance_for_text(image))
            candidates.append(self._binarize_for_text(image))

        best_text = ""
        best_score = -10_000

        for candidate in candidates:
            raw_text = self._decode(candidate, kind=kind)
            normalized = self._normalize_text(raw_text, kind=kind)
            score = self._score_text(normalized, kind=kind)
            if score > best_score:
                best_score = score
                best_text = normalized

        return path, best_text

    def inference_batch(self, paths: list[str], kind: str = "generic") -> list[tuple[str, str]]:
        """
        Run OCR on multiple images.
        """
        results = []
        for path in paths:
            try:
                result = self.inference(path, kind=kind)
                results.append(result)
            except Exception as e:
                logger.error(f"OCR failed for {path}: {e}")
                results.append((path, ""))
        return results
