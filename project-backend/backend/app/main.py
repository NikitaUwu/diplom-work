from contextlib import asynccontextmanager
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import router as api_v1_router
from app.core.config import settings


def _cors_origins() -> list[str]:
    raw = getattr(settings, "cors_origins", None)

    if raw is None:
        env_raw = os.getenv("CORS_ORIGINS", "http://localhost:5173")
        raw = [x.strip() for x in env_raw.split(",") if x.strip()]
    elif isinstance(raw, str):
        raw = [x.strip() for x in raw.split(",") if x.strip()]
    elif isinstance(raw, (list, tuple, set)):
        raw = [str(x).strip() for x in raw if str(x).strip()]
    else:
        raw = ["http://localhost:5173"]

    # Для allow_credentials=True нельзя "*"
    return [origin for origin in raw if origin != "*"] or ["http://localhost:5173"]


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(
    title="Chart Extraction API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["health"])
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(api_v1_router, prefix="/api/v1")