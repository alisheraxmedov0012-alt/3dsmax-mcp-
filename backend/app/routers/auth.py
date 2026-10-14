"""Authentication routes: register, login, logout, me, email verify, reset."""
from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from ..config import get_settings
from ..database import get_db
from ..deps import get_current_user, require_csrf
from ..errors import ApiError
from ..guards import ip_rate_limit
from ..models import OneTimeToken, User
from ..models import Session as SessionModel
from ..rate_limit import get_rate_limiter
from ..schemas import (
    ForgotPasswordRequest,
    LoginRequest,
    MessageResponse,
    RegisterRequest,
    ResetPasswordRequest,
    SessionResponse,
    UserResponse,
    VerifyEmailRequest,
)
from ..security import (
    ensure_aware,
    generate_token,
    hash_password,
    hash_token,
    is_expired,
    utcnow,
    verify_password,
)
from ..services.email import deliver

router = APIRouter(prefix="/api/auth", tags=["auth"])
limiter = get_rate_limiter()

PURPOSE_EMAIL_VERIFY = "email_verify"
PURPOSE_PASSWORD_RESET = "password_reset"


def _set_session_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key=settings.cookie_name,
        value=token,
        max_age=settings.session_ttl_seconds,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        domain=settings.cookie_domain,
        path="/",
    )


def _create_session(db: OrmSession, user: User, response: Response) -> str:
    settings = get_settings()
    token = generate_token()
    csrf = generate_token()
    db.add(
        SessionModel(
            user_id=user.id,
            token_hash=hash_token(token),
            csrf_hash=hash_token(csrf),
            expires_at=utcnow() + timedelta(seconds=settings.session_ttl_seconds),
        )
    )
    db.commit()
    _set_session_cookie(response, token)
    return csrf


def _issue_one_time_token(db: OrmSession, user: User, purpose: str) -> str:
    settings = get_settings()
    token = generate_token()
    db.add(
        OneTimeToken(
            user_id=user.id,
            purpose=purpose,
            token_hash=hash_token(token),
            expires_at=utcnow() + timedelta(seconds=settings.token_ttl_seconds),
        )
    )
    db.commit()
    return token


def _dev_token(token: str) -> str | None:
    settings = get_settings()
    return token if (settings.expose_dev_tokens and not settings.is_production) else None


@router.post("/register", response_model=SessionResponse, status_code=201)
def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    db: OrmSession = Depends(get_db),
) -> SessionResponse:
    limiter.check(f"register:{request.client.host if request.client else 'unknown'}")

    normalized = payload.email.strip().lower()
    existing = db.execute(select(User).where(User.email == normalized)).scalar_one_or_none()
    if existing is not None:
        # Do not confirm existence beyond the necessary registration conflict.
        raise ApiError("email_taken", "Bu email allaqachon ro'yxatdan o'tgan.", status_code=409)

    user = User(
        email=normalized,
        password_hash=hash_password(payload.password),
        role="user",
        is_email_verified=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # No subscription row is created here: the Free tier needs no payment, and
    # users with no active subscription automatically fall back to Free limits.

    csrf = _create_session(db, user, response)
    verify_token = _issue_one_time_token(db, user, PURPOSE_EMAIL_VERIFY)
    deliver(user.email, "Emailni tasdiqlash", f"Tasdiqlash tokeni: {verify_token}")

    return SessionResponse(
        user=UserResponse.model_validate(user),
        csrf_token=csrf,
        dev_verification_token=_dev_token(verify_token),
    )


@router.post("/login", response_model=SessionResponse)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: OrmSession = Depends(get_db),
) -> SessionResponse:
    limiter.check(f"login:{request.client.host if request.client else 'unknown'}")

    normalized = payload.email.strip().lower()
    user = db.execute(select(User).where(User.email == normalized)).scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        # Uniform error: no distinction between unknown email and bad password.
        raise ApiError("invalid_credentials", "Email yoki parol noto'g'ri.", status_code=401)

    csrf = _create_session(db, user, response)
    return SessionResponse(user=UserResponse.model_validate(user), csrf_token=csrf)


