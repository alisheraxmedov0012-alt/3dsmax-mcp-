"""Deterministic, offline AI provider.

This is **not** a real AI service: it is a rule-based interpretation used as an
honest, credential-free fallback (and as the provider the automated tests
exercise without touching the network). It extracts a furniture type, dimensions,
colour and a few type-specific counts from free text and hands the result to
:func:`build_design_spec` for the same validation every other provider goes
through.

Languages
---------
Keyword tables cover Uzbek (Latin **and** Cyrillic), Russian and English. This is
a keyword matcher, not a language model: it recognises the vocabulary listed below
and nothing else. A prompt phrased with different words is reported as ambiguous
rather than silently mapped onto a guessed type.

Bed length
----------
For a bed the Z extent is the head-board-to-foot direction, which people call the
bed's *length*. The parser maps "uzunlik / длина / length" onto ``depth_cm`` for
beds only, and adds an explicit note so the mapping is never silent. See the
dimension-semantics section of :mod:`app.services.ai.spec`.
"""
from __future__ import annotations

import re

from .base import AiAmbiguousPrompt, DesignRequest
from .spec import DesignDetails, DesignSpec, FurnitureType, RawDesignSpec, build_design_spec

_NUMBER = r"\d+(?:[.,]\d+)?"

# Letter class used for word boundaries. It must include Cyrillic, otherwise
# "стол" would match inside "столик" (Cyrillic is not in [a-z]).
_LETTER_ONLY = "a-z\\u0400-\\u04FF'"

# Ordered so multi-word / more specific words win; first match decides the type.
_FURNITURE_KEYWORDS: list[tuple[FurnitureType, tuple[str, ...]]] = [
    (FurnitureType.ARMCHAIR, ("kreslo", "armchair", "kursi", "кресло")),
    (FurnitureType.WARDROBE, ("shkaf", "wardrobe", "cabinet", "шкаф", "шкаф-купе")),
    (FurnitureType.DRESSER, ("komod", "dresser", "chest of drawers", "комод")),
    (FurnitureType.SHELF, ("javon", "bookshelf", "shelf", "polka", "жавон", "полка", "стеллаж")),
    (FurnitureType.SOFA, ("divan", "sofa", "couch", "диван")),
    (FurnitureType.CHAIR, ("stul", "chair", "стул")),
    (FurnitureType.BED, ("karavot", "bed", "kravat", "каравот", "кровать")),
    (FurnitureType.TABLE, ("stol", "table", "desk", "parta", "стол", "парта")),
]

_DIMENSION_KEYWORDS: dict[str, tuple[str, ...]] = {
    # Uzbek is agglutinative ("kengligi", "uzunligi"), so inflected forms are
    # listed explicitly rather than loosening the word boundary -- a loose
    # boundary would let short stems such as "en" match unrelated words.
    "width_cm": (
        "kenglik",
        "kengligi",
        "keng",
        "eni",
        "en",
        "width",
        "кенглик",
        "кенглиги",
        "ени",
        "ширина",
    ),
    "height_cm": (
        "balandlik",
        "balandligi",
        "baland",
        "bo'yi",
        "boyi",
        "height",
        "баландлик",
        "баландлиги",
        "бойи",
        "бўйи",
        "высота",
    ),
    "depth_cm": (
        "chuqurlik",
        "chuqurligi",
        "chuqur",
        "depth",
        "чуқурлик",
        "чуқурлиги",
        "глубина",
    ),
}

#: Colloquial "length". Only a bed maps this, and only onto the Z extent.
_LENGTH_KEYWORDS = (
    "uzunlik",
    "uzunligi",
    "uzun",
    "length",
    "узунлик",
    "узунлиги",
    "длина",
)

_COLOR_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ("#ffffff", ("oq", "white", "оқ", "белый")),
    ("#1a1a1a", ("qora", "black", "қора", "чёрный", "черный")),
    ("#808080", ("kulrang", "gray", "grey", "кулранг", "серый")),
    ("#8b5a2b", ("jigarrang", "brown", "жигарранг", "коричневый")),
    ("#a9744f", ("yog'och", "yogoch", "wood", "ёғоч", "дерево")),
    ("#c0392b", ("qizil", "red", "қизил", "красный")),
    ("#2f6fb0", ("ko'k", "kok", "blue", "кўк", "синий")),
    ("#2e8b57", ("yashil", "green", "яшил", "зелёный", "зеленый")),
    ("#d4b106", ("sariq", "yellow", "сариқ", "жёлтый", "желтый")),
]

#: Type-specific counts a prompt may carry, e.g. "3 eshikli shkaf".
_COUNT_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ("doorCount", ("eshik", "door", "двер", "эшик")),
    ("shelfCount", ("tokcha", "polka", "shelf", "shelves", "полк", "токча")),
    ("drawerCount", ("tortma", "drawer", "ящик", "тортма")),
    ("legCount", ("oyoq", "leg", "ножк", "оёқ")),
]


def _to_float(token: str) -> float:
    return float(token.replace(",", "."))


