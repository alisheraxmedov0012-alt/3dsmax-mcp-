"""OpenAI-compatible chat provider (real integration, swappable).

Works with any service exposing the OpenAI ``/chat/completions`` shape (OpenAI,
Azure OpenAI, Mistral, a local vLLM/Ollama gateway, ...). The endpoint and model
come from configuration; the API key is read from the server environment only
and is never sent to the frontend, echoed in responses or written to logs.

The model is asked for a strict JSON object (``response_format=json_object``)
which is then parsed and validated by :func:`build_design_spec` exactly like any
other untrusted provider output.
"""
from __future__ import annotations

import logging

import httpx
from pydantic import ValidationError

from .base import AiOutputError, AiProviderError, DesignRequest, ProviderNotConfigured
from .spec import DesignSpec, FurnitureType, RawDesignSpec, build_design_spec

logger = logging.getLogger("app.ai")

_FURNITURE_VALUES = ", ".join(f'"{t.value}"' for t in FurnitureType)

_SYSTEM_PROMPT = (
    "You are a furniture design assistant. Read the user's description (Uzbek or "
    "English) and return ONLY a JSON object with this shape:\n"
    "{\n"
    f'  "furniture": one of {_FURNITURE_VALUES},\n'
    '  "dimensions": {"width_cm": number, "height_cm": number, "depth_cm": number} or null,\n'
    '  "color": "#rrggbb" or null,\n'
    '  "material_kind": "wood"|"metal"|"glass"|"fabric"|"leather"|null,\n'
    '  "style": short string or null,\n'
    '  "confidence": "high"|"medium"|"low",\n'
    '  "notes": [short strings],\n'
    '  "warnings": [short strings]\n'
    "}\n"
    "All lengths are in centimetres. Do not invent features that were not "
    "requested. Use null when a value is unknown. Do not wrap the JSON in prose."
)


class OpenAiCompatibleProvider:
    """Provider backed by an OpenAI-compatible chat completions endpoint."""

    name = "openai_compatible"

    def __init__(
        self,
        *,
        api_key: str | None,
        base_url: str | None,
        model: str | None,
        timeout: float = 20.0,
        max_retries: int = 1,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._api_key = api_key or None
        self._base_url = (base_url or "").rstrip("/") or None
        self._model = model or None
        self._timeout = timeout
        self._max_retries = max(0, max_retries)
        # Injected in tests (httpx.MockTransport) to exercise the real code path
        # without any network access.
        self._transport = transport

    @property
    def is_configured(self) -> bool:
        return bool(self._api_key and self._base_url and self._model)

    def _endpoint(self) -> str:
        assert self._base_url is not None  # guarded by is_configured
        return f"{self._base_url}/chat/completions"

    def _post(self, payload: dict) -> httpx.Response:
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        with httpx.Client(timeout=self._timeout, transport=self._transport) as client:
            return client.post(self._endpoint(), json=payload, headers=headers)

    def _interpret(self, content: str) -> DesignSpec:
        try:
            raw = RawDesignSpec.model_validate_json(content)
        except ValidationError as exc:
            raise AiOutputError("AI javobi kutilgan sxemaga mos kelmadi.") from exc
        return build_design_spec(raw, provider=self.name)

    def generate_design(self, request: DesignRequest) -> DesignSpec:
        if not self.is_configured:
            raise ProviderNotConfigured(
                "AI provayderi sozlanmagan (APP_AI_API_KEY/APP_AI_MODEL kerak)."
            )

        payload = {
            "model": self._model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": request.text},
            ],
        }

        last_error: Exception | None = None
        for attempt in range(self._max_retries + 1):
            try:
                response = self._post(payload)
                if response.status_code >= 400:
                    # Do not include the body/headers: they may leak provider detail.
                    raise AiProviderError(f"AI provayderi HTTP {response.status_code} qaytardi.")
                data = response.json()
                content = data["choices"][0]["message"]["content"]
                return self._interpret(content)
            except AiOutputError:
                # Bad model output will not improve on retry.
                raise
            except (httpx.HTTPError, KeyError, IndexError, ValueError, TypeError) as exc:
                last_error = exc
                logger.warning(
                    "AI provider attempt %d/%d failed: %s",
                    attempt + 1,
                    self._max_retries + 1,
                    type(exc).__name__,
                )
                if attempt >= self._max_retries:
                    break

        raise AiProviderError("AI xizmatidan javob olishda xatolik yuz berdi.") from last_error


__all__ = ["OpenAiCompatibleProvider"]
