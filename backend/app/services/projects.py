"""W10 project service: server-side CRUD with ownership and versioning.

Every read/write goes through here so ownership is enforced **on the server** for
each record; a client-supplied user id is never trusted. A project that exists
but belongs to someone else is reported as *not found* (404) rather than
*forbidden* (403), so the API does not leak the existence of other users' data.

Concurrency: updates accept an optional ``expected_version``. When it does not
match the stored ``version`` the update is rejected with 409, so a stale client
cannot silently overwrite newer work. Successful updates bump the version.
"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from ..errors import ApiError
from ..models import Project, User
from .limits import METRIC_PROJECTS, enforce_limit
from .scene_payload import (
    DEFAULT_SCENE_SCHEMA_VERSION,
    MAX_SCENE_BYTES,
    extract_scene,
    scene_size_bytes,
)

MAX_PROJECT_NAME = 120


def _not_found() -> ApiError:
    return ApiError("project_not_found", "Loyiha topilmadi.", status_code=404)


def _check_size(scene: dict) -> None:
    if scene_size_bytes(scene) > MAX_SCENE_BYTES:
        raise ApiError(
            "scene_too_large",
            "Loyiha hajmi ruxsat etilgan chegaradan katta.",
            status_code=413,
        )


def get_owned_project(db: OrmSession, user: User, project_id: str) -> Project:
    """Return the project only when it belongs to ``user``; else 404."""
    project = db.get(Project, project_id)
    if project is None or project.user_id != user.id:
        raise _not_found()
    return project


def list_owned_projects(db: OrmSession, user: User) -> list[Project]:
    return (
        db.execute(
            select(Project)
            .where(Project.user_id == user.id)
            .order_by(Project.updated_at.desc())
        )
        .scalars()
        .all()
    )


def create_project(db: OrmSession, user: User, *, name: str, payload: dict) -> Project:
    """Create a project for ``user``, enforcing the plan's project limit."""
    scene = extract_scene(payload)
    _check_size(scene)

    # Enforce the server-side plan limit before inserting.
    enforce_limit(db, user, METRIC_PROJECTS, increment=1)

    project = Project(
        user_id=user.id,
        # Server-created projects get a generated client id; the column stays
        # non-null and unique per user so imports and creates share one table.
        client_id=f"server-{uuid.uuid4().hex}",
        name=name.strip()[:MAX_PROJECT_NAME] or "Nomsiz loyiha",
        scene=scene,
        version=1,
        schema_version=DEFAULT_SCENE_SCHEMA_VERSION,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def update_project(
    db: OrmSession,
    user: User,
    project_id: str,
    *,
    name: str | None = None,
    payload: dict | None = None,
    expected_version: int | None = None,
) -> Project:
    """Update a project the user owns. Never corrupts the stored value on error."""
    project = get_owned_project(db, user, project_id)

    if expected_version is not None and expected_version != project.version:
        raise ApiError(
            "version_conflict",
            "Loyiha boshqa joyda o'zgartirilgan. Yangilab, qaytadan urinib ko'ring.",
            status_code=409,
        )

    if name is not None:
        project.name = name.strip()[:MAX_PROJECT_NAME] or project.name

    if payload is not None:
        # Validate fully before mutating anything, so a bad payload leaves the
        # existing scene untouched.
        scene = extract_scene(payload)
        _check_size(scene)
        project.scene = scene

    # Bump the version only for a successful update.
    project.version = project.version + 1

    db.commit()
    db.refresh(project)
    return project


def delete_project(db: OrmSession, user: User, project_id: str) -> None:
    project = get_owned_project(db, user, project_id)
    db.delete(project)
    db.commit()


def project_to_dict(project: Project, *, include_scene: bool = True) -> dict:
    data = {
        "id": project.id,
        "client_id": project.client_id,
        "name": project.name,
        "version": project.version,
        "schema_version": project.schema_version,
        "created_at": project.created_at.isoformat() if project.created_at else None,
        "updated_at": project.updated_at.isoformat() if project.updated_at else None,
    }
    if include_scene:
        data["scene"] = project.scene
    return data


__all__ = [
    "MAX_PROJECT_NAME",
    "create_project",
    "delete_project",
    "get_owned_project",
    "list_owned_projects",
    "project_to_dict",
    "update_project",
]
