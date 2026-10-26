"""A3.4 F4/F10 — AI token usage and cost accounting.

Two questions are answered here, and only from what the system can actually know:

* **Tokens** (F4) — whatever the provider reported, summed over the calls that
  one user request made, and nothing else. A provider that reports no usage
  leaves the columns null; no value is ever estimated.
* **Cost** (F10) — computed only when the operator configured both prices and a
  currency. Otherwise the row stays ``cost_kind="unknown"`` with null cost
  columns, which is the honest answer for "we do not know the price".

A failed call to a paying provider is recorded too, because the spend may
already have happened; that row must never change the HTTP status the caller
sees.

Every provider interaction here goes through ``httpx.MockTransport``. No real AI
service is contacted and no credentials are used.
"""
from __future__ import annotations

import json

import httpx
import pytest

from app.config import get_settings
from app.services.ai.base import AiProviderError, DesignRequest
from app.services.ai.local_provider import LocalHeuristicProvider
from app.services.ai.openai_provider import OpenAiCompatibleProvider
from app.services.ai.pricing import TokenPrices, token_prices_from_settings
from tests.test_ai import _authenticated, _use_provider

_VALID_SPEC = json.dumps(
    {
        "furniture": "table",
        "dimensions": {"width_cm": 180, "height_cm": 75, "depth_cm": 60},
        "confidence": "high",
    }
)


def _chat(usage: dict | None, content: str = _VALID_SPEC) -> dict:
    body: dict = {"choices": [{"message": {"content": content}}]}
    if usage is not None:
        body["usage"] = usage
    return body


def _provider(handler, **kwargs) -> OpenAiCompatibleProvider:
    kwargs.setdefault("max_retries", 0)
    return OpenAiCompatibleProvider(
        api_key="test-key-not-real",
        base_url="https://ai.example.invalid/v1",
        model="test-model",
        transport=httpx.MockTransport(handler),
        **kwargs,
    )


def _usage_rows(email: str) -> list:
    from sqlalchemy import select

    from app.database import SessionLocal
    from app.models import UsageRecord, User

    with SessionLocal() as db:
        user = db.execute(select(User).where(User.email == email)).scalar_one()
        return (
            db.execute(
                select(UsageRecord)
                .where(UsageRecord.user_id == user.id)
                .order_by(UsageRecord.created_at)
            )
            .scalars()
            .all()
        )


@pytest.fixture(autouse=True)
def _clean_settings():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


# --------------------------------------------------------------------------- #
# Token capture (F4)
# --------------------------------------------------------------------------- #


def test_usage_block_is_captured_from_a_successful_response():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=_chat(
                {"prompt_tokens": 120, "completion_tokens": 45, "total_tokens": 165}
            ),
        )

    provider = _provider(handler)
    provider.generate_design(DesignRequest(text="stol"))

    assert provider.last_usage == {
        "prompt_tokens": 120,
        "completion_tokens": 45,
        "total_tokens": 165,
    }


def test_missing_usage_block_leaves_tokens_null():
    """Nothing is estimated: no usage means no numbers."""
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_chat(None))

    provider = _provider(handler)
    provider.generate_design(DesignRequest(text="stol"))

    assert provider.last_usage == {
        "prompt_tokens": None,
        "completion_tokens": None,
        "total_tokens": None,
    }


def test_total_is_derived_only_when_the_provider_omits_it():
    """Prompt+completion is arithmetic on reported numbers, not a guess."""
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json=_chat({"prompt_tokens": 100, "completion_tokens": 20})
        )

    provider = _provider(handler)
    provider.generate_design(DesignRequest(text="stol"))

    assert provider.last_usage["total_tokens"] == 120


@pytest.mark.parametrize(
    "usage",
    [
        {"prompt_tokens": -5, "completion_tokens": 10},
        {"prompt_tokens": True, "completion_tokens": 10},
        {"prompt_tokens": "many", "completion_tokens": 10},
        {"prompt_tokens": 1.5, "completion_tokens": 10},
        {},
    ],
)
def test_malformed_usage_is_not_trusted(usage):
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_chat(usage))

    provider = _provider(handler)
    provider.generate_design(DesignRequest(text="stol"))

    # Nothing invalid is stored; only the well-formed half survives.
    assert provider.last_usage["prompt_tokens"] is None
    if usage.get("completion_tokens") == 10:
        assert provider.last_usage["completion_tokens"] == 10


def test_usage_accumulates_across_retries_without_double_counting():
    """Two calls really consumed two responses' tokens, so they are summed."""
    responses = [
        httpx.Response(
            200, json=_chat({"prompt_tokens": 10, "completion_tokens": 5}, content="not json")
        ),
        httpx.Response(
            200, json=_chat({"prompt_tokens": 20, "completion_tokens": 8})
        ),
    ]
    calls: list[int] = []

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        return responses[len(calls) - 1]

    provider = _provider(handler, max_retries=1)
    provider.generate_design(DesignRequest(text="stol"))

    assert len(calls) == 2  # the repair made a second real call
    assert provider.last_usage == {
        "prompt_tokens": 30,
        "completion_tokens": 13,
        "total_tokens": 43,
    }


