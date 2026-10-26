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
    prepare_import_scene,
    project_to_dict,
    update_project,
)
from ..services.scene_payload import DEFAULT_SCENE_SCHEMA_VERSION

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
    imported = 0
    skipped = 0
    project_ids: list[str] = []

    # Validate every scene before writing anything. Import used to store
    # ``item.scene`` verbatim, so this path accepted NaN values, oversized scenes
    # and bad container versions that POST/PATCH /projects reject. Validating the
    # whole batch first also means a rejected payload leaves no half-imported
    # projects behind.
    scenes = [prepare_import_scene(item.scene) for item in payload.projects]

    for item, scene in zip(payload.projects, scenes, strict=True):
        existing = db.execute(
            select(Project).where(
                Project.user_id == user.id, Project.client_id == item.client_id
            )
        ).scalar_one_or_none()

        if existing is not None:
            # Idempotent update; never duplicate.
            existing.name = item.name
            existing.scene = scene
            existing.schema_version = DEFAULT_SCENE_SCHEMA_VERSION
            existing.version = existing.version + 1
            # Commit per item, like the create branch below. Without it the
            # update was only flushed if a later item happened to commit, so a
            # single re-import silently kept the old scene while still reporting
            # the item as skipped.
            db.commit()
            project_ids.append(existing.id)
            skipped += 1
            continue

        # Enforce the project limit only for genuinely new projects.
        enforce_limit(db, user, METRIC_PROJECTS, increment=1)

        project = Project(
            user_id=user.id,
            client_id=item.client_id,
            name=item.name,
            scene=scene,
            # Imports used to fall back to the column default (1) while
            # create_project wrote the current version, so the same scene was
            # described differently depending on how it arrived.
            schema_version=DEFAULT_SCENE_SCHEMA_VERSION,
        )
        db.add(project)
        db.commit()
        db.refresh(project)
        project_ids.append(project.id)
        imported += 1

    return LocalProjectImportResult(imported=imported, skipped=skipped, project_ids=project_ids)


@router.get("/projects", response_model=list[ProjectResponse])
def list_projects(
    user: User = Depends(get_current_user), db: OrmSession = Depends(get_db)
) -> list[ProjectResponse]:
    rows = list_owned_projects(db, user)
    return [ProjectResponse(**project_to_dict(row)) for row in rows]


__all__ = ["AdminUserResponse", "router"]
