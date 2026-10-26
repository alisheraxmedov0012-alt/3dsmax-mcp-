"""A3.4 F9 — optional cap on the number of tokens the provider may return.

The setting is off by default, so the request payload is byte-for-byte what it
was before unless an operator explicitly configures a cap. When a cap *is*
configured it travels as ``max_tokens``, the field every OpenAI-compatible
``/chat/completions`` implementation accepts.

Nothing here reaches a real provider: the payload is captured from
``httpx.MockTransport``, which sees the exact request the adapter would send.
"""
from __future__ import annotations

import json

import httpx
import pytest
from pydantic import ValidationError

from app.config import Settings, get_settings
from app.services.ai.base import DesignRequest
from app.services.ai.openai_provider import OpenAiCompatibleProvider
from app.services.ai.registry import get_ai_provider

_VALID_SPEC = json.dumps(
    {
        "furniture": "table",
        "dimensions": {"width_cm": 180, "height_cm": 75, "depth_cm": 60},
        "confidence": "high",
    }
)


def _capturing_provider(**kwargs) -> tuple[OpenAiCompatibleProvider, list[dict]]:
    """A provider whose transport records every payload it sends."""
    payloads: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payloads.append(json.loads(request.content))
        return httpx.Response(
            200, json={"choices": [{"message": {"content": _VALID_SPEC}}]}
        )

    kwargs.setdefault("max_retries", 0)
    provider = OpenAiCompatibleProvider(
        api_key="test-key-not-real",
        base_url="https://ai.example.invalid/v1",
        model="test-model",
        transport=httpx.MockTransport(handler),
        **kwargs,
    )
    return provider, payloads


@pytest.fixture(autouse=True)
def _clean_settings():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


# --------------------------------------------------------------------------- #
# Payload behaviour
# --------------------------------------------------------------------------- #


def test_no_cap_is_sent_by_default():
    """The default must not change the request at all."""
    provider, payloads = _capturing_provider()
    provider.generate_design(DesignRequest(text="stol"))

    assert len(payloads) == 1
    assert "max_tokens" not in payloads[0]
    assert "max_completion_tokens" not in payloads[0]


def test_explicit_none_sends_no_cap():
    provider, payloads = _capturing_provider(max_output_tokens=None)
    provider.generate_design(DesignRequest(text="stol"))

    assert "max_tokens" not in payloads[0]


def test_positive_cap_is_sent_as_max_tokens():
    provider, payloads = _capturing_provider(max_output_tokens=512)
    provider.generate_design(DesignRequest(text="stol"))

    assert payloads[0]["max_tokens"] == 512
    # Only one of the two mutually exclusive fields is used.
    assert "max_completion_tokens" not in payloads[0]


def test_the_cap_does_not_disturb_the_rest_of_the_payload():
    """Adding a cap must be additive: every other field keeps its value."""
    provider, payloads = _capturing_provider(max_output_tokens=256)
    provider.generate_design(DesignRequest(text="180x60x75 sm stol"))

    payload = payloads[0]
    assert payload["model"] == "test-model"
    assert payload["temperature"] == 0
    assert payload["response_format"] == {"type": "json_object"}
    assert payload["messages"][1]["content"] == "180x60x75 sm stol"
    assert payload["max_tokens"] == 256


@pytest.mark.parametrize("value", [0, -1, -512, True, False, 1.5, "512", [512]])
def test_a_nonsensical_cap_is_ignored_by_the_provider(value):
    """A directly constructed provider never sends an unusable limit.

    The settings validator rejects these earlier; this guards the provider
    itself, so a test or a future caller cannot slip one through.
    """
    provider, payloads = _capturing_provider(max_output_tokens=value)
    provider.generate_design(DesignRequest(text="stol"))

    assert "max_tokens" not in payloads[0]


def test_cap_is_applied_to_the_repair_call_too():
    """A repaired answer is a new request and carries the same cap."""
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
        max_output_tokens=128,
    )
    provider.generate_design(DesignRequest(text="stol"))

    assert len(payloads) == 2
    assert all(payload["max_tokens"] == 128 for payload in payloads)


def test_cap_is_applied_to_every_retry():
    """A retried request must use the same cap, not fall back to no cap."""
    calls: list[int] = []
    payloads: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payloads.append(json.loads(request.content))
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(503)
        return httpx.Response(200, json={"choices": [{"message": {"content": _VALID_SPEC}}]})

    provider = OpenAiCompatibleProvider(
        api_key="test-key-not-real",
        base_url="https://ai.example.invalid/v1",
        model="test-model",
        max_retries=1,
        sleep=lambda _s: None,
        transport=httpx.MockTransport(handler),
        max_output_tokens=64,
    )
    provider.generate_design(DesignRequest(text="stol"))

    assert len(payloads) == 2
    assert all(payload["max_tokens"] == 64 for payload in payloads)


# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #


def test_setting_defaults_to_none():
    assert Settings().ai_max_output_tokens is None


def test_setting_accepts_a_positive_integer(monkeypatch):
    monkeypatch.setenv("APP_AI_MAX_OUTPUT_TOKENS", "512")
    get_settings.cache_clear()
    assert get_settings().ai_max_output_tokens == 512


@pytest.mark.parametrize("raw", ["0", "-1", "-512"])
def test_setting_rejects_zero_and_negative(monkeypatch, raw):
    monkeypatch.setenv("APP_AI_MAX_OUTPUT_TOKENS", raw)
    get_settings.cache_clear()
    with pytest.raises(ValidationError):
        get_settings()


@pytest.mark.parametrize("raw", ["true", "false", "yes", "many", "1.5"])
def test_setting_rejects_booleans_and_wrong_types(monkeypatch, raw):
    monkeypatch.setenv("APP_AI_MAX_OUTPUT_TOKENS", raw)
    get_settings.cache_clear()
    with pytest.raises(ValidationError):
        get_settings()


def test_setting_rejects_a_boolean_passed_directly():
    """Env vars arrive as strings, but a direct caller could pass a real bool."""
    with pytest.raises(ValidationError):
        Settings(ai_max_output_tokens=True)


def test_blank_setting_means_no_cap(monkeypatch):
    """An empty value is treated as unset, like every other optional setting."""
    monkeypatch.setenv("APP_AI_MAX_OUTPUT_TOKENS", "")
    get_settings.cache_clear()
    assert get_settings().ai_max_output_tokens is None


# --------------------------------------------------------------------------- #
# Settings reach the provider
# --------------------------------------------------------------------------- #


def _configure_real_provider(monkeypatch, **env) -> None:
    monkeypatch.setenv("APP_AI_PROVIDER", "openai_compatible")
    monkeypatch.setenv("APP_AI_API_KEY", "test-key-not-real")
    monkeypatch.setenv("APP_AI_MODEL", "test-model")
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()


def test_registry_passes_the_cap_to_the_provider(monkeypatch):
    _configure_real_provider(monkeypatch, APP_AI_MAX_OUTPUT_TOKENS="777")
    provider = get_ai_provider()

    assert isinstance(provider, OpenAiCompatibleProvider)
    assert provider._max_output_tokens == 777


def test_registry_passes_no_cap_when_unset(monkeypatch):
    _configure_real_provider(monkeypatch)
    monkeypatch.delenv("APP_AI_MAX_OUTPUT_TOKENS", raising=False)
    get_settings.cache_clear()
    provider = get_ai_provider()

    assert isinstance(provider, OpenAiCompatibleProvider)
    assert provider._max_output_tokens is None


def test_the_offline_provider_takes_no_arguments(monkeypatch):
    """The local provider has no request payload, so this setting never reaches it."""
    monkeypatch.setenv("APP_AI_PROVIDER", "local")
    monkeypatch.setenv("APP_AI_MAX_OUTPUT_TOKENS", "128")
    get_settings.cache_clear()

    provider = get_ai_provider()
    assert provider.name == "local"
    assert not hasattr(provider, "_max_output_tokens")


# --------------------------------------------------------------------------- #
# The cap does not disturb the neighbouring features
# --------------------------------------------------------------------------- #


def test_usage_accounting_still_works_with_a_cap():
    """F4: token capture is independent of the limit."""
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": _VALID_SPEC}}],
                "usage": {"prompt_tokens": 100, "completion_tokens": 40},
            },
        )

    provider = OpenAiCompatibleProvider(
        api_key="test-key-not-real",
        base_url="https://ai.example.invalid/v1",
        model="test-model",
        transport=httpx.MockTransport(handler),
        max_output_tokens=64,
    )
    provider.generate_design(DesignRequest(text="stol"))

    assert provider.last_usage == {
        "prompt_tokens": 100,
        "completion_tokens": 40,
        "total_tokens": 140,
    }


def test_a_cap_is_still_bounded_by_the_deadline():
    """F2: the cap does not bypass the request budget."""
    from app.services.ai.base import AiTimeout

    class _Clock:
        def __init__(self) -> None:
            self.now = 0.0

        def __call__(self) -> float:
            return self.now

        def sleep(self, seconds: float) -> None:
            self.now += seconds

    clock = _Clock()

    def handler(_: httpx.Request) -> httpx.Response:
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
        max_output_tokens=64,
    )

    with pytest.raises(AiTimeout):
        provider.generate_design(DesignRequest(text="stol"))
