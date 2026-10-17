# Deployment guide (W12)

> Status: **preparation only.** No production deployment has been performed. This
> guide describes what exists in the repository today and what an operator must
> provide. It does **not** claim any external service is configured or running,
> and nothing here deploys automatically.

This document is organised into the twelve areas a release depends on. Where a
capability does not exist yet it is called out explicitly under
["Not yet integrated"](#12-not-yet-integrated).

---

## 1. Architecture

Three deployable pieces, each independently scalable:

| Component | What it is | Where it lives |
|---|---|---|
| **Frontend** | React + TypeScript single-page app (Vite), renders the browser 3D viewer via Three.js. Presentation only — it decides nothing about plans, limits or entitlements. | Static build output (`npm run build` → `dist/`). |
| **Backend API** | FastAPI + SQLAlchemy + Alembic. Auth, projects, jobs, files, usage, billing, health. | `backend/` (`backend/Dockerfile`, uvicorn). |
| **Worker** | Separate process that consumes the job queue (`python -m app.worker`). | Same backend image, different command. |

Data stores: **PostgreSQL** (system of record, production) and a **storage backend**
for uploaded artifacts (`local` disk today; `s3`/R2 is a documented, unimplemented
boundary). **Redis** is optional and only used for shared rate limiting.

Flow: `Frontend → Backend API → (job queue) → Worker`, with PostgreSQL and the
storage backend behind the API and worker.

Local development stack (PostgreSQL + Redis + backend + frontend) is in
`docker-compose.yml`; all its values are local placeholders and must never be
reused in production.

---

## 2. Required runtime and configuration

- **Backend / worker**: Python 3.12+ (image uses `python:3.13-slim`), one image for
  both (worker runs a different command).
- **Frontend**: Node 20+ to build; the runtime is any static file host/CDN.
- **PostgreSQL**: 14+ (16 in local compose). No other database is supported in
  production.
- **Reverse proxy / TLS**: required in front of the API. Only enable
  `APP_TRUST_FORWARDED_FOR` when the proxy is trusted (see §7).

The backend image runs as a non-root user (`appuser`, uid 10001), exposes port
8000, declares a healthcheck against `/api/health`, and uses `SIGTERM` for graceful
shutdown (uvicorn drains for up to 20s).

---

## 3. Environment variables

Full annotated list: [`backend/.env.example`](../backend/.env.example). Nothing
secret is stored in the repository; production values come from the platform's
secret manager.

**Mandatory in production** (startup is refused if any is wrong — see
`Settings.production_problems`):

| Variable | Requirement |
|---|---|
| `APP_ENVIRONMENT` | `production` |
| `APP_DATABASE_URL` | PostgreSQL DSN (SQLite is rejected) |
| `APP_SECRET_KEY` | strong, ≥ 32 chars, not the default |
| `APP_COOKIE_SECURE` | `true` (HTTPS only) |
| `APP_EXPOSE_DEV_TOKENS` | `false` |
| `APP_DEBUG` | `false` |
| `APP_CORS_ORIGINS` | explicit origin list, never `*` |
| `APP_JOB_BACKEND` | `worker` (not `inline`) |
| `APP_STORAGE_BACKEND` | not `memory`; `s3` is currently rejected as unimplemented |
| `APP_PAYMENT_PROVIDER` | **not** a sandbox name (`fake`); leaving the default is refused |
| `APP_EMAIL_BACKEND` | `smtp` (the `console` adapter is refused in production) |

**Required when the matching feature is enabled**: `APP_REDIS_URL` (if
`APP_RATE_LIMIT_BACKEND=redis`), `APP_PAYMENT_WEBHOOK_SECRET` (if using the
sandbox provider outside production), SMTP settings
(`APP_SMTP_HOST/PORT/USER/PASSWORD`) when `APP_EMAIL_BACKEND=smtp`.

**Optional tuning**: `APP_JOB_MAX_ATTEMPTS`, `APP_JOB_TIMEOUT_SECONDS`,
`APP_JOB_MAX_PARALLEL_PER_USER`, `APP_WORKER_HEARTBEAT_TTL_SECONDS`,
`APP_STORAGE_MAX_BYTES`, `APP_MAX_REQUEST_BYTES`, `APP_RATE_LIMIT_SCOPES`,
`APP_LOG_FORMAT`, `APP_ERROR_TRACKING_DSN`.

`VITE_API_BASE_URL` is a **build-time** frontend variable pointing at the API.

---

## 4. PostgreSQL and migration procedure

Schema is owned by Alembic; the application never creates tables in production.

```bash
# from backend/, with APP_DATABASE_URL pointing at the target database
python -m alembic upgrade head          # apply migrations
python -m alembic current               # confirm the applied revision == head
```

Verified behaviour (see `docs/W12_TEST_REPORT.md`):

- `upgrade head` → `downgrade base` → `upgrade head` succeeds on PostgreSQL 17
  (transactional DDL) and on SQLite.
- Unique constraints, foreign keys (with `ON DELETE CASCADE`/`SET NULL`),
  `timestamptz` and `JSON` columns behave correctly on PostgreSQL
  (`tests/test_postgres*.py`).
- Migrations are **not** run automatically at API startup in production; run them
  as a release step before starting the new version.

Backups and their relation to storage are covered in §7.

---

## 5. Worker: start, stop and observe

The worker is the same image with a different command:

```bash
python -m app.worker            # continuous loop (polls every few seconds)
python -m app.worker --once     # drain currently-queued jobs and exit
```

Run it as its own process (or a second container / systemd unit / platform worker
entrypoint). It:

- on startup, **recovers** jobs a previous crash left `running` (past their timeout)
  and marks them `failed` + retryable;
- writes a periodic **heartbeat** (`worker_heartbeats`) so `/api/health/ready`
  reflects whether a worker is actually alive;
- executes `noop` jobs and **fails every other kind explicitly** (no AI/render
  provider is wired yet) — it never reports a background job as done when nothing
  happened.

Stop it with `SIGTERM`/`SIGINT`; an in-flight job is left `running` and is
recovered by the timeout on the next start (no silent data loss).

Operational actions:
```bash
python -m app.cli recover-stale-jobs    # fail timed-out "running" jobs (safe, idempotent)
```
or, as an authenticated admin, `POST /api/admin/jobs/recover-stale` (CSRF required).

---

## 6. Storage and backup requirements

Storage backends (`APP_STORAGE_BACKEND`):

| Backend | Persistent | Production |
|---|---|---|
| `memory` | no (lost on restart) | refused at startup |
| `local` | yes (single node, `APP_STORAGE_DIR`) | allowed (single-node only) |
| `s3` | — | **not implemented**; selecting it is reported as unconfigured |

Uploaded files are stored under a **server-generated key** (`<user>/<uuid>.<fmt>`);
a user-supplied filename is never used as a path. Access is owner-scoped and
content-type/size are validated server-side.

Backups (`backend/scripts/backup.sh`, `restore.sh`) are **logical** `pg_dump`
custom-format archives. **A file backup is only half of a restore**: uploaded
artifacts live in the storage backend and must be backed up alongside PostgreSQL,
otherwise restored database rows will point at missing bytes. Documented steps:

- Database: `DATABASE_URL=... ./scripts/backup.sh [out_dir]` (writes outside the
  repo; verifies the archive is readable; keeps 14 most recent).
- Storage: snapshot/copy `APP_STORAGE_DIR` (or the bucket) on the same schedule.
- Restore: `TARGET_DATABASE_URL=... ./scripts/restore.sh <dump>` (refuses a DB whose
  name looks like production unless `ALLOW_PROD_RESTORE=yes`), then restore the
  storage snapshot to the matching point in time.

**RPO/RTO are not defined yet.** No recovery-point/recovery-time target has been
agreed, so none is promised here. This is an open item for the release gate.

---

## 7. Health, readiness and operational checks

| Endpoint | Meaning |
|---|---|
| `GET /api/health` | Liveness — process is up. Cheap, no dependencies. |
| `GET /api/health/ready` | Readiness — database reachable, storage usable, and (in `worker` mode) a worker heartbeat is fresh. `503` when not ready. |
| `GET /api/health/metrics` | Process-local counters/histograms. States `process_local: true` and `monitoring_provider: "none"` — it is **not** an external dashboard. |
| `GET /api/admin/diagnostics` | Admin-only production-readiness report (no secret values). |

Use `X-Request-ID` (echoed on every response) and the `job_id` in structured logs
to correlate a request with the work it triggered.

---

## 8. Logs and diagnostics

- Structured **JSON** logs (`APP_LOG_FORMAT=json`) with level, logger, message,
  `request_id`, optional `job_id`, and operational fields.
- A redaction filter strips anything resembling a secret (password, token, CSRF,
  `Bearer`, `api_key`, `dsn`, …) and request bodies are never logged.
- Error responses are generic; stack traces stay server-side.
- Error tracking is optional and only active when `APP_ERROR_TRACKING_DSN` is set;
  otherwise it reports as disabled.

Log retention and the secret-filtering policy are described in
`docs/SECURITY_AUDIT.md` (§ Operations) — no external log sink is connected.

---

## 9. Failure recovery

| Failure | Recovery |
|---|---|
| Worker crash / restart | On start it recovers stale `running` jobs; queued jobs are picked up. |
| API process crash | Stateless; restart it. In-flight requests are lost (client retries). |
| Stuck `running` jobs | Timeout-based `recover-stale-jobs` (CLI) / admin endpoint, or automatic on worker/API startup. |
| Redis (rate-limit store) down | Limiter **fails closed** (503) rather than allowing unlimited attempts. |
| Storage backend unavailable | Uploads/downloads return a clear `503`; nothing is silently lost. |
| PostgreSQL down | Readiness reports `not_ready`; the app returns errors, not corrupted state. |

---

## 10. Rollback plan

1. **Application**: redeploy the previous frontend build and the previous backend
   image tag. The API is stateless, so a rollback is a redeploy.
2. **Database**: Alembic migrations are reversible in this project (`downgrade`).
   Downgrade only as far as the previous release's revision, e.g.
   `python -m alembic downgrade <previous_revision>`. **Take a fresh backup
   immediately before any downgrade.**
3. **Verify** after rollback: `/api/health/ready` is `ready`, the previous version's
   smoke checks pass, and no half-applied migration remains (`alembic current`).
4. Rollback of a **destructive** migration (dropped column/table) cannot restore
   dropped data — the pre-migration database backup is the only recourse. This is
   why the pre-deploy checklist requires a verified backup.

---

## 11. Pre-deployment checklist

See [`docs/RELEASE_GATE.md`](RELEASE_GATE.md) for the authoritative, evidence-based
list and status. In short, before any release an operator must:

- [ ] Provision PostgreSQL and run `alembic upgrade head`; confirm `alembic current`
      equals head.
- [ ] Set every mandatory environment variable (§3); the app refuses to start
      otherwise.
- [ ] Run a worker process and confirm `/api/health/ready` reports it alive.
- [ ] Configure persistent storage and a matching backup schedule for it **and** the
      database; perform and record a restore drill.
- [ ] Configure a real payment provider (sandbox is refused in production) or
      explicitly disable paid plans.
- [ ] Configure SMTP (console adapter is refused in production).
- [ ] Terminate TLS at the proxy; set `APP_COOKIE_SECURE=true`; restrict CORS to the
      real frontend origin.
- [ ] Complete manual browser and mobile testing (not yet done — see the gate).
- [ ] Agree RPO/RTO (currently undefined).

---

## 12. Not yet integrated

These are **not** implemented and must not be presented as working:

- **Real AI / LLM provider** — no adapter is wired; provider-dependent job kinds
  fail honestly. Provider-reported token metrics will only populate once one is
  connected.
- **Real payment provider** — only the sandbox substitute exists; production
  refuses it. Webhook verification logic exists (HMAC) but is exercised only by the
  sandbox adapter.
- **S3 / Cloudflare R2 storage** — a documented boundary; selecting it is reported
  as unconfigured and blocks production startup.
- **External monitoring / alerting / dashboards** — metrics are process-local;
  nothing sends alerts.
- **Email delivery** — the console adapter must be replaced by SMTP in production.
- **Shared rate-limit store** — Redis support exists but is optional; without it,
  limits are per-process (documented limitation for multi-instance deployments).
- **CD/deploy automation** — `.github/workflows/deploy.yml` performs no action until
  deployment secrets exist; it never auto-deploys.
