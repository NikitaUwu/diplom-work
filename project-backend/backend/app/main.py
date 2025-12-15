from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import router as api_v1_router
from app.core.config import settings

app = FastAPI(title="Chart Extraction API")

# Разрешённые источники (origins) для фронтенда.
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
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
    # гарантируем, что существует корневая директория для хранилища файлов
    settings.storage_dir.mkdir(parents=True, exist_ok=True)


@app.get("/health", tags=["health"])
async def health_check():
    return {"status": "ok"}


# Все основные эндпойнты живут под /api/v1
app.include_router(api_v1_router, prefix="/api/v1")
