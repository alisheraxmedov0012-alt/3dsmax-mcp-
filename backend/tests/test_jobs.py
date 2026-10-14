"""W10 job queue: lifecycle, idempotency, retry, timeout and ownership."""
from __future__ import annotations

from datetime import timedelta

from tests.conftest import register
from tests.test_projects_server import _headers


def _enqueue(client, email="job@example.com", kind="noop", key="k1", payload=None):
    headers = _headers(client, email)
    return client.post(
        "/api/jobs",
        headers=headers,
        json={"kind": kind, "idempotency_key": key, "payload": payload or {}},
    )


def test_noop_job_runs_inline_and_succeeds(client):
    response = _enqueue(client, key="run-1")
    assert response.status_code == 202, response.text
    body = response.json()
    assert body["kind"] == "noop"
    # The inline backend executed it immediately.
    assert body["status"] == "succeeded"
    assert body["attempts"] == 1
    assert body["result"] == {"ok": True}
    assert body["finished_at"] is not None


def test_idempotency_key_returns_the_same_job(client):
    first = _enqueue(client, key="dup-key").json()
    second = _enqueue(client, key="dup-key").json()
    assert first["id"] == second["id"]
    # The repeat did not create a second job.
    headers = _headers(client, "job@example.com")
    listing = client.get("/api/jobs", headers=headers).json()
    assert len([job for job in listing if job["id"] == first["id"]]) == 1


def test_unknown_kind_is_rejected(client):
    response = _enqueue(client, kind="delete-everything", key="bad-kind")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "job_kind_invalid"


def test_unknown_kind_fails_with_a_safe_message_in_inline_mode(client):
    # A known kind the inline runner cannot execute must fail with a generic
    # message, never a stack trace.
    response = _enqueue(client, kind="ai_generate", key="ai-1")
    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "failed"
    assert body["error"] == "Vazifa bajarilmadi."
    assert "Traceback" not in (body["error"] or "")


def test_retry_after_failure(client):
    failed = _enqueue(client, kind="ai_generate", key="retry-1").json()
    assert failed["status"] == "failed"

    headers = _headers(client, "job@example.com")
    retried = client.post(f"/api/jobs/{failed['id']}/retry", headers=headers)
    assert retried.status_code == 200
    # It failed again (still no worker) but the attempt counter advanced.
    assert retried.json()["status"] == "failed"
    assert retried.json()["attempts"] == 2


def test_cancel_a_queued_job(client):
    # Enqueue without running: force the worker backend so the inline runner does
    # not execute it, then cancel it.
    from app.config import get_settings

    settings = get_settings()
    original = settings.job_backend
    settings.job_backend = "worker"
    try:
        queued = _enqueue(client, key="cancel-1").json()
        assert queued["status"] == "queued"

        headers = _headers(client, "job@example.com")
        cancelled = client.post(f"/api/jobs/{queued['id']}/cancel", headers=headers)
        assert cancelled.status_code == 200
        assert cancelled.json()["status"] == "cancelled"
    finally:
        settings.job_backend = original


def test_other_users_job_is_not_found(client):
    created = _enqueue(client, "a@example.com", key="idor-1").json()
    headers_b = _headers(client, "b@example.com")
    assert client.get(f"/api/jobs/{created['id']}", headers=headers_b).status_code == 404
    assert client.post(f"/api/jobs/{created['id']}/cancel", headers=headers_b).status_code == 404


def test_jobs_require_auth_and_csrf(client):
    # No session at all -> unauthenticated.
    assert client.post(
        "/api/jobs", json={"kind": "noop", "idempotency_key": "x"}
    ).status_code == 401

    # Authenticated (register logs the user in) but without a CSRF token -> 403.
    register(client, "job@example.com")
    assert (
        client.post("/api/jobs", json={"kind": "noop", "idempotency_key": "x"}).status_code
        == 403
    )


def test_stale_running_job_is_recovered(client, db_session):
    from app.models import Job, User
    from app.security import utcnow
    from app.services import jobs as jobs_service

    user = User(email="stale@example.com", password_hash="x", role="user", is_email_verified=True)
    db_session.add(user)
    db_session.commit()

    stale = Job(
        user_id=user.id,
        kind="ai_generate",
        status=jobs_service.STATUS_RUNNING,
        idempotency_key="stale-1",
        payload={},
        attempts=1,
        max_attempts=3,
        timeout_seconds=10,
        started_at=utcnow() - timedelta(seconds=60),
    )
    db_session.add(stale)
    db_session.commit()

    recovered = jobs_service.recover_stale_jobs(db_session)
    assert recovered == 1
    db_session.refresh(stale)
    assert stale.status == jobs_service.STATUS_FAILED
