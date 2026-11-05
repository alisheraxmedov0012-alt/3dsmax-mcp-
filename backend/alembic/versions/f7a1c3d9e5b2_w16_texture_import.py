"""Phase 4.3A: texture metadata on stored files.

Adds the columns required to treat a stored artifact as a validated texture and
to deduplicate identical uploads per user. Existing generic file rows keep
``kind='file'`` and null texture metadata, so the W10 file API is unchanged.

Revision ID: f7a1c3d9e5b2
Revises: d4b8f2a6c1e9
Create Date: 2026-11-04 18:00:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f7a1c3d9e5b2"
down_revision: Union[str, None] = "d4b8f2a6c1e9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "stored_files",
        sa.Column("kind", sa.String(length=20), nullable=False, server_default="file"),
    )
    op.add_column("stored_files", sa.Column("width", sa.Integer(), nullable=True))
    op.add_column("stored_files", sa.Column("height", sa.Integer(), nullable=True))
    op.add_column("stored_files", sa.Column("content_hash", sa.String(length=80), nullable=True))

    op.create_index("ix_stored_files_user_kind", "stored_files", ["user_id", "kind"])
    op.create_index(
        "uq_stored_files_user_hash",
        "stored_files",
        ["user_id", "content_hash"],
        unique=True,
        sqlite_where=sa.text("content_hash IS NOT NULL"),
        postgresql_where=sa.text("content_hash IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_stored_files_user_hash", table_name="stored_files")
    op.drop_index("ix_stored_files_user_kind", table_name="stored_files")
    with op.batch_alter_table("stored_files") as batch:
        batch.drop_column("content_hash")
        batch.drop_column("height")
        batch.drop_column("width")
        batch.drop_column("kind")
