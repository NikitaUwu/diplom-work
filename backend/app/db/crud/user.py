from typing import Optional

from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.db.models.user import User
from app.schemas.user import UserCreate


class UserCRUD:
    def get_by_id(self, db: Session, user_id: int) -> Optional[User]:
        return db.query(User).filter(User.id == user_id).first()

    def get_by_email(self, db: Session, email: str) -> Optional[User]:
        return db.query(User).filter(User.email == email).first()

    def create(self, db: Session, user_in: UserCreate) -> User:
        db_obj = User(
            email=user_in.email,
            hashed_password=get_password_hash(user_in.password),
            is_active=True,
        )
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj


user_crud = UserCRUD()
