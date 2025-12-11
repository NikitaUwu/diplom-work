from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.base import Base


class Chart(Base):
    __tablename__ = "charts"

    id = Column(Integer, primary_key=True, index=True)

    # владелец графика
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # информация о файле
    original_filename = Column(String(255), nullable=False)
    mime_type = Column(String(100), nullable=False)
    sha256 = Column(String(64), index=True, nullable=False)

    # статус обработки: uploaded / processing / done / error
    status = Column(String(32), index=True, nullable=False)

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    processed_at = Column(DateTime(timezone=True), nullable=True)

    error_message = Column(Text, nullable=True)

    # пути к файлам на диске
    original_path = Column(String(500), nullable=False)
    preview_path = Column(String(500), nullable=True)

    # немного агрегированной метаинформации
    n_panels = Column(Integer, nullable=True)
    n_series = Column(Integer, nullable=True)

    # результат обработки (структура панелей/серий/точек) целиком, как JSON
    result_json = Column(JSON, nullable=True)

    # связь с пользователем
    user = relationship("User", backref="charts")
