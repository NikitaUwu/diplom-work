from pathlib import Path
from typing import List, Optional, Tuple

from app.schemas.ml import MlMeta, Panel


def process_image(image_path: Path) -> Tuple[List[Panel], Optional[MlMeta]]:
    """
    Заглушка для ML-пайплайна.

    Позже здесь будет:
      - предобработка изображения,
      - запуск моделей (LineFormer и т.п.),
      - сбор панелей/серий/точек и меты.

    Сейчас специально NotImplementedError, чтобы было очевидно,
    что ML-часть ещё не подключена.
    """
    raise NotImplementedError("ML pipeline is not implemented yet")
