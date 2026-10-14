"""Billing domain: idempotent payment processing, invoices and audit events.

Payment events are only ever applied through ``apply_payment_event`` which is
idempotent: re-delivering the same provider event (same ``provider_ref``) never
double-charges, never reactivates twice and never creates a duplicate invoice.
"""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as OrmSession

from ..models import BillingEvent, Invoice, PaymentAttempt, Plan, Subscription, User
from ..security import utcnow
from .payments.base import ProviderEvent
from .subscriptions import (
    STATUS_CANCELLED,
    STATUS_PAYMENT_FAILED,
    activate,
    transition,
)

FINAL_PAYMENT_STATUSES = frozenset({"succeeded", "failed", "cancelled"})


def record_event(
    db: OrmSession, event_type: str, data: dict, user_id: str | None = None
) -> BillingEvent:
    event = BillingEvent(user_id=user_id, event_type=event_type, data=data)
    db.add(event)
    db.flush()
    return event


def _next_invoice_number(db: OrmSession) -> str:
    count = db.execute(select(func.count()).select_from(Invoice)).scalar_one()
    return f"INV-{utcnow().year}-{count + 1:06d}"


def create_invoice(
    db: OrmSession,
    *,
    user_id: str,
    subscription_id: str | None,
    description: str,
    amount_cents: int,
    currency: str,
    source_event_id: str,
    paid: bool,
) -> Invoice | None:
    """Create an invoice for a confirmed event, or return None if it already exists."""
    existing = db.execute(
        select(Invoice).where(Invoice.source_event_id == source_event_id)
    ).scalar_one_or_none()
    if existing is not None:
        return None

    invoice = Invoice(
        number=_next_invoice_number(db),
        user_id=user_id,
        subscription_id=subscription_id,
        source_event_id=source_event_id,
        description=description,
        amount_cents=amount_cents,
        currency=currency,
        status="paid" if paid else "failed",
        paid_at=utcnow() if paid else None,
    )
    db.add(invoice)
    try:
        db.flush()
    except IntegrityError:
        # Another concurrent delivery created it first: idempotent no-op.
        db.rollback()
        return None
    return invoice


def apply_payment_event(db: OrmSession, event: ProviderEvent) -> PaymentAttempt:
    """Apply a verified provider event idempotently.

    Raises ``ApiError`` (404) if the referenced attempt is unknown, so an
    unauthenticated/unrelated event cannot create entitlements.
    """
    from ..errors import ApiError

    attempt = db.execute(
        select(PaymentAttempt).where(
            PaymentAttempt.provider == event.provider,
            PaymentAttempt.provider_ref == event.provider_ref,
        )
    ).scalar_one_or_none()

    if attempt is None:
        raise ApiError("unknown_payment", "To'lov topilmadi.", status_code=404)

    # Idempotency: if already final, do nothing further.
    if attempt.status in FINAL_PAYMENT_STATUSES:
        record_event(
            db,
            "payment_event_duplicate",
            {"provider_ref": attempt.provider_ref, "status": attempt.status},
            user_id=attempt.user_id,
        )
        db.commit()
        return attempt

    status = event.status
    attempt.status = status

    subscription = db.get(Subscription, attempt.subscription_id) if attempt.subscription_id else None
    plan = db.get(Plan, attempt.plan_id)

    if status == "succeeded":
        if subscription is not None and plan is not None:
            activate(subscription, plan)
        create_invoice(
            db,
            user_id=attempt.user_id,
            subscription_id=attempt.subscription_id,
            description=f"{plan.name if plan else 'Tarif'} obunasi",
            amount_cents=attempt.amount_cents or 0,
            currency=attempt.currency or "UZS",
            source_event_id=f"{event.provider}:{event.provider_ref}",
            paid=True,
        )
        record_event(
            db,
            "payment_succeeded",
            {"provider_ref": event.provider_ref, "plan_id": attempt.plan_id},
            user_id=attempt.user_id,
        )
    elif status == "failed":
        if subscription is not None:
            transition(subscription, STATUS_PAYMENT_FAILED)
        create_invoice(
            db,
            user_id=attempt.user_id,
            subscription_id=attempt.subscription_id,
            description=f"{plan.name if plan else 'Tarif'} obunasi (muvaffaqiyatsiz)",
            amount_cents=attempt.amount_cents or 0,
            currency=attempt.currency or "UZS",
            source_event_id=f"{event.provider}:{event.provider_ref}",
            paid=False,
        )
        record_event(
            db,
            "payment_failed",
            {"provider_ref": event.provider_ref},
            user_id=attempt.user_id,
        )
    elif status == "cancelled":
        if subscription is not None:
            transition(subscription, STATUS_CANCELLED)
        record_event(
            db,
            "payment_cancelled",
            {"provider_ref": event.provider_ref},
            user_id=attempt.user_id,
        )
    else:  # pending
        record_event(
            db,
            "payment_pending",
            {"provider_ref": event.provider_ref},
            user_id=attempt.user_id,
        )

    db.commit()
    return attempt


def expire_due_subscriptions(db: OrmSession) -> int:
    """Mark active subscriptions past their period end as expired."""
    rows = db.execute(select(Subscription).where(Subscription.status == "active")).scalars().all()
    now = utcnow()
    changed = 0
    for subscription in rows:
        end = subscription.current_period_end
        if end is None:
            continue
        if end.tzinfo is None:
            end = end.replace(tzinfo=now.tzinfo)
        if end <= now:
            subscription.status = "expired"
            changed += 1
    db.commit()
    return changed


def user_billing_events(db: OrmSession, user: User) -> list[BillingEvent]:
    return (
        db.execute(
            select(BillingEvent)
            .where(BillingEvent.user_id == user.id)
            .order_by(BillingEvent.created_at.desc())
        )
        .scalars()
        .all()
    )


def user_invoices(db: OrmSession, user: User) -> list[Invoice]:
    return (
        db.execute(
            select(Invoice).where(Invoice.user_id == user.id).order_by(Invoice.issued_at.desc())
        )
        .scalars()
        .all()
    )


def period_end_preview(days: int | None) -> object:
    return utcnow() + timedelta(days=days or 30)
