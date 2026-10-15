"""Admin-only routes. All handlers require the ``admin`` role server-side."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from ..database import get_db
from ..deps import require_admin, require_csrf
from ..models import User
from ..schemas import AdminUserResponse, DiagnosticsResponse
from ..services import jobs as jobs_service
from ..services.diagnostics import production_diagnostics

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/users", response_model=list[AdminUserResponse])
def list_users(
    _: User = Depends(require_admin), db: OrmSession = Depends(get_db)
) -> list[AdminUserResponse]:
    users = db.execute(select(User).order_by(User.created_at)).scalars().all()
    return [AdminUserResponse.model_validate(user) for user in users]


@router.get("/diagnostics", response_model=DiagnosticsResponse)
def diagnostics(
    _: User = Depends(require_admin), db: OrmSession = Depends(get_db)
) -> DiagnosticsResponse:
    """Report production readiness without exposing any secret value."""
    return DiagnosticsResponse(**production_diagnostics(db))


@router.post("/jobs/recover-stale")
def recover_stale_jobs(
    _: None = Depends(require_csrf),
    __: User = Depends(require_admin),
    db: OrmSession = Depends(get_db),
) -> dict:
    """Recover jobs left ``running`` by a crashed process (admin/ops action).

    Exposed so an operator (or the worker on startup) can safely clear stuck
    jobs without a CLI; it only ever moves timed-out ``running`` jobs to
    ``failed`` with a retryable marker. CSRF is required, like every other
    authenticated state-changing endpoint.
    """
    recovered = jobs_service.recover_stale_jobs(db)
    return {"recovered": recovered}
