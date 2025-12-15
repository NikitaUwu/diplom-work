from enum import Enum
from typing import List, Optional, Tuple

from pydantic import BaseModel


class ScaleType(str, Enum):
    linear = "linear"
    log = "log"
    time = "time"


class SeriesStyle(BaseModel):
    mean_color: Optional[Tuple[int, int, int]] = None  # RGB
    marker: Optional[str] = None
    dash: Optional[str] = None


class Series(BaseModel):
    id: str
    name: Optional[str] = None
    style: Optional[SeriesStyle] = None
    # список точек: [ [x, y], ... ] уже в единицах осей
    points: List[Tuple[float, float]]


class Panel(BaseModel):
    id: str
    row: Optional[int] = None
    col: Optional[int] = None

    x_unit: Optional[str] = None
    y_unit: Optional[str] = None

    x_scale: ScaleType = ScaleType.linear
    y_scale: ScaleType = ScaleType.linear

    series: List[Series]


class MlMeta(BaseModel):
    # простые метаданные, которые может вернуть пайплайн
    total_time_ms: Optional[float] = None
    ocr_time_ms: Optional[float] = None
    line_extraction_time_ms: Optional[float] = None

    x_scale_confidence: Optional[float] = None
    y_scale_confidence: Optional[float] = None

    # любые дополнительные флаги
    used_degrid: Optional[bool] = None