def _contains(text: str, keyword: str) -> bool:
    return (
        re.search(rf"(?<![{_LETTER_ONLY}]){re.escape(keyword)}(?![{_LETTER_ONLY}])", text, re.I)
        is not None
    )


def _find_furniture(text: str) -> FurnitureType | None:
    for furniture, keywords in _FURNITURE_KEYWORDS:
        if any(_contains(text, keyword) for keyword in keywords):
            return furniture
    return None


def _find_number_near(text: str, keywords: tuple[str, ...]) -> float | None:
    for keyword in keywords:
        word = re.escape(keyword)
        after = re.search(
            rf"(?<![{_LETTER_ONLY}]){word}(?![{_LETTER_ONLY}])\s*(?::|=|-|sm)?\s*({_NUMBER})",
            text,
            re.I,
        )
        if after:
            return _to_float(after.group(1))
        before = re.search(
            rf"({_NUMBER})\s*(?:sm)?\s+(?<![{_LETTER_ONLY}]){word}(?![{_LETTER_ONLY}])",
            text,
            re.I,
        )
        if before:
            return _to_float(before.group(1))
    return None


def _find_dimensions(text: str) -> dict[str, float]:
    dimensions: dict[str, float] = {}
    # Cyrillic "ha" is what people type instead of the multiplication sign.
    triple = re.search(
        rf"({_NUMBER})\s*[x\u00d7\u0445]\s*({_NUMBER})\s*[x\u00d7\u0445]\s*({_NUMBER})",
        text,
        re.I,
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


def _find_counts(text: str) -> dict[str, int]:
    """Extract "<n> eshikli", "3 ta tokcha", "двери 2" style counts.

    Uzbek is agglutinative, so the noun is usually followed by a suffix
    ("eshik**li**"). Up to four trailing letters are tolerated so the count is
    still recognised; the word before the number keeps a full boundary check.
    """
    counts: dict[str, int] = {}
    for field, keywords in _COUNT_KEYWORDS:
        for keyword in keywords:
            word = re.escape(keyword)
            patterns = (
                # "3 eshikli", "4 двери", "5 ta tokcha" -- number before the noun.
                rf"({_NUMBER})\s*(?:ta\s+)?(?<![{_LETTER_ONLY}]){word}[{_LETTER_ONLY}]{{0,4}}",
                # "eshik: 3" -- an explicit separator is required after the noun,
                # otherwise "shelf 80x30x180" would read 80 as a shelf count.
                rf"(?<![{_LETTER_ONLY}]){word}[{_LETTER_ONLY}]{{0,4}}\s*[:\-]\s*({_NUMBER})",
            )
            match = None
            for pattern in patterns:
                match = re.search(pattern, text, re.I)
                if match:
                    break
            if match is None:
                continue
            value = _to_float(match.group(1))
            if value != int(value) or value <= 0:
                continue
            counts[field] = int(value)
            break
    return counts


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
            # Guessing a type here would silently build the wrong object, so the
            # request is reported as ambiguous instead.
            raise AiAmbiguousPrompt(
                "Mebel turini aniqlab bo'lmadi. Masalan: «180x60x75 sm stol» "
                "yoki «3 eshikli shkaf»."
            )

        dimensions = _find_dimensions(text)
        notes: list[str] = []
        warnings: list[str] = []

        # Beds: "length" is the Z extent. Map it explicitly and say so.
        if furniture is FurnitureType.BED and "depth_cm" not in dimensions:
            length = _find_number_near(text, _LENGTH_KEYWORDS)
            if length is not None:
                dimensions["depth_cm"] = length
                notes.append(
                    "Karavot uzunligi chuqurlik (Z o'qi) sifatida qabul qilindi "
                    f"({length} sm)."
                )

        if dimensions and len(dimensions) < 3:
            # A partial size (e.g. only "eni 180 sm") cannot form a complete spec;
            # report it and keep the defaults rather than sending invalid data
            # (which would otherwise fail schema validation).
            found = ", ".join(f"{key}={value} sm" for key, value in sorted(dimensions.items()))
            warnings.append(
                f"O'lchamlarning bir qismi aniqlandi ({found}), lekin to'liq emas; "
                "standart o'lchamlar ishlatiladi."
            )
            dimensions = {}

        if dimensions:
            notes.append(
                "O'lchamlar: "
                + ", ".join(f"{key}={value} sm" for key, value in sorted(dimensions.items()))
                + "."
            )

        counts = _find_counts(text)
        details = DesignDetails(**counts) if counts else None
        if details is not None:
            notes.append(
                "Qo'shimcha: "
                + ", ".join(f"{key}={value}" for key, value in sorted(counts.items()))
                + "."
            )

        raw = RawDesignSpec(
            furniture=furniture.value,
            dimensions=dimensions or None,
            details=details,
            color=_find_color(text),
            confidence="high" if len(dimensions) == 3 else "medium" if dimensions else "low",
            notes=notes,
            warnings=warnings,
        )
        return build_design_spec(raw, provider=self.name)


__all__ = ["LocalHeuristicProvider"]
