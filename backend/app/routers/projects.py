"""Server-side projects: CRUD with ownership, versioning and safe validation.

Two capabilities live here:

* the **server project CRUD** (W10): create/read/update/delete a project stored
  on the server, with ownership enforced per record and optimistic concurrency on
  updates;
* the original **local import** (Stage 7): idempotent import of browser
  ``localStorage`` projects.

Every endpoint authenticates the user server-side and never trusts a
client-supplied user id, plan or limit. A project owned by another user is
reported as not found so the API does not reveal that it exists. Mutating calls
require the CSRF token.
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
    LocalProjectImportItem,
    LocalProjectImportRequest,
    LocalProjectImportResult,
    ProjectCreateRequest,
    ProjectResponse,
    ProjectUpdateRequest,
    UserResponse,  # noqa: F401  (re-exported for routers)
)
from ..services.limits import METRIC_PROJECTS, enforce_limit
from ..services.projects import (
    create_project,
    delete_project,
    get_owned_project,
    list_owned_projects,
    project_to_dict,
    update_project,
    validate_scene_payload,
)

router = APIRouter(prefix="/api", tags=["projects"])


# ---------------------------------------------------------------------------
# Server-side project CRUD (W10)
# ---------------------------------------------------------------------------


@router.post("/projects", response_model=ProjectResponse, status_code=201)
def create_server_project(
    payload: ProjectCreateRequest,
    _: None = Depends(require_csrf),
    __: None = Depends(user_rate_limit("projects")),
    user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> ProjectResponse:
    project = create_project(db, user, name=payload.name, payload=payload.scene)
    return ProjectResponse(**project_to_dict(project))


@router.get("/projects/{project_id}", response_model=ProjectResponse)
def read_server_project(
    project_id: str,
    user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> ProjectResponse:
    project = get_owned_project(db, user, project_id)
    return ProjectResponse(**project_to_dict(project))


@router.patch("/projects/{project_id}", response_model=ProjectResponse)
def patch_server_project(
    project_id: str,
    payload: ProjectUpdateRequest,
    _: None = Depends(require_csrf),
    __: None = Depends(user_rate_limit("projects")),
    user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> ProjectResponse:
    project = update_project(
        db,
        user,
        project_id,
        name=payload.name,
        payload=payload.scene,
        expected_version=payload.expected_version,
    )
    return ProjectResponse(**project_to_dict(project))


@router.delete("/projects/{project_id}", status_code=204)
def delete_server_project(
    project_id: str,
    _: None = Depends(require_csrf),
    __: None = Depends(user_rate_limit("projects")),
    user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> None:
    delete_project(db, user, project_id)


# ---------------------------------------------------------------------------
# Local (localStorage) project import
# ---------------------------------------------------------------------------


@router.post("/projects/import", response_model=LocalProjectImportResult)
def import_local_projects(
    payload: LocalProjectImportRequest,
    _: None = Depends(require_csrf),
    __: None = Depends(user_rate_limit("import")),
    user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> LocalProjectImportResult:
    # Validate the whole batch before writing anything. Import used to store
    # ``item.scene`` as-is, which bypassed every bound create/update enforce
    # (object count, assemblies, depth, array length, size, NaN). Validating up
    # front also makes the batch all-or-nothing for validation errors: a bad
    # scene at position 3 cannot leave projects 1-2 half-imported.
    validated = [(item, validate_scene_payload(item.scene)) for item in payload.projects]

    entries: list[tuple[LocalProjectImportItem, dict, Project | None]] = []
    for item, scene in validated:
        existing = db.execute(
            select(Project).where(
                Project.user_id == user.id, Project.client_id == item.client_id
            )
        ).scalar_one_or_none()
        entries.append((item, scene, existing))

    # Enforce the project limit once, for the number of genuinely new projects,
    # so a mid-batch limit error cannot leave a partial import either.
    new_count = sum(1 for _, _, existing in entries if existing is None)
    if new_count > 0:
        enforce_limit(db, user, METRIC_PROJECTS, increment=new_count)

    imported = 0
    skipped = 0
    project_ids: list[str] = []

    for item, scene, existing in entries:
        if existing is not None:
            # Idempotent update; never duplicate.
            existing.name = item.name
            existing.scene = scene
            existing.version = existing.version + 1
            project_ids.append(existing.id)
            skipped += 1
            continue

        project = Project(
            user_id=user.id,
            client_id=item.client_id,
            name=item.name,
            scene=scene,
        )
        db.add(project)
        db.flush()
        project_ids.append(project.id)
        imported += 1

    db.commit()
    return LocalProjectImportResult(imported=imported, skipped=skipped, project_ids=project_ids)


@router.get("/projects", response_model=list[ProjectResponse])
def list_projects(
    user: User = Depends(get_current_user), db: OrmSession = Depends(get_db)
) -> list[ProjectResponse]:
    rows = list_owned_projects(db, user)
    return [ProjectResponse(**project_to_dict(row)) for row in rows]


__all__ = ["AdminUserResponse", "router"]
