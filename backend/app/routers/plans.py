"""Plans, subscription and usage routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from ..database import get_db
from ..deps import get_current_user, require_csrf
from ..errors import ApiError
from ..models import Plan, Subscription, User
from ..schemas import PlanResponse, SubscriptionResponse, UsageResponse
from ..services.limits import effective_limits, usage_snapshot
from ..services.subscriptions import (
    ACTIVE_STATUSES,
    STATUS_CANCELLED,
    get_active_subscription,
    transition,
)

router = APIRouter(prefix="/api", tags=["plans"])


@router.get("/plans", response_model=list[PlanResponse])
def list_plans(db: OrmSession = Depends(get_db)) -> list[PlanResponse]:
    plans = db.execute(select(Plan).where(Plan.is_active.is_(True)).order_by(Plan.name)).scalars().all()
    return [
        PlanResponse(
            key=plan.key,
            name=plan.name,
            is_active=plan.is_active,
            limits=plan.limits or {},
            price_cents=plan.price_cents,
            currency=plan.currency,
            period_days=plan.period_days,
        )
        for plan in plans
    ]


@router.get("/subscription", response_model=SubscriptionResponse)
def current_subscription(
    user: User = Depends(get_current_user), db: OrmSession = Depends(get_db)
) -> SubscriptionResponse:
    subscription: Subscription | None = get_active_subscription(db, user)
    limits, plan = effective_limits(db, user)

    plan_key = plan.key if plan else "free"
    plan_name = plan.name if plan else "Free"
    # Users with no subscription are on the Free tier, which is implicitly
    # active (no payment is required for Free).
    status = subscription.status if subscription else "active"

    usage = [
        UsageResponse(metric=row["metric"], used=row["used"], limit=row["limit"])
        for row in usage_snapshot(db, user)
    ]

    return SubscriptionResponse(
        plan_key=plan_key,
        plan_name=plan_name,
        status=status,
        current_period_end=subscription.current_period_end if subscription else None,
        limits=limits,
        usage=usage,
    )


@router.get("/usage", response_model=list[UsageResponse])
def usage(user: User = Depends(get_current_user), db: OrmSession = Depends(get_db)) -> list[UsageResponse]:
    return [UsageResponse(**row) for row in usage_snapshot(db, user)]


@router.post("/subscription/cancel", response_model=SubscriptionResponse)
def cancel_subscription(
    _: None = Depends(require_csrf),
    user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> SubscriptionResponse:
    subscription = get_active_subscription(db, user)
    if subscription is None or subscription.status not in ACTIVE_STATUSES:
        raise ApiError("no_active_subscription", "Faol obuna yo'q.", status_code=404)

    transition(subscription, STATUS_CANCELLED)
    db.commit()
    return current_subscription(user=user, db=db)
