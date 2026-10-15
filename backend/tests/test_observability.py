"""W11 observability: metrics, correlation id, readiness and diagnostics."""
from __future__ import annotations

from app.metrics import reset as reset_metrics
from tests.conftest import auth_headers, create_admin_user, register


def test_metrics_endpoint_reports_process_local_honestly(client):
    reset_metrics()
    client.get("/api/health")
    body = client.get("/api/health/metrics").json()
    assert body["process_local"] is True
    assert body["monitoring_provider"] == "none"
    # A request counter was recorded with method/status labels.
    counters = {(c["name"], c["labels"].get("method")) for c in body["counters"]}
    assert ("http_requests_total", "GET") in counters


def test_request_id_is_echoed_and_sanitized(client):
    ok = client.get("/api/health", headers={"X-Request-ID": "abc-123"})
    assert ok.headers["X-Request-ID"] == "abc-123"

    # A hostile/oversized inbound id is replaced, not echoed verbatim.
    bad = client.get("/api/health", headers={"X-Request-ID": "bad id with spaces"})
    assert bad.headers["X-Request-ID"] != "bad id with spaces"


def test_readiness_reports_database_storage_and_worker(client):
    body = client.get("/api/health/ready").json()
    assert body["checks"]["database"] is True
    # In the test environment storage is in-memory (non-production) and the
    # inline backend means no separate worker is required.
    assert body["checks"]["storage"] is True
    assert body["checks"]["worker"] is True
    assert body["status"] == "ready"


def test_diagnostics_requires_admin(client):
    register(client, "plain@example.com")
    headers = auth_headers(client, "plain@example.com")
    assert client.get("/api/admin/diagnostics", headers=headers).status_code == 403


def test_diagnostics_reports_checks_without_secrets(client):
    create_admin_user("admin-diag@example.com")
    from tests.conftest import login

    session = login(client, "admin-diag@example.com", "AdminSecret123!").json()
    headers = {"X-CSRF-Token": session["csrf_token"]}
    body = client.get("/api/admin/diagnostics", headers=headers).json()
    assert isinstance(body["checks"], list)
    keys = {check["key"] for check in body["checks"]}
    assert {"auth", "database", "storage", "worker", "payments", "secrets"} <= keys
    # No secret value is ever included in the payload.
    serialized = str(body).lower()
    assert "test-secret" not in serialized
    assert "test-webhook-secret" not in serialized


def test_health_metrics_labels_do_not_include_paths(client):
    reset_metrics()
    client.get("/api/health/ready")
    body = client.get("/api/health/metrics").json()
    for counter in body["counters"]:
        assert "path" not in counter["labels"]