def test_usage_is_reset_between_requests_on_a_reused_provider():
    """A previous request's tokens must never be attributed to the next one.

    The registry builds a provider per request, but nothing enforces that, and a
    test or a future cache could reuse one instance. Resetting makes the
    accounting correct either way.
    """
    calls: list[int] = []

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        usage = (
            {"prompt_tokens": 100, "completion_tokens": 10}
            if len(calls) == 1
            else None
        )
        return httpx.Response(200, json=_chat(usage))

    provider = _provider(handler)
    provider.generate_design(DesignRequest(text="stol"))
    assert provider.last_usage["prompt_tokens"] == 100

    provider.generate_design(DesignRequest(text="stol"))
    assert provider.last_usage["prompt_tokens"] is None


def test_a_call_that_returns_no_usage_reports_none_not_zero():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_chat(None))

    provider = _provider(handler)
    provider.generate_design(DesignRequest(text="stol"))

    assert provider.last_usage["prompt_tokens"] is None
    assert provider.last_usage["completion_tokens"] is None


def test_local_provider_reports_no_usage():
    """The offline analyzer makes no call, so it has nothing to report."""
    provider = LocalHeuristicProvider()
    provider.generate_design(DesignRequest(text="yog'och stol"))

    assert getattr(provider, "last_usage", None) is None


# --------------------------------------------------------------------------- #
# Pricing configuration
# --------------------------------------------------------------------------- #


def _set_prices(monkeypatch, *, input=None, output=None, currency=None) -> None:
    for key, value in (
        ("APP_AI_PRICE_INPUT_MICROS_PER_1K", input),
        ("APP_AI_PRICE_OUTPUT_MICROS_PER_1K", output),
        ("APP_AI_PRICE_CURRENCY", currency),
    ):
        if value is None:
            monkeypatch.delenv(key, raising=False)
        else:
            monkeypatch.setenv(key, str(value))
    get_settings.cache_clear()


def test_prices_are_absent_by_default(monkeypatch):
    """No price is shipped in code: an unconfigured deployment stays unknown."""
    _set_prices(monkeypatch)
    assert token_prices_from_settings(get_settings()) is None


def test_partial_prices_are_not_used(monkeypatch):
    """Half a price would produce a wrong number, so it is ignored."""
    _set_prices(monkeypatch, input=150, output=None, currency="USD")
    assert token_prices_from_settings(get_settings()) is None

    _set_prices(monkeypatch, input=150, output=600, currency=None)
    assert token_prices_from_settings(get_settings()) is None


def test_complete_prices_are_used(monkeypatch):
    _set_prices(monkeypatch, input=150, output=600, currency="USD")
    prices = token_prices_from_settings(get_settings())
    assert prices == TokenPrices(
        input_micros_per_1k=150, output_micros_per_1k=600, currency="USD"
    )


def test_cost_arithmetic():
    prices = TokenPrices(input_micros_per_1k=150, output_micros_per_1k=600, currency="USD")
    # 1000 prompt tokens at 150 micros/1k = 150; 500 completion at 600/1k = 300.
    assert prices.estimate_micros(1000, 500) == 450
    # Rounds to the nearest micro rather than truncating.
    assert prices.estimate_micros(1, 0) == 0
    assert prices.estimate_micros(10, 0) == 2  # 1.5 -> 2


def test_cost_needs_both_token_counts():
    prices = TokenPrices(input_micros_per_1k=150, output_micros_per_1k=600, currency="USD")
    assert prices.estimate_micros(None, 500) is None
    assert prices.estimate_micros(1000, None) is None


# --------------------------------------------------------------------------- #
# End-to-end: the ledger row
# --------------------------------------------------------------------------- #


def test_successful_call_with_usage_and_prices_records_an_estimated_cost(
    client, monkeypatch
):
    _set_prices(monkeypatch, input=150, output=600, currency="USD")

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=_chat({"prompt_tokens": 1000, "completion_tokens": 500, "total_tokens": 1500}),
        )

    _use_provider(monkeypatch, _provider(handler))
    _authenticated(client, "cost-known@example.com")

    response = client.post("/api/ai/design", json={"text": "180x60x75 sm stol"})
    assert response.status_code == 200

    rows = _usage_rows("cost-known@example.com")
    assert len(rows) == 1
    row = rows[0]
    assert row.prompt_tokens == 1000
    assert row.completion_tokens == 500
    assert row.total_tokens == 1500
    assert row.unit == "tokens"
    assert row.cost_kind == "estimated"
    assert row.cost_micros == 450
    assert row.currency == "USD"
    assert row.provider == "openai_compatible"
    assert row.model == "test-model"


def test_successful_call_without_prices_records_unknown_cost(client, monkeypatch):
    """Tokens are known but the price is not: cost stays unknown, never zero."""
    _set_prices(monkeypatch, input=None)

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json=_chat({"prompt_tokens": 1000, "completion_tokens": 500})
        )

    _use_provider(monkeypatch, _provider(handler))
    _authenticated(client, "cost-unknown@example.com")

    assert client.post("/api/ai/design", json={"text": "stol"}).status_code == 200

    row = _usage_rows("cost-unknown@example.com")[0]
    assert row.prompt_tokens == 1000
    assert row.total_tokens == 1500
    assert row.cost_kind == "unknown"
    assert row.cost_micros is None
    assert row.currency is None


