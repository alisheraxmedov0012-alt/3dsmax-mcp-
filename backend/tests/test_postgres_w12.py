"""W12 PostgreSQL integration tests for the W10/W11 records.

W10/W11 behaviour was validated on SQLite; PostgreSQL can differ in ways that
matter for production (transactional DDL, ``timestamptz`` handling, ``JSON``
columns, unique constraints under real concurrency). These tests run only when
``APP_TEST_POSTGRES_URL`` points at a throwaway PostgreSQL database, so the
default suite stays on SQLite and CI can opt in where a server exists::

    APP_TEST_POSTGRES_URL=postgresql+psycopg://studio:pw@127.0.0.1:5432/studio_test \
        python -m pytest tests/test_postgres_w12.py

They must never run against a production database.
"""
from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

PG_URL = os.environ.get("APP_TEST_POSTGRES_URL")

pytestmark = pytest.mark.skipif(
    not PG_URL, reason="APP_TEST_POSTGRES_URL o'rnatilmagan (PostgreSQL mavjud emas)"
)


@pytest.fixture(scope="module")
def pg_engine():
    engine = create_engine(PG_URL, pool_pre_ping=True, future=True)
    from app.database import Base
    from app.models import (  # noqa: F401
        BillingEvent,
        Invoice,
        Job,
        OneTimeToken,
        PaymentAttempt,
        Plan,
        Project,
        Session,
        StoredFile,
        Subscription,
        UsageCounter,
        UsageRecord,
        User,
        WorkerHeartbeat,
    )

    # Rebuild a clean schema (drop first so the W11 tables are present).
    Base.metadata.drop_all(bind=engine)
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


