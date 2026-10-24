"""Health, error shape and rate limiting."""
from __future__ import annotations


def test_health_reports_ok(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_unknown_route_returns_unified_error_shape(client):
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    body = response.json()
    assert set(body.keys()) == {"error"}
    assert "code" in body["error"] and "message" in body["error"]


def test_invalid_json_returns_unified_error(client):
    response = client.post(
        "/api/auth/login",
        content=b"{not-json",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_rate_limiter_blocks_repeated_login_attempts(client, monkeypatch):
    from app.config import get_settings
    from app.routers import auth

    settings = get_settings()
    original = settings.rate_limit_scopes
    # W11: the login guard now uses a per-scope budget; drive it through the
    # real override path instead of patching the limiter internals directly.
    settings.rate_limit_scopes = "login=3"
    auth.limiter.reset()

    try:
        statuses = []
        for _ in range(5):
            statuses.append(
                client.post(
                    "/api/auth/login", json={"email": "x@example.com", "password": "Sup3rSecret!"}
                ).status_code
            )

        assert 429 in statuses
    finally:
        settings.rate_limit_scopes = original
        auth.limiter.reset()


def test_rate_limited_response_includes_retry_after(client):
    from app.config import get_settings
    from app.routers import auth

    settings = get_settings()
    original = settings.rate_limit_scopes
    settings.rate_limit_scopes = "login=1"
    auth.limiter.reset()
    try:
        first = client.post(
            "/api/auth/login", json={"email": "x@example.com", "password": "Sup3rSecret!"}
        )
        assert first.status_code in (200, 401)
        blocked = client.post(
            "/api/auth/login", json={"email": "x@example.com", "password": "Sup3rSecret!"}
        )
        assert blocked.status_code == 429
        assert "Retry-After" in blocked.headers
        assert int(blocked.headers["Retry-After"]) >= 1
    finally:
        settings.rate_limit_scopes = original
        auth.limiter.reset()


# ---------------------------------------------------------------------------
# RD-1 — readiness must reflect the shared rate-limit store's real state
# ---------------------------------------------------------------------------


class _PingRedis:
    """Minimal stand-in for a Redis client: only ``ping``/``incr``/``expire``."""

    def __init__(self, reachable: bool = True, error: str | None = None):
        self.reachable = reachable
        self.error = error
        self.pings = 0

    def ping(self):
        self.pings += 1
        if not self.reachable:
            raise ConnectionError(self.error or "store down")
        return True

    def incr(self, key):
        return 1

    def expire(self, key, ttl):
        return True


def _use_limiter(monkeypatch, limiter):
    """Install a limiter instance into the cached adapter."""
    from app import rate_limit as rl

    monkeypatch.setattr(rl, "_ADAPTER", {"value": limiter})
    monkeypatch.setattr(rl, "get_rate_limiter", lambda: limiter)


def _redis_limiter(reachable: bool, error: str | None = None):
    from app.rate_limit import RedisRateLimiter

    client = _PingRedis(reachable=reachable, error=error)
    return RedisRateLimiter(client, max_events=10, window_seconds=60), client


def test_readiness_ready_when_shared_store_answers(client, monkeypatch):
    limiter, ping_client = _redis_limiter(reachable=True)
    _use_limiter(monkeypatch, limiter)

    response = client.get("/api/health/ready")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["checks"]["rate_limit_store"] is True
    assert body["rate_limit_store"] == "ok"
    assert body["rate_limit_backend"] == "redis-shared"
    assert ping_client.pings == 1


def test_readiness_not_ready_when_shared_store_is_down(client, monkeypatch):
    limiter, _ = _redis_limiter(reachable=False)
    _use_limiter(monkeypatch, limiter)

    response = client.get("/api/health/ready")

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "not_ready"
    assert body["checks"]["rate_limit_store"] is False
    assert body["rate_limit_store"] == "unavailable"


def test_readiness_reports_not_required_for_the_memory_backend(client, monkeypatch):
    from app.rate_limit import MemoryRateLimiter

    _use_limiter(monkeypatch, MemoryRateLimiter(max_events=10, window_seconds=60))

    response = client.get("/api/health/ready")

    # Nothing to reach, so a local/test environment stays ready.
    assert response.status_code == 200
    body = response.json()
    assert body["checks"]["rate_limit_store"] is True
    assert body["rate_limit_store"] == "not_required"


def test_readiness_reports_unconfigured_backend(client, monkeypatch):
    from app import rate_limit as rl

    def _raise():
        raise RuntimeError("APP_RATE_LIMIT_BACKEND=redis uchun APP_REDIS_URL kerak.")

    monkeypatch.setattr(rl, "get_rate_limiter", _raise)

    response = client.get("/api/health/ready")

    body = response.json()
    assert body["rate_limit_store"] == "unconfigured"
    assert body["rate_limit_backend"] == "unconfigured"


def test_readiness_probe_does_not_leak_secrets(client, monkeypatch):
    """A driver error message must never reach the response body."""
    limiter, _ = _redis_limiter(
        reachable=False,
        error="Error connecting to redis://:super-secret-password@cache.internal:6379/0",
    )
    _use_limiter(monkeypatch, limiter)

    response = client.get("/api/health/ready")

    assert response.status_code == 503
    text = response.text.lower()
    for leak in ("super-secret-password", "cache.internal", "6379", "redis://"):
        assert leak not in text


def test_liveness_is_unaffected_by_a_dead_store(client, monkeypatch):
    limiter, _ = _redis_limiter(reachable=False)
    _use_limiter(monkeypatch, limiter)

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_shared_store_state_distinguishes_states(monkeypatch):
    from app.rate_limit import (
        MemoryRateLimiter,
        RateLimitStoreState,
        RedisRateLimiter,
        shared_store_state,
    )

    _use_limiter(monkeypatch, RedisRateLimiter(_PingRedis(True), 10, 60))
    assert shared_store_state() is RateLimitStoreState.OK

    _use_limiter(monkeypatch, RedisRateLimiter(_PingRedis(False), 10, 60))
    assert shared_store_state() is RateLimitStoreState.UNAVAILABLE

    _use_limiter(monkeypatch, MemoryRateLimiter(10, 60))
    assert shared_store_state() is RateLimitStoreState.NOT_REQUIRED
