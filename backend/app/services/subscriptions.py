"""Subscription domain: statuses, transitions and queries.

Documented status model (no redundant/overlapping states):

* ``pending``        — payment expected but not yet confirmed. Merges the
                       roadmap's "to'lov kutilmoqda" and "sinov kutilmoqda /
                       tasdiqlanmagan": before the first confirmed payment a
                       subscription is unconfirmed either way.
* ``active``         — confirmed and currently entitled (roadmap: "faol").
* ``payment_failed`` — the last attempt failed; no entitlement.
* ``expired``        — the paid period elapsed without renewal.
* ``cancelled``      — the user cancelled; entitlement ends at period end.

Allowed transitions are listed in ``ALLOWED_TRANSITIONS``. Illegal transitions
raise ``ApiError`` so state can only move through confirmed, server-side events.
"""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from ..errors import ApiError
from ..models import Plan, Subscription, User
from ..security import utcnow

STATUS_PENDING = "pending"
STATUS_ACTIVE = "active"
STATUS_PAYMENT_FAILED = "payment_failed"
STATUS_EXPIRED = "expired"
STATUS_CANCELLED = "cancelled"

ALL_STATUSES = (
    STATUS_PENDING,
    STATUS_ACTIVE,
    STATUS_PAYMENT_FAILED,
    STATUS_EXPIRED,
    STATUS_CANCELLED,
)

ACTIVE_STATUSES = frozenset({STATUS_ACTIVE})

ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    STATUS_PENDING: frozenset({STATUS_ACTIVE, STATUS_PAYMENT_FAILED, STATUS_CANCELLED}),
    STATUS_ACTIVE: frozenset({STATUS_EXPIRED, STATUS_CANCELLED, STATUS_PAYMENT_FAILED}),
    STATUS_PAYMENT_FAILED: frozenset({STATUS_ACTIVE, STATUS_CANCELLED, STATUS_EXPIRED}),
    STATUS_EXPIRED: frozenset({STATUS_ACTIVE, STATUS_CANCELLED}),
    STATUS_CANCELLED: frozenset(),
}


def get_active_subscription(db: OrmSession, user: User) -> Subscription | None:
    """Return the user's most relevant subscription (active first)."""
    rows = (
        db.execute(
            select(Subscription)
            .where(Subscription.user_id == user.id)
            .order_by(Subscription.created_at.desc())
        )
        .scalars()
        .all()
    )
    for row in rows:
        if row.status == STATUS_ACTIVE:
            return row
    return rows[0] if rows else None


def transition(subscription: Subscription, new_status: str) -> None:
    """Move a subscription to ``new_status``, enforcing the state machine."""
    if new_status == subscription.status:
        return
    allowed = ALLOWED_TRANSITIONS.get(subscription.status, frozenset())
    if new_status not in allowed:
        raise ApiError(
            "invalid_transition",
            f"Obuna holatini '{subscription.status}' dan '{new_status}' ga o'zgartirib bo'lmaydi.",
            status_code=409,
        )
    subscription.status = new_status


def activate(subscription: Subscription, plan: Plan) -> None:
    period_days = plan.period_days or 30
    subscription.current_period_end = utcnow() + timedelta(days=period_days)
    transition(subscription, STATUS_ACTIVE)


def create_pending_subscription(db: OrmSession, user: User, plan: Plan) -> Subscription:
    """Reuse an existing pending subscription for the same plan, else create one."""
    existing = db.execute(
        select(Subscription).where(
            Subscription.user_id == user.id,
            Subscription.plan_id == plan.id,
            Subscription.status == STATUS_PENDING,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    subscription = Subscription(user_id=user.id, plan_id=plan.id, status=STATUS_PENDING)
    db.add(subscription)
    db.flush()
    return subscription
