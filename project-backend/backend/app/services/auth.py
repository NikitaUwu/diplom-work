from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import verify_password, create_access_token
from app.db.crud.user import user_crud
from app.db.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest, Token
from app.schemas.user import UserCreate, UserRead


class AuthService:
    """
    Сервис авторизации: регистрация, логин, простая аутентификация пользователя.
    """

    def register(self, db: Session, data: RegisterRequest) -> UserRead:
        """
        Регистрация нового пользователя.
        """
        # Проверяем, что такого email ещё нет
        existing = user_crud.get_by_email(db, data.email)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User with this email already exists",
            )

        # Создаём пользователя через CRUD (там уже хэшируется пароль)
        user = user_crud.create(
            db,
            UserCreate(email=data.email, password=data.password),
        )
        return UserRead.model_validate(user)

    def authenticate(self, db: Session, email: str, password: str) -> User | None:
        """
        Проверка пары email/пароль. Возвращает пользователя или None.
        """
        user = user_crud.get_by_email(db, email)
        if not user:
            return None
        if not verify_password(password, user.hashed_password):
            return None
        if not user.is_active:
            return None
        return user

    def login(self, db: Session, data: LoginRequest) -> Token:
        """
        Логин: проверка email/пароля и выдача JWT-токена.
        """
        user = self.authenticate(db, data.email, data.password)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Incorrect email or password",
            )

        # В subject кладём id пользователя в виде строки
        access_token = create_access_token(subject=str(user.id))

        return Token(access_token=access_token)


auth_service = AuthService()
