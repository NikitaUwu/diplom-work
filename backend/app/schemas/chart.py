from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel

from app.schemas.ml import Panel, MlMeta


class ChartStatus(str, Enum):
    uploaded = "uploaded"
    processing = "processing"
    done = "done"
    error = "error"


class ChartBase(BaseModel):
    id: int
    status: ChartStatus
    original_filename: str
    mime_type: str
    created_at: datetime
    processed_at: Optional[datetime] = None

    n_panels: Optional[int] = None
    n_series: Optional[int] = None


class ChartListItem(ChartBase):
    # то, что нужно для списка графиков пользователя
    error_message: Optional[str] = None

    class Config:
        from_attributes = True


class ChartDetail(ChartBase):
    # полный результат: панели/серии/точки + метаданные
    panels: List[Panel]
    ml_meta: Optional[MlMeta] = None
    error_message: Optional[str] = None

    class Config:
        from_attributes = True


class ChartCreateResponse(ChartDetail):
    """
    Можно использовать ту же структуру для ответа на загрузку:
    после загрузки и обработки возвращаем детальную информацию.
    """
    pass


class ExportFormat(str, Enum):
    csv = "csv"
    txt = "txt"


class ChartExportParams(BaseModel):
    format: ExportFormat = ExportFormat.csv
    panel_id: Optional[str] = None
    series_id: Optional[str] = None
