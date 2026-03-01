from fastapi import APIRouter, Depends, status, Response
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_current_user
from app.db.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest, Token
from app.schemas.user import UserRead
from app.services.auth import auth_service

router = APIRouter()

COOKIE_NAME = "access_token"


@router.post(
    "/register",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
)
def register_user(
    data: RegisterRequest,
    db: Session = Depends(get_db),
) -> UserRead:
    return auth_service.register(db, data)


@router.post(
    "/login",
    response_model=Token,
)
def login(
    data: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> Token:
    """
    Логин: проверка email/пароля, выдача JWT-токена.
    Дополнительно: кладём access_token в HttpOnly cookie, чтобы <img> мог грузить артефакты.
    """
    token = auth_service.login(db, data)

    # Для localhost/HTTP: secure=False. В проде будет secure=True (HTTPS).
    response.set_cookie(
        key=COOKIE_NAME,
        value=token.access_token,
        httponly=True,
        samesite="lax",
        secure=False,
        path="/",
        max_age=60 * 60,  # 1 час
    )
    return token


@router.post("/logout")
def logout(response: Response) -> dict:
    """
    Выход: удаляем cookie с токеном.
    """
    response.delete_cookie(key=COOKIE_NAME, path="/")
    return {"ok": True}


@router.get(
    "/me",
    response_model=UserRead,
)
def read_current_user(
    current_user: User = Depends(get_current_user),
) -> UserRead:
    return UserRead.model_validate(current_user)