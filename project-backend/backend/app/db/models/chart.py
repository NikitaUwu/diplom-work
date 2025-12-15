from sqlalchemy import Column, DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB

from app.db.base import Base


class Chart(Base):
    __tablename__ = "charts"

    id = Column(Integer, primary_key=True)

    user_id = Column(Integer, index=True, nullable=False)

    original_filename = Column(String(255), nullable=False)
    mime_type = Column(String(100), nullable=False)

    sha256 = Column(String(64), index=True, nullable=False)
    original_path = Column(String(1024), nullable=False)

    status = Column(String(32), nullable=False, default="uploaded")  # uploaded|processing|done|error
    error_message = Column(Text, nullable=True)

    result_json = Column(JSONB, nullable=True)

    n_panels = Column(Integer, nullable=True)
    n_series = Column(Integer, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    processed_at = Column(DateTime(timezone=True), nullable=True)
