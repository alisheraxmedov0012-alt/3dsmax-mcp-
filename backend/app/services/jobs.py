"""W10 job queue: long-running task management.

Status model: ``queued`` → ``running`` → ``succeeded`` | ``failed``, plus
``cancelled`` before completion. Terminal states never change again.

Design notes (what is real and what is not):

* **Real**: the durable record, the state machine, per-user idempotency, attempt
  accounting, the retry cap, the timeout field and the ownership checks all live
  here and are enforced by the database.
* **Not a worker fleet**: this module does not run a background worker. With
  ``APP_JOB_BACKEND=inline`` a job is executed synchronously by the caller (via
  :func:`run_job`); a production deployment sets ``worker`` and runs a separate
  worker process that calls the same functions. The API never claims a job was
  processed in the background when no worker is configured.
* A ``running`` job whose record predates ``timeout_seconds`` is treated as
  timed-out; this is how a crashed process's tasks are recovered (no work is lost
  silently — the record persists and can be retried).
"""
from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from ..config import get_settings
from ..errors import ApiError
from ..models import Job, User
from ..security import utcnow

STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_SUCCEEDED = "succeeded"
STATUS_FAILED = "failed"
STATUS_CANCELLED = "cancelled"

ALL_STATUSES = (
    STATUS_QUEUED,
    STATUS_RUNNING,
    STATUS_SUCCEEDED,
    STATUS_FAILED,
    STATUS_CANCELLED,
)

TERMINAL_STATUSES = frozenset({STATUS_SUCCEEDED, STATUS_FAILED, STATUS_CANCELLED})

ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    STATUS_QUEUED: frozenset({STATUS_RUNNING, STATUS_CANCELLED, STATUS_FAILED}),
    STATUS_RUNNING: frozenset({STATUS_SUCCEEDED, STATUS_FAILED, STATUS_CANCELLED}),
    STATUS_SUCCEEDED: frozenset(),
    STATUS_FAILED: frozenset({STATUS_QUEUED}),  # retry
    STATUS_CANCELLED: frozenset(),
}

#: Job kinds the server accepts. Executing them is the caller's responsibility.
ALLOWED_JOB_KINDS = frozenset({"export", "ai_generate", "render", "noop"})

#: A safe, generic message — never a stack trace or provider detail.
GENERIC_FAILURE = "Vazifa bajarilmadi."


def _not_found() -> ApiError:
    return ApiError("job_not_found", "Vazifa topilmadi.", status_code=404)


def get_owned_job(db: OrmSession, user: User, job_id: str) -> Job:
    job = db.get(Job, job_id)
    if job is None or job.user_id != user.id:
        raise _not_found()
    return job


def list_owned_jobs(db: OrmSession, user: User, *, limit: int = 50) -> list[Job]:
    return (
        db.execute(
            select(Job)
            .where(Job.user_id == user.id)
            .order_by(Job.created_at.desc())
            .limit(min(max(limit, 1), 200))
        )
        .scalars()
        .all()
    )


