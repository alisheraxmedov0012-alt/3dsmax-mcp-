"""Phase 4.3A — secure server-side texture validation and normalization.

The client is never trusted. A texture is accepted only when:

* its declared MIME type matches the bytes it actually contains,
* the bytes decode with Pillow as PNG, JPEG or WebP,
* it is a single still image (no SVG/GIF/animation),
* it stays inside the configured byte, dimension and pixel limits.

Accepted images are EXIF-oriented, metadata-stripped and re-encoded as a
deterministic PNG. The SHA-256 is computed over that normalized output, so the
same upload always produces the same asset hash regardless of the container
metadata the source happened to carry.
"""
from __future__ import annotations

import hashlib
import io
import warnings
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

from ..config import get_settings
from ..errors import ApiError

_ALLOWED_MIME: dict[str, str] = {
    "image/png": "PNG",
    "image/jpeg": "JPEG",
    "image/webp": "WEBP",
}
_ALLOWED_FORMAT_MIME = {value: key for key, value in _ALLOWED_MIME.items()}
_ALLOWED_FORMATS = set(_ALLOWED_FORMAT_MIME)
_MIME_ALIASES = {"image/jpg": "image/jpeg", "image/pjpeg": "image/jpeg"}


@dataclass(frozen=True)
class NormalizedTexture:
    """Validated texture bytes plus the facts stored in the database."""

    data: bytes
    width: int
    height: int
    content_hash: str


def sniff_image_format(data: bytes) -> str | None:
    """Detect PNG/JPEG/WebP from magic bytes only (no decode)."""
    if len(data) >= 8 and data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if len(data) >= 3 and data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _declared_mime(value: str | None) -> str:
    declared = (value or "").split(";")[0].strip().lower()
    return _MIME_ALIASES.get(declared, declared)


def _reject(code: str, message: str, status_code: int) -> ApiError:
    return ApiError(code, message, status_code=status_code)


def _open_image(data: bytes) -> Image.Image:
    """Open without decoding pixels, converting Pillow bomb warnings to errors."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            return Image.open(io.BytesIO(data))
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise _reject(
            "texture_too_large",
            "Rasm o'lchami xavfsiz chegarasidan katta (decompression bomb).",
            413,
        ) from exc
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, OverflowError) as exc:
        raise _reject(
            "texture_corrupt",
            "Fayl rasmiy formatga mos emas yoki buzilgan.",
            422,
        ) from exc


def validate_and_normalize_texture(
    data: bytes,
    declared_mime: str | None,
) -> NormalizedTexture:
    """Validate uploaded bytes and return deterministic PNG output."""
    settings = get_settings()
    max_bytes = settings.texture_max_bytes
    max_dimension = settings.texture_max_dimension
    max_pixels = settings.texture_max_pixels

    if not data:
        raise _reject("texture_empty", "Fayl bo'sh.", 400)
    if len(data) > max_bytes:
        raise _reject(
            "texture_too_large",
            f"Rasm hajmi juda katta (maksimum {max_bytes // (1024 * 1024)} MB).",
            413,
        )

    declared = _declared_mime(declared_mime)
    if declared not in _ALLOWED_MIME:
        raise _reject(
            "texture_type_unsupported",
            "Faqat PNG, JPEG yoki WebP teksturalari qabul qilinadi.",
            415,
        )

    sniffed = sniff_image_format(data)
    if sniffed is None:
        raise _reject(
            "texture_type_unsupported",
            "Fayl tarkibi PNG, JPEG yoki WebP emas (SVG/GIF qabul qilinmaydi).",
            415,
        )

    image = _open_image(data)
    try:
        actual_format = (image.format or "").upper()
        if actual_format not in _ALLOWED_FORMATS:
            raise _reject(
                "texture_type_unsupported",
                "Faqat PNG, JPEG yoki WebP teksturalari qabul qilinadi.",
                415,
            )
        actual_mime = _ALLOWED_FORMAT_MIME[actual_format]
        if actual_mime != sniffed:
            raise _reject(
                "texture_corrupt",
                "Fayl tarkibi o'zining magic bytes bilan mos kelmadi.",
                422,
            )
        if actual_mime != declared:
            raise _reject(
                "texture_mime_mismatch",
                "Fayl turi e'lon qilingan MIME turiga mos kelmadi.",
                415,
            )

        width, height = image.size
        if width <= 0 or height <= 0:
            raise _reject("texture_corrupt", "Rasm o'lchami noto'g'ri.", 422)
        if width > max_dimension or height > max_dimension or width * height > max_pixels:
            raise _reject(
                "texture_dimensions_too_large",
                f"Rasm {max_dimension}px va {max_pixels // 1_000_000} MP chegarasidan katta.",
                413,
            )

        # Animated WebP would silently turn into a single frame; reject it so the
        # stored texture is exactly what the user chose.
        try:
            frames = int(getattr(image, "n_frames", 1))
        except (OSError, ValueError) as exc:
            raise _reject("texture_corrupt", "Rasm kadrlarini o'qib bo'lmadi.", 422) from exc
        if frames > 1:
            raise _reject(
                "texture_animated",
                "Animatsiyalangan rasmlar tekstura sifatida qabul qilinmaydi.",
                422,
            )

        try:
            image.verify()
        except (OSError, ValueError, SyntaxError, OverflowError) as exc:
            raise _reject("texture_corrupt", "Rasm butunligi tekshiruvdan o'tmadi.", 422) from exc
    finally:
        image.close()

    # Reopen: Pillow's verify() leaves the object unusable for pixel access.
    image = _open_image(data)
    try:
        oriented = ImageOps.exif_transpose(image)
        has_alpha = oriented.mode in ("RGBA", "LA", "PA") or "transparency" in oriented.info
        converted = oriented.convert("RGBA" if has_alpha else "RGB")
        converted.load()
    except (OSError, ValueError, SyntaxError, OverflowError) as exc:
        raise _reject(
            "texture_decode_failed",
            "Rasmni dekodlab bo'lmadi — fayl shikastlangan bo'lishi mumkin.",
            422,
        ) from exc
    finally:
        image.close()

    output = io.BytesIO()
    # Pillow copies `info["icc_profile"]` into the PNG iCCP chunk by default, so
    # clear the inherited metadata explicitly. No exif/icc/pnginfo is passed:
    # the normalized file carries only pixels.
    converted.info = {}
    converted.save(output, format="PNG", compress_level=9)
    normalized = output.getvalue()

    # A JPEG can normalize to a much larger PNG. Apply the storage cap so a
    # valid upload cannot exhaust disk through normalization.
    if len(normalized) > settings.storage_max_bytes:
        raise _reject(
            "texture_too_large",
            "Normallashtirilgan rasm hajmi saqlash chegarasidan katta.",
            413,
        )

    return NormalizedTexture(
        data=normalized,
        width=converted.width,
        height=converted.height,
        content_hash=f"sha256:{hashlib.sha256(normalized).hexdigest()}",
    )


__all__ = [
    "NormalizedTexture",
    "sniff_image_format",
    "validate_and_normalize_texture",
]