def _user(db, email: str) -> object:
    from app.models import User

    user = User(email=email, password_hash="x", role="user", is_email_verified=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# --- usage ledger ------------------------------------------------------------


def test_usage_idempotency_enforced_by_unique_constraint(pg_session):
    from app.models import UsageRecord

    user = _user(pg_session, "pg-usage-idem@example.com")

    pg_session.add(
        UsageRecord(
            user_id=user.id,
            operation="job.run",
            idempotency_key="pg-usage-1",
            cost_kind="unknown",
            created_at=datetime.now(UTC),
        )
    )
    pg_session.commit()

    pg_session.add(
        UsageRecord(
            user_id=user.id,
            operation="job.run",
            idempotency_key="pg-usage-1",
            cost_kind="unknown",
            created_at=datetime.now(UTC),
        )
    )
    with pytest.raises(IntegrityError):
        pg_session.commit()
    pg_session.rollback()


def test_usage_record_json_and_timestamptz_round_trip(pg_session):
    from app.models import UsageRecord

    user = _user(pg_session, "pg-usage-json@example.com")
    meta = {"kind": "ai_generate", "nested": {"n": 1}}
    record = UsageRecord(
        user_id=user.id,
        operation="ai.generate",
        idempotency_key="pg-json-1",
        cost_kind="unknown",
        meta=meta,
        created_at=datetime.now(UTC),
    )
    pg_session.add(record)
    pg_session.commit()
    pg_session.refresh(record)

    assert record.meta == meta
    # PostgreSQL returns a timezone-aware timestamp.
    assert record.created_at.tzinfo is not None


def test_usage_record_rejects_other_users_duplicate_key(pg_session):
    """The same key is allowed for a *different* user (scoped per user)."""
    from app.models import UsageRecord

    a = _user(pg_session, "pg-usage-a@example.com")
    b = _user(pg_session, "pg-usage-b@example.com")
    pg_session.add_all(
        [
            UsageRecord(
                user_id=a.id, operation="export", idempotency_key="shared-key",
                cost_kind="unknown", created_at=datetime.now(UTC),
            ),
            UsageRecord(
                user_id=b.id, operation="export", idempotency_key="shared-key",
                cost_kind="unknown", created_at=datetime.now(UTC),
            ),
        ]
    )
    pg_session.commit()  # no error: the key is unique per user, not globally


# --- job state, recovery and versioning --------------------------------------


def test_job_state_and_stale_recovery_on_postgres(pg_session):
    from app.models import Job
    from app.services import jobs as jobs_service

    user = _user(pg_session, "pg-job-stale@example.com")
    stale = Job(
        user_id=user.id,
        kind="render",
        status=jobs_service.STATUS_RUNNING,
        idempotency_key="pg-stale-1",
        payload={},
        attempts=1,
        max_attempts=3,
        timeout_seconds=10,
        started_at=datetime.now(UTC) - timedelta(seconds=120),
    )
    pg_session.add(stale)
    pg_session.commit()

    recovered = jobs_service.recover_stale_jobs(pg_session)
    assert recovered == 1
    pg_session.refresh(stale)
    assert stale.status == jobs_service.STATUS_FAILED
    assert stale.retryable is True

    # Idempotent: a second call must not "recover" it again.
    assert jobs_service.recover_stale_jobs(pg_session) == 0


def test_job_idempotency_key_unique_per_user(pg_session):
    from app.models import Job

    user = _user(pg_session, "pg-job-idem@example.com")
    pg_session.add(
        Job(
            user_id=user.id, kind="noop", status="queued", idempotency_key="pg-job-key",
            payload={}, attempts=0, max_attempts=3, timeout_seconds=300,
        )
    )
    pg_session.commit()

    pg_session.add(
        Job(
            user_id=user.id, kind="noop", status="queued", idempotency_key="pg-job-key",
            payload={}, attempts=0, max_attempts=3, timeout_seconds=300,
        )
    )
    with pytest.raises(IntegrityError):
        pg_session.commit()
    pg_session.rollback()


def test_project_optimistic_versioning_on_postgres(pg_session):
    from app.models import Project

    user = _user(pg_session, "pg-proj-version@example.com")
    project = Project(
        user_id=user.id,
        client_id="pg-server-1",
        name="V",
        scene={},
        version=1,
        schema_version=1,
    )
    pg_session.add(project)
    pg_session.commit()

    project.version = 2
    pg_session.commit()
    pg_session.refresh(project)
    assert project.version == 2

    # Unique (user_id, client_id) is a real constraint on PostgreSQL.
    pg_session.add(
        Project(
            user_id=user.id, client_id="pg-server-1", name="dup", scene={},
            version=1, schema_version=1,
        )
    )
    with pytest.raises(IntegrityError):
        pg_session.commit()
    pg_session.rollback()


def test_worker_heartbeat_upsert_on_postgres(pg_session):
    from app.services.heartbeat import latest_heartbeat, write_heartbeat

    write_heartbeat(pg_session, "pg-worker-1", meta={"kind": "startup"})
    write_heartbeat(pg_session, "pg-worker-1", meta={"kind": "beat"})

    latest = latest_heartbeat(pg_session)
    assert latest is not None
    assert latest.worker_id == "pg-worker-1"
    assert latest.meta == {"kind": "beat"}


def test_foreign_key_cascade_on_user_delete(pg_session):
    """Deleting a user cascades to their projects/jobs/usage (FK behaviour)."""
    from sqlalchemy import delete, func

    from app.models import Job, Project, UsageRecord, User

    user = _user(pg_session, "pg-cascade@example.com")
    pg_session.add_all(
        [
            Project(user_id=user.id, client_id="pg-c1", name="p", scene={}, version=1, schema_version=1),
            Job(
                user_id=user.id, kind="noop", status="queued", idempotency_key="pg-c1",
                payload={}, attempts=0, max_attempts=3, timeout_seconds=300,
            ),
            UsageRecord(
                user_id=user.id, operation="job.run", idempotency_key="pg-c1",
                cost_kind="unknown", created_at=datetime.now(UTC),
            ),
        ]
    )
    pg_session.commit()
    user_id = user.id

    pg_session.execute(delete(User).where(User.id == user_id))
    pg_session.commit()

    # Every child row for this user is gone (DB-level ON DELETE CASCADE).
    for model in (Project, Job, UsageRecord):
        remaining = pg_session.execute(
            select(func.count()).select_from(model).where(model.user_id == user_id)
        ).scalar_one()
        assert remaining == 0


def test_transaction_rollback_leaves_no_partial_job(pg_session):
    from sqlalchemy import func

    from app.models import Job

    user = _user(pg_session, "pg-rollback-job@example.com")
    before = pg_session.execute(select(func.count()).select_from(Job)).scalar_one()

    try:
        pg_session.add(
            Job(
                user_id=user.id, kind="noop", status="queued", idempotency_key="pg-rb",
                payload={}, attempts=0, max_attempts=3, timeout_seconds=300,
            )
        )
        pg_session.flush()
        raise RuntimeError("simulated failure mid-transaction")
    except RuntimeError:
        pg_session.rollback()

    after = pg_session.execute(select(func.count()).select_from(Job)).scalar_one()
    assert after == before


def test_w11_tables_exist_after_schema_creation(pg_engine):
    with pg_engine.connect() as connection:
        # W11 tables are present and queryable on PostgreSQL.
        assert connection.execute(text("SELECT count(*) FROM usage_records")).scalar_one() >= 0
        assert (
            connection.execute(text("SELECT count(*) FROM worker_heartbeats")).scalar_one() >= 0
        )
        # The tables exist in the schema (works whether created by metadata here or
        # by an Alembic migration; the migration path itself is exercised by the CI
        # `alembic upgrade/downgrade` step and the local PostgreSQL run).
        names = {
            row[0]
            for row in connection.execute(
                text(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = 'public'"
                )
            )
        }
        assert {"usage_records", "worker_heartbeats", "jobs", "projects"} <= names
