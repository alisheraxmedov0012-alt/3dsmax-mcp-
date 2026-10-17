"""W11 reliability: usage ledger, worker heartbeat, job retryability

Adds the durable records for the W11 reliability/cost stage:

* ``usage_records`` — append-only per-operation usage/cost ledger, unique per
  ``(user_id, idempotency_key)`` so a retried or concurrent request counts once,
* ``worker_heartbeats`` — periodic worker liveness markers used by readiness,
* ``jobs.retryable`` — whether the last failure is worth retrying.

Revision ID: c3a7e1d5f9b2
Revises: b2f1c4a9d3e7
Create Date: 2026-10-14 18:40:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "c3a7e1d5f9b2"
down_revision: Union[str, None] = "b2f1c4a9d3e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("jobs") as batch:
        batch.add_column(sa.Column("retryable", sa.Boolean(), nullable=True))

    op.create_table(
        "usage_records",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=True),
        sa.Column("job_id", sa.String(length=36), nullable=True),
        sa.Column("operation", sa.String(length=60), nullable=False),
        sa.Column("idempotency_key", sa.String(length=160), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("unit", sa.String(length=20), nullable=False, server_default="request"),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("cost_kind", sa.String(length=12), nullable=False, server_default="unknown"),
        sa.Column("cost_micros", sa.Integer(), nullable=True),
        sa.Column("currency", sa.String(length=8), nullable=True),
        sa.Column("provider", sa.String(length=40), nullable=True),
        sa.Column("model", sa.String(length=80), nullable=True),
        sa.Column("prompt_tokens", sa.Integer(), nullable=True),
        sa.Column("completion_tokens", sa.Integer(), nullable=True),
        sa.Column("total_tokens", sa.Integer(), nullable=True),
        sa.Column("meta", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["job_id"], ["jobs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "idempotency_key", name="uq_user_usage_key"),
    )
    op.create_index("ix_usage_records_user_id", "usage_records", ["user_id"])
    op.create_index("ix_usage_records_project_id", "usage_records", ["project_id"])
    op.create_index("ix_usage_records_job_id", "usage_records", ["job_id"])

    op.create_table(
        "worker_heartbeats",
        sa.Column("worker_id", sa.String(length=120), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("meta", sa.JSON(), nullable=False),
        sa.PrimaryKeyConstraint("worker_id"),
    )


def downgrade() -> None:
    op.drop_table("worker_heartbeats")
    op.drop_index("ix_usage_records_job_id", table_name="usage_records")
    op.drop_index("ix_usage_records_project_id", table_name="usage_records")
    op.drop_index("ix_usage_records_user_id", table_name="usage_records")
    op.drop_table("usage_records")
    with op.batch_alter_table("jobs") as batch:
        batch.drop_column("retryable")
