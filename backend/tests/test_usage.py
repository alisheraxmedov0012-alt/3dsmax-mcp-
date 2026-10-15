"""W11 usage & cost metering: idempotency, honesty and aggregation."""
from __future__ import annotations

import pytest
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.models import UsageRecord, User
from app.security import utcnow
from app.services import usage as usage_service
from tests.conftest import auth_headers, register


def _user(email: str = "usage@example.com") -> User:
    with SessionLocal() as db:
        from sqlalchemy import select

        row = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if row is None:
            row = User(email=email, password_hash="x", role="user", is_email_verified=True)
            db.add(row)
            db.commit()
            db.refresh(row)
        return row


def _count(db) -> int:
    from sqlalchemy import func, select

    return int(db.execute(select(func.count()).select_from(UsageRecord)).scalar_one())


def test_record_usage_is_idempotent_per_key():
    user = _user()
    with SessionLocal() as db:
        first, created_first = usage_service.record_usage(
            db, user, operation="project.create", idempotency_key="same-key"
        )
        second, created_second = usage_service.record_usage(
            db, user, operation="project.create", idempotency_key="same-key"
        )
        assert created_first is True
        assert created_second is False
        assert first.id == second.id
        assert _count(db) == 1


def test_unknown_cost_is_never_invented():
    user = _user("unknown-cost@example.com")
    with SessionLocal() as db:
        record, _ = usage_service.record_usage(
            db,
            user,
            operation="ai.generate",
            idempotency_key="no-price",
            cost_kind=usage_service.COST_UNKNOWN,
            cost_micros=123,
            currency="USD",
        )
        # A cost with an "unknown" trust level is dropped, not stored.
        assert record.cost_kind == "unknown"
        assert record.cost_micros is None
        assert record.currency is None


def test_actual_and_estimated_costs_are_kept_distinct():
    user = _user("cost-kinds@example.com")
    with SessionLocal() as db:
        usage_service.record_usage(
            db, user, operation="export", idempotency_key="a1",
            cost_kind=usage_service.COST_ACTUAL, cost_micros=1000, currency="UZS",
        )
        usage_service.record_usage(
            db, user, operation="export", idempotency_key="a2",
            cost_kind=usage_service.COST_ESTIMATED, cost_micros=500, currency="UZS",
        )
        summary = {row["operation"]: row for row in usage_service.usage_summary(db, user)}
        assert summary["export"]["actual"] == 1
        assert summary["export"]["estimated"] == 1
        assert summary["export"]["unknown"] == 0


def test_database_unique_constraint_blocks_parallel_duplicate():
    """The unique constraint is the final guard against a doubled count."""
    user = _user("parallel@example.com")
    with SessionLocal() as db:
        db.add(
            UsageRecord(
                user_id=user.id,
                operation="export",
                idempotency_key="race-key",
                cost_kind="unknown",
                created_at=utcnow(),
            )
        )
        db.commit()
        db.add(
            UsageRecord(
                user_id=user.id,
                operation="export",
                idempotency_key="race-key",
                cost_kind="unknown",
                created_at=utcnow(),
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()


def test_provider_tokens_are_stored_only_when_reported():
    user = _user("tokens@example.com")
    with SessionLocal() as db:
        with_tokens, _ = usage_service.record_from_job(
            db,
            user,
            job_id="job-1",
            operation="ai.generate",
            duration_ms=120,
            result={"usage": {"prompt_tokens": 10, "completion_tokens": 5}},
        )
        assert with_tokens.prompt_tokens == 10
        assert with_tokens.completion_tokens == 5
        assert with_tokens.total_tokens == 15

        without_tokens, _ = usage_service.record_from_job(
            db,
            user,
            job_id="job-2",
            operation="ai.generate",
            duration_ms=80,
            result={},
        )
        assert without_tokens.total_tokens is None


def test_creating_a_project_records_usage(client):
    register(client, "proj-usage@example.com")
    headers = auth_headers(client, "proj-usage@example.com")
    created = client.post(
        "/api/projects", headers=headers, json={"name": "U", "scene": {}}
    )
    assert created.status_code == 201
    summary = client.get("/api/usage/summary", headers=headers).json()
    ops = {row["operation"] for row in summary}
    assert "project.create" in ops


def test_uploading_a_file_records_byte_usage(client):
    register(client, "file-usage@example.com")
    headers = auth_headers(client, "file-usage@example.com")
    uploaded = client.post(
        "/api/files",
        headers=headers,
        files={"file": ("a.png", b"\x89PNG1234", "image/png")},
    )
    assert uploaded.status_code == 201
    records = client.get("/api/usage/records", headers=headers).json()
    uploads = [row for row in records if row["operation"] == "file.upload"]
    assert uploads and uploads[0]["unit"] == "bytes"
    assert uploads[0]["quantity"] == 8


def test_usage_endpoints_require_auth(client):
    assert client.get("/api/usage/summary").status_code == 401
    assert client.get("/api/usage/records").status_code == 401
