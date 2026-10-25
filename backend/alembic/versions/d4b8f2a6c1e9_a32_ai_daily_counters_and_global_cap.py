"""A3.2 guardrails: daily AI counters and a system-wide AI ceiling

Two changes, both about bounding what an AI request may cost.

1. ``usage_counters`` gains a ``period`` column and its uniqueness moves from
   ``(user_id, metric)`` to ``(user_id, metric, period)``. An empty period keeps
   the old meaning — a lifetime total, which is what the project, export and
   render counters have always been. A ``YYYY-MM-DD`` period scopes the count to
   one UTC day, which is what the AI quota needs: a limit of 20 that never
   refills is a lifetime allowance, not a rate limit.

2. ``global_usage_counters`` is a new system-wide counter. It exists because the
   plan limits are per user and were all left unset (``None`` means "not
   configured"), so nothing bounded total provider spend. This row lives in the
   database so it survives a restart and is shared by every backend replica.

The migration also backfills the AI allowance for plans that already exist:
``seed_plans`` only inserts missing plans, so an existing database would keep its
stored ``None`` and the new default would never reach it.

Revision ID: d4b8f2a6c1e9
Revises: c3a7e1d5f9b2
Create Date: 2026-10-25 10:00:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "d4b8f2a6c1e9"
down_revision: Union[str, None] = "c3a7e1d5f9b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

#: AI allowance per UTC day written into plans that do not have one yet.
FREE_AI_REQUESTS_PER_DAY = 20
PRO_AI_REQUESTS_PER_DAY = 100


def upgrade() -> None:
    # --- 1. period on the per-user counter -------------------------------
    with op.batch_alter_table("usage_counters") as batch:
        batch.add_column(
            sa.Column("period", sa.String(length=10), nullable=False, server_default="")
        )
        batch.drop_constraint("uq_user_metric", type_="unique")
        batch.create_unique_constraint(
            "uq_user_metric_period", ["user_id", "metric", "period"]
        )

    # --- 2. system-wide counter -----------------------------------------
    op.create_table(
        "global_usage_counters",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("metric", sa.String(length=40), nullable=False),
        sa.Column("period", sa.String(length=10), nullable=False, server_default=""),
        sa.Column("count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("metric", "period", name="uq_global_metric_period"),
    )

    # --- 3. backfill the AI allowance on existing plans -----------------
    # Done in Python rather than SQL so the JSON handling is identical on
    # PostgreSQL and SQLite.
    plans = sa.table(
        "plans",
        sa.column("key", sa.String),
        sa.column("limits", sa.JSON),
    )
    connection = op.get_bind()
    rows = connection.execute(sa.select(plans.c.key, plans.c.limits)).all()
    for key, limits in rows:
        defaults = {"free": FREE_AI_REQUESTS_PER_DAY, "pro": PRO_AI_REQUESTS_PER_DAY}
        if key not in defaults:
            continue
        current = dict(limits or {})
        if current.get("max_ai_requests") is not None:
            # An operator already set a number: never overwrite it.
            continue
        current["max_ai_requests"] = defaults[key]
        connection.execute(
            sa.update(plans).where(plans.c.key == key).values(limits=current)
        )


def downgrade() -> None:
    op.drop_table("global_usage_counters")
    with op.batch_alter_table("usage_counters") as batch:
        batch.drop_constraint("uq_user_metric_period", type_="unique")
        batch.create_unique_constraint("uq_user_metric", ["user_id", "metric"])
        batch.drop_column("period")
