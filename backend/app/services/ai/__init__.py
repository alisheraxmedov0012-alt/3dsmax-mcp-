"""AI design providers (W1).

Provider-agnostic text->design integration. The concrete provider is selected by
configuration (``APP_AI_PROVIDER``) behind :class:`AiProvider`, so a real LLM
service can be swapped in without touching the router, the validation or the
geometry layer. No credentials are required by the module itself and none are
logged.
"""
from __future__ import annotations

from .base import (
    AiOutputError,
    AiProvider,
    AiProviderError,
    DesignRequest,
    ProviderNotConfigured,
)
from .registry import get_ai_provider
from .spec import (
    SUPPORTED_FURNITURE_TYPES,
    DesignSpec,
    Dimensions,
    FurnitureType,
)

__all__ = [
    "SUPPORTED_FURNITURE_TYPES",
    "AiOutputError",
    "AiProvider",
    "AiProviderError",
    "DesignRequest",
    "DesignSpec",
    "Dimensions",
    "FurnitureType",
    "ProviderNotConfigured",
    "get_ai_provider",
]
