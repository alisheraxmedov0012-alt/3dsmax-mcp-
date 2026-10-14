"""Deterministic, offline AI provider.

This is **not** a real AI service: it is a rule-based interpretation used as an
honest, credential-free fallback (and as the provider the automated tests
exercise without touching the network). It extracts a furniture type, dimensions
and colour from free text and hands the result to :func:`build_design_spec` for
the same validation every other provider goes through.
"""
from __future__ import annotations

import re

from .base import DesignRequest
from .spec import DesignSpec, FurnitureType, RawDesignSpec, build_design_spec

_NUMBER = r"\d+(?:[.,]\d+)?"

# Ordered so multi-word / more specific words win; first match decides the type.
_FURNITURE_KEYWORDS: list[tuple[FurnitureType, tuple[str, ...]]] = [
    (FurnitureType.ARMCHAIR, ("kreslo", "armchair", "kursi")),
    (FurnitureType.WARDROBE, ("shkaf", "wardrobe", "cabinet")),
    (FurnitureType.DRESSER, ("komod", "dresser", "chest of drawers")),
    (FurnitureType.SHELF, ("javon", "bookshelf", "shelf", "polka")),
    (FurnitureType.SOFA, ("divan", "sofa", "couch")),
    (FurnitureType.CHAIR, ("stul", "chair")),
    (FurnitureType.BED, ("karavot", "bed", "kravat")),
    (FurnitureType.TABLE, ("stol", "table", "desk", "parta")),
]

_DIMENSION_KEYWORDS: dict[str, tuple[str, ...]] = {
    "width_cm": ("kenglik", "keng", "eni", "en", "width"),
    "height_cm": ("balandlik", "baland", "bo'yi", "height"),
    "depth_cm": ("chuqurlik", "chuqur", "depth"),
}

_COLOR_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ("#ffffff", ("oq", "white")),
    ("#1a1a1a", ("qora", "black")),
    ("#808080", ("kulrang", "gray", "grey")),
    ("#8b5a2b", ("jigarrang", "brown")),
    ("#a9744f", ("yog'och", "yogoch", "wood")),
    ("#c0392b", ("qizil", "red")),
    ("#2f6fb0", ("ko'k", "kok", "blue")),
    ("#2e8b57", ("yashil", "green")),
    ("#d4b106", ("sariq", "yellow")),
]


def _to_float(token: str) -> float:
    return float(token.replace(",", "."))


def _contains(text: str, keyword: str) -> bool:
    return re.search(rf"(?<![a-z']){re.escape(keyword)}(?![a-z'])", text, re.IGNORECASE) is not None


def _find_furniture(text: str) -> FurnitureType | None:
    for furniture, keywords in _FURNITURE_KEYWORDS:
        if any(_contains(text, keyword) for keyword in keywords):
            return furniture
    return None


def _find_number_near(text: str, keywords: tuple[str, ...]) -> float | None:
    for keyword in keywords:
        word = re.escape(keyword)
        after = re.search(
            rf"(?<![a-z']){word}(?![a-z'])\s*(?::|=|-|sm)?\s*({_NUMBER})", text, re.IGNORECASE
        )
        if after:
            return _to_float(after.group(1))
        before = re.search(rf"({_NUMBER})\s*(?:sm)?\s+(?<![a-z']){word}(?![a-z'])", text, re.IGNORECASE)
        if before:
            return _to_float(before.group(1))
    return None


def _find_dimensions(text: str) -> dict[str, float]:
    dimensions: dict[str, float] = {}
    triple = re.search(
        rf"({_NUMBER})\s*[x\u00d7]\s*({_NUMBER})\s*[x\u00d7]\s*({_NUMBER})", text, re.IGNORECASE
    )
    if triple:
        # Convention matches the frontend: width x depth x height.
        dimensions["width_cm"] = _to_float(triple.group(1))
        dimensions["depth_cm"] = _to_float(triple.group(2))
        dimensions["height_cm"] = _to_float(triple.group(3))
        return dimensions

    for field, keywords in _DIMENSION_KEYWORDS.items():
        value = _find_number_near(text, keywords)
        if value is not None:
            dimensions[field] = value
    return dimensions


def _find_color(text: str) -> str | None:
    hex6 = re.search(r"#[0-9a-fA-F]{6}", text)
    if hex6:
        return hex6.group(0).lower()
    for hex_value, keywords in _COLOR_KEYWORDS:
        if any(_contains(text, keyword) for keyword in keywords):
            return hex_value
    return None


class LocalHeuristicProvider:
    """Offline, deterministic provider. Requires no credentials or network."""

    name = "local"

    @property
    def is_configured(self) -> bool:
        return True

    def generate_design(self, request: DesignRequest) -> DesignSpec:
        text = request.text.lower()

        furniture = _find_furniture(text)
        if furniture is None:
            # Default to the only buildable type rather than guessing a random one,
            # but say so explicitly in the warnings.
            furniture = FurnitureType.TABLE
            fallback_note = "Mebel turi aniqlanmadi; stol deb qabul qilindi."
        else:
            fallback_note = None

        dimensions = _find_dimensions(text)
        notes: list[str] = []
        warnings: list[str] = []
        if fallback_note:
            warnings.append(fallback_note)
        if dimensions:
            notes.append(
                "O'lchamlar: "
                + ", ".join(f"{key}={value} sm" for key, value in sorted(dimensions.items()))
                + "."
            )

        raw = RawDesignSpec(
            furniture=furniture.value,
            dimensions=dimensions or None,
            color=_find_color(text),
            confidence="high" if len(dimensions) == 3 else "medium" if dimensions else "low",
            notes=notes,
            warnings=warnings,
        )
        return build_design_spec(raw, provider=self.name)


__all__ = ["LocalHeuristicProvider"]
