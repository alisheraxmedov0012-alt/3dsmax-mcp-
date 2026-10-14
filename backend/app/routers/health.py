"""Health and readiness checks.

* ``/api/health`` — liveness: the process is up. No dependencies, no secrets.
* ``/api/health/ready`` — readiness: the database is reachable. Reports only
  coarse booleans/flags, never credentials, DSNs or internal error text.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import text
from sqlalchemy.orm import Session as OrmSession

from ..config import get_settings
from ..database import get_db
from ..error_tracking import is_active as error_tracking_active
from ..rate_limit import describe_backend as rate_limit_backend

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


@router.get("/api/health")
def health() -> dict:
    """Liveness — cheap, no dependencies."""
    return {"status": "ok"}


@router.get("/api/health/ready")
def readiness(response: Response, db: OrmSession = Depends(get_db)) -> dict:
    settings = get_settings()
    database_ok = _database_ok(db)
    if not database_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    # Only non-sensitive operational facts are exposed.
    return {
        "status": "ready" if database_ok else "not_ready",
        "checks": {
            "database": database_ok,
        },
        "environment": settings.environment,
        "database_backend": _db_backend(settings.database_url),
        "rate_limit_backend": rate_limit_backend(),
        "error_tracking": error_tracking_active(),
    }
