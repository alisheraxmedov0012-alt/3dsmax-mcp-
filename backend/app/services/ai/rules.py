"""Type-specific consistency rules for a validated ``DesignSpec`` (W13).

These mirror ``relationErrors`` in the frontend geometry layer
(``src/geometry/furniture/params.ts``) so that a structurally impossible
specification is rejected at the API boundary with a precise message instead of
being rejected later, after the user has already waited for a result.

Two different things are deliberately kept apart:

* **Impossible combinations** are rejected here (for example a seat height above
  the total height). No amount of clamping makes them meaningful.
* **Out-of-range but meaningful values** are *not* rejected. The geometry layer
  clamps them into the editable range and reports a warning; clamping still
  produces valid geometry.

Nothing in this module imports the spec module, which keeps the import graph
acyclic.
"""
from __future__ import annotations

from .base import AiOutputError

_SEAT_TYPES = frozenset({"chair", "armchair", "sofa"})
_CASE_TYPES = frozenset({"wardrobe", "shelf"})


def _number(details: dict, key: str) -> float | None:
    """Return a finite number for ``key`` or ``None`` when absent/unusable."""
    value = details.get(key)
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if number == number and abs(number) != float("inf") else None
    return None


def validate_type_rules(
    furniture: str,
    *,
    height_cm: float | None,
    depth_cm: float | None,
    details: dict | None,
) -> None:
    """Raise :class:`AiOutputError` when the specification is self-contradictory."""
    extra = details or {}

    if furniture == "table" and height_cm is not None:
        thickness = _number(extra, "topThicknessCm")
        if thickness is not None and thickness >= height_cm:
            raise AiOutputError("Stol usti qalinligi balandlikdan kichik bo'lishi kerak.")

    if furniture in _SEAT_TYPES and height_cm is not None:
        seat = _number(extra, "seatHeightCm")
        if seat is not None and seat >= height_cm:
            raise AiOutputError(
                "O'rindiq balandligi umumiy balandlikdan kichik bo'lishi kerak."
            )
        arm = _number(extra, "armHeightCm")
        if arm is not None and arm > height_cm:
            raise AiOutputError(
                "Qo'l tayanchi balandligi umumiy balandlikdan oshmasligi kerak."
            )

    if furniture in _CASE_TYPES:
        wall = _number(extra, "wallThicknessCm")
        if wall is not None and wall > 0:
            if height_cm is not None and height_cm <= 2 * wall:
                raise AiOutputError("Devor qalinligi balandlikka nisbatan juda katta.")
            if depth_cm is not None and depth_cm <= 2 * wall:
                raise AiOutputError("Devor qalinligi chuqurlikka nisbatan juda katta.")

    if furniture == "dresser" and height_cm is not None:
        leg = _number(extra, "legHeightCm")
        if leg is not None and leg >= height_cm:
            raise AiOutputError("Oyoq balandligi umumiy balandlikdan kichik bo'lishi kerak.")

    # A headboard that is lower than the frame it is attached to cannot be built.
    if furniture == "bed" and height_cm is not None:
        headboard = _number(extra, "headboardHeightCm")
        if headboard is not None and headboard < height_cm:
            raise AiOutputError(
                "Karavot bosh qismi balandligi karkas balandligidan kichik bo'lmasligi kerak."
            )


__all__ = ["validate_type_rules"]
