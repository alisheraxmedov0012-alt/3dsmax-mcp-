"""Server-side limit enforcement.

Limits are always evaluated on the server from the plan's configuration; a
client cannot raise a limit by editing frontend state or request payloads.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from ..errors import ApiError
from ..models import Plan, UsageCounter, User
from .subscriptions import ACTIVE_STATUSES, get_active_subscription

METRIC_PROJECTS = "projects"
METRIC_PNG_EXPORTS = "png_exports"
METRIC_GLB_EXPORTS = "glb_exports"
METRIC_AI_REQUESTS = "ai_requests"

METRIC_TO_LIMIT_KEY = {
    METRIC_PROJECTS: "max_projects",
    METRIC_PNG_EXPORTS: "max_png_exports",
    METRIC_GLB_EXPORTS: "max_glb_exports",
    METRIC_AI_REQUESTS: "max_ai_requests",
}


def _counter(db: OrmSession, user: User, metric: str) -> UsageCounter:
    row = db.execute(
        select(UsageCounter).where(UsageCounter.user_id == user.id, UsageCounter.metric == metric)
    ).scalar_one_or_none()
    if row is None:
        row = UsageCounter(user_id=user.id, metric=metric, count=0)
        db.add(row)
        db.flush()
    return row


def effective_limits(db: OrmSession, user: User) -> tuple[dict, Plan | None]:
    """Return the limits dict that applies to this user, and its plan."""
    subscription = get_active_subscription(db, user)
    if subscription is not None and subscription.status in ACTIVE_STATUSES:
        plan = db.get(Plan, subscription.plan_id)
        if plan is not None:
            return dict(plan.limits or {}), plan

    free = db.execute(select(Plan).where(Plan.key == "free")).scalar_one_or_none()
    if free is None:
        return {}, None
    return dict(free.limits or {}), free


def usage_snapshot(db: OrmSession, user: User) -> list[dict]:
    limits, _ = effective_limits(db, user)
    snapshot = []
    for metric, limit_key in METRIC_TO_LIMIT_KEY.items():
        counter = _counter(db, user, metric)
        snapshot.append({"metric": metric, "used": counter.count, "limit": limits.get(limit_key)})
    db.commit()
    return snapshot


def enforce_limit(db: OrmSession, user: User, metric: str, increment: int = 1) -> None:
    """Check and consume one unit of a metered action.

    Raises ``ApiError`` (code ``limit_reached``) when the configured limit would
    be exceeded. A ``None`` limit means "not configured" and does not block.
    """
    if metric not in METRIC_TO_LIMIT_KEY:
        raise ApiError("unknown_metric", "Noma'lum limit ko'rsatkichi.", status_code=400)

    limits, _ = effective_limits(db, user)
    limit = limits.get(METRIC_TO_LIMIT_KEY[metric])
    counter = _counter(db, user, metric)

    if isinstance(limit, int) and limit >= 0 and counter.count + increment > limit:
        raise ApiError(
            "limit_reached",
            "Tarif limiti tugadi. Pro tarifga o'tishni ko'rib chiqing.",
            status_code=402,
        )

    counter.count += increment
    db.commit()


__all__ = [
    "METRIC_AI_REQUESTS",
    "METRIC_GLB_EXPORTS",
    "METRIC_PNG_EXPORTS",
    "METRIC_PROJECTS",
    "effective_limits",
    "enforce_limit",
    "usage_snapshot",
]
