"""Minimal in-process rate limiter.

This is a per-process sliding-window counter suitable for local development and
tests. It is intentionally simple: for production it must be replaced by a
shared store (e.g. Redis) so limits apply across workers. That limitation is
documented in README.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import Request

from .config import get_settings
from .errors import ApiError


class SlidingWindowLimiter:
    def __init__(self, max_events: int, window_seconds: int):
        self.max_events = max_events
        self.window_seconds = window_seconds
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            bucket = self._events[key]
            while bucket and now - bucket[0] > self.window_seconds:
                bucket.popleft()
            if len(bucket) >= self.max_events:
                raise ApiError(
                    "rate_limited",
                    "Juda ko'p urinish. Keyinroq qayta urinib ko'ring.",
                    status_code=429,
                )
            bucket.append(now)

    def reset(self) -> None:
        with self._lock:
            self._events.clear()


def _client_key(request: Request) -> str:
    client = request.client
    return client.host if client else "unknown"


def install_rate_limiter() -> SlidingWindowLimiter:
    settings = get_settings()
    return SlidingWindowLimiter(settings.rate_limit_attempts, settings.rate_limit_window_seconds)
