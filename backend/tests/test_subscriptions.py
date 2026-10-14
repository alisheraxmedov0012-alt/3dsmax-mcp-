"""Subscription state machine and expiry."""
from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import select

from app.database import SessionLocal
from app.errors import ApiError
from app.models import Plan, Subscription, User
from app.security import utcnow
from app.services.billing import expire_due_subscriptions
from app.services.subscriptions import (
    STATUS_ACTIVE,
    STATUS_CANCELLED,
    STATUS_EXPIRED,
    STATUS_PAYMENT_FAILED,
    STATUS_PENDING,
    activate,
    create_pending_subscription,
    transition,
)


def _user_and_plan(db, email: str = "state@example.com"):
    from app.security import hash_password

    user = User(email=email, password_hash=hash_password("Sup3rSecret!"), role="user")
    db.add(user)
    db.flush()
    plan = db.execute(select(Plan).where(Plan.key == "pro")).scalar_one()
    return user, plan


def test_pending_to_active_is_allowed():
    with SessionLocal() as db:
        user, plan = _user_and_plan(db)
        subscription = create_pending_subscription(db, user, plan)
        assert subscription.status == STATUS_PENDING

        activate(subscription, plan)
        assert subscription.status == STATUS_ACTIVE
        assert subscription.current_period_end is not None
        db.rollback()


def test_cancelled_is_terminal():
    with SessionLocal() as db:
        user, plan = _user_and_plan(db, "terminal@example.com")
        subscription = create_pending_subscription(db, user, plan)
        activate(subscription, plan)
        transition(subscription, STATUS_CANCELLED)

        with pytest.raises(ApiError) as excinfo:
            transition(subscription, STATUS_ACTIVE)
        assert excinfo.value.code == "invalid_transition"
        db.rollback()


def test_expired_can_be_reactivated():
    with SessionLocal() as db:
        user, plan = _user_and_plan(db, "renew@example.com")
        subscription = create_pending_subscription(db, user, plan)
        activate(subscription, plan)
        transition(subscription, STATUS_EXPIRED)
        activate(subscription, plan)
        assert subscription.status == STATUS_ACTIVE
        db.rollback()


def test_failed_payment_blocks_entitlement(client):
    from tests.conftest import auth_headers, register

    register(client, "blocked@example.com")
    headers = auth_headers(client, "blocked@example.com")
    checkout = client.post("/api/billing/checkout", headers=headers, json={"plan_key": "pro"}).json()
    client.post(
        "/api/billing/sandbox/confirm",
        headers=headers,
        json={"payment_id": checkout["payment_id"], "outcome": "failed"},
    )

    with SessionLocal() as db:
        user = db.execute(
            select(User).where(User.email == "blocked@example.com")
        ).scalar_one()
        pro = db.execute(select(Plan).where(Plan.key == "pro")).scalar_one()
        subscription = db.execute(
            select(Subscription).where(
                Subscription.user_id == user.id, Subscription.plan_id == pro.id
            )
        ).scalars().first()
        assert subscription is not None
        assert subscription.status == STATUS_PAYMENT_FAILED


def test_expire_due_subscriptions():
    with SessionLocal() as db:
        user, plan = _user_and_plan(db, "expire@example.com")
        subscription = create_pending_subscription(db, user, plan)
        activate(subscription, plan)
        # Force the period into the past.
        subscription.current_period_end = utcnow() - timedelta(days=1)
        db.commit()

        changed = expire_due_subscriptions(db)
        assert changed >= 1

        refreshed = db.get(Subscription, subscription.id)
        assert refreshed is not None
        assert refreshed.status == STATUS_EXPIRED
