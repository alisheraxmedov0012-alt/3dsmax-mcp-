"""Server-side limit enforcement.

Limits are always evaluated on the server from the plan's configuration; a
client cannot raise a limit by editing frontend state or request payloads.

Two scopes exist, both in this module so there is one enforcement path:

* **Per user, from the plan** (``enforce_limit``) — counted in ``UsageCounter``.
  Most metrics accumulate over the account's lifetime, which is how the earlier
  stages behave. AI requests are counted per UTC day instead (see
  :data:`DAILY_METRICS`), because a provider bills per call and an allowance that
  never refills would be a lifetime cap rather than a rate limit.
* **Per system** (``consume_global``) — counted in ``GlobalUsageCounter``. This
  is not a plan limit and grants nobody an allowance; it bounds total spend when
  a plan limit is unset or an account misbehaves. It lives in the database so it
  survives a restart and is shared by every backend replica.

Both take their unit with a single conditional ``UPDATE``, so parallel requests
cannot both pass the last slot.
"""
from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as OrmSession

from ..errors import ApiError
from ..models import GlobalUsageCounter, Plan, UsageCounter, User
from .subscriptions import ACTIVE_STATUSES, get_active_subscription

METRIC_PROJECTS = "projects"
METRIC_PNG_EXPORTS = "png_exports"
METRIC_GLB_EXPORTS = "glb_exports"
METRIC_AI_REQUESTS = "ai_requests"

METRIC_TO_LIMIT_KEY = {
    METRIC_PROJECTS: "max_projects",
    METRIC_PNG_EXPORTS: "max_png_exports",
    METRIC_GLB_EXPORTS: "max_glb_exports",
    METRIC_AI_REQUESTS: "max_ai_requests",
}


#: Metrics whose limit is enforced per UTC day rather than over the lifetime of
#: the account. Only the AI quota is daily: providers are billed per call, so an
#: allowance that never refills would be a lifetime cap, not a rate limit.
DAILY_METRICS: frozenset[str] = frozenset({METRIC_AI_REQUESTS})


def utc_day(now: datetime | None = None) -> str:
    """The UTC calendar day used as a counter period, e.g. ``2026-10-25``.

    UTC rather than local time because the backend may run in any timezone and
    several replicas must agree on when the day rolls over.
    """
    moment = now or datetime.now(UTC)
    return moment.astimezone(UTC).date().isoformat()


def period_for(metric: str, now: datetime | None = None) -> str:
    """Counter period for a metric: a UTC day for daily metrics, else lifetime."""
    return utc_day(now) if metric in DAILY_METRICS else ""


def _ensure_counter(db: OrmSession, user: User, metric: str, period: str) -> None:
    """Make sure the counter row exists, without failing when it already does.

    A nested transaction (SAVEPOINT) is used so a lost insert race does not poison
    the caller's transaction.
    """
    existing = db.execute(
        select(UsageCounter.id).where(
            UsageCounter.user_id == user.id,
            UsageCounter.metric == metric,
            UsageCounter.period == period,
        )
    ).first()
    if existing is not None:
        return
    try:
        with db.begin_nested():
            db.add(UsageCounter(user_id=user.id, metric=metric, period=period, count=0))
    except IntegrityError:
        # Another request created it first: that row is the one to increment.
        pass


def _counter(
    db: OrmSession, user: User, metric: str, period: str | None = None
) -> UsageCounter:
    scope = period_for(metric) if period is None else period
    _ensure_counter(db, user, metric, scope)
    row = db.execute(
        select(UsageCounter).where(
            UsageCounter.user_id == user.id,
            UsageCounter.metric == metric,
            UsageCounter.period == scope,
        )
    ).scalar_one()
    return row


def _ensure_global(db: OrmSession, metric: str, period: str) -> None:
    existing = db.execute(
        select(GlobalUsageCounter.id).where(
            GlobalUsageCounter.metric == metric, GlobalUsageCounter.period == period
        )
    ).first()
    if existing is not None:
        return
    try:
        with db.begin_nested():
            db.add(GlobalUsageCounter(metric=metric, period=period, count=0))
    except IntegrityError:
        pass


def consume_global(
    db: OrmSession,
    metric: str,
    *,
    limit: int,
    increment: int = 1,
    period: str | None = None,
    commit: bool = True,
) -> int:
    """Atomically take ``increment`` units from the system-wide daily budget.

    The whole check-and-take is a single conditional ``UPDATE``: the database
    decides whether the last slot is available, so two replicas handling parallel
    requests cannot both pass a "count + 1 <= limit" check and overshoot. Raises
    ``ApiError`` (``ai_capacity_reached``) when the budget is spent, in which case
    nothing was consumed and no provider call should start.

    Returns the counter value after this call.
    """
    scope = period or utc_day()
    _ensure_global(db, metric, scope)
    result = db.execute(
        update(GlobalUsageCounter)
        .where(
            GlobalUsageCounter.metric == metric,
            GlobalUsageCounter.period == scope,
            GlobalUsageCounter.count + increment <= limit,
        )
        .values(count=GlobalUsageCounter.count + increment)
    )
    if result.rowcount == 0:
        raise ApiError(
            "ai_capacity_reached",
            "AI xizmati bugun uchun umumiy chegaraga yetdi. Ertaga qayta urinib ko'ring.",
            status_code=503,
            headers={"Retry-After": "3600"},
        )
    if commit:
        db.commit()
    else:
        db.flush()
    return global_usage(db, metric, scope)


