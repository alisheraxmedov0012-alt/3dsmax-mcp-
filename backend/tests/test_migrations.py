"""Migrations run and produce the expected schema.

Run against SQLite here. PostgreSQL-specific migration behaviour is NOT verified
in this environment (documented limitation).
"""
from __future__ import annotations

import os
import sqlite3
import subprocess
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

EXPECTED_TABLES = {
    "users",
    "sessions",
    "one_time_tokens",
    "plans",
    "subscriptions",
    "payment_attempts",
    "invoices",
    "billing_events",
    "projects",
    "usage_counters",
}


def _run_alembic(args: list[str], db_url: str) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["APP_DATABASE_URL"] = db_url
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )


def test_migrations_upgrade_and_downgrade(tmp_path):
    db_path = tmp_path / "migrate.db"
    db_url = f"sqlite:///{db_path}"

    upgrade = _run_alembic(["upgrade", "head"], db_url)
    assert upgrade.returncode == 0, upgrade.stderr

    connection = sqlite3.connect(db_path)
    try:
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
    finally:
        connection.close()

    assert EXPECTED_TABLES.issubset(tables)

    downgrade = _run_alembic(["downgrade", "base"], db_url)
    assert downgrade.returncode == 0, downgrade.stderr
