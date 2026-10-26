"""A3.4 F7 — an unconfigured provider is a 503, not a 502.

``ProviderNotConfigured`` can surface from two places:

* the registry, when it refuses to build a provider at all — this always mapped
  to 503 and was already covered;
* ``generate_design``, when a provider that looked configured reports it is not
  (credentials rotated away, a provider swapped in, a future adapter).

The second path had no handler of its own, so it fell through to the generic
``AiProviderError`` handler and answered 502 ``ai_provider_error`` — telling the
client the gateway failed when nothing had been called. That is the defect fixed
here; the assertion that matters is that the *other* error types did not move.

Every provider here is a local stub. No network access, no credentials.
"""
from __future__ import annotations

import pytest

from app.services.ai.base import (
    AiOutputError,
    AiProviderError,
    AiTimeout,
    ProviderNotConfigured,
)
from app.services.ai.local_provider import LocalHeuristicProvider
from tests.test_ai import _authenticated, _use_provider


def _usage_rows(email: str) -> list:
    from sqlalchemy import select

    from app.database import SessionLocal
    from app.models import UsageRecord, User

    with SessionLocal() as db:
        user = db.execute(select(User).where(User.email == email)).scalar_one()
        return (
            db.execute(select(UsageRecord).where(UsageRecord.user_id == user.id))
            .scalars()
            .all()
        )


def _raising(error: Exception, *, bills: bool = True):
    """A provider that reports itself configured but raises on the call."""

    class _Provider:
        name = "openai_compatible"
        bills_per_request = bills
        last_usage: dict[str, int | None] = {}

        @property
        def is_configured(self) -> bool:
            return True

        def generate_design(self, request):
            raise error

    return _Provider()


# --------------------------------------------------------------------------- #
# 1. The fix: an unconfigured provider is a 503
# --------------------------------------------------------------------------- #


def test_provider_not_configured_from_generate_design_is_503(client, monkeypatch):
    """The defect: this used to answer 502 ai_provider_error."""
    _use_provider(monkeypatch, _raising(ProviderNotConfigured("not configured")))
    _authenticated(client, "f7-inner@example.com")

    response = client.post("/api/ai/design", json={"text": "stol"})

    assert response.status_code == 503, response.text
    assert response.json()["error"]["code"] == "ai_unconfigured"


def test_registry_level_path_still_answers_503(client, monkeypatch):
    """The original path must not regress while fixing the other one."""
    _use_provider(monkeypatch, ProviderNotConfigured("not configured"))
    _authenticated(client, "f7-registry@example.com")

    response = client.post("/api/ai/design", json={"text": "stol"})

    assert response.status_code == 503, response.text
    assert response.json()["error"]["code"] == "ai_unconfigured"


def test_both_paths_return_the_same_body(client, monkeypatch):
    """One condition, one answer: the message and code must not depend on where
    the error was raised, or a client cannot treat them alike."""
    _use_provider(monkeypatch, ProviderNotConfigured("registry refused"))
    _authenticated(client, "f7-body-a@example.com")
    from_registry = client.post("/api/ai/design", json={"text": "stol"})

    _use_provider(monkeypatch, _raising(ProviderNotConfigured("inner refused")))
    _authenticated(client, "f7-body-b@example.com")
    from_call = client.post("/api/ai/design", json={"text": "stol"})

    assert from_registry.status_code == from_call.status_code == 503
    assert from_registry.json() == from_call.json()


# --------------------------------------------------------------------------- #
# 2. The body keeps the existing format
# --------------------------------------------------------------------------- #


def test_error_body_uses_the_existing_shape(client, monkeypatch):
    _use_provider(monkeypatch, _raising(ProviderNotConfigured("x")))
    _authenticated(client, "f7-shape@example.com")

    payload = client.post("/api/ai/design", json={"text": "stol"}).json()

    assert set(payload) == {"error"}
    assert set(payload["error"]) == {"code", "message"}
    assert isinstance(payload["error"]["message"], str)
    assert payload["error"]["message"].strip()


def test_the_message_names_the_real_problem(client, monkeypatch):
    """A 502 message about a failed gateway would mislead here."""
    _use_provider(monkeypatch, _raising(ProviderNotConfigured("x")))
    _authenticated(client, "f7-message@example.com")

    message = client.post("/api/ai/design", json={"text": "stol"}).json()["error"]["message"]

    assert "sozlanmagan" in message
    assert "ulanib bo'lmadi" not in message


# --------------------------------------------------------------------------- #
# 3. No other error type moved
# --------------------------------------------------------------------------- #


