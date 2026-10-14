"""Reusable request guards built on the rate limiter.

Two flavours:

* ``ip_rate_limit`` — for unauthenticated endpoints (login, register, webhook).
* ``user_rate_limit`` — for authenticated, resource-consuming endpoints; keyed on
  the user id so a shared IP cannot be used to bypass the limit, and so one user
  cannot exhaust another's budget.
"""
from __future__ import annotations

from collections.abc import Callable

from fastapi import Depends, Request

from .deps import get_current_user
from .models import User
from .rate_limit import get_rate_limiter


def _client_ip(request: Request) -> str:
    client = request.client
    return client.host if client else "unknown"


def ip_rate_limit(scope: str) -> Callable[[Request], None]:
    def dependency(request: Request) -> None:
        get_rate_limiter().check(f"{scope}:ip:{_client_ip(request)}")

    return dependency


def user_rate_limit(scope: str) -> Callable[..., None]:
    def dependency(request: Request, user: User = Depends(get_current_user)) -> None:
        get_rate_limiter().check(f"{scope}:user:{user.id}")

    return dependency
