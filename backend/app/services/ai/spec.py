"""Design specification: the shared vocabulary between W1 (AI) and W2 (geometry).

This module is the single source of truth for the *wire* design contract:

    DesignSpec = { furniture, dimensions, color, material_kind, style,
                   confidence, notes, warnings, supported }

``FurnitureType`` and ``SUPPORTED_FURNITURE_TYPES`` are the W1 <-> W2 seam. W2
adds parametric builders for the remaining types and extends
``SUPPORTED_FURNITURE_TYPES``; W1 then needs no change. Until then a recognised
but not-yet-buildable type is returned with ``supported = False`` and an explicit
warning, so nothing is silently turned into a table (no false capability claims).

Untrusted input: anything a provider produces is treated as untrusted and must
pass :func:`build_design_spec`. Unknown furniture types and non-finite,
non-positive or absurd dimensions are rejected; only clearly recoverable values
(e.g. a malformed colour) are downgraded to defaults with a warning.
"""
from __future__ import annotations

import math
import re
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .base import AiOutputError

# Absolute sanity bounds for any single dimension (cm) from an untrusted model.
MIN_DIMENSION_CM = 1.0
MAX_DIMENSION_CM = 1000.0

HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")

Confidence = Literal["high", "medium", "low"]


class FurnitureType(StrEnum):
    """Known furniture categories (W2 vocabulary)."""

    TABLE = "table"
    CHAIR = "chair"
    ARMCHAIR = "armchair"
    SOFA = "sofa"
    BED = "bed"
    WARDROBE = "wardrobe"
    SHELF = "shelf"
    DRESSER = "dresser"


# W1 <-> W2 seam: the types the current geometry layer can actually assemble.
# W2 extends this set as builders are added; W1 needs no change.
SUPPORTED_FURNITURE_TYPES: frozenset[FurnitureType] = frozenset({FurnitureType.TABLE})


class Dimensions(BaseModel):
    model_config = ConfigDict(extra="ignore")

    width_cm: float
    height_cm: float
    depth_cm: float


class RawDesignSpec(BaseModel):
    """Provider output before domain validation (all fields untrusted/optional)."""

    model_config = ConfigDict(extra="ignore")

    furniture: str | None = None
    dimensions: Dimensions | None = None
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


def build_design_spec(raw: RawDesignSpec, *, provider: str) -> DesignSpec:
    """Validate untrusted provider output into a ``DesignSpec``.

    Raises :class:`AiOutputError` for an unknown furniture type or an invalid
    dimension. A malformed colour is dropped with a warning rather than failing
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

    color: str | None = None
    if raw.color:
        if HEX_COLOR.match(raw.color.strip()):
            color = raw.color.strip().lower()
        else:
            warnings.append(f"Rang: \"{raw.color}\" noto'g'ri, standart rang ishlatiladi.")

    supported = furniture in SUPPORTED_FURNITURE_TYPES
    if not supported:
        warnings.append(
            f"\"{furniture.value}\" hozircha geometriyada qo'llab-quvvatlanmaydi "
            "(W2 bosqichida qo'shiladi); model o'zgartirilmadi."
        )

    return DesignSpec(
        furniture=furniture,
        dimensions=dimensions,
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
    "DesignSpec",
    "Dimensions",
    "FurnitureType",
    "RawDesignSpec",
    "build_design_spec",
]
