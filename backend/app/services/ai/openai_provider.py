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

Transient HTTP failures (``RETRYABLE_STATUS_CODES``) are retried up to
``max_retries`` times, honouring ``Retry-After`` when the provider sends one. A
permanent status (400/401/403/404/422 and the rest) fails at once: repeating the
same request cannot change the answer and every call may cost money.
"""
from __future__ import annotations

import logging
import time
from collections.abc import Callable

import httpx
from pydantic import ValidationError

from .base import AiOutputError, AiProviderError, DesignRequest, ProviderNotConfigured
from .spec import DesignSpec, FurnitureType, RawDesignSpec, build_design_spec

logger = logging.getLogger("app.ai")

#: One repair attempt only. Bounded on purpose: every extra call costs money.
MAX_REPAIR_ATTEMPTS = 1

#: Statuses that signal a transient condition: the same request may succeed
#: later. 408/425/429 are explicit "try again" answers; 5xx means the provider
#: failed on its side. Everything else is permanent and is not retried.
RETRYABLE_STATUS_CODES: frozenset[int] = frozenset({408, 425, 429, 500, 502, 503, 504})

#: Hard ceiling on one wait, so a large or hostile ``Retry-After`` cannot stall
#: a request. The overall request deadline is a separate concern (A3.4 F2).
MAX_RETRY_WAIT_SECONDS = 5.0

#: Wait before the first retry when the provider sends no ``Retry-After``.
#: Doubles per attempt and is capped by ``MAX_RETRY_WAIT_SECONDS``.
RETRY_BACKOFF_SECONDS = 0.5

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


class _RetryableStatus(AiProviderError):
    """A transient HTTP failure that may be retried.

    Subclasses :class:`AiProviderError` so that, if the retries are exhausted, it
    still surfaces to the API as a controlled ``502`` rather than an unhandled
    error.
    """

    def __init__(self, status: int, retry_after: float | None = None) -> None:
        super().__init__(f"AI provayderi HTTP {status} qaytardi.")
        self.status_code = status
        self.retry_after = retry_after


def _retry_after_seconds(response: httpx.Response) -> float | None:
    """Parsed, capped ``Retry-After`` in seconds, or ``None`` when unusable.

    Only the delay-seconds form is honoured. The HTTP-date form is ignored rather
    than guessed at: falling back to the normal backoff is safer than computing a
    delay from an unsynchronised clock. Negative and non-numeric values are
    ignored for the same reason.
    """
    raw = response.headers.get("Retry-After")
    if not raw:
        return None
    try:
        seconds = float(raw.strip())
    except ValueError:
        return None
    if seconds < 0:
        return None
    return min(seconds, MAX_RETRY_WAIT_SECONDS)


def _wait_before_retry(attempt: int, retry_after: float | None) -> float:
    """Seconds to wait before retry number ``attempt`` (1-based)."""
    if retry_after is not None:
        return retry_after
    return min(RETRY_BACKOFF_SECONDS * (2 ** (attempt - 1)), MAX_RETRY_WAIT_SECONDS)


class OpenAiCompatibleProvider:
    """Provider backed by an OpenAI-compatible chat completions endpoint."""

    name = "openai_compatible"
    # Every call may be billed by the remote service, so it counts against the
    # system-wide spend ceiling.
    bills_per_request = True

    def __init__(
        self,
        *,
        api_key: str | None,
        base_url: str | None,
        model: str | None,
        timeout: float = 20.0,
        max_retries: int = 1,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._api_key = api_key or None
        self._base_url = (base_url or "").rstrip("/") or None
        self._model = model or None
        self._timeout = timeout
        self._max_retries = max(0, max_retries)
        # Injected in tests (httpx.MockTransport) to exercise the real code path
        # without any network access.
        self._transport = transport
        # Injected in tests so a retry does not actually wait.
        self._sleep = sleep

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
        if response.status_code in RETRYABLE_STATUS_CODES:
            raise _RetryableStatus(
                response.status_code, _retry_after_seconds(response)
            )
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
            except _RetryableStatus as exc:
                network_attempts += 1
                last_error = exc
                logger.warning(
                    "AI provider attempt %d/%d failed: HTTP %d",
                    network_attempts,
                    self._max_retries + 1,
                    exc.status_code,
                )
                if network_attempts > self._max_retries:
                    break
                # The wait is capped, so a Retry-After of hours cannot stall the
                # request. Retrying is the only thing this branch does.
                self._sleep(_wait_before_retry(network_attempts, exc.retry_after))
                continue
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
                self._sleep(_wait_before_retry(network_attempts, None))
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

        # Exhausted the allowed attempts. A transient HTTP failure keeps its
        # status in the message; a transport failure gets the generic one, as
        # before. Either way the caller sees a controlled AiProviderError.
        if isinstance(last_error, AiProviderError):
            raise last_error
        raise AiProviderError("AI xizmatidan javob olishda xatolik yuz berdi.") from last_error


__all__ = [
    "MAX_REPAIR_ATTEMPTS",
    "MAX_RETRY_WAIT_SECONDS",
    "RETRYABLE_STATUS_CODES",
    "RETRY_BACKOFF_SECONDS",
    "OpenAiCompatibleProvider",
]
