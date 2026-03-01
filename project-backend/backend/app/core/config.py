import os
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from pydantic import BaseModel, ValidationError

BACKEND_DIR = Path(__file__).resolve().parents[2]   # .../project-backend/backend
PROJECT_DIR = Path(__file__).resolve().parents[3]   # .../project-backend

load_dotenv(PROJECT_DIR / ".env")


class Settings(BaseModel):
    database_url: str

    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60

    storage_dir: Path = (BACKEND_DIR / "storage").resolve()

    auth_enabled: bool = True
    auth_cookie_name: str = "access_token"
    cookie_secure: bool = False
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    cookie_max_age: int = 3600

    dev_user_email: str = "dev@local"
    dev_user_password: str = "devpass"


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return int(raw)


def _env_str(name: str, default: str | None = None) -> str:
    raw = os.getenv(name)
    if raw is None:
        return "" if default is None else default
    return raw.strip()


def get_settings() -> Settings:
    try:
        jwt_ttl_minutes = _env_int("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", 60)
        cookie_max_age = _env_int("COOKIE_MAX_AGE", jwt_ttl_minutes * 60)
        cookie_samesite = _env_str("COOKIE_SAMESITE", "lax").lower()

        settings_obj = Settings(
            database_url=_env_str("DATABASE_URL"),
            jwt_secret_key=_env_str("JWT_SECRET_KEY"),
            jwt_algorithm=_env_str("JWT_ALGORITHM", "HS256") or "HS256",
            jwt_access_token_expire_minutes=jwt_ttl_minutes,
            storage_dir=Path(_env_str("STORAGE_DIR", str(BACKEND_DIR / "storage"))).resolve(),
            auth_enabled=_env_bool("AUTH_ENABLED", True),
            auth_cookie_name=_env_str("AUTH_COOKIE_NAME", "access_token") or "access_token",
            cookie_secure=_env_bool("COOKIE_SECURE", False),
            cookie_samesite=cookie_samesite,
            cookie_max_age=cookie_max_age,
            dev_user_email=_env_str("DEV_USER_EMAIL", "dev@local") or "dev@local",
            dev_user_password=os.getenv("DEV_USER_PASSWORD", "devpass"),
        )

        if not settings_obj.database_url:
            raise RuntimeError("DATABASE_URL is required")

        if not settings_obj.jwt_secret_key or settings_obj.jwt_secret_key == "CHANGE_ME":
            raise RuntimeError("JWT_SECRET_KEY must be set and must not be CHANGE_ME")

        if settings_obj.jwt_access_token_expire_minutes <= 0:
            raise RuntimeError("JWT_ACCESS_TOKEN_EXPIRE_MINUTES must be > 0")

        if settings_obj.cookie_max_age <= 0:
            raise RuntimeError("COOKIE_MAX_AGE must be > 0")

        if settings_obj.cookie_samesite == "none" and not settings_obj.cookie_secure:
            raise RuntimeError("COOKIE_SECURE must be true when COOKIE_SAMESITE=none")

        return settings_obj

    except (ValidationError, ValueError) as e:
        raise RuntimeError(f"Invalid settings: {e}") from e


settings = get_settings()