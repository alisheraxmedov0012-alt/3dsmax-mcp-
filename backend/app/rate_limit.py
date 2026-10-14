"""Rate limiting with an optional shared (Redis) store.

Two backends:

* ``memory`` — per-process sliding window. Correct for a single worker only;
  this limitation is reported by :func:`describe_backend`.
* ``redis`` — shared fixed-window counter, so the limit holds across all
  workers/instances.

Failure behaviour: if the Redis store is unreachable, the limiter **fails
closed** (refuses the request) rather than silently allowing unlimited attempts.
This is deliberate and documented.
"""
from __future__ import annotations

import logging
import time
from collections import defaultdict, deque
from threading import Lock

from .config import get_settings
from .errors import ApiError

logger = logging.getLogger("app.rate_limit")


class RateLimiter:
    def check(self, key: str) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    def reset(self) -> None:  # pragma: no cover - interface
        raise NotImplementedError


class MemoryRateLimiter(RateLimiter):
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


class RedisRateLimiter(RateLimiter):
    def __init__(self, client, max_events: int, window_seconds: int):
        self.client = client
        self.max_events = max_events
        self.window_seconds = window_seconds

    def check(self, key: str) -> None:
        bucket = int(time.time() // self.window_seconds)
        redis_key = f"rl:{key}:{bucket}"
        try:
            count = int(self.client.incr(redis_key))
            if count == 1:
                self.client.expire(redis_key, self.window_seconds + 1)
        except Exception as exc:  # store unavailable
            logger.error("Rate limit store unavailable: %s", type(exc).__name__)
            # Fail closed: refuse rather than allow unlimited attempts.
            raise ApiError(
                "rate_limit_unavailable",
                "Xizmat vaqtincha mavjud emas. Keyinroq qayta urinib ko'ring.",
                status_code=503,
            ) from exc

        if count > self.max_events:
            raise ApiError(
                "rate_limited",
                "Juda ko'p urinish. Keyinroq qayta urinib ko'ring.",
                status_code=429,
            )

    def reset(self) -> None:  # pragma: no cover - not used in tests
        try:
            for key in self.client.scan_iter("rl:*"):
                self.client.delete(key)
        except Exception:  # pragma: no cover - defensive
            pass


_ADAPTER: dict[str, RateLimiter | None] = {"value": None}


def _build() -> RateLimiter:
    settings = get_settings()
    attempts = settings.rate_limit_attempts
    window = settings.rate_limit_window_seconds

    if settings.rate_limit_backend == "redis":
        if not settings.redis_url:
            raise RuntimeError("APP_RATE_LIMIT_BACKEND=redis uchun APP_REDIS_URL kerak.")
        import redis  # imported lazily so 'memory' needs no redis client

        client = redis.Redis.from_url(
            settings.redis_url, socket_timeout=1, socket_connect_timeout=1
        )
        logger.info("Rate limiting Redis store bilan ishlaydi.")
        return RedisRateLimiter(client, attempts, window)

    logger.warning(
        "Rate limiting jarayon ichida (memory) ishlaydi: ko'p worker uchun global emas."
    )
    return MemoryRateLimiter(attempts, window)


def get_rate_limiter() -> RateLimiter:
    if _ADAPTER["value"] is None:
        _ADAPTER["value"] = _build()
    return _ADAPTER["value"]


def reset_rate_limiter_cache() -> None:
    """Test helper: drop the cached adapter so settings changes take effect."""
    _ADAPTER["value"] = None


def describe_backend() -> str:
    """Human-readable description used by readiness/health output."""
    try:
        limiter = get_rate_limiter()
    except Exception:
        return "unconfigured"
    if isinstance(limiter, RedisRateLimiter):
        return "redis-shared"
    return "memory-process-local"
