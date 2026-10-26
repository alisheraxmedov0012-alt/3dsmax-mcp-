"""A3.4 F11 — ``response_format`` compatibility on OpenAI-compatible providers.

Some gateways implementing ``/chat/completions`` reject ``response_format``
outright. Before this change the field was always sent, so such a gateway
answered 400 and the operator saw only "AI provayderi HTTP 400 qaytardi" with no
hint about the cause or the remedy.

The fix is a configuration switch plus an actionable message — deliberately not
an automatic retry without the field, because a second call costs money and a 400
can also mean a bad model name, which retrying would hide.

Every request here is captured from ``httpx.MockTransport``; no provider is
contacted.
"""
from __future__ import annotations

import json

import httpx
import pytest

from app.config import Settings, get_settings
from app.services.ai.base import AiOutputError, AiProviderError, DesignRequest
from app.services.ai.openai_provider import OpenAiCompatibleProvider
from app.services.ai.registry import get_ai_provider

_VALID_SPEC = json.dumps(
    {
        "furniture": "table",
        "dimensions": {"width_cm": 180, "height_cm": 75, "depth_cm": 60},
        "confidence": "high",
    }
)


def _capture(handler, **kwargs):
    """Return (provider, payloads) with every request body recorded."""
    payloads: list[dict] = []

    def wrapped(request: httpx.Request) -> httpx.Response:
        payloads.append(json.loads(request.content))
        return handler(request, payloads)

    kwargs.setdefault("max_retries", 0)
    provider = OpenAiCompatibleProvider(
        api_key="test-key-not-real",
        base_url="https://ai.example.invalid/v1",
        model="test-model",
        transport=httpx.MockTransport(wrapped),
        **kwargs,
    )
    return provider, payloads


def _ok(_request: httpx.Request, _payloads: list[dict]) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": _VALID_SPEC}}]})


@pytest.fixture(autouse=True)
def _clean_settings():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


# --------------------------------------------------------------------------- #
# 1. The existing JSON-mode payload is unchanged by default
# --------------------------------------------------------------------------- #


def test_json_mode_is_on_by_default():
    provider, payloads = _capture(_ok)
    provider.generate_design(DesignRequest(text="stol"))

    assert payloads[0]["response_format"] == {"type": "json_object"}


def test_explicit_json_mode_true_sends_the_field():
    provider, payloads = _capture(_ok, json_mode=True)
    provider.generate_design(DesignRequest(text="stol"))

    assert payloads[0]["response_format"] == {"type": "json_object"}


def test_only_an_explicit_false_disables_the_field():
    """Any other value keeps the previous behaviour, so a typo cannot disable it."""
    for value in (True, None, 1, "false-typo"):
        provider, payloads = _capture(_ok, json_mode=value)
        provider.generate_design(DesignRequest(text="stol"))
        assert payloads[0]["response_format"] == {"type": "json_object"}, value


# --------------------------------------------------------------------------- #
# 2. Turning it off for an incompatible provider
# --------------------------------------------------------------------------- #


def test_json_mode_false_omits_the_field():
    provider, payloads = _capture(_ok, json_mode=False)
    provider.generate_design(DesignRequest(text="stol"))

    assert "response_format" not in payloads[0]


def test_json_mode_false_keeps_the_rest_of_the_payload():
    provider, payloads = _capture(_ok, json_mode=False, max_output_tokens=99)
    provider.generate_design(DesignRequest(text="180x60x75 sm stol"))

    payload = payloads[0]
    assert payload["model"] == "test-model"
    assert payload["temperature"] == 0
    assert payload["messages"][1]["content"] == "180x60x75 sm stol"
    # F9 still applies with JSON mode off.
    assert payload["max_tokens"] == 99


def test_answer_is_still_validated_as_json_when_json_mode_is_off():
    """Turning the field off never skips the schema check."""
    def handler(_request: httpx.Request, _payloads: list[dict]) -> httpx.Response:
        return httpx.Response(
            200, json={"choices": [{"message": {"content": "not json at all"}}]}
        )

    provider, _payloads = _capture(handler, json_mode=False)
    with pytest.raises(AiOutputError):
        provider.generate_design(DesignRequest(text="stol"))


