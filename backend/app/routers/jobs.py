"""W10 job endpoints: enqueue, poll, cancel, retry.

Long-running work is represented as a durable ``Job`` record. The API only
*groups* the request; execution happens either inline (``APP_JOB_BACKEND=inline``,
development/test) or in a separate worker process that calls the same service
functions (``APP_JOB_BACKEND=worker``, production).

In inline mode the built-in runner understands ``noop`` only. Any other kind is
failed with an explicit message that a worker is required — the API never
pretends background AI/render work ran when no worker exists.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as OrmSession

from ..config import get_settings
from ..database import get_db
from ..deps import get_current_user, require_csrf
from ..guards import user_rate_limit
from ..models import User
from ..schemas import JobCreateRequest, JobResponse
from ..services import jobs as jobs_service

router = APIRouter(prefix="/api", tags=["jobs"])


def _inline_handler(job: jobs_service.Job) -> dict | None:
    """The only job kind the inline backend can actually execute."""
    if job.kind == "noop":
        return {"ok": True}
    raise RuntimeError("worker_required")


@router.post("/jobs", response_model=JobResponse, status_code=202)
def create_job(
    payload: JobCreateRequest,
    _: None = Depends(require_csrf),
    __: None = Depends(user_rate_limit("jobs")),
    user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> JobResponse:
    job, _created = jobs_service.enqueue_job(
        db,
        user,
        kind=payload.kind,
        idempotency_key=payload.idempotency_key,
        payload=payload.payload,
    )
    # The inline backend executes immediately so a queued job is not left
    # pending forever in a single-process deployment.
    if job.status == jobs_service.STATUS_QUEUED and get_settings().job_backend == "inline":
        job = jobs_service.run_job(db, user, job.id, _inline_handler)
    return JobResponse(**jobs_service.job_to_dict(job))


@router.get("/jobs", response_model=list[JobResponse])
def list_jobs(
    user: User = Depends(get_current_user), db: OrmSession = Depends(get_db)
) -> list[JobResponse]:
    return [JobResponse(**jobs_service.job_to_dict(job)) for job in jobs_service.list_owned_jobs(db, user)]


@router.get("/jobs/{job_id}", response_model=JobResponse)
def read_job(
    job_id: str,
    user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> JobResponse:
    job = jobs_service.get_owned_job(db, user, job_id)
    return JobResponse(**jobs_service.job_to_dict(job))


@router.post("/jobs/{job_id}/cancel", response_model=JobResponse)
def cancel_job_endpoint(
    job_id: str,
    _: None = Depends(require_csrf),
    __: None = Depends(user_rate_limit("jobs")),
    user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> JobResponse:
    job = jobs_service.cancel_job(db, user, job_id)
    return JobResponse(**jobs_service.job_to_dict(job))


@router.post("/jobs/{job_id}/retry", response_model=JobResponse)
def retry_job_endpoint(
    job_id: str,
    _: None = Depends(require_csrf),
    __: None = Depends(user_rate_limit("jobs")),
    user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> JobResponse:
    """Requeue a failed job and, on the inline backend, run it again."""
    job = jobs_service.requeue_job(db, user, job_id)
    if get_settings().job_backend == "inline":
        job = jobs_service.run_job(db, user, job.id, _inline_handler)
    return JobResponse(**jobs_service.job_to_dict(job))


__all__ = ["router"]
