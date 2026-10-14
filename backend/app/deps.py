"""FastAPI dependencies: current user, role/ownership checks, CSRF."""
from __future__ import annotations

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from .config import get_settings
from .database import get_db
from .errors import ApiError
from .models import Session as SessionModel
from .models import User
from .security import constant_time_equals, hash_token, is_expired


def get_current_user(request: Request, db: OrmSession = Depends(get_db)) -> User:
    settings = get_settings()
    raw_token = request.cookies.get(settings.cookie_name)
    if not raw_token:
        raise ApiError("not_authenticated", "Avtorizatsiya talab qilinadi.", status_code=401)

    session = db.execute(
        select(SessionModel).where(SessionModel.token_hash == hash_token(raw_token))
    ).scalar_one_or_none()

    if session is None or session.revoked_at is not None or is_expired(session.expires_at):
        raise ApiError("not_authenticated", "Sessiya yaroqsiz.", status_code=401)

    user = db.get(User, session.user_id)
    if user is None or not user.is_active:
        raise ApiError("not_authenticated", "Sessiya yaroqsiz.", status_code=401)

    # Attach for later use without another query.
    request.state.session_row = session
    request.state.user = user
    return user


def require_csrf(request: Request, _user: User = Depends(get_current_user)) -> None:
    """Double-submit CSRF check for state-changing requests.

    Depends on ``get_current_user`` so the session row is loaded (and the user
    authenticated) before the CSRF token is compared.
    """
    session = getattr(request.state, "session_row", None)
    if session is None:
        raise ApiError("not_authenticated", "Avtorizatsiya talab qilinadi.", status_code=401)

    settings = get_settings()
    header = request.headers.get(settings.csrf_header_name, "")
    if not header or not constant_time_equals(hash_token(header), session.csrf_hash):
        raise ApiError("csrf_failed", "CSRF tekshiruvi muvaffaqiyatsiz.", status_code=403)


def require_admin(request: Request, user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise ApiError("forbidden", "Ruxsat yo'q.", status_code=403)
    return user
