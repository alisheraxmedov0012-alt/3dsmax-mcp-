"""AI design endpoint (W1).

    POST /api/ai/design  ->  { provider, spec }

Requires an authenticated user and is metered against the ``ai_requests`` limit
(server-side, from the plan). The API key lives only in the server environment.

This endpoint is a compute/read operation: it returns a design spec and does not
mutate user-visible state (the only server effect is the usage counter). It
therefore relies on authentication + per-user rate limiting rather than CSRF,
which also lets an already-logged-in browser use it after a page reload (the CSRF
token is only issued at login). The frontend falls back to the offline
``localTableAdapter`` when the provider is unconfigured or fails.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as OrmSession

from ..database import get_db
from ..deps import get_current_user
from ..errors import ApiError
from ..guards import user_rate_limit
from ..models import User
from ..services.ai import get_ai_provider
from ..services.ai.base import AiOutputError, AiProviderError, DesignRequest, ProviderNotConfigured
from ..services.ai.spec import AiDesignRequest, AiDesignResponse
from ..services.limits import METRIC_AI_REQUESTS, enforce_limit

router = APIRouter(prefix="/api", tags=["ai"])


@router.post("/ai/design", response_model=AiDesignResponse)
def create_design(
    payload: AiDesignRequest,
    _rate: None = Depends(user_rate_limit("ai")),
    user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> AiDesignResponse:
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

    # Enforce the server-side limit before spending provider cost.
    enforce_limit(db, user, METRIC_AI_REQUESTS, increment=1)

    try:
        spec = provider.generate_design(
            DesignRequest(text=payload.text, image_filename=payload.image_filename)
        )
    except AiOutputError as exc:
        raise ApiError(
            "ai_invalid_output",
            "AI javobi tekshiruvdan o'tmadi. Iltimos, tavsifni aniqroq yozing.",
            status_code=422,
        ) from exc
    except AiProviderError as exc:
        raise ApiError(
            "ai_provider_error",
            "AI xizmatiga ulanib bo'lmadi. Mahalliy tahlil ishlatilmoqda.",
            status_code=502,
        ) from exc

    return AiDesignResponse(provider=provider.name, spec=spec)


__all__ = ["router"]
