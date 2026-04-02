from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class ChartStatus(str, Enum):
    uploaded = 'uploaded'
    processing = 'processing'
    done = 'done'
    error = 'error'


class ChartExportFormat(str, Enum):
    csv = 'csv'
    txt = 'txt'
    json = 'json'
    table_csv = 'table_csv'


class ChartUpdateRequest(BaseModel):
    result_json: dict[str, Any]


class ChartSplinePointsRequest(BaseModel):
    total_points: int = Field(default=3, ge=2)


class ChartCreateResponse(BaseModel):
    id: int
    status: ChartStatus
    original_filename: str
    mime_type: str
    created_at: datetime

    processed_at: Optional[datetime] = None
    n_panels: Optional[int] = None
    n_series: Optional[int] = None

    result_json: Optional[dict[str, Any]] = None
    error_message: Optional[str] = None