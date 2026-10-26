"""A3.4 F5 — ``azure`` must not be routed to the OpenAI adapter.

Azure OpenAI is a different protocol from the one this project implements:

    OpenAI : {base}/chat/completions                       + Authorization: Bearer
    Azure  : {base}/openai/deployments/{d}/chat/completions?api-version=...
                                                           + api-key: ...

No Azure adapter exists in this codebase, yet the name sat in the OpenAI alias
set, so ``APP_AI_PROVIDER=azure`` silently produced the OpenAI adapter and a URL
Azure answers with 404. It is now rejected with a reason instead.

These are unit tests against the registry and the stub provider. **No Azure
service was contacted, no Azure resource exists, and nothing here proves Azure
works** — it only proves the name is refused rather than misrouted.
"""
from __future__ import annotations

import pytest

from app.config import get_settings
from app.services.ai.base import AiOutputError, DesignRequest, ProviderNotConfigured
from app.services.ai.local_provider import LocalHeuristicProvider
from app.services.ai.openai_provider import OpenAiCompatibleProvider
from app.services.ai.registry import get_ai_provider
from tests.test_ai import _authenticated, _use_provider


@pytest.fixture(autouse=True)
def _clean_settings():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _configure(monkeypatch, provider: str, **extra) -> None:
    monkeypatch.setenv("APP_AI_PROVIDER", provider)
    monkeypatch.setenv("APP_AI_API_KEY", "test-key-not-real")
    monkeypatch.setenv("APP_AI_MODEL", "test-model")
    monkeypatch.setenv("APP_AI_BASE_URL", "https://myres.openai.azure.com")
    for key, value in extra.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()


# --------------------------------------------------------------------------- #
# 1. azure is not misrouted
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("name", ["azure", "azure_openai", "azure-openai", "AZURE"])
def test_azure_is_not_routed_to_the_openai_adapter(monkeypatch, name):
    """The defect: this used to return OpenAiCompatibleProvider."""
    _configure(monkeypatch, name)

    with pytest.raises(ProviderNotConfigured):
        get_ai_provider()


def test_azure_never_yields_a_provider_object(monkeypatch):
    """Belt and braces: nothing callable may come back for this name."""
    _configure(monkeypatch, "azure")

    try:
        provider = get_ai_provider()
    except ProviderNotConfigured:
        return
    raise AssertionError(f"azure produced {type(provider).__name__}; it must not")


# --------------------------------------------------------------------------- #
# 2. The configuration message is understandable
# --------------------------------------------------------------------------- #


def test_azure_message_explains_the_real_reason(monkeypatch):
    _configure(monkeypatch, "azure")

    with pytest.raises(ProviderNotConfigured) as excinfo:
        get_ai_provider()

    message = str(excinfo.value)
    # Names the service, the missing protocol and the fact that it is not built.
    assert "Azure" in message
    assert "api-version" in message
    assert "adapter" in message
    # It must not read like the generic "unknown provider" text.
    assert "hali qo'llab-quvvatlanmaydi." not in message.rstrip()


def test_azure_message_does_not_leak_the_key(monkeypatch):
    _configure(monkeypatch, "azure")

    with pytest.raises(ProviderNotConfigured) as excinfo:
        get_ai_provider()

    assert "test-key-not-real" not in str(excinfo.value)


def test_azure_name_is_accepted_as_a_settings_value(monkeypatch):
    """The *name* must load; refusing it must be the registry's decision.

    Raising during settings load instead would make the app fail to start with
    no route to a 503, which is a worse experience than a controlled refusal.
    """
    _configure(monkeypatch, "azure")
    assert get_settings().ai_provider == "azure"


# --------------------------------------------------------------------------- #
# 3. Supported names keep working
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("name", ["openai", "openai_compatible", "openai-compatible"])
def test_openai_compatible_names_still_work(monkeypatch, name):
    _configure(monkeypatch, name)
    provider = get_ai_provider()

    assert isinstance(provider, OpenAiCompatibleProvider)
    assert provider.name == "openai_compatible"


@pytest.mark.parametrize("name", ["local", "local-heuristic"])
def test_local_names_still_work(monkeypatch, name):
    _configure(monkeypatch, name)
    provider = get_ai_provider()

    assert isinstance(provider, LocalHeuristicProvider)


def test_openai_provider_still_builds_the_openai_endpoint(monkeypatch):
    """Removing azure must not disturb the shape the OpenAI path builds."""
    _configure(monkeypatch, "openai_compatible")
    provider = get_ai_provider()

    assert provider._endpoint() == "https://myres.openai.azure.com/chat/completions"


