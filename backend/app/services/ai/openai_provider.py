"""OpenAI-compatible chat provider (real integration, swappable).

Works with any service exposing the OpenAI ``/chat/completions`` shape (OpenAI,
Azure OpenAI, Mistral, a local vLLM/Ollama gateway, ...). The endpoint and model
come from configuration; the API key is read from the server environment only
and is never sent to the frontend, echoed in responses or written to logs.

The model is asked for a strict JSON object (``response_format=json_object``)
which is then parsed and validated by :func:`build_design_spec` exactly like any
other untrusted provider output.

Repair is bounded: when the model returns syntactically or structurally invalid
JSON it is asked exactly once more, with the failure appended to the
conversation. After that the error is surfaced. There is no unbounded retry
loop, and a semantically rejected answer (unknown type, impossible dimensions)
is not retried, because repeating the same request would return the same answer.
"""
from __future__ import annotations

import logging

import httpx
from pydantic import ValidationError

from .base import AiOutputError, AiProviderError, DesignRequest, ProviderNotConfigured
from .spec import DesignSpec, FurnitureType, RawDesignSpec, build_design_spec

logger = logging.getLogger("app.ai")

#: One repair attempt only. Bounded on purpose: every extra call costs money.
MAX_REPAIR_ATTEMPTS = 1

_FURNITURE_VALUES = ", ".join(f'"{t.value}"' for t in FurnitureType)

_SYSTEM_PROMPT = (
    "You are a furniture design assistant. Read the user's description (Uzbek, "
    "Russian or English) and return ONLY a JSON object with this shape:\n"
    "{\n"
    f'  "furniture": one of {_FURNITURE_VALUES},\n'
    '  "dimensions": {"width_cm": number, "height_cm": number, "depth_cm": number} or null,\n'
    '  "details": object or null,\n'
    '  "color": "#rrggbb" or null,\n'
    '  "material_kind": "wood"|"metal"|"glass"|"fabric"|"leather"|null,\n'
    '  "style": short string or null,\n'
    '  "confidence": "high"|"medium"|"low",\n'
    '  "notes": [short strings],\n'
    '  "warnings": [short strings]\n'
    "}\n"
    "All lengths are in centimetres. Dimensions are extents along fixed axes: "
    "width is the X extent, depth is the Z extent and height is the Y extent. For "
    "a bed the Z extent is the head-board-to-foot direction (its length) and "
    'height is the frame height, not the total height.\n'
    '"details" may carry optional type-specific numbers: topThicknessCm, '
    "legCount (table); seatHeightCm, backHeightCm, armHeightCm (chair, armchair, "
    "sofa); wallThicknessCm, shelfCount (wardrobe, shelf); doorCount (wardrobe, "
    "dresser); drawerCount, legHeightCm (dresser); mattressHeightCm, "
    "headboardHeightCm (bed). Omit the key when you do not know the value.\n"
    "Do not invent features that were not requested. Use null when a value is "
    "unknown. Do not wrap the JSON in prose."
)

_REPAIR_INSTRUCTION = (
    "Your previous reply could not be validated. Return ONLY the JSON object in "
    "the exact shape requested, with no prose and no markdown fences."
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

    def _request_once(self, payload: dict) -> str:
        response = self._post(payload)
        if response.status_code >= 400:
            # Do not include the body/headers: they may leak provider detail.
            raise AiProviderError(f"AI provayderi HTTP {response.status_code} qaytardi.")
        data = response.json()
        return data["choices"][0]["message"]["content"]

    def generate_design(self, request: DesignRequest) -> DesignSpec:
        if not self.is_configured:
            raise ProviderNotConfigured(
                "AI provayderi sozlanmagan (APP_AI_API_KEY/APP_AI_MODEL kerak)."
            )

        messages = [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": request.text},
        ]
        payload = {
            "model": self._model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": messages,
        }

        repair_left = MAX_REPAIR_ATTEMPTS
        network_attempts = 0
        last_error: Exception | None = None

        while True:
            try:
                content = self._request_once(payload)
            except (httpx.HTTPError, KeyError, IndexError, ValueError, TypeError) as exc:
                network_attempts += 1
                last_error = exc
                logger.warning(
                    "AI provider attempt %d/%d failed: %s",
                    network_attempts,
                    self._max_retries + 1,
                    type(exc).__name__,
                )
                if network_attempts > self._max_retries:
                    break
                continue

            try:
                return self._interpret(content)
            except AiOutputError:
                if repair_left <= 0:
                    raise
                # Bounded repair: exactly one extra call, with the failure shown
                # to the model. Never an unbounded loop.
                repair_left -= 1
                logger.warning("AI output failed validation; asking once more.")
                payload = {
                    **payload,
                    "messages": [
                        *messages,
                        {"role": "assistant", "content": content},
                        {"role": "user", "content": _REPAIR_INSTRUCTION},
                    ],
                }

        raise AiProviderError("AI xizmatidan javob olishda xatolik yuz berdi.") from last_error


__all__ = ["MAX_REPAIR_ATTEMPTS", "OpenAiCompatibleProvider"]
