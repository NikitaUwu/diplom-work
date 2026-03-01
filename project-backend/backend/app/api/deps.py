from typing import Generator
import os

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import decode_access_token
from app.db import models
from app.db.session import SessionLocal
from app.schemas.auth import TokenPayload

bearer_scheme = HTTPBearer(auto_error=False)


def _env_bool(name: str, default: str = "1") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


def _get_setting(name: str, env_name: str, default):
    value = getattr(settings, name, None)
    if value is not None:
        return value
    return os.getenv(env_name, default)


def _auth_enabled() -> bool:
    value = getattr(settings, "auth_enabled", None)
    if value is not None:
        return bool(value)
    return _env_bool("AUTH_ENABLED", "1")


def _cookie_name() -> str:
    return str(_get_setting("auth_cookie_name", "AUTH_COOKIE_NAME", "access_token")).strip()


def _dev_user_email() -> str:
    return str(_get_setting("dev_user_email", "DEV_USER_EMAIL", "dev@local")).strip()


def _dev_user_password() -> str:
    return str(_get_setting("dev_user_password", "DEV_USER_PASSWORD", "devpass"))


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _get_or_create_dev_user(db: Session) -> models.user.User:
    email = _dev_user_email()
    password = _dev_user_password()

    user = db.query(models.user.User).filter(models.user.User.email == email).first()
    if user:
        if not user.is_active:
            user.is_active = True
            db.commit()
            db.refresh(user)
        return user

    from app.core.security import get_password_hash

    user = models.user.User(
        email=email,
        hashed_password=get_password_hash(password),
        is_active=True,
    )
    db.add(user)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        user = db.query(models.user.User).filter(models.user.User.email == email).first()
        if user:
            if not user.is_active:
                user.is_active = True
                db.commit()
                db.refresh(user)
            return user
        raise

    db.refresh(user)
    return user


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> models.user.User:
    if not _auth_enabled():
        return _get_or_create_dev_user(db)

    token: str | None = None

    if credentials is not None and credentials.scheme.lower() == "bearer":
        token = credentials.credentials

    if not token:
        token = request.cookies.get(_cookie_name())

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = decode_access_token(token)
        token_data = TokenPayload.model_validate(payload)
        user_id = int(token_data.sub)
    except (JWTError, ValidationError, ValueError, TypeError):
        raise credentials_exception

    user = db.query(models.user.User).filter(models.user.User.id == user_id).first()
    if not user or not user.is_active:
        raise credentials_exception

    return user