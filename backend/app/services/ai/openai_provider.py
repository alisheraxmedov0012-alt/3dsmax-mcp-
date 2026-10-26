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

Every attempt, retry wait and repair call shares one wall-clock budget
(``budget``, default ``DEFAULT_REQUEST_BUDGET_SECONDS``). Each HTTP call gets
whichever is smaller: its own timeout or the time left in the budget, so no
single call outlives the deadline. When the budget is gone the request stops
with :class:`AiTimeout` instead of starting another call.

What the deadline does *not* do: it bounds how long *this process waits*. It
cannot cancel work already running at the provider, and it does not kill an
in-flight socket — it only stops waiting for it, and the per-call timeout ends
the wait at the remaining budget. An abandoned provider call may still be
completed and billed remotely.
"""
from __future__ import annotations

import logging
import time
from collections.abc import Callable

import httpx
from pydantic import ValidationError

from .base import (
    AiOutputError,
    AiProviderError,
    AiTimeout,
    DesignRequest,
    ProviderNotConfigured,
)
from .spec import DesignSpec, FurnitureType, RawDesignSpec, build_design_spec

logger = logging.getLogger("app.ai")

#: One repair attempt only. Bounded on purpose: every extra call costs money.
MAX_REPAIR_ATTEMPTS = 1

#: Statuses that signal a transient condition: the same request may succeed
#: later. 408/425/429 are explicit "try again" answers; 5xx means the provider
#: failed on its side. Everything else is permanent and is not retried.
RETRYABLE_STATUS_CODES: frozenset[int] = frozenset({408, 425, 429, 500, 502, 503, 504})

#: Hard ceiling on one wait, so a large or hostile ``Retry-After`` cannot stall
#: a request. The overall budget caps it further.
MAX_RETRY_WAIT_SECONDS = 5.0

#: Wait before the first retry when the provider sends no ``Retry-After``.
#: Doubles per attempt and is capped by ``MAX_RETRY_WAIT_SECONDS``.
RETRY_BACKOFF_SECONDS = 0.5

#: Wall-clock budget for one design request when the caller does not supply one.
#: Must stay below the frontend's 30s abort (``src/api/client.ts``) so the browser
#: gets a controlled error rather than a dead connection.
DEFAULT_REQUEST_BUDGET_SECONDS = 25.0

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


def _token_count(value: object) -> int | None:
    """A non-negative token count, or ``None`` for anything else.

    ``bool`` is rejected explicitly: it is a subclass of ``int``, so ``True``
    would otherwise be stored as one token.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value >= 0:
        return value
    return None


