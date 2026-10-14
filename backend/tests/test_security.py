"""Security regression tests (Stage 8 audit).

Grouped by the audit areas: error handling, headers, request ids, logging
redaction, rate-limit backends, production config validation and secret hygiene.
"""
from __future__ import annotations

import pytest

from app.config import Settings
from app.errors import ApiError
from app.logging_config import redact
from app.rate_limit import MemoryRateLimiter, RedisRateLimiter, reset_rate_limiter_cache

# --- safe error responses -------------------------------------------------


def test_unknown_error_shape_is_generic(client):
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "not_found"
    # No internal detail leaked.
    assert "detail" not in body["error"]


def test_unhandled_exception_returns_generic_500():
    """The catch-all handler must return a generic 500 without internals."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.errors import install_error_handlers

    probe = FastAPI()
    install_error_handlers(probe)

    @probe.get("/boom")
    def boom() -> dict:  # pragma: no cover - always raises
        raise RuntimeError("secret internal detail: db password=abc123")

    with TestClient(probe, raise_server_exceptions=False) as test_client:
        response = test_client.get("/boom")

    assert response.status_code == 500
    body = response.json()
    assert body["error"]["code"] == "internal_error"
    # The internal message must NOT be echoed to the client.
    assert "abc123" not in response.text
    assert "password" not in response.text.lower()


def test_validation_errors_do_not_echo_internals(client):
    response = client.post(
        "/api/auth/register", json={"email": "not-an-email", "password": "x"}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    # Only the generic message is returned.
    assert "not-an-email" not in response.text


# --- security headers & request id ---------------------------------------


def test_security_headers_present(client):
    response = client.get("/api/health")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert "X-Request-ID" in response.headers


def test_request_id_is_echoed_when_valid(client):
    response = client.get("/api/health", headers={"X-Request-ID": "trace-abc-123"})
    assert response.headers["X-Request-ID"] == "trace-abc-123"


def test_request_id_replaced_when_invalid(client):
    response = client.get("/api/health", headers={"X-Request-ID": "bad id !!!"})
    echoed = response.headers["X-Request-ID"]
    assert echoed != "bad id !!!"
    assert len(echoed) == 32


# --- readiness ------------------------------------------------------------


def test_readiness_reports_non_sensitive_facts(client):
    response = client.get("/api/health/ready")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["checks"]["database"] is True
    # Never expose a DSN or credentials.
    assert "sqlite" in body["database_backend"] or "postgres" in body["database_backend"]
    assert "database_url" not in body
    assert "@" not in response.text


# --- log redaction --------------------------------------------------------


def test_redact_removes_common_secret_patterns():
    samples = [
        "password=hunter2",
        "secret: abcdef",
        '"token": "eyJhbGciOi"',
        "Authorization: Bearer abc.def.ghi",
        "csrf_token=xyz",
    ]
    for sample in samples:
        redacted = redact(sample)
        assert "hunter2" not in redacted
        assert "abcdef" not in redacted
        assert "eyJhbGciOi" not in redacted
        assert "abc.def.ghi" not in redacted
        assert "xyz" not in redacted


def test_redact_keeps_normal_text():
    assert redact("user logged in") == "user logged in"


# --- production configuration validation ---------------------------------


def _prod_settings(**overrides) -> Settings:
    base = dict(
        environment="production",
        secret_key="x" * 40,
        cookie_secure=True,
        expose_dev_tokens=False,
        debug=False,
        cors_origins="https://app.example.com",
        database_url="postgresql+psycopg://u:p@h:5432/db",
    )
    base.update(overrides)
    return Settings(**base)


def test_secure_production_config_has_no_problems():
    assert _prod_settings().production_problems() == []


def test_default_secret_blocks_production():
    problems = _prod_settings(secret_key="dev-insecure-change-me").production_problems()
    assert any("SECRET_KEY" in p for p in problems)


def test_insecure_cookie_blocks_production():
    problems = _prod_settings(cookie_secure=False).production_problems()
    assert any("COOKIE_SECURE" in p for p in problems)


def test_dev_tokens_exposed_blocks_production():
    problems = _prod_settings(expose_dev_tokens=True).production_problems()
    assert any("EXPOSE_DEV_TOKENS" in p for p in problems)


def test_wildcard_cors_blocks_production():
    problems = _prod_settings(cors_origins="*").production_problems()
    assert any("CORS" in p for p in problems)


def test_sqlite_blocks_production():
    problems = _prod_settings(database_url="sqlite:///./x.db").production_problems()
    assert any("SQLite" in p for p in problems)


def test_development_config_never_blocks():
    assert Settings(environment="development").production_problems() == []


# --- rate limiting backends ----------------------------------------------


def test_memory_limiter_enforces_limit():
    limiter = MemoryRateLimiter(max_events=2, window_seconds=60)
    limiter.check("k")
    limiter.check("k")
    with pytest.raises(ApiError) as excinfo:
        limiter.check("k")
    assert excinfo.value.status_code == 429


def test_memory_limiter_is_per_key():
    limiter = MemoryRateLimiter(max_events=1, window_seconds=60)
    limiter.check("a")
    limiter.check("b")  # different key — allowed


class _BrokenRedis:
    def incr(self, key):
        raise ConnectionError("store down")

    def expire(self, key, ttl):
        return True


class _FakeRedis:
    def __init__(self):
        self.values: dict[str, int] = {}

    def incr(self, key):
        self.values[key] = self.values.get(key, 0) + 1
        return self.values[key]

    def expire(self, key, ttl):
        return True


def test_redis_limiter_enforces_shared_limit():
    limiter = RedisRateLimiter(_FakeRedis(), max_events=2, window_seconds=60)
    limiter.check("k")
    limiter.check("k")
    with pytest.raises(ApiError) as excinfo:
        limiter.check("k")
    assert excinfo.value.status_code == 429


def test_redis_limiter_fails_closed_when_store_down():
    limiter = RedisRateLimiter(_BrokenRedis(), max_events=5, window_seconds=60)
    with pytest.raises(ApiError) as excinfo:
        limiter.check("k")
    # Fail closed (503), not fail open.
    assert excinfo.value.status_code == 503


def test_rate_limit_backend_falls_back_to_memory():
    import os

    os.environ["APP_RATE_LIMIT_BACKEND"] = "memory"
    reset_rate_limiter_cache()
    from app.config import get_settings

    get_settings.cache_clear()
    from app.rate_limit import get_rate_limiter

    assert isinstance(get_rate_limiter(), MemoryRateLimiter)
    reset_rate_limiter_cache()
    get_settings.cache_clear()


# --- webhook signature / idempotency regressions -------------------------


def test_webhook_signature_required(client):
    response = client.post(
        "/api/billing/webhook/fake-sandbox",
        content=b'{"ref":"x","status":"succeeded"}',
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_signature"