@router.post("/logout", response_model=MessageResponse)
def logout(
    request: Request,
    response: Response,
    _: None = Depends(require_csrf),
    user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> MessageResponse:
    session = getattr(request.state, "session_row", None)
    if session is not None:
        session.revoked_at = utcnow()
        db.commit()

    settings = get_settings()
    response.delete_cookie(settings.cookie_name, path="/")
    return MessageResponse(message="Chiqdingiz.")


@router.get("/me", response_model=UserResponse)
def me(user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse.model_validate(user)


@router.post("/verify-email", response_model=MessageResponse)
def verify_email(payload: VerifyEmailRequest, db: OrmSession = Depends(get_db)) -> MessageResponse:
    token_hash = hash_token(payload.token)
    row = db.execute(
        select(OneTimeToken).where(
            OneTimeToken.token_hash == token_hash,
            OneTimeToken.purpose == PURPOSE_EMAIL_VERIFY,
        )
    ).scalar_one_or_none()

    if row is None or row.used_at is not None or is_expired(row.expires_at):
        raise ApiError("invalid_token", "Token yaroqsiz yoki muddati tugagan.", status_code=400)

    user = db.get(User, row.user_id)
    if user is None:
        raise ApiError("invalid_token", "Token yaroqsiz.", status_code=400)

    user.is_email_verified = True
    row.used_at = utcnow()
    db.commit()
    return MessageResponse(message="Email tasdiqlandi.")


@router.post("/resend-verification", response_model=MessageResponse)
def resend_verification(
    _: None = Depends(require_csrf),
    user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> MessageResponse:
    if user.is_email_verified:
        return MessageResponse(message="Email allaqachon tasdiqlangan.")
    token = _issue_one_time_token(db, user, PURPOSE_EMAIL_VERIFY)
    deliver(user.email, "Emailni tasdiqlash", f"Tasdiqlash tokeni: {token}")
    return MessageResponse(message="Tasdiqlash xati yuborildi.", dev_token=_dev_token(token))


@router.post("/forgot-password", response_model=MessageResponse)
def forgot_password(
    payload: ForgotPasswordRequest,
    request: Request,
    db: OrmSession = Depends(get_db),
) -> MessageResponse:
    limiter.check(f"forgot:{request.client.host if request.client else 'unknown'}")

    normalized = payload.email.strip().lower()
    user = db.execute(select(User).where(User.email == normalized)).scalar_one_or_none()
    # Always return the same message to avoid disclosing account existence.
    dev_token = None
    if user is not None:
        token = _issue_one_time_token(db, user, PURPOSE_PASSWORD_RESET)
        deliver(user.email, "Parolni tiklash", f"Tiklash tokeni: {token}")
        dev_token = _dev_token(token)

    return MessageResponse(
        message="Agar email mavjud bo'lsa, tiklash ko'rsatmasi yuborildi.",
        dev_token=dev_token,
    )


@router.post("/reset-password", response_model=MessageResponse)
def reset_password(
    payload: ResetPasswordRequest,
    _: None = Depends(ip_rate_limit("reset")),
    db: OrmSession = Depends(get_db),
) -> MessageResponse:
    token_hash = hash_token(payload.token)
    row = db.execute(
        select(OneTimeToken).where(
            OneTimeToken.token_hash == token_hash,
            OneTimeToken.purpose == PURPOSE_PASSWORD_RESET,
        )
    ).scalar_one_or_none()

    if row is None or row.used_at is not None or is_expired(row.expires_at):
        raise ApiError("invalid_token", "Token yaroqsiz yoki muddati tugagan.", status_code=400)

    user = db.get(User, row.user_id)
    if user is None:
        raise ApiError("invalid_token", "Token yaroqsiz.", status_code=400)

    user.password_hash = hash_password(payload.password)
    row.used_at = utcnow()

    # Revoke all existing sessions for safety.
    sessions = (
        db.execute(select(SessionModel).where(SessionModel.user_id == user.id)).scalars().all()
    )
    for session in sessions:
        if session.revoked_at is None:
            session.revoked_at = ensure_aware(utcnow()) if session.revoked_at else utcnow()

    db.commit()
    return MessageResponse(message="Parol yangilandi. Qaytadan kiring.")
