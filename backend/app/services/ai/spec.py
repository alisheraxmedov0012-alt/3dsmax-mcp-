"""Design specification: the shared vocabulary between the AI layer and geometry.

This module is the single source of truth for the *wire* design contract:

    DesignSpec = { furniture, dimensions, details, color, material_kind, style,
                   confidence, notes, warnings, supported }

Dimension semantics (W13, explicit and tested)
----------------------------------------------
``width_cm`` / ``depth_cm`` / ``height_cm`` are **geometric extents along the
fixed world axes** used by every builder:

* ``width_cm``  -> X axis
* ``depth_cm``  -> Z axis
* ``height_cm`` -> Y axis

For a bed this has a naming consequence worth stating out loud: the Z extent is
the head-board-to-foot direction, which people call the bed's *length*. The
geometry layer has always built the bed that way (``buildBed`` places the frame
along Z), and the furniture UI labels ``depthCm`` as "Uzunlik" for beds. The two
names therefore describe the same extent; there is no second "length" axis.

Nothing in this module silently moves a bed's length into another axis. When a
prompt says "uzunlik / длина / length", the *parser* maps that word onto
``depth_cm`` for beds only, and emits an explicit note saying so. Every other
type ignores the word rather than guessing.

Untrusted input: anything a provider produces is treated as untrusted and must
pass :func:`build_design_spec`. Unknown furniture types, non-finite dimensions
and structurally impossible combinations are rejected; only clearly recoverable
values (e.g. a malformed colour) are downgraded to defaults with a warning.
"""
from __future__ import annotations

import math
import re
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .base import AiOutputError
from .rules import validate_type_rules

# Absolute sanity bounds for any single dimension (cm) from an untrusted model.
MIN_DIMENSION_CM = 1.0
MAX_DIMENSION_CM = 1000.0

HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")

Confidence = Literal["high", "medium", "low"]


class FurnitureType(StrEnum):
    """Furniture categories with a parametric builder in the geometry layer."""

    TABLE = "table"
    CHAIR = "chair"
    ARMCHAIR = "armchair"
    SOFA = "sofa"
    BED = "bed"
    WARDROBE = "wardrobe"
    SHELF = "shelf"
    DRESSER = "dresser"


#: Every type above has a builder (``src/geometry/furniture/buildFurniture.ts``),
#: so all eight are buildable. The flag is kept rather than removed: a stored
#: spec written by an older build keeps its meaning, and a future type can be
#: introduced behind the same contract without a breaking change.
SUPPORTED_FURNITURE_TYPES: frozenset[FurnitureType] = frozenset(FurnitureType)


class Dimensions(BaseModel):
    model_config = ConfigDict(extra="ignore")

    width_cm: float
    height_cm: float
    depth_cm: float


#: Numeric detail channels that must be finite and non-negative when present.
_DETAIL_NUMERIC_FIELDS = (
    "topThicknessCm",
    "legCount",
    "seatHeightCm",
    "backHeightCm",
    "armHeightCm",
    "wallThicknessCm",
    "shelfCount",
    "doorCount",
    "drawerCount",
    "legHeightCm",
    "mattressHeightCm",
    "headboardHeightCm",
)


class DesignDetails(BaseModel):
    """Optional, type-specific channels (W13).

    The field names intentionally match ``FurnitureParams`` in the frontend
    geometry layer (``src/geometry/furniture/types.ts``) so the frontend can
    merge them onto ``FURNITURE_DEFAULTS[type]`` without a translation table.
    Because they mirror a TypeScript interface, they keep that casing on the
    wire.

    All fields are optional and default to ``None``, which makes the addition
    backward compatible: a stored specification written before W13 simply has no
    ``details`` key and continues to work.
    """

    model_config = ConfigDict(extra="ignore")

    # table
    topThicknessCm: float | None = None
    legCount: int | None = None
    # chair / armchair / sofa
    seatHeightCm: float | None = None
    backHeightCm: float | None = None
    armHeightCm: float | None = None
    # wardrobe / shelf
    wallThicknessCm: float | None = None
    shelfCount: int | None = None
    # wardrobe / dresser
    doorCount: int | None = None
    # dresser
    drawerCount: int | None = None
    legHeightCm: float | None = None
    # bed
    mattressHeightCm: float | None = None
    headboardHeightCm: float | None = None

    @model_validator(mode="before")
    @classmethod
    def _reject_boolean_channels(cls, data: object) -> object:
        """Reject ``true``/``false`` for numeric channels.

        Python's ``bool`` is a subclass of ``int``, so without this check
        pydantic happily coerces ``true`` to ``1`` (and to ``1.0`` for the float
        channels). That is a wrong *type* coming from an untrusted provider, not
        a legitimate value, so it is rejected rather than silently accepted.
        The check runs before coercion, while the raw value is still a bool.
        """
        if isinstance(data, dict):
            for field in _DETAIL_NUMERIC_FIELDS:
                if isinstance(data.get(field), bool):
                    raise ValueError(f"'{field}' boolean emas, son bo'lishi kerak.")
        return data


