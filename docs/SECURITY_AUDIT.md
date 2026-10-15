# W12 security audit

> Scope: the code in this repository (backend API, worker, frontend), reviewed by
> reading the source and running the automated checks. **No independent
> penetration test was performed.** Automated tests are not a full security
> guarantee; passing them does not prove the absence of vulnerabilities.

Method: manual source review of authentication, authorization/ownership, CSRF,
CORS, cookies/sessions, rate limiting, upload handling, webhook verification,
logging, error handling, admin/diagnostics, production/test-mode gating; plus
`pip-audit`, `npm audit`, and the full test suites on SQLite and PostgreSQL.

Severity uses: **Critical / High / Medium / Low / Informational**.

---

## Findings

### W12-1 — Sandbox payment provider allowed in production — **Medium** (fixed)

- **Evidence.** `Settings.production_problems()` did not inspect
  `payment_provider`. A production deployment that left the default
  (`APP_PAYMENT_PROVIDER=fake`) would run the clearly-labelled sandbox adapter,
  and `POST /api/billing/sandbox/confirm` would activate a paid subscription with
  no real payment.
- **Impact.** Entitlement/plan escalation without payment; billing integrity.
- **Fix.** `production_problems()` now rejects sandbox provider names
  (`fake`, `fake-sandbox`, `sandbox`) and the app refuses to start in production.
  Test: `tests/test_security.py::test_sandbox_payment_provider_blocks_production`.
- **Result.** Fixed; startup blocked; test passing.

### W12-2 — Console email adapter allowed in production — **Medium** (fixed)

- **Evidence.** `production_problems()` did not inspect `email_backend`. In
  production the default `console` adapter logs the message and does not deliver
  it, so email verification and password reset silently never reach the user.
- **Impact.** Broken account recovery; a user-facing availability/trust issue, and
  it can mask the fact that a security email (password reset) was not sent.
- **Fix.** `production_problems()` now requires `APP_EMAIL_BACKEND=smtp` in
  production. Test: `tests/test_security.py::test_console_email_backend_blocks_production`.
- **Result.** Fixed; startup blocked; test passing.

### W12-3 — Admin state-changing endpoint lacked CSRF — **Low** (fixed)

- **Evidence.** `POST /api/admin/jobs/recover-stale` depended on `require_admin`
  but not on `require_csrf`, unlike every other authenticated POST/PATCH/DELETE.
- **Impact.** A cross-site request from a logged-in admin could trigger stale-job
  recovery. The action is idempotent and non-destructive, so impact is low, but it
  is an inconsistency worth closing (defence in depth).
- **Fix.** Added `require_csrf`. Test:
  `tests/test_roles.py::test_admin_recover_stale_requires_csrf` (403 without the
  token, 200 with it).
- **Result.** Fixed; test passing.

### W12-4 — SQLite tests did not enforce foreign keys — **Informational** (fixed)

- **Evidence.** SQLite does not enforce foreign keys unless `PRAGMA foreign_keys=ON`
  is set, and the engine did not set it. Running the full suite on a **real
  PostgreSQL** instance immediately surfaced an FK violation
  (`usage_records.job_id` referencing a non-existent job) that SQLite had accepted.
- **Impact.** Cross-engine divergence: local/CI (SQLite) tests could pass while
  production (PostgreSQL) rejected the same write. No production defect was found
  in the application path itself — the offending row came from a test — but the
  blind spot was real.
- **Fix.** SQLite connections now enable `PRAGMA foreign_keys=ON`
  (`app/database.py`), and a dedicated PostgreSQL job runs the whole suite plus
  PostgreSQL-only integration tests in CI
  (`.github/workflows/ci.yml`).
- **Result.** Fixed; full suite green on both engines.

---

## Areas reviewed with no outstanding high-risk finding

- **Authentication / sessions.** Opaque session tokens; only a SHA-256 hash is
  stored; expiry and revocation checked on every request; uniform login errors;
  bcrypt password hashing (≤ 72 bytes enforced).
- **Authorization / IDOR.** Projects, jobs and files are all scoped by
  `user_id`; a foreign record is reported `404` (not `403`), so existence is not
  leaked. Verified end-to-end by tests (`test_roles.py`, `test_projects_server.py`,
  `test_files.py`, `test_jobs.py`).
- **CSRF.** Double-submit token, constant-time compared, required on every
  authenticated state-changing endpoint (including the admin endpoint, after
  W12-3).
- **CORS / cookies.** Explicit origin list (wildcard refused in production),
  credentials allowed; session cookie is `HttpOnly`, `SameSite=Lax`, and
  `Secure` in production.
- **Rate limiting / large requests.** Per-scope budgets; `Retry-After` on 429/503;
  `X-Forwarded-For` honoured only behind a trusted proxy; oversized bodies rejected
  early with 413.
- **File upload / storage keys.** Content-type allow-list and size cap enforced
  server-side; storage key is server-generated; path-traversal guard on the local
  adapter; owner-scoped download.
- **Webhook verification.** HMAC signature compared with `hmac.compare_digest`;
  unknown providers return 404; unknown payment references return 404 so an
  unauthenticated event cannot create entitlements.
- **Secret logging.** Redaction filter over all log records; request bodies never
  logged; error responses carry no stack traces. Verified by
  `tests/test_security.py` (redaction) and `tests/test_observability.py`
  (diagnostics payload contains no secret values).
- **Server errors.** Single catch-all handler returns a generic 500 and logs the
  real error server-side only.
- **Dependencies.** `pip-audit` and `npm audit --audit-level=high` report no known
  vulnerabilities (recorded in the test report).
- **Test/mock modes.** Production startup refuses `APP_EXPOSE_DEV_TOKENS`,
  `APP_DEBUG`, sandbox payments, console email, `inline` jobs and `memory`
  storage (W12-1/2 plus W10 checks).

## Accepted / open items (not defects blocking a future release)

- **SVG uploads** are accepted (`image/svg+xml`). Downloads are served with
  `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`, so an
  SVG cannot execute in the app's origin. Kept under observation; if a future
  feature renders SVGs inline this must be revisited.
- **Process-local rate limiting** without Redis: limits are per-process, so a
  multi-instance deployment needs Redis for global enforcement. Documented, not a
  code defect.
- **No external monitoring/alerting** is connected; metrics are process-local and
  report this honestly.

## Operations (logging/secret policy)

- Logs are structured JSON with a request id (and job id where relevant); request
  bodies, cookies, tokens and anything matching the sensitive-key list are redacted
  before a record is emitted.
- Retention is a **deployment** concern: the platform's log sink must define it.
  No retention period is enforced in the application.

## Summary

| Severity | Count | Fixed |
|---|---|---|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 2 | 2 |
| Low | 1 | 1 |
| Informational | 1 | 1 |

No Critical or High findings. No independent penetration test has been performed,
and no production infrastructure (hosting, TLS, managed database, secret manager,
monitoring) is in place — both are prerequisites for release.
