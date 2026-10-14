"""Security primitives: password hashing, opaque session tokens, CSRF tokens.

Design notes
------------
* Passwords are hashed with bcrypt via passlib. Plaintext is never stored.
* Sessions use an opaque random token. Only a SHA-256 hash of the token is
  stored, so a database leak does not expose usable session tokens.
* A separate CSRF token is issued with the session; state-changing requests must
  echo it in the ``X-CSRF-Token`` header (double-submit pattern).
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import UTC, datetime

from passlib.context import CryptContext

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

SESSION_TOKEN_BYTES = 32
CSRF_TOKEN_BYTES = 32
API_TOKEN_BYTES = 32


def hash_password(password: str) -> str:
    # bcrypt truncates at 72 bytes; reject silently-truncated long passwords by
    # hashing the full input through a deterministic pre-hash is overkill here,
    # so we simply cap responsibility on the caller via validation (<= 72 bytes).
    return _pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _pwd_context.verify(password, password_hash)
    except ValueError:
        return False


def generate_token(nbytes: int = SESSION_TOKEN_BYTES) -> str:
    return secrets.token_urlsafe(nbytes)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def utcnow() -> datetime:
    return datetime.now(UTC)


def ensure_aware(value: datetime) -> datetime:
    """SQLite drops tzinfo; treat naive values as UTC for comparisons."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def is_expired(expires_at: datetime, now: datetime | None = None) -> bool:
    reference = now or utcnow()
    return ensure_aware(expires_at) <= reference