class RawDesignSpec(BaseModel):
    """Provider output before domain validation (all fields untrusted/optional)."""

    model_config = ConfigDict(extra="ignore")

    furniture: str | None = None
    dimensions: Dimensions | None = None
    details: DesignDetails | None = None
    color: str | None = None
    material_kind: str | None = None
    style: str | None = None
    confidence: Confidence = "low"
    notes: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class DesignSpec(BaseModel):
    """Validated design specification returned by the API."""

    furniture: FurnitureType
    dimensions: Dimensions | None = None
    details: DesignDetails | None = None
    color: str | None = None
    material_kind: str | None = None
    style: str | None = None
    confidence: Confidence = "low"
    notes: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    #: Whether the current build can turn this spec into geometry.
    supported: bool = False


class AiDesignRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    image_filename: str | None = None


class AiDesignResponse(BaseModel):
    provider: str
    spec: DesignSpec


def _validate_dimension(value: float, label: str) -> float:
    if not math.isfinite(value) or value <= 0 or value > MAX_DIMENSION_CM:
        raise AiOutputError(f"{label} qiymati noto'g'ri: ruxsat etilgan oraliqdan tashqarida.")
    return value


def _validate_details(details: DesignDetails | None) -> DesignDetails | None:
    """Reject non-numeric, non-finite or negative channels before they reach geometry.

    ``DesignDetails`` already refuses a boolean at parse time. This second check
    covers a details object built without validation (``model_construct``) and
    keeps the rule in one place for every caller of ``build_design_spec``.
    """
    if details is None:
        return None
    for field in _DETAIL_NUMERIC_FIELDS:
        value = getattr(details, field)
        if value is None:
            continue
        # bool is a subclass of int; True/False must never pass as 1/0.
        if isinstance(value, bool):
            raise AiOutputError(f"'{field}' boolean emas, son bo'lishi kerak.")
        number = float(value)
        if not math.isfinite(number) or number < 0:
            raise AiOutputError(f"'{field}' qiymati noto'g'ri.")
    return details


def build_design_spec(raw: RawDesignSpec, *, provider: str) -> DesignSpec:
    """Validate untrusted provider output into a ``DesignSpec``.

    Raises :class:`AiOutputError` for an unknown furniture type, an invalid
    dimension, an unusable type-specific channel, or a structurally impossible
    combination. A malformed colour is dropped with a warning rather than failing
    the whole request.
    """
    if not raw.furniture:
        raise AiOutputError("AI javobida mebel turi ko'rsatilmagan.")

    try:
        furniture = FurnitureType(raw.furniture.strip().lower())
    except ValueError as exc:
        raise AiOutputError(f"Qo'llab-quvvatlanmaydigan mebel turi: {raw.furniture!r}.") from exc

    notes = list(raw.notes)
    warnings = list(raw.warnings)

    dimensions: Dimensions | None = None
    if raw.dimensions is not None:
        dimensions = Dimensions(
            width_cm=_validate_dimension(raw.dimensions.width_cm, "Kenglik"),
            height_cm=_validate_dimension(raw.dimensions.height_cm, "Balandlik"),
            depth_cm=_validate_dimension(raw.dimensions.depth_cm, "Chuqurlik"),
        )
    else:
        warnings.append("O'lchamlar aniqlanmadi; standart qiymatlar ishlatiladi.")

    details = _validate_details(raw.details)

    color: str | None = None
    if raw.color:
        if HEX_COLOR.match(raw.color.strip()):
            color = raw.color.strip().lower()
        else:
            warnings.append(f"Rang: \"{raw.color}\" noto'g'ri, standart rang ishlatiladi.")

    # Type-specific rules: reject only combinations that cannot be built.
    validate_type_rules(
        furniture.value,
        height_cm=dimensions.height_cm if dimensions else None,
        depth_cm=dimensions.depth_cm if dimensions else None,
        details=details.model_dump(exclude_none=True) if details else None,
    )

    supported = furniture in SUPPORTED_FURNITURE_TYPES
    if not supported:
        warnings.append(
            f"\"{furniture.value}\" hozircha geometriyada qo'llab-quvvatlanmaydi; "
            "model o'zgartirilmadi."
        )

    return DesignSpec(
        furniture=furniture,
        dimensions=dimensions,
        details=details,
        color=color,
        material_kind=raw.material_kind,
        style=raw.style,
        confidence=raw.confidence,
        notes=notes,
        warnings=warnings,
        supported=supported,
    )


__all__ = [
    "MAX_DIMENSION_CM",
    "MIN_DIMENSION_CM",
    "SUPPORTED_FURNITURE_TYPES",
    "AiDesignRequest",
    "AiDesignResponse",
    "Confidence",
    "DesignDetails",
    "DesignSpec",
    "Dimensions",
    "FurnitureType",
    "RawDesignSpec",
    "build_design_spec",
]
