from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import router as api_v1_router
from app.core.config import settings

app = FastAPI(title="Chart Extraction API")


# Разрешённые источники (origins) для фронтенда.
# Пока можно оставить localhost; позже подставишь реальный адрес фронта.
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    # сюда можно добавить продакшн-URL фронта, когда он появится
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    """
    Действия при старте приложения:
    - гарантируем, что существует корневая директория для хранилища файлов.
    - позже здесь же можно инициализировать ML-модели.
    """
    storage_dir: Path = settings.storage_dir
    storage_dir.mkdir(parents=True, exist_ok=True)


@app.get("/health", tags=["health"])
async def health_check():
    return {"status": "ok"}


# Все основные эндпойнты живут под /api/v1
app.include_router(api_v1_router, prefix="/api/v1")
