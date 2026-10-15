"""Worker liveness tracking for readiness.

A ``worker`` deployment must actually have a running worker consuming the queue.
This module records a periodic heartbeat and answers "is a worker alive?" for the
readiness endpoint, so the API never reports ready while nothing is serving jobs.

Nothing here contacts an external monitoring service; it is the minimum needed to
avoid a false "ready".
"""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from ..config import get_settings
from ..models import WorkerHeartbeat
from ..security import utcnow


def write_heartbeat(db: OrmSession, worker_id: str, meta: dict | None = None) -> WorkerHeartbeat:
    """Upsert the heartbeat row for ``worker_id``."""
    row = db.get(WorkerHeartbeat, worker_id)
    now = utcnow()
    if row is None:
        row = WorkerHeartbeat(worker_id=worker_id, last_seen_at=now, meta=meta or {})
        db.add(row)
    else:
        row.last_seen_at = now
        if meta is not None:
            row.meta = meta
    db.commit()
    db.refresh(row)
    return row


def latest_heartbeat(db: OrmSession) -> WorkerHeartbeat | None:
    return (
        db.execute(select(WorkerHeartbeat).order_by(WorkerHeartbeat.last_seen_at.desc()).limit(1))
        .scalars()
        .first()
    )


def _fresh(last_seen_at, now) -> bool:
    if last_seen_at is None:
        return False
    if last_seen_at.tzinfo is None:
        last_seen_at = last_seen_at.replace(tzinfo=now.tzinfo)
    ttl = max(get_settings().worker_heartbeat_ttl_seconds, 1)
    return last_seen_at + timedelta(seconds=ttl) >= now


def worker_status(db: OrmSession) -> dict:
    """Report whether a worker is required and whether one is alive.

    Never claims a background fleet exists: in ``inline`` mode it reports that
    jobs run in-process; in ``worker`` mode it reports ``running`` only when a
    heartbeat within the configured TTL exists.
    """
    settings = get_settings()
    mode = (settings.job_backend or "inline").lower()

    if mode != "worker":
        return {
            "mode": mode,
            "required": False,
            "running": True,
            "note": "Vazifalar so'rov ichida (inline) bajariladi.",
        }

    latest = latest_heartbeat(db)
    now = utcnow()
    fresh = _fresh(latest.last_seen_at if latest else None, now)
    age = None
    if latest is not None and latest.last_seen_at is not None:
        seen = latest.last_seen_at
        if seen.tzinfo is None:
            seen = seen.replace(tzinfo=now.tzinfo)
        age = int((now - seen).total_seconds())

    return {
        "mode": mode,
        "required": True,
        "running": fresh,
        "worker_id": latest.worker_id if latest else None,
        "last_seen_seconds_ago": age,
        "note": "Worker heartbeat" if fresh else "Worker heartbeat topilmadi (worker ishlamayapti).",
    }


__all__ = ["latest_heartbeat", "worker_status", "write_heartbeat"]