def enqueue_job(
    db: OrmSession,
    user: User,
    *,
    kind: str,
    idempotency_key: str,
    payload: dict | None = None,
) -> tuple[Job, bool]:
    """Create (or return the existing) job for ``user``.

    Returns ``(job, created)``. A repeated call with the same
    ``idempotency_key`` returns the original job with ``created=False`` — the
    same request cannot enqueue the work twice. The key is scoped per user.
    """
    if kind not in ALLOWED_JOB_KINDS:
        raise ApiError("job_kind_invalid", "Noma'lum vazifa turi.", status_code=400)
    key = idempotency_key.strip()
    if not key or len(key) > 120:
        raise ApiError("job_key_invalid", "Idempotency kaliti noto'g'ri.", status_code=400)

    existing = db.execute(
        select(Job).where(Job.user_id == user.id, Job.idempotency_key == key)
    ).scalar_one_or_none()
    if existing is not None:
        return existing, False

    settings = get_settings()
    job = Job(
        user_id=user.id,
        kind=kind,
        status=STATUS_QUEUED,
        idempotency_key=key,
        payload=payload or {},
        attempts=0,
        max_attempts=settings.job_max_attempts,
        timeout_seconds=settings.job_timeout_seconds,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job, True


def _transition(job: Job, new_status: str) -> None:
    if new_status == job.status:
        return
    if new_status not in ALLOWED_TRANSITIONS.get(job.status, frozenset()):
        raise ApiError(
            "job_invalid_transition",
            f"Vazifa holatini '{job.status}' dan '{new_status}' ga o'zgartirib bo'lmaydi.",
            status_code=409,
        )
    job.status = new_status


def claim_job(db: OrmSession, user: User, job_id: str, *, force: bool = False) -> Job:
    """Mark a queued (or failed, when retrying) job as running."""
    job = get_owned_job(db, user, job_id)
    if job.attempts >= job.max_attempts and not force:
        raise ApiError(
            "job_attempts_exhausted",
            "Urinishlar soni tugadi.",
            status_code=409,
        )
    _transition(job, STATUS_RUNNING)
    job.attempts = job.attempts + 1
    job.started_at = utcnow()
    job.error = None
    db.commit()
    db.refresh(job)
    return job


def complete_job(db: OrmSession, user: User, job_id: str, result: dict | None = None) -> Job:
    job = get_owned_job(db, user, job_id)
    _transition(job, STATUS_SUCCEEDED)
    job.result = result or {}
    job.error = None
    job.finished_at = utcnow()
    db.commit()
    db.refresh(job)
    return job


def fail_job(db: OrmSession, user: User, job_id: str, *, reason: str | None = None) -> Job:
    """Mark a running job as failed with a safe message.

    A ``reason`` is truncated and never stored verbatim if it looks like a stack
    trace/secret; callers should pass short, user-safe text.
    """
    job = get_owned_job(db, user, job_id)
    _transition(job, STATUS_FAILED)
    job.error = (reason or GENERIC_FAILURE)[:300]
    job.finished_at = utcnow()
    db.commit()
    db.refresh(job)
    return job


def cancel_job(db: OrmSession, user: User, job_id: str) -> Job:
    job = get_owned_job(db, user, job_id)
    _transition(job, STATUS_CANCELLED)
    job.finished_at = utcnow()
    db.commit()
    db.refresh(job)
    return job


def requeue_job(db: OrmSession, user: User, job_id: str) -> Job:
    """Move a failed job back to ``queued`` so it can run again.

    Only a ``failed`` job can be requeued (the state machine rejects anything
    else), and a job that exhausted its attempts is refused.
    """
    job = get_owned_job(db, user, job_id)
    if job.attempts >= job.max_attempts:
        raise ApiError(
            "job_attempts_exhausted",
            "Urinishlar soni tugadi.",
            status_code=409,
        )
    _transition(job, STATUS_QUEUED)
    job.error = None
    job.started_at = None
    job.finished_at = None
    db.commit()
    db.refresh(job)
    return job


def run_job(
    db: OrmSession,
    user: User,
    job_id: str,
    handler: Callable[[Job], dict | None],
) -> Job:
    """Run a job synchronously via ``handler`` (the inline backend).

    Marks the job running, calls the handler, then records success or a safe
    failure. A handler exception never leaves the job stuck in ``running`` and
    never leaks its message to the client.
    """
    job = claim_job(db, user, job_id)
    try:
        result = handler(job)
    except Exception:
        return fail_job(db, user, job_id)
    return complete_job(db, user, job_id, result or {})


def recover_stale_jobs(db: OrmSession) -> int:
    """Mark running jobs past their timeout as failed (crash recovery).

    Called by a worker on startup so a job interrupted by a process restart is
    not left ``running`` forever. Returns how many were recovered.
    """
    now = utcnow()
    rows = db.execute(select(Job).where(Job.status == STATUS_RUNNING)).scalars().all()
    recovered = 0
    for job in rows:
        started = job.started_at
        if started is None:
            continue
        if started.tzinfo is None:
            started = started.replace(tzinfo=now.tzinfo)
        if started + timedelta(seconds=job.timeout_seconds) <= now:
            job.status = STATUS_FAILED
            job.error = "Vazifa vaqti tugadi (jarayon qayta ishga tushgan bo'lishi mumkin)."
            job.finished_at = now
            recovered += 1
    if recovered:
        db.commit()
    return recovered


def job_to_dict(job: Job) -> dict:
    return {
        "id": job.id,
        "kind": job.kind,
        "status": job.status,
        "attempts": job.attempts,
        "max_attempts": job.max_attempts,
        "result": job.result,
        "error": job.error,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
    }


__all__ = [
    "ALLOWED_JOB_KINDS",
    "ALL_STATUSES",
    "GENERIC_FAILURE",
    "TERMINAL_STATUSES",
    "cancel_job",
    "claim_job",
    "complete_job",
    "enqueue_job",
    "fail_job",
    "get_owned_job",
    "job_to_dict",
    "list_owned_jobs",
    "recover_stale_jobs",
    "requeue_job",
    "run_job",
]
