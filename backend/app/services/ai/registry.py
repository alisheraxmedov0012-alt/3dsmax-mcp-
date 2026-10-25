"""AI provider selection.

The provider is chosen from ``APP_AI_PROVIDER``. Only the offline ``local``
provider and the OpenAI-compatible adapter are wired here; a real service is
selected by configuration, not by code changes. If no provider is configured
(or a real one lacks its credentials) ``ProviderNotConfigured`` is raised so the
API reports the integration as unconfigured instead of faking success.
"""
from __future__ import annotations

from ...config import get_settings
from .base import AiProvider, ProviderNotConfigured
from .local_provider import LocalHeuristicProvider
from .openai_provider import OpenAiCompatibleProvider

_LOCAL_NAMES = {"local", "local-heuristic"}
_OPENAI_NAMES = {"openai", "openai_compatible", "openai-compatible", "azure"}


def get_ai_provider() -> AiProvider:
    settings = get_settings()
    name = (settings.ai_provider or "none").lower()

    if name in {"none", ""}:
        raise ProviderNotConfigured(
            "AI provayderi sozlanmagan. APP_AI_PROVIDER ni o'rnating "
            "(local yoki openai_compatible)."
        )

    if name in _LOCAL_NAMES:
        return LocalHeuristicProvider()

    if name in _OPENAI_NAMES:
        provider = OpenAiCompatibleProvider(
            api_key=settings.ai_api_key,
            base_url=settings.ai_base_url,
            model=settings.ai_model,
            timeout=settings.ai_timeout_seconds,
            max_retries=settings.ai_max_retries,
            budget=settings.ai_request_budget_seconds,
        )
        # Report an unconfigured real provider here so the API answers
        # "ai_unconfigured" (503) without consuming a usage unit, instead of
        # failing later with a mislabelled provider error.
        if not provider.is_configured:
            raise ProviderNotConfigured(
                "AI provayderi sozlanmagan (APP_AI_API_KEY/APP_AI_MODEL kerak)."
            )
        return provider

    raise ProviderNotConfigured(f"'{name}' AI provayderi hali qo'llab-quvvatlanmaydi.")


__all__ = ["get_ai_provider"]
