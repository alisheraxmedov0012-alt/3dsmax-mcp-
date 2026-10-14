"""Checkout (sandbox), provider webhook, billing history and invoices."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from ..database import get_db
from ..deps import get_current_user, require_csrf
from ..errors import ApiError
from ..models import Invoice, PaymentAttempt, Plan, User
from ..schemas import (
    BillingEventResponse,
    CheckoutConfirmRequest,
    CheckoutRequest,
    CheckoutResponse,
    InvoiceResponse,
)
from ..services.billing import (
    apply_payment_event,
    record_event,
    user_billing_events,
    user_invoices,
)
from ..services.payments.base import ProviderEvent, SignatureError
from ..services.payments.registry import ProviderNotConfigured, get_payment_provider
from ..services.subscriptions import create_pending_subscription

router = APIRouter(prefix="/api", tags=["billing"])


@router.get("/billing/history", response_model=list[BillingEventResponse])
def billing_history(
    user: User = Depends(get_current_user), db: OrmSession = Depends(get_db)
) -> list[BillingEventResponse]:
    # Only the current user's own events are ever returned.
    return [BillingEventResponse.model_validate(e) for e in user_billing_events(db, user)]


@router.get("/invoices", response_model=list[InvoiceResponse])
def list_invoices(
    user: User = Depends(get_current_user), db: OrmSession = Depends(get_db)
) -> list[InvoiceResponse]:
    return [InvoiceResponse.model_validate(i) for i in user_invoices(db, user)]


@router.post("/billing/checkout", response_model=CheckoutResponse)
def create_checkout(
    payload: CheckoutRequest,
    _: None = Depends(require_csrf),
    user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> CheckoutResponse:
    """Start a SANDBOX checkout. No real payment is created or processed."""
    try:
        provider = get_payment_provider()
    except ProviderNotConfigured as exc:
        raise ApiError("provider_not_configured", str(exc), status_code=503) from exc

    plan = db.execute(select(Plan).where(Plan.key == payload.plan_key)).scalar_one_or_none()
    if plan is None or not plan.is_active:
        raise ApiError("unknown_plan", "Tarif topilmadi.", status_code=404)
    if plan.key == "free":
        raise ApiError("free_plan_no_checkout", "Free tarif uchun to'lov kerak emas.", status_code=400)

    subscription = create_pending_subscription(db, user, plan)
    provider_ref = provider.create_payment(
        user_id=user.id,
        plan_key=plan.key,
        amount_cents=plan.price_cents,
        currency=plan.currency,
        idempotency_key=subscription.id,
    )

    attempt = db.execute(
        select(PaymentAttempt).where(
            PaymentAttempt.provider == provider.name,
            PaymentAttempt.provider_ref == provider_ref,
        )
    ).scalar_one_or_none()
    if attempt is None:
        attempt = PaymentAttempt(
            user_id=user.id,
            subscription_id=subscription.id,
            plan_id=plan.id,
            provider=provider.name,
            provider_ref=provider_ref,
            amount_cents=plan.price_cents,
            currency=plan.currency,
            status="pending",
        )
        db.add(attempt)
    db.commit()

    record_event(
        db,
        "checkout_created",
        {"provider": provider.name, "plan_key": plan.key, "sandbox": True},
        user_id=user.id,
    )
    db.commit()

    # Sandbox confirmation/cancel URLs are explicit and clearly labelled.
    return CheckoutResponse(
        payment_id=attempt.id,
        provider=provider.name,
        mode="sandbox",
        status=attempt.status,
        amount_cents=attempt.amount_cents,
        currency=attempt.currency,
        confirm_url="/api/billing/sandbox/confirm",
        cancelled_url="/api/billing/sandbox/confirm",
    )


@router.post("/billing/sandbox/confirm", response_model=CheckoutResponse)
def sandbox_confirm(
    payload: CheckoutConfirmRequest,
    _: None = Depends(require_csrf),
    user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> CheckoutResponse:
    """Simulate the provider's result inside the SANDBOX only.

    This endpoint represents the sandbox provider telling us the outcome via a
    verified event. It never processes real card data and is unavailable when a
    real provider is configured.
    """
    try:
        provider = get_payment_provider()
    except ProviderNotConfigured as exc:
        raise ApiError("provider_not_configured", str(exc), status_code=503) from exc

    if getattr(provider, "is_real_provider", False):
        raise ApiError(
            "sandbox_not_available",
            "Sandbox tasdiqlash haqiqiy provayder rejimida o'chirilgan.",
            status_code=409,
        )

    attempt = db.get(PaymentAttempt, payload.payment_id)
    if attempt is None or attempt.user_id != user.id:
        raise ApiError("unknown_payment", "To'lov topilmadi.", status_code=404)

    build_event = getattr(provider, "build_event", None)
    if build_event is None:  # pragma: no cover - defensive
        raise ApiError("provider_misconfigured", "Sandbox adapter mos emas.", status_code=503)

    body, signature = build_event(
        provider_ref=attempt.provider_ref,
        status=payload.outcome,
        amount_cents=attempt.amount_cents,
        currency=attempt.currency,
    )
    event = provider.parse_webhook(body, signature)
    apply_payment_event(db, event)

    refreshed = db.get(PaymentAttempt, attempt.id)
    assert refreshed is not None
    return CheckoutResponse(
        payment_id=refreshed.id,
        provider=refreshed.provider,
        mode="sandbox",
        status=refreshed.status,
        amount_cents=refreshed.amount_cents,
        currency=refreshed.currency,
    )


@router.post("/billing/webhook/{provider_name}")
async def provider_webhook(
    provider_name: str, request: Request, db: OrmSession = Depends(get_db)
) -> dict:
    """Handle a provider webhook with signature verification and idempotency."""
    try:
        provider = get_payment_provider()
    except ProviderNotConfigured as exc:
        raise ApiError("provider_not_configured", str(exc), status_code=503) from exc

    if provider.name != provider_name:
        raise ApiError("unknown_provider", "Provayder topilmadi.", status_code=404)

    body = await request.body()
    signature = request.headers.get("X-Signature-256") or request.headers.get("X-Signature")

    try:
        event: ProviderEvent = provider.parse_webhook(body, signature)
    except SignatureError as exc:
        raise ApiError("invalid_signature", "Webhook imzosi noto'g'ri.", status_code=401) from exc

    apply_payment_event(db, event)
    return {"status": "ok"}
