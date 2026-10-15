"""Reusable request guards built on the rate limiter.

Two flavours:

* ``ip_rate_limit`` — for unauthenticated endpoints (login, register, webhook).
* ``user_rate_limit`` — for authenticated, resource-consuming endpoints; keyed on
  the user id so a shared IP cannot be used to bypass the limit, and so one user
  cannot exhaust another's budget.

W11: each guard resolves a **per-scope** budget via ``scope_limit`` (a login is
far more sensitive than a project read) and the client IP is only taken from
``X-Forwarded-For`` when the operator has explicitly enabled a trusted reverse
proxy, so a client cannot spoof its address to dodge an IP limit.
"""
from __future__ import annotations

from collections.abc import Callable

from fastapi import Depends, Request

from .config import get_settings
from .deps import get_current_user
from .models import User
from .rate_limit import get_rate_limiter, scope_limit


def client_ip(request: Request) -> str:
    """Return the caller's IP, honouring ``X-Forwarded-For`` only when trusted.

    With no trusted proxy configured this is simply the socket peer address — the
    forwardable header is ignored, because any client can set it. When a trusted
    proxy is configured we take the ``trusted_proxy_count``-th address from the
    right, which is the last hop the trusted proxy appended (the leftmost values
    are attacker-controlled once a client prepends to the header).
    """
    settings = get_settings()
    peer = request.client.host if request.client else "unknown"

    if not settings.trust_forwarded_for:
        return peer

    forwarded = request.headers.get("X-Forwarded-For", "")
    parts = [part.strip() for part in forwarded.split(",") if part.strip()]
    if not parts:
        return peer

    hops = max(settings.trusted_proxy_count, 1)
    index = max(len(parts) - hops, 0)
    # A length-capped token only; never trust arbitrary header content verbatim.
    candidate = parts[index][:64]
    return candidate or peer


def ip_rate_limit(scope: str) -> Callable[[Request], None]:
    def dependency(request: Request) -> None:
        get_rate_limiter().check(
            f"{scope}:ip:{client_ip(request)}", max_events=scope_limit(scope)
        )

    return dependency


def user_rate_limit(scope: str) -> Callable[..., None]:
    def dependency(request: Request, user: User = Depends(get_current_user)) -> None:
        get_rate_limiter().check(f"{scope}:user:{user.id}", max_events=scope_limit(scope))

    return dependency


__all__ = ["client_ip", "ip_rate_limit", "user_rate_limit"]
