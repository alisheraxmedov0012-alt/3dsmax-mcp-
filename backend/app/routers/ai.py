"""AI design endpoint (W1, extended in W13).

    POST /api/ai/design  ->  { provider, spec }

Requires an authenticated user and is metered against the ``ai_requests`` limit
(server-side, from the plan). The API key lives only in the server environment.

Request handling, in order: a reference image is refused (no provider reads one),
the provider is selected (an unconfigured service must not consume quota), then
the per-user daily allowance and the system-wide daily ceiling are taken together
in one transaction before the provider is called.

Quota accounting rule: one accepted request consumes exactly one unit from each
budget, however many provider HTTP calls it needs internally (a network retry and
one JSON repair are internal, worst case three calls). A request refused by either
budget consumes nothing. A request that reaches the provider keeps its unit even
if the provider then fails, because the call may already have cost money.

The system-wide ceiling bounds *spend*, so it only counts providers that bill per
request (``AiProvider.bills_per_request``). The free offline provider is excluded;
the per-user allowance applies to every provider.

This endpoint is a compute/read operation: it returns a design spec and does not
mutate user-visible state (the only server effects are the usage counter and the
usage ledger row). It therefore relies on authentication + per-user rate limiting
rather than CSRF, which also lets an already-logged-in browser use it after a page
reload (the CSRF token is only issued at login). The frontend falls back to the
offline ``localTableAdapter`` when the provider is unconfigured or fails.

W13 additions:

* ``ai_ambiguous_type`` (422) when the prompt names no known furniture type. The
  provider refuses to guess rather than silently building a table.
* One usage-ledger row per accepted request, keyed by the request id so a retried
  call within the same request cannot be counted twice. The ledger is written
  after a successful call, with ``cost_kind=unknown`` because no price is known
  yet — no cost is invented.
"""
from __future__ import annotations

import logging
import time
import uuid

from fastapi import APIRouter, Depends
from pydantic import ValidationError
from sqlalchemy.orm import Session as OrmSession

from ..config import get_settings
from ..database import get_db
from ..deps import get_current_user
from ..errors import ApiError
from ..guards import user_rate_limit
from ..logging_config import get_request_id
from ..models import User
from ..services.ai import get_ai_provider
from ..services.ai.base import (
    AiAmbiguousPrompt,
    AiOutputError,
    AiProviderError,
    AiTimeout,
    DesignRequest,
    ProviderNotConfigured,
)
from ..services.ai.pricing import token_prices_from_settings
from ..services.ai.spec import AiDesignRequest, AiDesignResponse
from ..services.limits import METRIC_AI_REQUESTS, consume_global, enforce_limit
from ..services.usage import (
    COST_ESTIMATED,
    COST_UNKNOWN,
    OPERATION_AI_GENERATE,
    UNIT_REQUEST,
    UNIT_TOKENS,
    record_usage,
)

logger = logging.getLogger("app.ai")

router = APIRouter(prefix="/api", tags=["ai"])


def _ledger_key() -> str:
    """Idempotency key for one request: the correlation id when available."""
    request_id = get_request_id()
    if request_id and request_id != "-":
        return f"ai-design:{request_id}"
    return f"ai-design:{uuid.uuid4().hex}"


def _provider_usage(provider) -> dict[str, int | None]:
    """Token counts the provider reported for this request.

    Providers that do not report usage (the offline analyzer) simply have no
    ``last_usage``; the ledger then stores nulls instead of a guess.
    """
    usage = getattr(provider, "last_usage", None)
    return usage if isinstance(usage, dict) else {}


def _cost_fields(provider, usage: dict[str, int | None]):
    """(cost_kind, cost_micros, currency) for this call.

    A cost is only computed when the operator configured both prices and a
    currency *and* the provider reported both token counts. Anything less stays
    ``unknown`` with null cost columns: the ledger must never show an invented
    price as if it were real.
    """
    prices = token_prices_from_settings(get_settings())
    if prices is None:
        return COST_UNKNOWN, None, None
    cost_micros = prices.estimate_micros(
        usage.get("prompt_tokens"), usage.get("completion_tokens")
    )
    if cost_micros is None:
        return COST_UNKNOWN, None, None
    return COST_ESTIMATED, cost_micros, prices.currency


def _write_ledger(
    db: OrmSession,
    user: User,
    *,
    provider,
    duration_ms: int,
    meta: dict,
) -> None:
    """Append one ledger row; never let a ledger problem change the outcome.

    Both the success and the failure path go through here. A ledger failure is
    logged by exception type only (never the message, which could quote data) and
    the caller's own result or error is left exactly as it was.
    """
    usage = _provider_usage(provider)
    try:
        cost_kind, cost_micros, currency = _cost_fields(provider, usage)
        total_tokens = usage.get("total_tokens")
        record_usage(
            db,
            user,
            operation=OPERATION_AI_GENERATE,
            idempotency_key=_ledger_key(),
            quantity=1,
            unit=UNIT_TOKENS if total_tokens is not None else UNIT_REQUEST,
            duration_ms=duration_ms,
            cost_kind=cost_kind,
            cost_micros=cost_micros,
            currency=currency,
            provider=getattr(provider, "name", None),
            model=getattr(provider, "_model", None),
            prompt_tokens=usage.get("prompt_tokens"),
            completion_tokens=usage.get("completion_tokens"),
            total_tokens=total_tokens,
            project_id=None,
            meta=meta,
        )
    except Exception as exc:
        logger.warning("AI usage ledger write failed: %s", type(exc).__name__)


