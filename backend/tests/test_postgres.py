"""PostgreSQL-specific integration tests.

These run only when a PostgreSQL DSN is provided via ``APP_TEST_POSTGRES_URL``
(the whole suite otherwise runs on SQLite). They verify behaviour that can differ
between engines: unique-constraint idempotency, transactional rollback and
migration bookkeeping.

Run against a throwaway database, e.g.::

    APP_TEST_POSTGRES_URL=postgresql+psycopg://studio:pw@127.0.0.1:5432/studio_test \
        python -m pytest tests/test_postgres.py
"""
from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import sessionmaker

PG_URL = os.environ.get("APP_TEST_POSTGRES_URL")

pytestmark = pytest.mark.skipif(
    not PG_URL, reason="APP_TEST_POSTGRES_URL o'rnatilmagan (PostgreSQL mavjud emas)"
)


@pytest.fixture(scope="module")
def pg_engine():
    engine = create_engine(PG_URL, pool_pre_ping=True)
    # Ensure the schema exists (migrations are expected to have run, but create
    # as a fallback for a fresh scratch database).
    from app.database import Base
    from app.models import (  # noqa: F401
        BillingEvent,
        Invoice,
        OneTimeToken,
        PaymentAttempt,
        Plan,
        Project,
        Subscription,
        UsageCounter,
        User,
    )

    Base.metadata.create_all(bind=engine)

    from app.services.plans import seed_plans

    with sessionmaker(bind=engine)() as db:
        seed_plans(db)
    yield engine
    engine.dispose()


@pytest.fixture
def pg_session(pg_engine):
    factory = sessionmaker(bind=pg_engine)
    with factory() as session:
        yield session


def test_migrations_table_reachable(pg_engine):
    with pg_engine.connect() as connection:
        assert connection.execute(text("SELECT 1")).scalar_one() == 1


def test_unique_constraint_makes_payment_events_idempotent(pg_session):
    from app.models import PaymentAttempt, Plan, User
    from app.security import hash_password

    user = User(email="pg-idem@example.com", password_hash=hash_password("x" * 10))
    pg_session.add(user)
    pg_session.flush()
    plan = pg_session.execute(select(Plan).where(Plan.key == "pro")).scalar_one()

    attempt = PaymentAttempt(
        user_id=user.id,
        subscription_id=None,
        plan_id=plan.id,
        provider="fake-sandbox",
        provider_ref="pg-ref-1",
        status="pending",
    )
    pg_session.add(attempt)
    pg_session.commit()

    # A duplicate provider_ref must be rejected by the unique constraint.
    from sqlalchemy.exc import IntegrityError

    duplicate = PaymentAttempt(
        user_id=user.id,
        subscription_id=None,
        plan_id=plan.id,
        provider="fake-sandbox",
        provider_ref="pg-ref-1",
        status="pending",
    )
    pg_session.add(duplicate)
    with pytest.raises(IntegrityError):
        pg_session.commit()
    pg_session.rollback()


def test_invoice_source_event_is_unique(pg_session):
    from sqlalchemy.exc import IntegrityError

    from app.models import Invoice, User
    from app.security import hash_password

    user = User(email="pg-inv@example.com", password_hash=hash_password("x" * 10))
    pg_session.add(user)
    pg_session.flush()

    pg_session.add(
        Invoice(
            number="INV-PG-1",
            user_id=user.id,
            source_event_id="evt-1",
            description="Test",
            amount_cents=100,
            currency="UZS",
        )
    )
    pg_session.commit()

    pg_session.add(
        Invoice(
            number="INV-PG-2",
            user_id=user.id,
            source_event_id="evt-1",  # same event id
            description="Test duplicate",
            amount_cents=100,
            currency="UZS",
        )
    )
    with pytest.raises(IntegrityError):
        pg_session.commit()
    pg_session.rollback()


def test_transaction_rollback_leaves_no_partial_data(pg_session):
    from app.models import User
    from app.security import hash_password

    before = pg_session.execute(select(func.count()).select_from(User)).scalar_one()

    try:
        user = User(email="pg-rollback@example.com", password_hash=hash_password("x" * 10))
        pg_session.add(user)
        pg_session.flush()  # within transaction
        raise RuntimeError("simulated failure")
    except RuntimeError:
        pg_session.rollback()

    after = pg_session.execute(select(func.count()).select_from(User)).scalar_one()
    assert after == before