def _add_optional(current: int | None, increment: int | None) -> int | None:
    if increment is None:
        return current
    return (current or 0) + increment


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
        budget: float = DEFAULT_REQUEST_BUDGET_SECONDS,
        clock: Callable[[], float] = time.monotonic,
        max_output_tokens: int | None = None,
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
        # Per-request budget. Held on the instance, never shared, so concurrent
        # requests cannot shorten each other's deadline.
        self._budget = max(0.0, budget)
        # Monotonic clock, injected in tests to make deadline tests instant.
        self._clock = clock
        # Optional answer-length cap. Validated here as well as in the settings so
        # a directly constructed provider (a test, a future caller) cannot send a
        # nonsensical limit: anything but a positive int means "no cap".
        self._max_output_tokens = (
            max_output_tokens
            if isinstance(max_output_tokens, int)
            and not isinstance(max_output_tokens, bool)
            and max_output_tokens > 0
            else None
        )
        # Token counts reported by the provider for the *current* request. Reset
        # at the start of every call; kept as null when nothing was reported.
        self.last_usage: dict[str, int | None] = {
            "prompt_tokens": None,
            "completion_tokens": None,
            "total_tokens": None,
        }

    @property
    def is_configured(self) -> bool:
        return bool(self._api_key and self._base_url and self._model)

    def _remaining(self, deadline: float) -> float:
        """Time left in the budget; never negative."""
        return max(0.0, deadline - self._clock())

    def _wait_within_budget(self, seconds: float, deadline: float) -> bool:
        """Sleep ``seconds`` if it fits in the budget; report whether it did.

        A wait that would consume the remaining budget leaves no time for the
        call it is meant to precede, so it is refused instead of being shortened:
        retrying with no time left would only delay the error.
        """
        remaining = self._remaining(deadline)
        if seconds >= remaining:
            return False
        self._sleep(seconds)
        return True

    def _endpoint(self) -> str:
        assert self._base_url is not None  # guarded by is_configured
        return f"{self._base_url}/chat/completions"

    def _post(self, payload: dict, timeout: float) -> httpx.Response:
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        # The client is opened and closed per call, so its connection is released
        # on timeout, on error and on success alike.
        with httpx.Client(timeout=timeout, transport=self._transport) as client:
            return client.post(self._endpoint(), json=payload, headers=headers)

    def _interpret(self, content: str) -> DesignSpec:
        try:
            raw = RawDesignSpec.model_validate_json(content)
        except ValidationError as exc:
            raise AiOutputError("AI javobi kutilgan sxemaga mos kelmadi.") from exc
        return build_design_spec(raw, provider=self.name)

    def _request_once(self, payload: dict, timeout: float) -> str:
        response = self._post(payload, timeout)
        if response.status_code in RETRYABLE_STATUS_CODES:
            raise _RetryableStatus(
                response.status_code, _retry_after_seconds(response)
            )
        if response.status_code >= 400:
            # Do not include the body/headers: they may leak provider detail.
            raise AiProviderError(f"AI provayderi HTTP {response.status_code} qaytardi.")
        data = response.json()
        # Record what the provider reported *before* the content is validated, so
        # a call whose answer fails validation still counts toward the total: the
        # tokens were consumed whether or not we could use the answer.
        self._add_usage(data.get("usage"))
        return data["choices"][0]["message"]["content"]

    def _add_usage(self, usage: object) -> None:
        """Add one response's token counts to this request's running total.

        Only what the provider actually reported is counted; a missing or
        malformed block contributes nothing rather than a guess. Counts add up
        across retried and repaired calls because each of those calls really did
        consume tokens — summing them is accurate, not double counting.
        """
        if not isinstance(usage, dict):
            return
        prompt = _token_count(usage.get("prompt_tokens"))
        completion = _token_count(usage.get("completion_tokens"))
        total = _token_count(usage.get("total_tokens"))
        if total is None and (prompt is not None or completion is not None):
            total = (prompt or 0) + (completion or 0)
        if prompt is None and completion is None and total is None:
            return

        self.last_usage["prompt_tokens"] = _add_optional(
            self.last_usage["prompt_tokens"], prompt
        )
        self.last_usage["completion_tokens"] = _add_optional(
            self.last_usage["completion_tokens"], completion
        )
        self.last_usage["total_tokens"] = _add_optional(
            self.last_usage["total_tokens"], total
        )

    def generate_design(self, request: DesignRequest) -> DesignSpec:
        if not self.is_configured:
            raise ProviderNotConfigured(
                "AI provayderi sozlanmagan (APP_AI_API_KEY/APP_AI_MODEL kerak)."
            )

        # Reset before the first call: the provider instance may be reused, and a
        # previous request's tokens must never be attributed to this one.
        self.last_usage: dict[str, int | None] = {
            "prompt_tokens": None,
            "completion_tokens": None,
            "total_tokens": None,
        }

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
        if self._max_output_tokens is not None:
            # ``max_tokens`` is the field every OpenAI-compatible
            # ``/chat/completions`` implementation accepts (OpenAI's older models,
            # vLLM, Ollama, Mistral, LM Studio). OpenAI's newer reasoning models
            # want ``max_completion_tokens`` instead, but they already reject this
            # payload's ``temperature: 0`` and ``response_format``, so they are out
            # of scope for this adapter either way. This module has no per-provider
            # switch to pick the field name, so the widely supported one is used;
            # supporting the other would need a provider-specific setting.
            payload["max_tokens"] = self._max_output_tokens

        repair_left = MAX_REPAIR_ATTEMPTS
        network_attempts = 0
        last_error: Exception | None = None
        # Set when a retry is abandoned because its wait would not fit in the
        # budget: the request then ends as a timeout, not as a provider error.
        budget_exhausted = False
        # One deadline for the whole request: every call, wait and repair draws
        # from the same budget.
        deadline = self._clock() + self._budget

        while True:
            remaining = self._remaining(deadline)
            if remaining <= 0:
                raise AiTimeout(
                    "AI so'rovi vaqt chegarasidan oshdi (javob olinmadi)."
                )

            try:
                # Never outlive the deadline: the call may wait at most what is
                # left of the budget.
                content = self._request_once(payload, min(self._timeout, remaining))
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
                if not self._wait_within_budget(
                    _wait_before_retry(network_attempts, exc.retry_after), deadline
                ):
                    budget_exhausted = True
                    break
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
                if not self._wait_within_budget(
                    _wait_before_retry(network_attempts, None), deadline
                ):
                    budget_exhausted = True
                    break
                continue

            try:
                return self._interpret(content)
            except AiOutputError:
                if repair_left <= 0:
                    raise
                # No budget for another call means no repair attempt either.
                if self._remaining(deadline) <= 0:
                    raise AiTimeout(
                        "AI so'rovi vaqt chegarasidan oshdi (javob tekshirilmadi)."
                    ) from None
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

        # The budget, not the attempt count, ended the request: report that
        # honestly instead of blaming the provider. This also keeps the internal
        # retry error from ever reaching the caller.
        if budget_exhausted or self._remaining(deadline) <= 0:
            raise AiTimeout("AI so'rovi vaqt chegarasidan oshdi.")

        # Exhausted the allowed attempts. A transient HTTP failure keeps its
        # status in the message; a transport failure gets the generic one, as
        # before. Either way the caller sees a controlled AiProviderError.
        if isinstance(last_error, AiProviderError):
            raise last_error
        raise AiProviderError("AI xizmatidan javob olishda xatolik yuz berdi.") from last_error


__all__ = [
    "DEFAULT_REQUEST_BUDGET_SECONDS",
    "MAX_REPAIR_ATTEMPTS",
    "MAX_RETRY_WAIT_SECONDS",
    "RETRYABLE_STATUS_CODES",
    "RETRY_BACKOFF_SECONDS",
    "OpenAiCompatibleProvider",
]