def _record_failed_call(db: OrmSession, user: User, provider, started: float) -> None:
    """Record a failed paid call, leaving the caller's error untouched.

    Only providers that bill per request are recorded: an offline failure costs
    nothing, so a ledger row would imply a charge that never happened.
    """
    if not getattr(provider, "bills_per_request", False):
        return
    duration_ms = int((time.perf_counter() - started) * 1000)
    _write_ledger(
        db,
        user,
        provider=provider,
        duration_ms=duration_ms,
        meta={"outcome": "error"},
    )


@router.post("/ai/design", response_model=AiDesignResponse)
def create_design(
    payload: AiDesignRequest,
    _rate: None = Depends(user_rate_limit("ai")),
    user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> AiDesignResponse:
    # A reference image is accepted by the request schema so an older client does
    # not break, but no provider reads it: neither the offline analyzer nor the
    # OpenAI adapter sends the image anywhere. Silently answering with a text-only
    # design would look like the image had been understood, so the request is
    # rejected with a stable code instead.
    if payload.image_filename:
        raise ApiError(
            "ai_image_not_supported",
            "Rasm tahlili hozircha qo'llab-quvvatlanmaydi. Iltimos, mebelni matn "
            "bilan tavsiflang (masalan: «180x60x75 sm stol»).",
            status_code=422,
        )

    # Select/validate the provider first so an unconfigured service does not
    # consume a usage unit.
    try:
        provider = get_ai_provider()
    except ProviderNotConfigured as exc:
        raise ApiError(
            "ai_unconfigured",
            "AI xizmati hozircha sozlanmagan. Mahalliy tahlil ishlatilmoqda.",
            status_code=503,
        ) from exc

    # Both budgets are consumed in one transaction: if either is exhausted the
    # request is refused before any provider call, and neither counter keeps a
    # unit the caller did not get to use.
    try:
        enforce_limit(db, user, METRIC_AI_REQUESTS, increment=1, commit=False)
        limit_global = get_settings().ai_global_daily_limit
        # The global counter bounds spending, so it only applies to providers
        # that can actually cost money. A local provider is free and must not
        # drain a budget that paid providers depend on. The per-user allowance
        # above still applies to every provider.
        if limit_global > 0 and getattr(provider, "bills_per_request", True):
            consume_global(
                db, METRIC_AI_REQUESTS, limit=limit_global, increment=1, commit=False
            )
        db.commit()
    except ApiError:
        db.rollback()
        raise

    started = time.perf_counter()
    try:
        try:
            spec = provider.generate_design(
                DesignRequest(text=payload.text, image_filename=payload.image_filename)
            )
        except ProviderNotConfigured:
            # No call was made, so there is nothing to record; the mapped 503
            # below already tells the operator what is missing.
            raise
        except Exception:
            # F10: a call that reached a paying provider may have cost money even
            # though it failed (and its retries may have too). Record it, then
            # re-raise untouched so the status code below is unaffected.
            _record_failed_call(db, user, provider, started)
            raise
    except AiAmbiguousPrompt as exc:
        raise ApiError(
            "ai_ambiguous_type",
            "Mebel turini aniqlab bo'lmadi. Iltimos, turni aniq yozing "
            "(masalan: «180x60x75 sm stol» yoki «3 eshikli shkaf»).",
            status_code=422,
        ) from exc
    except AiOutputError as exc:
        raise ApiError(
            "ai_invalid_output",
            "AI javobi tekshiruvdan o'tmadi. Iltimos, tavsifni aniqroq yozing.",
            status_code=422,
        ) from exc
    except ValidationError as exc:
        # Untrusted provider output that failed pydantic validation before it
        # reached ``build_design_spec`` (e.g. a bool where a number is required,
        # or a wrong type for a field). This is the same class of failure as
        # ``AiOutputError``, so it maps to the same controlled 422. The raw
        # validation errors are never echoed to the client.
        logger.warning("Provider output failed schema validation: %s", type(exc).__name__)
        raise ApiError(
            "ai_invalid_output",
            "AI javobi tekshiruvdan o'tmadi. Iltimos, tavsifni aniqroq yozing.",
            status_code=422,
        ) from exc
    except AiTimeout as exc:
        # A budget overrun is not a provider failure: the service may be healthy
        # but too slow. 504 keeps it distinguishable from ``ai_provider_error``
        # while staying in the ``5xx`` range the frontend already treats as
        # "unavailable, fall back to the offline analyzer".
        raise ApiError(
            "ai_timeout",
            "AI xizmati vaqt chegarasida javob bermadi. Mahalliy tahlil ishlatilmoqda.",
            status_code=504,
        ) from exc
    except AiProviderError as exc:
        raise ApiError(
            "ai_provider_error",
            "AI xizmatiga ulanib bo'lmadi. Mahalliy tahlil ishlatilmoqda.",
            status_code=502,
        ) from exc

    duration_ms = int((time.perf_counter() - started) * 1000)
    _write_ledger(
        db,
        user,
        provider=provider,
        duration_ms=duration_ms,
        meta={"furniture": spec.furniture.value},
    )

    return AiDesignResponse(provider=provider.name, spec=spec)


__all__ = ["router"]
