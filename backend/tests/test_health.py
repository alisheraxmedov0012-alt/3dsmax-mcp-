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
