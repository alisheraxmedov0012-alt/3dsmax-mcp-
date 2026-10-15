"""W11 usage & cost metering ledger.

Design notes — read before extending
------------------------------------
* The plan-limit system (:mod:`app.services.limits` + ``UsageCounter``) is the
  single source of truth for *blocking* an action. This module is the append-only
  ledger that records **what each metered operation actually consumed**, so the
  counters can be audited later. It does not enforce limits and must not grow a
  second enforcement path.
* Every write is idempotent on ``(user_id, idempotency_key)``. A retried request
  or two concurrent requests carrying the same key record exactly one row, so a
  parallel retry can never be counted twice.
* Cost is never invented. When no approved price is configured the cost columns
  stay ``None`` and ``cost_kind`` is ``"unknown"``. Token counts are stored only
  when a provider actually reported them.
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as OrmSession

from ..errors import ApiError
from ..models import UsageRecord, User

# Cost trust levels.
COST_ACTUAL = "actual"
COST_ESTIMATED = "estimated"
COST_UNKNOWN = "unknown"
COST_KINDS = (COST_ACTUAL, COST_ESTIMATED, COST_UNKNOWN)

# Resource units.
UNIT_REQUEST = "request"
UNIT_SECONDS = "seconds"
UNIT_TOKENS = "tokens"

MAX_OPERATION_LENGTH = 60
MAX_IDEMPOTENCY_LENGTH = 160

#: Operations the server records. Keeping this closed prevents typos and makes
#: the ledger querable; extend deliberately when a new metered action is added.
OPERATION_AI_GENERATE = "ai.generate"
OPERATION_EXPORT = "export"
OPERATION_RENDER = "render"
OPERATION_PROJECT_CREATE = "project.create"
OPERATION_PROJECT_UPDATE = "project.update"
OPERATION_FILE_UPLOAD = "file.upload"
OPERATION_JOB_ENQUEUE = "job.enqueue"
OPERATION_JOB_RUN = "job.run"


def _existing(db: OrmSession, user: User, key: str) -> UsageRecord | None:
    return db.execute(
        select(UsageRecord).where(
            UsageRecord.user_id == user.id, UsageRecord.idempotency_key == key
        )
    ).scalar_one_or_none()


def record_usage(
    db: OrmSession,
    user: User,
    *,
    operation: str,
    idempotency_key: str,
    quantity: int = 1,
    unit: str = UNIT_REQUEST,
    duration_ms: int | None = None,
    cost_kind: str = COST_UNKNOWN,
    cost_micros: int | None = None,
    currency: str | None = None,
    provider: str | None = None,
    model: str | None = None,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    total_tokens: int | None = None,
    project_id: str | None = None,
    job_id: str | None = None,
    meta: dict | None = None,
) -> tuple[UsageRecord, bool]:
    """Record one metered operation for ``user``.

    Returns ``(record, created)``. A repeated call with the same
    ``idempotency_key`` returns the original row with ``created=False`` and never
    double-counts, including when two requests race (the unique constraint is the
    final arbiter and the loser re-reads the winner's row).
    """
    operation = (operation or "").strip()
    if not operation or len(operation) > MAX_OPERATION_LENGTH:
        raise ApiError("usage_operation_invalid", "Noma'lum operatsiya turi.", status_code=400)

    key = (idempotency_key or "").strip()
    if not key or len(key) > MAX_IDEMPOTENCY_LENGTH:
        raise ApiError("usage_key_invalid", "Foydalanish kaliti noto'g'ri.", status_code=400)

    if cost_kind not in COST_KINDS:
        raise ApiError("usage_cost_kind_invalid", "Xarajat turi noto'g'ri.", status_code=400)

    # Never store a cost without a trust level, and never store an invented cost.
    if cost_kind == COST_UNKNOWN:
        cost_micros = None
        currency = None

    existing = _existing(db, user, key)
    if existing is not None:
        return existing, False

    record = UsageRecord(
        user_id=user.id,
        project_id=project_id,
        job_id=job_id,
        operation=operation,
        idempotency_key=key,
        quantity=max(int(quantity), 0),
        unit=(unit or UNIT_REQUEST)[:20],
        duration_ms=duration_ms,
        cost_kind=cost_kind,
        cost_micros=cost_micros,
        currency=currency,
        provider=provider,
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        meta=meta or {},
    )
    db.add(record)
    try:
        db.commit()
    except IntegrityError:
        # A concurrent request inserted the same key first: idempotent no-op.
        db.rollback()
        winner = _existing(db, user, key)
        if winner is None:  # pragma: no cover - defensive
            raise
        return winner, False
    db.refresh(record)
    return record, True


def record_from_job(
    db: OrmSession,
    user: User,
    *,
    job_id: str,
    operation: str,
    duration_ms: int | None,
    result: dict | None,
    provider: str | None = None,
) -> tuple[UsageRecord, bool]:
    """Record usage for a finished job, including real provider metrics.

    A job result may carry a ``usage`` block reported by an AI provider:
    ``{"prompt_tokens": .., "completion_tokens": .., "total_tokens": ..}``. Only
    values that are actually present are stored; nothing is estimated here.
    """
    usage = (result or {}).get("usage") if isinstance(result, dict) else None
    prompt = completion = total = None
    if isinstance(usage, dict):
        prompt = _positive_int(usage.get("prompt_tokens"))
        completion = _positive_int(usage.get("completion_tokens"))
        total = _positive_int(usage.get("total_tokens"))
        if total is None and (prompt is not None or completion is not None):
            total = (prompt or 0) + (completion or 0)

    return record_usage(
        db,
        user,
        operation=operation,
        idempotency_key=f"job-run:{job_id}",
        quantity=1,
        unit=UNIT_TOKENS if total is not None else UNIT_REQUEST,
        duration_ms=duration_ms,
        cost_kind=COST_UNKNOWN,
        provider=provider,
        prompt_tokens=prompt,
        completion_tokens=completion,
        total_tokens=total,
        job_id=job_id,
        meta={"kind": operation},
    )


def _positive_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value >= 0:
        return value
    return None


def list_usage(db: OrmSession, user: User, *, limit: int = 100) -> list[UsageRecord]:
    return (
        db.execute(
            select(UsageRecord)
            .where(UsageRecord.user_id == user.id)
            .order_by(UsageRecord.created_at.desc())
            .limit(min(max(limit, 1), 500))
        )
        .scalars()
        .all()
    )


def usage_summary(db: OrmSession, user: User) -> list[dict]:
    """Aggregate totals per operation, separating actual from estimated."""
    rows = (
        db.execute(
            select(
                UsageRecord.operation,
                func.count(UsageRecord.id).label("records"),
                func.coalesce(func.sum(UsageRecord.quantity), 0).label("quantity"),
                func.coalesce(func.sum(UsageRecord.duration_ms), 0).label("duration_ms"),
                func.coalesce(func.sum(UsageRecord.total_tokens), 0).label("total_tokens"),
            )
            .where(UsageRecord.user_id == user.id)
            .group_by(UsageRecord.operation)
            .order_by(UsageRecord.operation)
        )
        .all()
    )

    summary: list[dict] = []
    for operation, records, quantity, duration_ms, total_tokens in rows:
        # Counts per cost trust level so actual and estimated are never conflated.
        levels = dict(
            db.execute(
                select(UsageRecord.cost_kind, func.count(UsageRecord.id))
                .where(UsageRecord.user_id == user.id, UsageRecord.operation == operation)
                .group_by(UsageRecord.cost_kind)
            ).all()
        )
        summary.append(
            {
                "operation": operation,
                "records": records,
                "quantity": quantity,
                "duration_ms": duration_ms,
                "total_tokens": total_tokens,
                "actual": levels.get(COST_ACTUAL, 0),
                "estimated": levels.get(COST_ESTIMATED, 0),
                "unknown": levels.get(COST_UNKNOWN, 0),
            }
        )
    return summary


def record_to_dict(record: UsageRecord) -> dict:
    return {
        "id": record.id,
        "operation": record.operation,
        "quantity": record.quantity,
        "unit": record.unit,
        "duration_ms": record.duration_ms,
        "cost_kind": record.cost_kind,
        "cost_micros": record.cost_micros,
        "currency": record.currency,
        "provider": record.provider,
        "model": record.model,
        "prompt_tokens": record.prompt_tokens,
        "completion_tokens": record.completion_tokens,
        "total_tokens": record.total_tokens,
        "project_id": record.project_id,
        "job_id": record.job_id,
        "meta": record.meta or {},
        "created_at": record.created_at.isoformat() if record.created_at else None,
    }


__all__ = [
    "COST_ACTUAL",
    "COST_ESTIMATED",
    "COST_UNKNOWN",
    "OPERATION_AI_GENERATE",
    "OPERATION_EXPORT",
    "OPERATION_FILE_UPLOAD",
    "OPERATION_JOB_ENQUEUE",
    "OPERATION_JOB_RUN",
    "OPERATION_PROJECT_CREATE",
    "OPERATION_PROJECT_UPDATE",
    "OPERATION_RENDER",
    "UNIT_REQUEST",
    "UNIT_SECONDS",
    "UNIT_TOKENS",
    "list_usage",
    "record_from_job",
    "record_to_dict",
    "record_usage",
    "usage_summary",
]
