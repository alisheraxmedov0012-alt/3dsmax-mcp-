"""W11 job reliability: retry classification, stale recovery, worker, limits."""
from __future__ import annotations

from datetime import timedelta

from app.config import get_settings
from app.database import SessionLocal
from app.models import Job, User
from app.security import utcnow
from app.services import heartbeat as heartbeat_service
from app.services import jobs as jobs_service
from tests.conftest import auth_headers, register
from tests.test_projects_server import _headers


def _enqueue(client, email="job@example.com", kind="noop", key="k1", payload=None):
    headers = _headers(client, email)
    return client.post(
        "/api/jobs",
        headers=headers,
        json={"kind": kind, "idempotency_key": key, "payload": payload or {}},
    )


def _worker_mode():
    """Context-free helper: force worker backend and return the previous value."""
    settings = get_settings()
    original = settings.job_backend
    settings.job_backend = "worker"
    return original


def test_transient_failure_is_marked_retryable():
    class Transient(Exception):
        pass

    # Only JobError carries a classification; anything else is permanent.
    assert jobs_service.classify_failure(Transient("boom")) == (False, jobs_service.GENERIC_FAILURE)
    assert jobs_service.classify_failure(
        jobs_service.JobError("timeout", retryable=True)
    ) == (True, "timeout")
    assert jobs_service.classify_failure(
        jobs_service.JobError("bad payload", retryable=False)
    ) == (False, "bad payload")


def test_transient_failure_records_retryable_true_in_inline_mode(client):
    register(client, "transient@example.com")

    def handler(_job):
        raise jobs_service.JobError("vaqtincha xato", retryable=True)

    with SessionLocal() as db:
        from sqlalchemy import select

        user = db.execute(select(User).where(User.email == "transient@example.com")).scalar_one()
        job, _ = jobs_service.enqueue_job(
            db, user, kind="noop", idempotency_key="transient-1"
        )
        result = jobs_service.run_job(db, user, job.id, handler)
        assert result.status == jobs_service.STATUS_FAILED
        assert result.retryable is True


def test_stale_recovery_marks_retryable(client):
    with SessionLocal() as db:
        user = User(
            email="stale2@example.com", password_hash="x", role="user", is_email_verified=True
        )
        db.add(user)
        db.commit()
        stale = Job(
            user_id=user.id,
            kind="ai_generate",
            status=jobs_service.STATUS_RUNNING,
            idempotency_key="stale-2",
            payload={},
            attempts=1,
            max_attempts=3,
            timeout_seconds=10,
            started_at=utcnow() - timedelta(seconds=60),
        )
        db.add(stale)
        db.commit()
        recovered = jobs_service.recover_stale_jobs(db)
        assert recovered == 1
        db.refresh(stale)
        assert stale.status == jobs_service.STATUS_FAILED
        assert stale.retryable is True


def test_parallel_job_budget_blocks_extra_starts(client):
    register(client, "parallel-jobs@example.com")
    settings = get_settings()
    original = settings.job_backend
    settings.job_backend = "worker"  # keep jobs queued so they stay running
    try:
        with SessionLocal() as db:
            from sqlalchemy import select

            user = db.execute(
                select(User).where(User.email == "parallel-jobs@example.com")
            ).scalar_one()
            job, _ = jobs_service.enqueue_job(db, user, kind="noop", idempotency_key="p1")
            jobs_service.claim_job(db, user, job.id)  # now running

            original_parallel = settings.job_max_parallel_per_user
            settings.job_max_parallel_per_user = 1
            try:
                import pytest

                from app.errors import ApiError

                with pytest.raises(ApiError) as excinfo:
                    jobs_service.assert_parallel_capacity(db, user)
                assert excinfo.value.code == "too_many_parallel_jobs"
                assert excinfo.value.status_code == 429
            finally:
                settings.job_max_parallel_per_user = original_parallel
    finally:
        settings.job_backend = original


def test_worker_processes_noop_and_fails_others_honestly(client):
    register(client, "worker@example.com")
    original = _worker_mode()
    try:
        _enqueue(client, "worker@example.com", kind="noop", key="w-noop")
        _enqueue(client, "worker@example.com", kind="ai_generate", key="w-ai")

        import app.worker as worker

        with SessionLocal() as db:
            processed = worker.run_once(db)
            assert processed == 2

        headers = auth_headers(client, "worker@example.com")
        jobs = {job["kind"]: job for job in client.get("/api/jobs", headers=headers).json()}
        assert jobs["noop"]["status"] == "succeeded"
        assert jobs["ai_generate"]["status"] == "failed"
        # The AI kind is a permanent failure (no provider), not a retry loop.
        assert jobs["ai_generate"]["retryable"] is False
    finally:
        get_settings().job_backend = original


def test_worker_heartbeat_and_status():
    with SessionLocal() as db:
        heartbeat_service.write_heartbeat(db, "test-worker", meta={"kind": "unit"})
        latest = heartbeat_service.latest_heartbeat(db)
        assert latest is not None and latest.worker_id == "test-worker"

        settings = get_settings()
        original = settings.job_backend
        settings.job_backend = "worker"
        try:
            status = heartbeat_service.worker_status(db)
            assert status["required"] is True
            assert status["running"] is True
        finally:
            settings.job_backend = original


def test_worker_required_but_missing_is_not_ready():
    with SessionLocal() as db:
        from sqlalchemy import delete

        from app.models import WorkerHeartbeat

        db.execute(delete(WorkerHeartbeat))
        db.commit()
        settings = get_settings()
        original = settings.job_backend
        settings.job_backend = "worker"
        try:
            status = heartbeat_service.worker_status(db)
            assert status["required"] is True
            assert status["running"] is False
        finally:
            settings.job_backend = original


def test_job_limit_is_enforced_when_configured(client):
    from sqlalchemy import select

    from app.models import Plan

    register(client, "job-limit@example.com")
    with SessionLocal() as db:
        plan = db.execute(select(Plan).where(Plan.key == "free")).scalar_one()
        limits = dict(plan.limits or {})
        limits["max_ai_requests"] = 0
        plan.limits = limits
        db.commit()
    response = _enqueue(client, "job-limit@example.com", kind="ai_generate", key="blocked-1")
    assert response.status_code == 402
    assert response.json()["error"]["code"] == "limit_reached"