def test_a_valid_json_answer_still_builds_a_spec_when_json_mode_is_off():
    provider, _payloads = _capture(_ok, json_mode=False)
    spec = provider.generate_design(DesignRequest(text="stol"))

    assert spec.furniture.value == "table"


# --------------------------------------------------------------------------- #
# 3. A provider that rejects the field
# --------------------------------------------------------------------------- #


def _rejects(_request: httpx.Request, _payloads: list[dict]) -> httpx.Response:
    return httpx.Response(
        400, json={"error": {"message": "response_format is not supported"}}
    )


def test_rejection_is_reported_with_an_actionable_hint():
    """The operator must learn what to change, not just that a 400 happened."""
    provider, _payloads = _capture(_rejects, max_retries=2)
    with pytest.raises(AiProviderError) as excinfo:
        provider.generate_design(DesignRequest(text="stol"))

    message = str(excinfo.value)
    assert "400" in message
    assert "APP_AI_JSON_MODE" in message
    assert "response_format" in message


def test_rejection_is_not_retried():
    """400 is permanent: retrying the same request cannot help."""
    provider, payloads = _capture(_rejects, max_retries=3)
    with pytest.raises(AiProviderError):
        provider.generate_design(DesignRequest(text="stol"))

    assert len(payloads) == 1


def test_no_hint_is_added_when_json_mode_is_off():
    """With the field off, a 400 is about something else; do not mislead."""
    provider, payloads = _capture(_rejects, max_retries=0, json_mode=False)
    with pytest.raises(AiProviderError) as excinfo:
        provider.generate_design(DesignRequest(text="stol"))

    assert "APP_AI_JSON_MODE" not in str(excinfo.value)
    assert len(payloads) == 1


@pytest.mark.parametrize("status", [401, 403, 404, 409])
def test_other_permanent_errors_do_not_get_the_hint(status):
    def handler(_request: httpx.Request, _payloads: list[dict]) -> httpx.Response:
        return httpx.Response(status, json={"error": "nope"})

    provider, _payloads = _capture(handler, max_retries=2)
    with pytest.raises(AiProviderError) as excinfo:
        provider.generate_design(DesignRequest(text="stol"))

    assert "APP_AI_JSON_MODE" not in str(excinfo.value)


def test_the_error_never_contains_the_api_key():
    provider, _payloads = _capture(_rejects, max_retries=0)
    with pytest.raises(AiProviderError) as excinfo:
        provider.generate_design(DesignRequest(text="stol"))

    assert "test-key-not-real" not in str(excinfo.value)


def test_fixing_the_setting_makes_the_same_request_work():
    """The documented remedy must actually be the fix."""
    def handler(_request: httpx.Request, payloads: list[dict]) -> httpx.Response:
        # Mimics a gateway that only rejects the request *with* the field.
        if "response_format" in payloads[-1]:
            return httpx.Response(400, json={"error": "unsupported response_format"})
        return httpx.Response(200, json={"choices": [{"message": {"content": _VALID_SPEC}}]})

    provider, payloads = _capture(handler, max_retries=0, json_mode=False)
    spec = provider.generate_design(DesignRequest(text="stol"))

    assert spec.furniture.value == "table"
    assert "response_format" not in payloads[0]


# --------------------------------------------------------------------------- #
# 4. Neighbouring behaviour is untouched
# --------------------------------------------------------------------------- #


def test_retryable_status_still_retries_with_json_mode_off():
    """F1: the retry policy does not depend on this setting."""
    calls: list[int] = []

    def handler(_request: httpx.Request, _payloads: list[dict]) -> httpx.Response:
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(503)
        return httpx.Response(200, json={"choices": [{"message": {"content": _VALID_SPEC}}]})

    provider, payloads = _capture(handler, max_retries=1, json_mode=False, sleep=lambda _s: None)
    provider.generate_design(DesignRequest(text="stol"))

    assert len(payloads) == 2
    assert all("response_format" not in payload for payload in payloads)


