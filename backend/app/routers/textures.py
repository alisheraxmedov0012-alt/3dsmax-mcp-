"""Phase 4.3A — authenticated texture storage endpoints.

Textures are validated and normalized before they touch storage. The binary
bytes never appear in JSON; the API returns only the metadata a MaterialAsset
v1 `TextureAsset` needs. Every query is scoped to the authenticated user, and
upload requires CSRF, a rate-limit slot and durable verified storage.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, File, Request, Response, UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as OrmSession

from ..config import get_settings
from ..database import get_db
from ..deps import get_current_user, require_csrf
from ..errors import ApiError
from ..guards import user_rate_limit
from ..models import StoredFile, User
from ..schemas import TextureAssetResponse, TextureAssetSourceResponse
from ..services import storage as storage_service
from ..services import usage as usage_service
from ..services.image_validation import validate_and_normalize_texture

router = APIRouter(prefix="/api", tags=["textures"])

_TEXTURE_KIND = "texture"
_TEXTURE_VERSION = 1
_TEXTURE_MIME = "image/png"


def _texture_response(record: StoredFile) -> TextureAssetResponse:
    return TextureAssetResponse(
        id=record.id,
        version=_TEXTURE_VERSION,
        filename=record.filename,
        mime_type=_TEXTURE_MIME,
        width=int(record.width or 0),
        height=int(record.height or 0),
        byte_size=record.size_bytes,
        content_hash=record.content_hash or "",
        source=TextureAssetSourceResponse(kind="bitmap"),
    )


def _get_owned_texture(db: OrmSession, user: User, texture_id: str) -> StoredFile:
    record = db.get(StoredFile, texture_id)
    if record is None or record.user_id != user.id or record.kind != _TEXTURE_KIND:
        raise ApiError("texture_not_found", "Tekstura topilmadi.", status_code=404)
    return record


def _texture_filename(original: str | None) -> str:
    stem = Path(original or "texture").stem
    return storage_service.sanitize_filename(f"{stem or 'texture'}.png", fallback="texture.png")


def _delete_quietly(adapter: storage_service.StorageAdapter, key: str) -> None:
    try:
        adapter.delete(key)
    except Exception:
        # The database failure is the error worth reporting; a failed cleanup
        # leaves an orphan file but must not mask it.
        pass


def _enforce_user_quota(db: OrmSession, user: User, additional_bytes: int) -> None:
    settings = get_settings()
    # Lock the user row so two uploads cannot both pass the last slot in
    # PostgreSQL. SQLite ignores FOR UPDATE, but its tests are sequential.
    db.execute(select(User.id).where(User.id == user.id).with_for_update()).scalar_one()
    used = db.execute(
        select(func.coalesce(func.sum(StoredFile.size_bytes), 0)).where(
            StoredFile.user_id == user.id
        )
    ).scalar_one()
    if used + additional_bytes > settings.storage_max_user_bytes:
        raise ApiError(
            "storage_quota_exceeded",
            "Bu hisob uchun fayl saqlash kvotasi tugagan.",
            status_code=413,
        )


@router.post("/textures", response_model=TextureAssetResponse, status_code=201)
async def upload_texture(
    response: Response,
    file: UploadFile = File(...),
    _: None = Depends(require_csrf),
    __: None = Depends(user_rate_limit("textures")),
    user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> TextureAssetResponse:
    settings = get_settings()

    # Refuse before reading/decoding when storage cannot survive a restart.
    storage_service.ensure_persistent_storage()

    data = await file.read(settings.texture_max_bytes + 1)
    normalized = validate_and_normalize_texture(data, file.content_type)

    existing = db.execute(
        select(StoredFile).where(
            StoredFile.user_id == user.id,
            StoredFile.kind == _TEXTURE_KIND,
            StoredFile.content_hash == normalized.content_hash,
        )
    ).scalar_one_or_none()
    if existing is not None:
        response.status_code = 200
        return _texture_response(existing)

    _enforce_user_quota(db, user, len(normalized.data))

    adapter = storage_service.get_storage_adapter()
    key = storage_service.generate_storage_key(user.id, "png")
    try:
        adapter.put(key, normalized.data)
    except ApiError:
        raise
    except Exception as exc:
        raise ApiError(
            "storage_write_failed",
            "Teksturani saqlab bo'lmadi. Keyinroq qayta urinib ko'ring.",
            status_code=503,
        ) from exc

    record = StoredFile(
        user_id=user.id,
        project_id=None,
        filename=_texture_filename(file.filename),
        content_type=_TEXTURE_MIME,
        format="png",
        size_bytes=len(normalized.data),
        storage_key=key,
        kind=_TEXTURE_KIND,
        width=normalized.width,
        height=normalized.height,
        content_hash=normalized.content_hash,
    )
    try:
        db.add(record)
        db.commit()
    except IntegrityError:
        # Another request stored the same normalized bytes first. The unique
        # (user_id, content_hash) index is the authority; return that asset.
        db.rollback()
        _delete_quietly(adapter, key)
        existing = db.execute(
            select(StoredFile).where(
                StoredFile.user_id == user.id,
                StoredFile.kind == _TEXTURE_KIND,
                StoredFile.content_hash == normalized.content_hash,
            )
        ).scalar_one_or_none()
        if existing is None:
            raise ApiError(
                "texture_conflict",
                "Tekstura yozuvida ziddiyat yuz berdi.",
                status_code=409,
            ) from None
        response.status_code = 200
        return _texture_response(existing)
    except Exception:
        db.rollback()
        _delete_quietly(adapter, key)
        raise

    usage_service.record_usage(
        db,
        user,
        operation=usage_service.OPERATION_FILE_UPLOAD,
        idempotency_key=f"texture-upload:{record.id}",
        quantity=record.size_bytes,
        unit="bytes",
        meta={"format": "png", "kind": _TEXTURE_KIND},
    )
    return _texture_response(record)


@router.get("/textures", response_model=list[TextureAssetResponse])
def list_textures(
    user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> list[TextureAssetResponse]:
    rows = (
        db.execute(
            select(StoredFile)
            .where(StoredFile.user_id == user.id, StoredFile.kind == _TEXTURE_KIND)
            .order_by(StoredFile.created_at.desc())
        )
        .scalars()
        .all()
    )
    return [_texture_response(row) for row in rows]


@router.get("/textures/{texture_id}", response_model=TextureAssetResponse)
def read_texture(
    texture_id: str,
    user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> TextureAssetResponse:
    return _texture_response(_get_owned_texture(db, user, texture_id))


@router.get("/textures/{texture_id}/content")
def read_texture_content(
    texture_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> Response:
    record = _get_owned_texture(db, user, texture_id)
    etag = f'"{record.content_hash}"' if record.content_hash else None
    if etag is not None and request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})

    adapter = storage_service.get_storage_adapter()
    try:
        data = adapter.get(record.storage_key)
    except ApiError:
        raise
    except Exception as exc:
        raise ApiError(
            "storage_read_failed",
            "Tekstura faylini o'qib bo'lmadi.",
            status_code=503,
        ) from exc

    headers = {
        "Content-Disposition": f'inline; filename="{record.filename}"',
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=31536000, immutable",
    }
    if etag is not None:
        headers["ETag"] = etag
    return Response(content=data, media_type=_TEXTURE_MIME, headers=headers)


__all__ = ["router"]