# --------------------------------------------------------------------------- #
# 4. Unknown names keep the previous behaviour
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("name", ["mistral", "anthropic", "gemini", "nonsense"])
def test_unknown_names_keep_the_generic_error(monkeypatch, name):
    _configure(monkeypatch, name)

    with pytest.raises(ProviderNotConfigured) as excinfo:
        get_ai_provider()

    message = str(excinfo.value)
    assert name.lower() in message.lower()
    assert "qo'llab-quvvatlanmaydi" in message
    # The Azure-specific explanation must not be borrowed by other names.
    assert "api-version" not in message


def test_none_still_means_unconfigured(monkeypatch):
    monkeypatch.setenv("APP_AI_PROVIDER", "none")
    get_settings.cache_clear()

    with pytest.raises(ProviderNotConfigured):
        get_ai_provider()


# --------------------------------------------------------------------------- #
# 5. The API answers a controlled 503 (F7 mapping still applies)
# --------------------------------------------------------------------------- #


def test_azure_through_the_endpoint_is_503_ai_unconfigured(client, monkeypatch, caplog):
    """The rejection must reach the client as the documented error, not a 500.

    The client keeps the existing generic message for every unconfigured case, so
    the reason is checked in the log where an operator will look for it.
    """
    _configure(monkeypatch, "azure")
    _authenticated(client, "f5-azure@example.com")

    with caplog.at_level("WARNING", logger="app.ai"):
        response = client.post("/api/ai/design", json={"text": "stol"})

    assert response.status_code == 503, response.text
    assert response.json()["error"]["code"] == "ai_unconfigured"
    # The API message stays the stable, user-facing one.
    assert response.json()["error"]["message"].startswith("AI xizmati hozircha")
    # The reason is not lost: it is in the log.
    assert "Azure" in caplog.text
    assert "api-version" in caplog.text


def test_azure_leaks_no_key_in_the_response_or_the_log(client, monkeypatch, caplog):
    _configure(monkeypatch, "azure")
    _authenticated(client, "f5-azure-secret@example.com")

    with caplog.at_level("WARNING", logger="app.ai"):
        body = client.post("/api/ai/design", json={"text": "stol"}).text

    assert "test-key-not-real" not in body
    assert "test-key-not-real" not in caplog.text


# --------------------------------------------------------------------------- #
# 6. Neighbouring behaviour is untouched
# --------------------------------------------------------------------------- #


def test_retry_and_deadline_still_work_through_the_openai_path():
    """F1/F2 are adapter-level and independent of the alias list."""
    import httpx

    calls: list[int] = []

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(503)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": '{"furniture": "table", "confidence": "high"}'
                        }
                    }
                ]
            },
        )

    provider = OpenAiCompatibleProvider(
        api_key="test-key-not-real",
        base_url="https://ai.example.invalid/v1",
        model="test-model",
        max_retries=1,
        sleep=lambda _s: None,
        transport=httpx.MockTransport(handler),
    )
    result = provider.generate_design(DesignRequest(text="stol"))

    assert result.furniture.value == "table"
    assert len(calls) == 2


def test_json_mode_and_token_limit_still_reach_the_payload():
    """F11 and F9 are unaffected by the registry change."""
    import json

    import httpx

    payloads: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payloads.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": "{}"}}]})

    provider = OpenAiCompatibleProvider(
        api_key="test-key-not-real",
        base_url="https://ai.example.invalid/v1",
        model="test-model",
        max_retries=0,
        transport=httpx.MockTransport(handler),
        max_output_tokens=64,
        json_mode=False,
    )
    # The empty JSON answer is not a valid spec, which does not matter here: the
    # point is what the provider put on the wire.
    with pytest.raises(AiOutputError):
        provider.generate_design(DesignRequest(text="stol"))

    assert "response_format" not in payloads[0]
    assert payloads[0]["max_tokens"] == 64


def test_local_provider_still_skips_the_global_ceiling(client, monkeypatch):
    """F6 is unchanged by this task."""
    from sqlalchemy import select

    from app.database import SessionLocal
    from app.models import GlobalUsageCounter

    def global_count() -> int:
        with SessionLocal() as db:
            rows = db.execute(select(GlobalUsageCounter)).scalars().all()
            return sum(row.count for row in rows)

    before = global_count()
    _use_provider(monkeypatch, LocalHeuristicProvider())
    _authenticated(client, "f5-local@example.com")

    assert client.post("/api/ai/design", json={"text": "stol"}).status_code == 200
    assert global_count() == before


def test_base_url_https_rule_still_applies(monkeypatch):
    """F8 is unchanged: a plain-HTTP external URL is still refused."""
    from pydantic import ValidationError

    from app.config import Settings

    with pytest.raises(ValidationError):
        Settings(ai_base_url="http://api.openai.com/v1")
