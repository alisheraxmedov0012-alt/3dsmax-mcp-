"""Background worker entrypoint for ``APP_JOB_BACKEND=worker``.

This is the separate process a production deployment runs to consume the queue.
It is deliberately honest about what it can execute:

* it **recovers** jobs interrupted by a previous crash (``recover_stale_jobs``)
  on startup, so nothing is left ``running`` forever;
* it writes a periodic heartbeat so readiness can tell whether a worker exists;
* it executes the ``noop`` kind for real and fails every other kind explicitly
  with a non-retryable error, because no AI/render provider is wired in this
  stage. It never reports a background job as done when no work happened.

Run it with::

    python -m app.worker            # continuous loop
    python -m app.worker --once     # process currently-queued jobs once and exit
"""
from __future__ import annotations

import argparse
import logging
import os
import socket
import time
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from .config import get_settings
from .database import SessionLocal
from .errors import ApiError
from .logging_config import configure_logging
from .metrics import incr
from .models import Job, User
from .services import jobs as jobs_service
from .services.heartbeat import write_heartbeat

logger = logging.getLogger("app.worker")


def _default_worker_id() -> str:
    explicit = os.environ.get("APP_WORKER_ID")
    if explicit:
        return explicit[:120]
    return f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:6]}"


WORKER_ID = _default_worker_id()
POLL_INTERVAL_SECONDS = 2.0


def handler_for(job: Job):
    """Return the callable that executes ``job``, or one that fails honestly."""
    if job.kind == "noop":
        return lambda _job: {"ok": True}

    def _unsupported(_job: Job) -> dict:
        raise jobs_service.JobError(
            f"'{job.kind}' turidagi vazifa uchun provayder hali sozlanmagan.",
            retryable=False,
        )

    return _unsupported


def _next_queued(db: OrmSession) -> Job | None:
    return (
        db.execute(
            select(Job).where(Job.status == jobs_service.STATUS_QUEUED).order_by(Job.created_at)
        )
        .scalars()
        .first()
    )


def process_one(db: OrmSession) -> bool:
    """Claim and run a single queued job. Returns True if a job was processed."""
    job = _next_queued(db)
    if job is None:
        return False

    user = db.get(User, job.user_id)
    if user is None:  # orphaned record (owner deleted): close it out safely
        job.status = jobs_service.STATUS_FAILED
        job.error = "Vazifa egasi topilmadi."
        job.retryable = False
        db.commit()
        return True

    try:
        jobs_service.run_job(db, user, job.id, handler_for(job))
    except ApiError:
        # Parallel budget exhausted or attempts used up: leave queued for later.
        logger.warning("Job %s not started (capacity/attempts).", job.id)
        return True

    db.refresh(job)
    if (
        job.status == jobs_service.STATUS_FAILED
        and job.retryable
        and job.attempts < job.max_attempts
    ):
        jobs_service.requeue_job(db, user, job.id)
        incr("job_auto_requeued_total", kind=job.kind)
        logger.info("Job %s requeued for retry (attempt %s).", job.id, job.attempts)
    return True


def run_once(db: OrmSession) -> int:
    """Process all currently-queued jobs once. Returns how many were processed."""
    processed = 0
    while process_one(db):
        processed += 1
    return processed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="3D Studio AI job worker")
    parser.add_argument("--once", action="store_true", help="Process queued jobs once and exit")
    args = parser.parse_args(argv)

    configure_logging()
    settings = get_settings()
    if settings.job_backend != "worker":
        logger.warning(
            "APP_JOB_BACKEND=%s — worker ishga tushirildi, lekin sozlama 'worker' emas.",
            settings.job_backend,
        )

    with SessionLocal() as db:
        recovered = jobs_service.recover_stale_jobs(db)
        write_heartbeat(db, WORKER_ID, meta={"kind": "startup", "recovered": recovered})
        logger.info("Worker %s started (recovered=%s).", WORKER_ID, recovered)

        if args.once:
            processed = run_once(db)
            write_heartbeat(db, WORKER_ID, meta={"kind": "final", "processed": processed})
            logger.info("Processed %s queued job(s).", processed)
            return 0

        while True:
            write_heartbeat(db, WORKER_ID)
            run_once(db)
            time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":  # pragma: no cover - process entrypoint
    raise SystemExit(main())
