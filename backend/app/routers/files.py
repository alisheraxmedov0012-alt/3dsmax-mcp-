"""W10 file storage endpoints.

Uploads are validated on the server (content type allow-list, size cap) and the
bytes are written behind a storage adapter under a **server-generated key** — a
user-supplied filename is never used as a path. Every record is scoped to the
authenticated user; a file owned by someone else is reported as not found.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from ..config import get_settings
from ..database import get_db
from ..deps import get_current_user, require_csrf
from ..errors import ApiError
from ..guards import user_rate_limit
from ..models import StoredFile, User
from ..schemas import StorageStatusResponse, StoredFileResponse
from ..services import projects as projects_service
from ..services import usage as usage_service
from ..services.storage import (
    generate_storage_key,
    get_storage_adapter,
    resolve_format,
    sanitize_filename,
    storage_status,
    validate_size,
)

router = APIRouter(prefix="/api", tags=["files"])


@router.get("/files/status", response_model=StorageStatusResponse)
def files_status() -> StorageStatusResponse:
    """Report the storage backend honestly (no fake 'cloud is ready')."""
    return StorageStatusResponse(**storage_status())


@router.post("/files", response_model=StoredFileResponse, status_code=201)
async def upload_file(
    file: UploadFile = File(...),
    project_id: str | None = Form(default=None),
    _: None = Depends(require_csrf),
    __: None = Depends(user_rate_limit("files")),
    user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> StoredFileResponse:
    settings = get_settings()

    # If a project is referenced it must belong to this user (no IDOR).
    if project_id is not None:
        projects_service.get_owned_project(db, user, project_id)

    declared_type = (file.content_type or "application/octet-stream").lower()
    fmt = resolve_format(declared_type)

    # Read with a hard cap so a huge upload cannot exhaust memory.
    data = await file.read(settings.storage_max_bytes + 1)
    validate_size(len(data))

    adapter = get_storage_adapter()
    key = generate_storage_key(user.id, fmt)
    adapter.put(key, data)

    record = StoredFile(
        user_id=user.id,
        project_id=project_id,
        filename=sanitize_filename(file.filename or f"file.{fmt}"),
        content_type=declared_type,
        format=fmt,
        size_bytes=len(data),
        storage_key=key,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    # Ledger entry: real byte count recorded, idempotent on the file id.
    usage_service.record_usage(
        db,
        user,
        operation=usage_service.OPERATION_FILE_UPLOAD,
        idempotency_key=f"file-upload:{record.id}",
        quantity=record.size_bytes,
        unit="bytes",
        project_id=project_id,
        meta={"format": fmt, "content_type": declared_type},
    )
    return StoredFileResponse(**_file_to_dict(record))


@router.get("/files", response_model=list[StoredFileResponse])
def list_files(
    user: User = Depends(get_current_user), db: OrmSession = Depends(get_db)
) -> list[StoredFileResponse]:
    rows = (
        db.execute(
            select(StoredFile)
            .where(StoredFile.user_id == user.id)
            .order_by(StoredFile.created_at.desc())
        )
        .scalars()
        .all()
    )
    return [StoredFileResponse(**_file_to_dict(row)) for row in rows]


@router.get("/files/{file_id}")
def download_file(
    file_id: str,
    user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> Response:
    record = _get_owned_file(db, user, file_id)
    data = get_storage_adapter().get(record.storage_key)
    return Response(
        content=data,
        media_type=record.content_type,
        headers={
            # Filename is display-only; the key is never derived from it.
            "Content-Disposition": f'attachment; filename="{record.filename}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


def _get_owned_file(db: OrmSession, user: User, file_id: str) -> StoredFile:
    record = db.get(StoredFile, file_id)
    if record is None or record.user_id != user.id:
        raise ApiError("file_not_found", "Fayl topilmadi.", status_code=404)
    return record


def _file_to_dict(record: StoredFile) -> dict:
    return {
        "id": record.id,
        "filename": record.filename,
        "content_type": record.content_type,
        "format": record.format,
        "size_bytes": record.size_bytes,
        "project_id": record.project_id,
        "created_at": record.created_at,
    }


__all__ = ["router"]
