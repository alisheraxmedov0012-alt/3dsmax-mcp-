"""Admin-only routes. All handlers require the ``admin`` role server-side."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from ..database import get_db
from ..deps import require_admin
from ..models import User
from ..schemas import AdminUserResponse

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/users", response_model=list[AdminUserResponse])
def list_users(
    _: User = Depends(require_admin), db: OrmSession = Depends(get_db)
) -> list[AdminUserResponse]:
    users = db.execute(select(User).order_by(User.created_at)).scalars().all()
    return [AdminUserResponse.model_validate(user) for user in users]
