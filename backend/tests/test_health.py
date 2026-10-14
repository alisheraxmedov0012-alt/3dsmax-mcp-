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
    from app.routers import auth

    auth.limiter.reset()
    monkeypatch.setattr(auth.limiter, "max_events", 3)

    statuses = []
    for _ in range(5):
        statuses.append(
            client.post(
                "/api/auth/login", json={"email": "x@example.com", "password": "Sup3rSecret!"}
            ).status_code
        )

    assert 429 in statuses
    auth.limiter.reset()