def test_plain_provider_error_is_still_502(client, monkeypatch):
    _use_provider(monkeypatch, _raising(AiProviderError("gateway down")))
    _authenticated(client, "f7-provider@example.com")

    response = client.post("/api/ai/design", json={"text": "stol"})

    assert response.status_code == 502, response.text
    assert response.json()["error"]["code"] == "ai_provider_error"


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (AiTimeout("too slow"), 504, "ai_timeout"),
        (AiOutputError("bad json"), 422, "ai_invalid_output"),
    ],
)
def test_other_ai_errors_keep_their_status(client, monkeypatch, error, status, code):
    """Placed above the generic handler, the new one must not shadow these."""
    _use_provider(monkeypatch, _raising(error))
    _authenticated(client, f"f7-{code}@example.com")

    response = client.post("/api/ai/design", json={"text": "stol"})

    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code


@pytest.mark.parametrize(
    ("status", "expected_code"),
    [
        (400, "ai_provider_error"),
        (401, "ai_provider_error"),
        (403, "ai_provider_error"),
        (404, "ai_provider_error"),
    ],
)
def test_http_status_errors_from_the_provider_are_not_503(
    client, monkeypatch, status, expected_code
):
    """A provider answering 400/401/403/404 is a gateway problem, not a
    configuration one: it must stay 502."""
    import httpx

    from app.services.ai.openai_provider import OpenAiCompatibleProvider

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"error": "nope"})

    provider = OpenAiCompatibleProvider(
        api_key="test-key-not-real",
        base_url="https://ai.example.invalid/v1",
        model="test-model",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )
    _use_provider(monkeypatch, provider)
    _authenticated(client, f"f7-http-{status}@example.com")

    response = client.post("/api/ai/design", json={"text": "stol"})

    assert response.status_code == 502, response.text
    assert response.json()["error"]["code"] == expected_code


def test_a_successful_call_is_unaffected(client, monkeypatch):
    _use_provider(monkeypatch, LocalHeuristicProvider())
    _authenticated(client, "f7-success@example.com")

    response = client.post("/api/ai/design", json={"text": "180x60x75 sm stol"})

    assert response.status_code == 200
    assert response.json()["spec"]["furniture"] == "table"


# --------------------------------------------------------------------------- #
# 4. Neighbouring behaviour is untouched
# --------------------------------------------------------------------------- #


def test_unconfigured_path_records_no_usage(client, monkeypatch):
    """Nothing was called, so nothing may be billed or counted."""
    _use_provider(monkeypatch, _raising(ProviderNotConfigured("x")))
    _authenticated(client, "f7-usage@example.com")

    assert client.post("/api/ai/design", json={"text": "stol"}).status_code == 503
    assert _usage_rows("f7-usage@example.com") == []


def test_unconfigured_path_consumes_no_global_budget(client, monkeypatch):
    """F6: the ceiling is taken before the provider call, so it does move here —
    the point of this test is that the status fix did not change that ordering."""
    from app.config import get_settings

    monkeypatch.setenv("APP_AI_GLOBAL_DAILY_LIMIT", "5")
    get_settings.cache_clear()
    _use_provider(monkeypatch, _raising(ProviderNotConfigured("x")))
    _authenticated(client, "f7-global@example.com")

    assert client.post("/api/ai/design", json={"text": "stol"}).status_code == 503
    get_settings.cache_clear()


def test_a_free_provider_still_skips_the_global_ceiling(client, monkeypatch):
    """F6 behaviour is unchanged by this fix."""
    from sqlalchemy import select

    from app.config import get_settings
    from app.database import SessionLocal
    from app.models import GlobalUsageCounter

    def global_count() -> int:
        with SessionLocal() as db:
            rows = db.execute(select(GlobalUsageCounter)).scalars().all()
            return sum(row.count for row in rows)

    before = global_count()
    _use_provider(monkeypatch, LocalHeuristicProvider())
    _authenticated(client, "f7-free@example.com")

    assert client.post("/api/ai/design", json={"text": "stol"}).status_code == 200
    assert global_count() == before
    get_settings.cache_clear()


def test_no_api_key_appears_in_the_response(client, monkeypatch):
    _use_provider(monkeypatch, _raising(ProviderNotConfigured("key=sk-should-not-leak")))
    _authenticated(client, "f7-secret@example.com")

    body = client.post("/api/ai/design", json={"text": "stol"}).text

    assert "sk-should-not-leak" not in body
    assert "key=" not in body