def test_prices_without_reported_tokens_stay_unknown(client, monkeypatch):
    """A price is useless without token counts: no cost is invented."""
    _set_prices(monkeypatch, input=150, output=600, currency="USD")

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_chat(None))

    _use_provider(monkeypatch, _provider(handler))
    _authenticated(client, "cost-no-tokens@example.com")

    assert client.post("/api/ai/design", json={"text": "stol"}).status_code == 200

    row = _usage_rows("cost-no-tokens@example.com")[0]
    assert row.total_tokens is None
    assert row.cost_kind == "unknown"
    assert row.cost_micros is None
    assert row.unit == "request"


def test_local_provider_records_no_tokens_and_unknown_cost(client, monkeypatch):
    _use_provider(monkeypatch, LocalHeuristicProvider())
    _authenticated(client, "local-cost@example.com")

    assert client.post("/api/ai/design", json={"text": "stol"}).status_code == 200

    row = _usage_rows("local-cost@example.com")[0]
    assert row.prompt_tokens is None
    assert row.total_tokens is None
    assert row.cost_kind == "unknown"
    assert row.cost_micros is None


# --------------------------------------------------------------------------- #
# F10 — failed paid calls are recorded, the status is not changed
# --------------------------------------------------------------------------- #


def test_failed_paid_call_is_recorded_with_unknown_cost(client, monkeypatch):
    """The provider may have charged for a call that failed; record the attempt."""
    calls: list[int] = []

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(500, json={"error": "upstream"})

    _use_provider(monkeypatch, _provider(handler, max_retries=1, sleep=lambda _s: None))
    _authenticated(client, "failed-paid@example.com")

    response = client.post("/api/ai/design", json={"text": "stol"})
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "ai_provider_error"

    rows = _usage_rows("failed-paid@example.com")
    assert len(rows) == 1
    row = rows[0]
    assert row.operation == "ai.generate"
    assert row.provider == "openai_compatible"
    assert row.cost_kind == "unknown"
    assert row.cost_micros is None
    assert row.meta.get("outcome") == "error"


def test_failed_free_call_is_not_recorded(client, monkeypatch):
    """An offline failure costs nothing, so no charge is implied."""
    class _FailingFree:
        name = "local"
        bills_per_request = False

        @property
        def is_configured(self) -> bool:
            return True

        def generate_design(self, request):
            raise AiProviderError("offline failure")

    _use_provider(monkeypatch, _FailingFree())
    _authenticated(client, "failed-free@example.com")

    assert client.post("/api/ai/design", json={"text": "stol"}).status_code == 502
    assert _usage_rows("failed-free@example.com") == []


def test_unconfigured_provider_records_nothing(client, monkeypatch):
    """No call was made, so there is nothing to account for."""
    from app.services.ai.base import ProviderNotConfigured

    _use_provider(monkeypatch, ProviderNotConfigured("not configured"))
    _authenticated(client, "unconfigured-usage@example.com")

    assert client.post("/api/ai/design", json={"text": "stol"}).status_code == 503
    assert _usage_rows("unconfigured-usage@example.com") == []


@pytest.mark.parametrize(
    ("raised", "expected_status", "expected_code"),
    [
        (AiProviderError("down"), 502, "ai_provider_error"),
    ],
)
def test_ledger_failure_does_not_change_the_original_error(
    client, monkeypatch, raised, expected_status, expected_code
):
    """F10: a broken ledger must not turn a provider error into a 500."""
    class _FailingPaid:
        name = "openai_compatible"
        bills_per_request = True

        @property
        def is_configured(self) -> bool:
            return True

        def generate_design(self, request):
            raise raised

    _use_provider(monkeypatch, _FailingPaid())

    def _explode(*args, **kwargs):
        raise RuntimeError("ledger is down")

    monkeypatch.setattr("app.routers.ai.record_usage", _explode)
    _authenticated(client, "ledger-down@example.com")

    response = client.post("/api/ai/design", json={"text": "stol"})

    assert response.status_code == expected_status
    assert response.json()["error"]["code"] == expected_code


def test_ledger_failure_on_success_still_returns_the_design(client, monkeypatch):
    """The generation already happened; a ledger problem must not discard it."""
    _use_provider(monkeypatch, LocalHeuristicProvider())

    def _explode(*args, **kwargs):
        raise RuntimeError("ledger is down")

    monkeypatch.setattr("app.routers.ai.record_usage", _explode)
    _authenticated(client, "ledger-down-success@example.com")

    response = client.post("/api/ai/design", json={"text": "stol"})

    assert response.status_code == 200, response.text
    assert response.json()["spec"]["furniture"] == "table"
    # Nothing was written, which is the expected consequence of the failure.
    assert _usage_rows("ledger-down-success@example.com") == []
