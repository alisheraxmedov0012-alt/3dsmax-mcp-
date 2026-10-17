# Release gate checklist (W12)

> Every item is marked with evidence. Passing automated checks is **not** by itself
> sufficient for a production release. As of this revision the overall result is
> **NOT READY FOR PRODUCTION** — see the blockers below.

Legend: **PASS** (verified with evidence) · **FAIL** (check failed) ·
**BLOCKED** (external service/infrastructure missing) · **NOT TESTED** (not yet
exercised).

| # | Area | Status | Evidence / notes |
|---|---|---|---|
| 1 | Automated tests & CI | **PASS** | Frontend: 409 tests pass; lint/typecheck/build clean; `npm audit` 0 vulns. Backend: 149 pass / 14 skip on SQLite; ruff + `pip-audit` clean. CI runs frontend, backend (SQLite) and a PostgreSQL job. See `docs/W12_TEST_REPORT.md`. |
| 2 | PostgreSQL integration tests | **PASS** | Real PostgreSQL 17 service: migrations `upgrade→downgrade→upgrade` OK (transactional DDL); 14 PostgreSQL-only tests (unique constraints, FK cascade, `timestamptz`, JSON, stale-job recovery, versioning) pass; full suite also passes on PostgreSQL (163 with PG-only tests). CI adds an ephemeral `postgres:16` job. |
| 3 | Authentication & security | **PASS** (automated) | Ownership/IDOR, CSRF, CORS, cookies, rate limiting, upload validation, webhook verification and secret redaction covered by tests. W12 fixed 2 Medium + 1 Low findings (see `docs/SECURITY_AUDIT.md`). **Independent penetration testing: NOT TESTED.** |
| 4 | Worker & queue | **PASS** (code) / **BLOCKED** (infra) | Worker lifecycle, heartbeat, stale recovery, retry classification and parallel cap are implemented and tested. Running a real worker against production infrastructure: **BLOCKED** (no environment). |
| 5 | Storage & backup/restore | **PASS** (code) / **NOT TESTED** (drill) | Storage adapters, ownership, key generation and size/type validation tested. A real backup + **restore drill** against provisioned PostgreSQL and storage: **NOT TESTED** (no infrastructure). RPO/RTO: **undefined**. |
| 6 | AI provider | **BLOCKED** | No provider is connected; provider-dependent job kinds fail honestly. Token metering stays empty until one is wired. |
| 7 | Real payment provider & webhook | **BLOCKED** | Only the sandbox substitute exists and is refused in production. Real provider account + keys: **BLOCKED**. |
| 8 | Monitoring & alerting | **BLOCKED** | Metrics are process-local and say so; no dashboard/alert provider is connected. |
| 9 | Manual browser testing | **NOT TESTED** | Deferred until all stages are complete (see README manual-test plan). |
| 10 | Manual mobile testing | **NOT TESTED** | Deferred until all stages are complete. |
| 11 | Failure recovery | **PASS** (automated) / **NOT TESTED** (drills) | Stale-job recovery, rollback reasoning and fail-closed rate limiting are tested; live recovery/restore drills: **NOT TESTED**. |
| 12 | Deployment & rollback | **NOT TESTED** / **BLOCKED** | Deployment guide and rollback plan exist (`docs/DEPLOYMENT.md`); no environment to execute or roll back a deployment. CD workflow performs no action until secrets exist. |

## Release blockers

1. No production infrastructure: managed PostgreSQL, TLS/hosting, secret manager,
   persistent storage and a worker host are not provisioned.
2. Real payment provider not integrated (sandbox is refused in production).
3. AI/LLM provider not integrated.
4. No external monitoring/alerting.
5. SMTP not configured (console adapter is refused in production).
6. RPO/RTO not defined; backup/restore not drilled.
7. Manual browser and mobile QA not performed.
8. No independent security penetration test.

## Conclusion

**NOT READY FOR PRODUCTION.** The application is internally consistent, tested on
both SQLite and PostgreSQL, and hardened against the Medium/Low issues found in
this audit — but a release is gated on the external integrations, infrastructure
and manual QA listed above. Automated and CI success alone does not satisfy the
release criteria.
