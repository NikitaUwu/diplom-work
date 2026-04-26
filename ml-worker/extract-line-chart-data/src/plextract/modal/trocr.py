"""
This script runs OCR using Microsofts trocr-base-handwritten on the axis label images.
"""

import modal
from modal import method
from pathlib import Path
from .modal import vol, modal_app as app

ocr_img = modal.Image.debian_slim().pip_install("transformers", "pillow", "torch")

with ocr_img.imports():
    from PIL import Image, ImageOps
    import io
    import json
    import os
    import torch
    from transformers import TrOCRProcessor, VisionEncoderDecoderModel


@app.cls(
    image=ocr_img,
    gpu="any",
    volumes={"/data": vol},
)
class OCRModel:
    @modal.enter()
    def enter(self):
        self.device = torch.device("cuda:0")
        self.processor = TrOCRProcessor.from_pretrained(
            "microsoft/trocr-base-handwritten"
        )
        self.model = VisionEncoderDecoderModel.from_pretrained(
            "microsoft/trocr-base-handwritten"
        )
        self.model.to(self.device)
        self.model.eval()

    @method()
    def inference(self, path: Path):
        # Make sure the file to make the prediction on is there
        vol.reload()

        # Open the image file
        image = Image.open(path).convert("RGB")

        pixel_values = self.processor(image, return_tensors="pt").pixel_values.to(self.device)
        with torch.inference_mode():
            generated_ids = self.model.generate(pixel_values)

        generated_text = self.processor.batch_decode(
            generated_ids, skip_special_tokens=True
        )[0]

        return path, generated_text
