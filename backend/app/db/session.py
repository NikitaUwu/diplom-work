from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings

# Создаём engine на основе строки подключения из .env
engine = create_engine(
    settings.database_url,
    future=True,
    pool_pre_ping=True,
)

# Фабрика сессий: её будем использовать в зависимостях FastAPI
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    future=True,
)
