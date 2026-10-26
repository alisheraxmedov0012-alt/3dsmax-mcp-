"""AI provider selection.

The provider is chosen from ``APP_AI_PROVIDER``. Only the offline ``local``
provider and the OpenAI-compatible adapter are wired here; a real service is
selected by configuration, not by code changes. If no provider is configured
(or a real one lacks its credentials) ``ProviderNotConfigured`` is raised so the
API reports the integration as unconfigured instead of faking success.

Azure OpenAI is *not* supported: it speaks a different protocol, so the name is
rejected with an explicit reason rather than routed to the OpenAI adapter.
"""
from __future__ import annotations

from ...config import get_settings
from .base import AiProvider, ProviderNotConfigured
from .local_provider import LocalHeuristicProvider
from .openai_provider import OpenAiCompatibleProvider

_LOCAL_NAMES = {"local", "local-heuristic"}
#: Names that speak the OpenAI ``/chat/completions`` shape end to end.
#: ``azure`` is deliberately absent: Azure OpenAI is a *different* protocol
#: (``/openai/deployments/{deployment}/chat/completions?api-version=...`` with an
#: ``api-key`` header), and no adapter for it exists here. Routing the name to
#: the OpenAI adapter would build a URL Azure answers with 404.
_OPENAI_NAMES = {"openai", "openai_compatible", "openai-compatible"}

#: Known provider names this build cannot serve, with the reason. Answering with
#: the generic "not supported" text would leave an operator guessing whether the
#: name or the configuration was wrong.
_AZURE_NAMES = {"azure", "azure_openai", "azure-openai"}
_AZURE_MESSAGE = (
    "Azure OpenAI qo'llab-quvvatlanmaydi: unga alohida protokol kerak "
    "(/openai/deployments/{deployment}/chat/completions?api-version=... va "
    "api-key sarlavhasi), bu build'da bunday adapter yo'q."
)


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

    # Checked before _OPENAI_NAMES (which no longer contains it) and reported with
    # a specific reason, because this name used to be accepted and would now look
    # like a typo.
    if name in _AZURE_NAMES:
        raise ProviderNotConfigured(_AZURE_MESSAGE)

    if name in _OPENAI_NAMES:
        provider = OpenAiCompatibleProvider(
            api_key=settings.ai_api_key,
            base_url=settings.ai_base_url,
            model=settings.ai_model,
            timeout=settings.ai_timeout_seconds,
            max_retries=settings.ai_max_retries,
            budget=settings.ai_request_budget_seconds,
            max_output_tokens=settings.ai_max_output_tokens,
            json_mode=settings.ai_json_mode,
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