def global_usage(db: OrmSession, metric: str, period: str | None = None) -> int:
    """How many units of ``metric`` the whole system has used this period."""
    scope = period or utc_day()
    value = db.execute(
        select(GlobalUsageCounter.count).where(
            GlobalUsageCounter.metric == metric, GlobalUsageCounter.period == scope
        )
    ).scalar_one_or_none()
    return int(value or 0)


def effective_limits(db: OrmSession, user: User) -> tuple[dict, Plan | None]:
    """Return the limits dict that applies to this user, and its plan."""
    subscription = get_active_subscription(db, user)
    if subscription is not None and subscription.status in ACTIVE_STATUSES:
        plan = db.get(Plan, subscription.plan_id)
        if plan is not None:
            return dict(plan.limits or {}), plan

    free = db.execute(select(Plan).where(Plan.key == "free")).scalar_one_or_none()
    if free is None:
        return {}, None
    return dict(free.limits or {}), free


def usage_snapshot(db: OrmSession, user: User) -> list[dict]:
    """Current usage per metric, scoped to the period its limit applies to.

    For a daily metric this is today's count, which is what the plan limit is
    checked against; reporting a lifetime total next to a daily limit would be
    misleading.
    """
    limits, _ = effective_limits(db, user)
    snapshot = []
    for metric, limit_key in METRIC_TO_LIMIT_KEY.items():
        counter = _counter(db, user, metric)
        # Shape is fixed by `UsageResponse`; the period is an internal detail of
        # how `used` was scoped, so it is not added to the public payload.
        snapshot.append({"metric": metric, "used": counter.count, "limit": limits.get(limit_key)})
    db.commit()
    return snapshot


def enforce_limit(
    db: OrmSession,
    user: User,
    metric: str,
    increment: int = 1,
    *,
    commit: bool = True,
    period: str | None = None,
) -> None:
    """Check and consume one unit of a metered action.

    Raises ``ApiError`` (code ``limit_reached``) when the configured limit would
    be exceeded. A ``None`` limit means "not configured" and does not block.

    The check and the take are one conditional ``UPDATE``, so two parallel
    requests cannot both read the same value and both pass the last slot. Metrics
    in :data:`DAILY_METRICS` count per UTC day; everything else keeps counting
    over the account's lifetime, which is how the earlier stages behave.

    ``commit=False`` leaves the counter increment in the caller's transaction so
    it can be committed together with the work it pays for, or rolled back when a
    later check in the same request fails. The caller must commit (or roll back)
    itself.
    """
    if metric not in METRIC_TO_LIMIT_KEY:
        raise ApiError("unknown_metric", "Noma'lum limit ko'rsatkichi.", status_code=400)

    limits, _ = effective_limits(db, user)
    limit = limits.get(METRIC_TO_LIMIT_KEY[metric])
    scope = period_for(metric) if period is None else period
    _ensure_counter(db, user, metric, scope)

    if isinstance(limit, int) and limit >= 0:
        result = db.execute(
            update(UsageCounter)
            .where(
                UsageCounter.user_id == user.id,
                UsageCounter.metric == metric,
                UsageCounter.period == scope,
                UsageCounter.count + increment <= limit,
            )
            .values(count=UsageCounter.count + increment)
        )
        if result.rowcount == 0:
            raise ApiError(
                "limit_reached",
                "Tarif limiti tugadi. Pro tarifga o'tishni ko'rib chiqing.",
                status_code=402,
            )
    else:
        # No configured limit: still count the use so the ledger and the usage
        # report stay truthful.
        db.execute(
            update(UsageCounter)
            .where(
                UsageCounter.user_id == user.id,
                UsageCounter.metric == metric,
                UsageCounter.period == scope,
            )
            .values(count=UsageCounter.count + increment)
        )

    if commit:
        db.commit()
    else:
        db.flush()


__all__ = [
    "DAILY_METRICS",
    "METRIC_AI_REQUESTS",
    "METRIC_GLB_EXPORTS",
    "METRIC_PNG_EXPORTS",
    "METRIC_PROJECTS",
    "consume_global",
    "effective_limits",
    "enforce_limit",
    "global_usage",
    "period_for",
    "usage_snapshot",
    "utc_day",
]
