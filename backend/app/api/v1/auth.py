from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_current_user
from app.db.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest, Token
from app.schemas.user import UserRead
from app.services.auth import auth_service

router = APIRouter()


@router.post(
    "/register",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
)
def register_user(
    data: RegisterRequest,
    db: Session = Depends(get_db),
) -> UserRead:
    """
    Регистрация нового пользователя.
    """
    return auth_service.register(db, data)


@router.post(
    "/login",
    response_model=Token,
)
def login(
    data: LoginRequest,
    db: Session = Depends(get_db),
) -> Token:
    """
    Логин: проверка email/пароля, выдача JWT-токена.
    """
    return auth_service.login(db, data)


@router.get(
    "/me",
    response_model=UserRead,
)
def read_current_user(
    current_user: User = Depends(get_current_user),
) -> UserRead:
    """
    Возвращает данные текущего авторизованного пользователя.
    """
    return UserRead.model_validate(current_user)
