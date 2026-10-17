"""W11 rate limiting and resource-limit guards."""
from __future__ import annotations

from app.config import get_settings
from app.guards import client_ip
from app.rate_limit import scope_limit


class _FakeRequest:
    def __init__(self, host: str, headers: dict[str, str] | None = None):
        class _Client:
            def __init__(self, host: str):
                self.host = host

        self.client = _Client(host)
        self.headers = headers or {}


def test_scope_limit_uses_builtin_defaults_and_overrides():
    settings = get_settings()
    original = settings.rate_limit_scopes
    try:
        settings.rate_limit_scopes = ""
        # A built-in sensitive scope is tighter than the generic default.
        assert scope_limit("login") < scope_limit("projects")

        settings.rate_limit_scopes = "login=42"
        assert scope_limit("login") == 42
    finally:
        settings.rate_limit_scopes = original


def test_forwarded_for_is_ignored_without_trusted_proxy():
    settings = get_settings()
    original = settings.trust_forwarded_for
    try:
        settings.trust_forwarded_for = False
        request = _FakeRequest("10.0.0.1", {"X-Forwarded-For": "1.2.3.4"})
        # The spoofable header must not change the resolved IP.
        assert client_ip(request) == "10.0.0.1"
    finally:
        settings.trust_forwarded_for = original


def test_forwarded_for_used_only_when_trusted():
    settings = get_settings()
    original_trust = settings.trust_forwarded_for
    original_hops = settings.trusted_proxy_count
    try:
        settings.trust_forwarded_for = True
        settings.trusted_proxy_count = 1
        request = _FakeRequest(
            "10.0.0.1", {"X-Forwarded-For": "spoofed, 203.0.113.9"}
        )
        # One trusted hop from the right: the address the proxy appended.
        assert client_ip(request) == "203.0.113.9"
    finally:
        settings.trust_forwarded_for = original_trust
        settings.trusted_proxy_count = original_hops


def test_oversized_request_body_is_rejected_early(client):
    settings = get_settings()
    original = settings.max_request_bytes
    settings.max_request_bytes = 50
    try:
        response = client.post(
            "/api/auth/login",
            content=b"x" * 200,
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 413
        assert response.json()["error"]["code"] == "payload_too_large"
    finally:
        settings.max_request_bytes = original
