"""Provider-agnostic contracts and errors for AI design generation (W1).

A provider turns a free-text furniture description into a structured
:class:`~app.services.ai.spec.DesignSpec`. The abstraction keeps the router,
validation and geometry layer independent of any particular LLM service; a new
service only has to implement :class:`AiProvider`.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from pydantic import BaseModel, Field

if TYPE_CHECKING:  # avoid a runtime import cycle (spec imports these errors)
    from .spec import DesignSpec


class DesignRequest(BaseModel):
    """Input for a design generation / modification request."""

    text: str = Field(min_length=1, max_length=2000)
    # Reference image is a W7 concern; W1 must not claim to handle it.
    image_filename: str | None = None


class AiProviderError(Exception):
    """Base class for provider failures. ``code`` maps to a stable API code."""

    code = "ai_provider_error"


class ProviderNotConfigured(AiProviderError):
    """No provider is configured (or a real one is missing its credentials)."""

    code = "ai_unconfigured"


class AiOutputError(AiProviderError):
    """The provider returned output that does not pass schema validation."""

    code = "ai_invalid_output"


class AiProvider(Protocol):
    """A text -> design spec provider."""

    name: str

    @property
    def is_configured(self) -> bool:
        """True only when the provider can actually be called."""

    def generate_design(self, request: DesignRequest) -> DesignSpec:
        """Return a validated design spec, or raise an :class:`AiProviderError`."""


__all__ = [
    "AiOutputError",
    "AiProvider",
    "AiProviderError",
    "DesignRequest",
    "ProviderNotConfigured",
]