def test_repair_still_works_with_json_mode_off():
    contents = ["not json at all", _VALID_SPEC]
    payloads: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payloads.append(json.loads(request.content))
        return httpx.Response(
            200, json={"choices": [{"message": {"content": contents[len(payloads) - 1]}}]}
        )

    provider = OpenAiCompatibleProvider(
        api_key="test-key-not-real",
        base_url="https://ai.example.invalid/v1",
        model="test-model",
        max_retries=1,
        transport=httpx.MockTransport(handler),
        json_mode=False,
    )
    spec = provider.generate_design(DesignRequest(text="stol"))

    assert spec.furniture.value == "table"
    assert len(payloads) == 2
    assert all("response_format" not in payload for payload in payloads)


def test_deadline_still_applies_with_json_mode_off():
    """F2: the budget is independent of this setting."""
    from app.services.ai.base import AiTimeout

    class _Clock:
        def __init__(self) -> None:
            self.now = 0.0

        def __call__(self) -> float:
            return self.now

        def sleep(self, seconds: float) -> None:
            self.now += seconds

    clock = _Clock()

    def handler(_request: httpx.Request) -> httpx.Response:
        clock.now += 30.0
        return httpx.Response(503)

    provider = OpenAiCompatibleProvider(
        api_key="test-key-not-real",
        base_url="https://ai.example.invalid/v1",
        model="test-model",
        max_retries=2,
        transport=httpx.MockTransport(handler),
        clock=clock,
        sleep=clock.sleep,
        budget=25.0,
        json_mode=False,
    )

    with pytest.raises(AiTimeout):
        provider.generate_design(DesignRequest(text="stol"))


def test_token_accounting_still_works_with_json_mode_off():
    """F4: usage capture is independent of this setting."""
    def handler(_request: httpx.Request, _payloads: list[dict]) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": _VALID_SPEC}}],
                "usage": {"prompt_tokens": 70, "completion_tokens": 30},
            },
        )

    provider, _payloads = _capture(handler, json_mode=False)
    provider.generate_design(DesignRequest(text="stol"))

    assert provider.last_usage == {
        "prompt_tokens": 70,
        "completion_tokens": 30,
        "total_tokens": 100,
    }


# --------------------------------------------------------------------------- #
# 5. Configuration reaches the provider
# --------------------------------------------------------------------------- #


def test_setting_defaults_to_enabled():
    assert Settings().ai_json_mode is True


def _configure(monkeypatch, **env) -> None:
    monkeypatch.setenv("APP_AI_PROVIDER", "openai_compatible")
    monkeypatch.setenv("APP_AI_API_KEY", "test-key-not-real")
    monkeypatch.setenv("APP_AI_MODEL", "test-model")
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()


@pytest.mark.parametrize("raw", ["false", "False", "0", "no", "off"])
def test_setting_can_be_turned_off_from_the_environment(monkeypatch, raw):
    _configure(monkeypatch, APP_AI_JSON_MODE=raw)
    provider = get_ai_provider()

    assert isinstance(provider, OpenAiCompatibleProvider)
    assert provider._json_mode is False


@pytest.mark.parametrize("raw", ["true", "True", "1", "yes", "on"])
def test_setting_can_be_left_on_from_the_environment(monkeypatch, raw):
    _configure(monkeypatch, APP_AI_JSON_MODE=raw)
    provider = get_ai_provider()

    assert provider._json_mode is True


def test_the_offline_provider_is_unaffected(monkeypatch):
    monkeypatch.setenv("APP_AI_PROVIDER", "local")
    monkeypatch.setenv("APP_AI_JSON_MODE", "false")
    get_settings.cache_clear()

    provider = get_ai_provider()
    assert provider.name == "local"
    assert not hasattr(provider, "_json_mode")
