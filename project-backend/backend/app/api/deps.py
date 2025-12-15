from __future__ import annotations

from typing import Generator
import os

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.orm import Session

from app.core.security import decode_access_token, get_password_hash
from app.db.session import SessionLocal
from app.db.models.user import User
from app.schemas.auth import TokenPayload

# Схема безопасности "Bearer" для Swagger и зависимостей
bearer_scheme = HTTPBearer(auto_error=False)


def _env_bool(name: str, default: str = "1") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


def _auth_enabled() -> bool:
    return _env_bool("AUTH_ENABLED", "1")


def _dev_user_email() -> str:
    return os.getenv("DEV_USER_EMAIL", "dev@local").strip()


def _dev_user_password() -> str:
    return os.getenv("DEV_USER_PASSWORD", "devpass")


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _get_or_create_dev_user(db: Session) -> User:
    email = _dev_user_email()
    password = _dev_user_password()

    user = db.query(User).filter(User.email == email).first()
    if user:
        if not user.is_active:
            user.is_active = True
            db.commit()
            db.refresh(user)
        return user

    user = User(
        email=email,
        hashed_password=get_password_hash(password),
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    """
    Извлекает текущего пользователя по JWT-токену из заголовка Authorization: Bearer <token>.
    Если AUTH_ENABLED выключен — возвращает dev-пользователя без проверки токена.
    """
    if not _auth_enabled():
        return _get_or_create_dev_user(db)

    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = decode_access_token(token)
        token_data = TokenPayload(**payload)
    except (JWTError, ValueError):
        raise credentials_exception

    try:
        user_id = int(token_data.sub)
    except (TypeError, ValueError):
        raise credentials_exception

    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise credentials_exception

    return user
