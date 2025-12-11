import os
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel, ValidationError

# Загружаем .env из текущей директории или родительских
load_dotenv()


class Settings(BaseModel):
    # строка подключения к БД
    database_url: str

    # JWT
    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60

    # каталог для хранения загруженных файлов
    storage_dir: Path = Path("./storage")

    class Config:
        arbitrary_types_allowed = True


def get_settings() -> Settings:
    try:
        return Settings(
            database_url=os.environ.get("DATABASE_URL", ""),
            jwt_secret_key=os.environ.get("JWT_SECRET_KEY", "CHANGE_ME"),
            jwt_algorithm=os.environ.get("JWT_ALGORITHM", "HS256"),
            jwt_access_token_expire_minutes=int(
                os.environ.get("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "60")
            ),
            storage_dir=Path(os.environ.get("STORAGE_DIR", "./storage")),
        )
    except ValidationError as e:
        # На раннем этапе удобно упасть с понятной ошибкой,
        # если в .env что-то не так
        raise RuntimeError(f"Invalid settings: {e}") from e


settings = get_settings()