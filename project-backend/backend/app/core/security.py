from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from jose import jwt
from passlib.context import CryptContext

from app.core.config import settings

# Контекст для хэширования паролей
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(
    subject: str,
    expires_minutes: Optional[int] = None,
) -> str:
    """
    subject — обычно id пользователя в виде строки.
    """
    if expires_minutes is None:
        expires_minutes = settings.jwt_access_token_expire_minutes

    expire = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    to_encode: dict[str, Any] = {"sub": subject, "exp": expire}

    encoded_jwt = jwt.encode(
        to_encode,
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )
    return encoded_jwt


def decode_access_token(token: str) -> dict[str, Any]:
    """
    Бросает JWTError, если токен некорректен или истёк.
    """
    payload = jwt.decode(
        token,
        settings.jwt_secret_key,
        algorithms=[settings.jwt_algorithm],
    )
    return payload
