"""Plan definitions and seeding.

IMPORTANT — business values are NOT decided by the roadmap:
``PROJECT_PLAN.md`` does not specify concrete prices or limit numbers. They are
therefore left as ``None`` (an explicit, documented configuration point) rather
than invented. ``None`` means "not yet configured" and is deliberately NOT
treated as "unlimited" by the enforcement layer's reporting, though no limit is
blocked until a number is configured.

To enable a limit, set the corresponding key on the plan row (or here) to an
integer. The enforcement mechanism is fully implemented and tested.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from ..models import Plan

# Limit keys understood by the enforcement layer.
LIMIT_KEYS = ("max_projects", "max_png_exports", "max_glb_exports", "max_ai_requests")

# TODO(business): fill in approved numbers. Leaving None keeps behaviour
# unchanged (no blocking) and clearly signals "pending decision".
UNSET = None

PLAN_DEFINITIONS: list[dict] = [
    {
        "key": "free",
        "name": "Free",
        "is_active": True,
        "limits": {key: UNSET for key in LIMIT_KEYS},
        "price_cents": 0,
        "currency": None,
        "period_days": None,
    },
    {
        "key": "pro",
        "name": "Pro",
        "is_active": True,
        "limits": {key: UNSET for key in LIMIT_KEYS},
        # TODO(business): price/currency for Pro are not approved yet.
        "price_cents": UNSET,
        "currency": UNSET,
        "period_days": 30,
    },
]

DEFAULT_PLAN_KEY = "free"


def seed_plans(db: OrmSession) -> None:
    """Idempotently create the Free/Pro plans."""
    existing = {plan.key for plan in db.execute(select(Plan)).scalars().all()}
    for definition in PLAN_DEFINITIONS:
        if definition["key"] in existing:
            continue
        db.add(Plan(**definition))
    db.commit()


def get_plan_by_key(db: OrmSession, key: str) -> Plan | None:
    return db.execute(select(Plan).where(Plan.key == key)).scalar_one_or_none()
