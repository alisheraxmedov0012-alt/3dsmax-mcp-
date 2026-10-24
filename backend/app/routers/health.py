"""Health and readiness checks.

* ``/api/health`` — liveness: the process is up. No dependencies, no secrets.
* ``/api/health/ready`` — readiness: the database is reachable, storage is usable
  and (in ``worker`` mode) a worker is alive. Reports only coarse booleans/flags,
  never credentials, DSNs or internal error text.
* ``/api/health/metrics`` — process-local metrics snapshot (no monitoring
  provider is wired; the payload says so explicitly).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import text
from sqlalchemy.orm import Session as OrmSession

from ..config import get_settings
from ..database import get_db
from ..error_tracking import is_active as error_tracking_active
from ..metrics import snapshot as metrics_snapshot
from ..rate_limit import RateLimitStoreState, shared_store_state
from ..rate_limit import describe_backend as rate_limit_backend
from ..services.heartbeat import worker_status
from ..services.storage import storage_status

logger = logging.getLogger("app.health")

router = APIRouter(tags=["health"])


def _database_ok(db: OrmSession) -> bool:
    try:
        db.execute(text("SELECT 1"))
        return True
    except Exception:
        logger.warning("Readiness check: database unreachable")
        return False


def _db_backend(url: str) -> str:
    if url.startswith(("postgresql", "postgres")):
        return "postgresql"
    if url.startswith("sqlite"):
        return "sqlite"
    return "other"


def _storage_ok() -> tuple[bool, dict]:
    """Storage is usable when the adapter is available and (in production) durable."""
    settings = get_settings()
    info = storage_status()
    if not info.get("available"):
        return False, info
    if settings.is_production and not info.get("persistent"):
        # A volatile store loses uploads on restart: not ready for production.
        return False, info
    return True, info


@router.get("/api/health")
def health() -> dict:
    """Liveness — cheap, no dependencies."""
    return {"status": "ok"}


@router.get("/api/health/metrics")
def metrics() -> dict:
    """Process-local counters/histograms.

    Honest by construction: ``process_local`` is true and no external monitoring
    provider is implied. In a multi-process deployment each process has its own
    counters, so this endpoint is not an aggregate.
    """
    data = metrics_snapshot()
    data["monitoring_provider"] = "none"
    data["note"] = (
        "Jarayon ichidagi metrikalar. Tashqi monitoring provayderi ulanmagan; "
        "ko'p jarayonli muhitda bu agregat emas."
    )
    return data


@router.get("/api/health/ready")
def readiness(response: Response, db: OrmSession = Depends(get_db)) -> dict:
    settings = get_settings()
    database_ok = _database_ok(db)
    storage_ok, storage_info = _storage_ok()
    worker = worker_status(db)
    worker_ok = bool(worker.get("running"))

    # A configured shared store must actually answer. `rate_limit_backend` below
    # reports the *configuration* name; this is the live probe. With the memory
    # backend there is nothing to reach, so it never fails readiness.
    store_state = shared_store_state()
    shared_store_ok = store_state is not RateLimitStoreState.UNAVAILABLE

    ready = database_ok and storage_ok and worker_ok and shared_store_ok
    if not ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    # Only non-sensitive operational facts are exposed.
    return {
        "status": "ready" if ready else "not_ready",
        "checks": {
            "database": database_ok,
            "storage": storage_ok,
            "worker": worker_ok,
            "rate_limit_store": shared_store_ok,
        },
        "environment": settings.environment,
        "database_backend": _db_backend(settings.database_url),
        "storage_backend": storage_info.get("backend"),
        "worker": worker,
        "rate_limit_backend": rate_limit_backend(),
        "rate_limit_store": store_state.value,
        "error_tracking": error_tracking_active(),
    }
