"""W10 scene payload validation.

Server-side validation for a stored project scene. It mirrors the W8 JSON
exchange contract (``format``/``version``/``scene``) and treats the payload as
**untrusted input**:

* the body must be a bounded JSON object,
* numbers must be finite (JSON ``NaN``/``Infinity`` are rejected),
* the object graph must not be absurdly deep or wide,
* an unknown W8 container version is rejected rather than silently stored.

It does not attempt deep semantic validation of every furniture parameter — the
frontend owns that (W2/W3/W8). The server guarantees the stored value is valid,
bounded JSON so a bad payload can never corrupt an existing project.
"""
from __future__ import annotations

from typing import Any

from ..errors import ApiError

# W8 container (frontend) marker and the versions this server accepts.
SCENE_JSON_FORMAT = "3d-studio-ai-scene"
SUPPORTED_SCENE_JSON_VERSIONS = frozenset({1})

# Hard structural bounds (defence against oversized / pathological payloads).
MAX_SCENE_BYTES = 2 * 1024 * 1024
MAX_SCENE_DEPTH = 32
MAX_OBJECTS = 500
MAX_ARRAY_LENGTH = 5000

#: Scene schema version this server writes for records it creates.
DEFAULT_SCENE_SCHEMA_VERSION = 3


def _reject(code: str, message: str, status_code: int = 422) -> ApiError:
    return ApiError(code, message, status_code=status_code)


def _assert_finite(value: Any, depth: int = 0) -> None:
    """Walk the structure and reject non-finite floats.

    Python's ``json`` module parses ``NaN``/``Infinity`` into floats, and
    Pydantic's ``dict[str, Any]`` accepts them, so a stored value could otherwise
    contain values that are not valid JSON for other clients.
    """
    if depth > MAX_SCENE_DEPTH:
        raise _reject("scene_too_deep", "Sahna tuzilishi juda chuqur.")
    if isinstance(value, float):
        # NaN != NaN; also catches +/-Infinity.
        if value != value or value in (float("inf"), float("-inf")):
            raise _reject("scene_non_finite", "Sahnada noto'g'ri (NaN/Infinity) qiymat bor.")
        return
    if isinstance(value, dict):
        for item in value.values():
            _assert_finite(item, depth + 1)
        return
    if isinstance(value, (list, tuple)):
        if len(value) > MAX_ARRAY_LENGTH:
            raise _reject("scene_too_large", "Sahna massivi juda katta.")
        for item in value:
            _assert_finite(item, depth + 1)


def extract_scene(payload: Any) -> dict:
    """Validate an incoming scene payload and return the scene dict to store.

    Accepts either the W8 container (``{format, version, scene}``) or a bare
    scene object. Raises ``ApiError`` (422) on any problem.
    """
    if not isinstance(payload, dict):
        raise _reject("scene_invalid", "Sahna ma'lumotlari obyekt bo'lishi kerak.")

    scene: Any = payload
    if "format" in payload or "scene" in payload:
        # Looks like a W8 container — validate it rather than storing the wrapper.
        if payload.get("format") != SCENE_JSON_FORMAT:
            raise _reject("scene_format", "Sahna formati noto'g'ri (3d-studio-ai-scene kutilgan).")
        version = payload.get("version")
        if version not in SUPPORTED_SCENE_JSON_VERSIONS:
            raise _reject("scene_version", "Sahna format versiyasi qo'llab-quvvatlanmaydi.")
        scene = payload.get("scene")
        if not isinstance(scene, dict):
            raise _reject("scene_invalid", "Sahna ma'lumotlari noto'g'ri.")

    _assert_finite(scene)

    objects = scene.get("objects")
    if objects is not None and not isinstance(objects, list):
        raise _reject("scene_invalid", "Sahnadagi obyektlar ro'yxati noto'g'ri.")
    if isinstance(objects, list) and len(objects) > MAX_OBJECTS:
        raise _reject("scene_too_large", f"Sahnada {MAX_OBJECTS} dan ortiq obyekt bo'lmasligi kerak.")

    room = scene.get("room")
    if room is not None and not isinstance(room, dict):
        raise _reject("scene_invalid", "Xona ma'lumotlari noto'g'ri.")

    return scene


def scene_size_bytes(scene: dict) -> int:
    """Approximate serialized size, used to enforce the byte cap."""
    import json

    return len(json.dumps(scene, separators=(",", ":")).encode("utf-8"))


__all__ = [
    "DEFAULT_SCENE_SCHEMA_VERSION",
    "MAX_SCENE_BYTES",
    "SCENE_JSON_FORMAT",
    "SUPPORTED_SCENE_JSON_VERSIONS",
    "extract_scene",
    "scene_size_bytes",
]
