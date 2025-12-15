from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel


class ChartStatus(str, Enum):
    uploaded = "uploaded"
    processing = "processing"
    done = "done"
    error = "error"


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
