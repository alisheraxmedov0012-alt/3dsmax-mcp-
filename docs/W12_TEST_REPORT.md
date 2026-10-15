# W12 test report

Environment: Debian, Python 3.13.15, Node 24 / npm 11, **PostgreSQL 17.11**
(installed locally for this stage), SQLite for the default suite. All commands run
from a clean checkout of `w12-production-readiness`.

## Frontend

| Command | Result |
|---|---|
| `npm test` | **409 passed** (42 files) |
| `npx oxlint src --deny-warnings` | clean (exit 0) |
| `npm run typecheck` | clean |
| `npm run build` | success (one pre-existing chunk-size warning for the Three.js bundle) |
| `npm audit --audit-level=high` | **0 vulnerabilities** |

## Backend — SQLite (default suite)

| Command | Result |
|---|---|
| `python -m ruff check app tests` | All checks passed |
| `python -m pytest` | **149 passed, 14 skipped** |
| `python -m pip_audit` | No known vulnerabilities found |
| config import (`from app.main import app`) | OK |

The 14 skips are the PostgreSQL-only integration tests (no DSN in this
configuration) plus the SQLite migration test that is run explicitly below.

## Backend — PostgreSQL (real server)

PostgreSQL 17.11 was installed and started locally; a throwaway database
`studio_test` was created. **No production database was touched.**

| Command | Result |
|---|---|
| `alembic upgrade head` / `downgrade base` / `upgrade head` | success (transactional DDL) |
| `alembic current` after upgrade | `c3a7e1d5f9b2 (head)` |
| full suite, `APP_DATABASE_URL` = PostgreSQL | **163 passed** |
| full suite, SQLite app DB + `APP_TEST_POSTGRES_URL` set | **163 passed** |

### PostgreSQL-only integration tests (`tests/test_postgres*.py`, 14 tests)

Verified on the real server:

- unique-constraint idempotency (payment events, invoices, usage records, job keys,
  project `(user_id, client_id)`);
- foreign-key `ON DELETE CASCADE` from users to projects/jobs/usage;
- transaction rollback leaves no partial rows;
- `timestamptz` and `JSON` column round-trips;
- stale `running` job recovery (and its idempotency);
- worker-heartbeat upsert;
- the W11 tables exist and are queryable.

## Cross-engine finding

Running the suite on real PostgreSQL surfaced a difference SQLite had hidden:
SQLite does not enforce foreign keys unless asked, so an FK violation on
`usage_records.job_id` passed on SQLite but is rejected by PostgreSQL. Fixed by
enabling `PRAGMA foreign_keys=ON` for SQLite and adding the PostgreSQL CI job
(see `docs/SECURITY_AUDIT.md`, finding W12-4).

## Migrations

`upgrade head → downgrade base → upgrade head` verified on **SQLite** and on
**PostgreSQL**. Expected tables (including the W10/W11 tables `jobs`,
`stored_files`, `usage_records`, `worker_heartbeats`) are created; `downgrade`
removes them cleanly.

## CI

`.github/workflows/ci.yml` runs three jobs: `frontend` (lint/typecheck/test/build/
audit), `backend` (ruff/pip-audit/config import/migrations/tests on SQLite) and
`postgres` (migrations + full suite against an ephemeral `postgres:16` service,
with the PostgreSQL-only tests enabled). CI status is recorded on the pull request.

## Not covered by automated tests

- Manual browser and mobile (device) testing — **NOT TESTED** in this stage.
- Real external services (AI provider, real payments, S3/R2, SMTP, monitoring) —
  **BLOCKED**, none configured.
- A live backup + restore drill against provisioned infrastructure — **NOT TESTED**.
