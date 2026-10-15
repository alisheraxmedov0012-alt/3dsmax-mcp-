"""Rate limiting with an optional shared (Redis) store.

Two backends:

* ``memory`` — per-process sliding window. Correct for a single worker only;
  this limitation is reported by :func:`describe_backend`.
* ``redis`` — shared fixed-window counter, so the limit holds across all
  workers/instances.

Failure behaviour: if the Redis store is unreachable, the limiter **fails
closed** (refuses the request) rather than silently allowing unlimited attempts.
This is deliberate and documented.

W11 additions:

* **Per-scope limits.** Different endpoints need different budgets (a login
  attempt is far more sensitive than a project list). ``scope_limit`` resolves a
  limit for a named scope, defaulting to the global ``rate_limit_attempts`` but
  allowing tighter built-in defaults and ``APP_RATE_LIMIT_SCOPES`` overrides.
* **Retry-After.** Every 429/503 carries a ``Retry-After`` header so a client can
  back off correctly instead of hammering the endpoint.
* **Multi-process.** The memory backend is per-process; the limitation is
  reported by :func:`describe_backend` and in diagnostics.
"""
from __future__ import annotations

import logging
import time
from collections import defaultdict, deque
from threading import Lock

from .config import get_settings
from .errors import ApiError

logger = logging.getLogger("app.rate_limit")

# Tighter-than-default budgets for sensitive/expensive scopes. A scope missing
# here falls back to ``rate_limit_attempts``. These are conservative defaults,
# not business decisions: they bound abuse, they do not sell a plan.
DEFAULT_SCOPE_LIMITS: dict[str, int] = {
    "login": 10,
    "register": 5,
    "forgot": 5,
    "reset": 5,
    "webhook": 60,
}


def _window_seconds() -> int:
    return max(get_settings().rate_limit_window_seconds, 1)


def scope_limit(scope: str) -> int:
    """Resolve the max events allowed for ``scope`` within one window."""
    settings = get_settings()
    overrides = _parse_scope_overrides(settings.rate_limit_scopes)
    if scope in overrides:
        return overrides[scope]
    if scope in DEFAULT_SCOPE_LIMITS:
        return DEFAULT_SCOPE_LIMITS[scope]
    return max(settings.rate_limit_attempts, 1)


def _parse_scope_overrides(raw: str) -> dict[str, int]:
    overrides: dict[str, int] = {}
    for chunk in (raw or "").split(","):
        part = chunk.strip()
        if not part or "=" not in part:
            continue
        name, _, value = part.partition("=")
        name = name.strip()
        value = value.strip()
        if name and value.isdigit() and int(value) > 0:
            overrides[name] = int(value)
    return overrides


class RateLimiter:
    def check(self, key: str, *, max_events: int | None = None) -> None:  # pragma: no cover
        raise NotImplementedError

    def reset(self) -> None:  # pragma: no cover - interface
        raise NotImplementedError


class MemoryRateLimiter(RateLimiter):
    def __init__(self, max_events: int, window_seconds: int):
        self.max_events = max_events
        self.window_seconds = window_seconds
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def check(self, key: str, *, max_events: int | None = None) -> None:
        limit = max_events if max_events is not None else self.max_events
        now = time.monotonic()
        window = self.window_seconds
        with self._lock:
            bucket = self._events[key]
            while bucket and now - bucket[0] > window:
                bucket.popleft()
            if len(bucket) >= limit:
                raise ApiError(
                    "rate_limited",
                    "Juda ko'p urinish. Keyinroq qayta urinib ko'ring.",
                    status_code=429,
                    headers={"Retry-After": str(window)},
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

    def check(self, key: str, *, max_events: int | None = None) -> None:
        limit = max_events if max_events is not None else self.max_events
        window = self.window_seconds
        bucket = int(time.time() // window)
        redis_key = f"rl:{key}:{bucket}"
        try:
            count = int(self.client.incr(redis_key))
            if count == 1:
                self.client.expire(redis_key, window + 1)
        except Exception as exc:  # store unavailable
            logger.error("Rate limit store unavailable: %s", type(exc).__name__)
            # Fail closed: refuse rather than allow unlimited attempts.
            raise ApiError(
                "rate_limit_unavailable",
                "Xizmat vaqtincha mavjud emas. Keyinroq qayta urinib ko'ring.",
                status_code=503,
                headers={"Retry-After": str(window)},
            ) from exc

        if count > limit:
            raise ApiError(
                "rate_limited",
                "Juda ko'p urinish. Keyinroq qayta urinib ko'ring.",
                status_code=429,
                headers={"Retry-After": str(window)},
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
