"""Local (localStorage) project import.

Before accounts existed, projects lived in the browser's localStorage. This
endpoint lets an authenticated user import those projects safely:

* it is **idempotent** — re-importing the same ``client_id`` updates the
  existing row instead of creating a duplicate,
* it never deletes the user's local data (that is the client's decision),
* a bad item is skipped without failing the whole import,
* a user can only ever read/write their own projects.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from ..database import get_db
from ..deps import get_current_user, require_csrf
from ..guards import user_rate_limit
from ..models import Project, User
from ..schemas import (
    AdminUserResponse,
    LocalProjectImportRequest,
    LocalProjectImportResult,
    UserResponse,  # noqa: F401  (re-exported for routers)
)
from ..services.limits import METRIC_PROJECTS, enforce_limit

router = APIRouter(prefix="/api", tags=["projects"])


@router.post("/projects/import", response_model=LocalProjectImportResult)
def import_local_projects(
    payload: LocalProjectImportRequest,
    _: None = Depends(require_csrf),
    __: None = Depends(user_rate_limit("import")),
    user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> LocalProjectImportResult:
    imported = 0
    skipped = 0
    project_ids: list[str] = []

    for item in payload.projects:
        existing = db.execute(
            select(Project).where(
                Project.user_id == user.id, Project.client_id == item.client_id
            )
        ).scalar_one_or_none()

        if existing is not None:
            # Idempotent update; never duplicate.
            existing.name = item.name
            existing.scene = item.scene
            project_ids.append(existing.id)
            skipped += 1
            continue

        # Enforce the project limit only for genuinely new projects.
        enforce_limit(db, user, METRIC_PROJECTS, increment=1)

        project = Project(
            user_id=user.id,
            client_id=item.client_id,
            name=item.name,
            scene=item.scene,
        )
        db.add(project)
        db.commit()
        db.refresh(project)
        project_ids.append(project.id)
        imported += 1

    return LocalProjectImportResult(imported=imported, skipped=skipped, project_ids=project_ids)


@router.get("/projects", response_model=list[dict])
def list_projects(
    user: User = Depends(get_current_user), db: OrmSession = Depends(get_db)
) -> list[dict]:
    rows = db.execute(select(Project).where(Project.user_id == user.id)).scalars().all()
    return [
        {"id": row.id, "client_id": row.client_id, "name": row.name, "scene": row.scene}
        for row in rows
    ]


__all__ = ["AdminUserResponse", "router"]
