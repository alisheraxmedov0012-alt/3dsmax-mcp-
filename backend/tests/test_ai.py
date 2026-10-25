"""W1 AI design endpoint and provider tests.

All provider interactions are offline: the endpoint tests use the deterministic
``LocalHeuristicProvider`` or an injected stub, and the OpenAI-compatible adapter
is exercised through ``httpx.MockTransport``. No real AI service is ever called
and no credentials are used.
"""
from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.services.ai.base import (
    AiOutputError,
    AiProviderError,
    AiTimeout,
    DesignRequest,
    ProviderNotConfigured,
)
from app.services.ai.local_provider import LocalHeuristicProvider
from app.services.ai.openai_provider import (
    DEFAULT_REQUEST_BUDGET_SECONDS,
    MAX_RETRY_WAIT_SECONDS,
    RETRY_BACKOFF_SECONDS,
    RETRYABLE_STATUS_CODES,
    OpenAiCompatibleProvider,
)
from app.services.ai.registry import get_ai_provider
from app.services.ai.spec import (
    FurnitureType,
    RawDesignSpec,
    build_design_spec,
)
from tests.conftest import register

# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


class _StubProvider:
    """A provider whose output/behaviour is fully controlled by the test."""

    name = "stub"

    def __init__(self, *, spec: RawDesignSpec | None = None, error: Exception | None = None):
        self._spec = spec
        self._error = error

    @property
    def is_configured(self) -> bool:
        return True

    def generate_design(self, request: DesignRequest):
        if self._error is not None:
            raise self._error
        assert self._spec is not None
        return build_design_spec(self._spec, provider=self.name)


def _use_provider(monkeypatch, provider) -> None:
    """Route the endpoint to ``provider`` (or make selection raise)."""
    if isinstance(provider, Exception):
        def _raise():
            raise provider

        monkeypatch.setattr("app.routers.ai.get_ai_provider", _raise)
    else:
        monkeypatch.setattr("app.routers.ai.get_ai_provider", lambda: provider)


def _authenticated(client: TestClient, email: str = "ai@example.com") -> TestClient:
    register(client, email)
    return client


def _set_limit(plan_key: str, key: str, value: int) -> None:
    from sqlalchemy import select

    from app.database import SessionLocal
    from app.models import Plan

    with SessionLocal() as db:
        plan = db.execute(select(Plan).where(Plan.key == plan_key)).scalar_one()
        limits = dict(plan.limits or {})
        limits[key] = value
        plan.limits = limits
        db.commit()


def _ai_usage() -> int:
    from sqlalchemy import select

    from app.database import SessionLocal
    from app.models import UsageCounter

    with SessionLocal() as db:
        rows = (
            db.execute(select(UsageCounter).where(UsageCounter.metric == "ai_requests"))
            .scalars()
            .all()
        )
        return sum(row.count for row in rows)


# --------------------------------------------------------------------------- #
# Endpoint behaviour
# --------------------------------------------------------------------------- #


def test_requires_authentication(client):
    response = client.post("/api/ai/design", json={"text": "stol"})
    assert response.status_code == 401


def test_unconfigured_provider_returns_503(client, monkeypatch):
    _use_provider(monkeypatch, ProviderNotConfigured("not configured"))
    _authenticated(client)

    response = client.post("/api/ai/design", json={"text": "180x60x75 sm stol"})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "ai_unconfigured"


def test_unconfigured_provider_does_not_consume_limit(client, monkeypatch):
    _use_provider(monkeypatch, ProviderNotConfigured("not configured"))
    _authenticated(client)

    client.post("/api/ai/design", json={"text": "stol"})
    assert _ai_usage() == 0


def test_local_provider_returns_validated_spec(client, monkeypatch):
    _use_provider(monkeypatch, LocalHeuristicProvider())
    _authenticated(client)

    response = client.post("/api/ai/design", json={"text": "180x60x75 sm yog'och stol"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["provider"] == "local"
    spec = body["spec"]
    assert spec["furniture"] == "table"
    assert spec["supported"] is True
    assert spec["dimensions"] == {"width_cm": 180.0, "height_cm": 75.0, "depth_cm": 60.0}
    assert spec["color"] == "#a9744f"


def test_recognised_but_unsupported_type_is_not_applied(client, monkeypatch):
    """A spec the build cannot turn into geometry is still never applied.

    Since W13 all eight types have builders, so this guards the *mechanism*: the
    router still returns the spec marked ``supported=false`` and the frontend
    refuses it. The supported set is narrowed here on purpose.
    """
    from app.services.ai import spec as spec_module

    monkeypatch.setattr(
        spec_module, "SUPPORTED_FURNITURE_TYPES", frozenset({spec_module.FurnitureType.TABLE})
    )
    _use_provider(monkeypatch, LocalHeuristicProvider())
    _authenticated(client)

    response = client.post("/api/ai/design", json={"text": "qizil divan"})
    assert response.status_code == 200, response.text
    spec = response.json()["spec"]
    assert spec["furniture"] == "sofa"
    assert spec["supported"] is False
    assert any("qo'llab-quvvatlanmaydi" in warning for warning in spec["warnings"])


def test_unknown_furniture_type_from_provider_is_rejected(client, monkeypatch):
    _use_provider(
        monkeypatch,
        _StubProvider(spec=RawDesignSpec(furniture="spaceship")),
    )
    _authenticated(client)

    response = client.post("/api/ai/design", json={"text": "raketa"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "ai_invalid_output"


def test_invalid_dimensions_from_provider_are_rejected(client, monkeypatch):
    _use_provider(
        monkeypatch,
        _StubProvider(
            spec=RawDesignSpec.model_validate(
                {
                    "furniture": "table",
                    "dimensions": {"width_cm": -5, "height_cm": 75, "depth_cm": 60},
                }
            )
        ),
    )
    _authenticated(client)

    response = client.post("/api/ai/design", json={"text": "stol"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "ai_invalid_output"


def test_provider_failure_maps_to_502(client, monkeypatch):
    _use_provider(monkeypatch, _StubProvider(error=AiProviderError("boom")))
    _authenticated(client)

    response = client.post("/api/ai/design", json={"text": "stol"})
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "ai_provider_error"


def test_empty_text_is_rejected(client, monkeypatch):
    _use_provider(monkeypatch, LocalHeuristicProvider())
    _authenticated(client)

    response = client.post("/api/ai/design", json={"text": ""})
    assert response.status_code == 422


def test_partial_dimensions_do_not_cause_server_error(client, monkeypatch):
    """HIGH-1: a partial size (e.g. only "eni") must not raise an unhandled
    validation error (HTTP 500). It is reported and defaults are used."""
    _use_provider(monkeypatch, LocalHeuristicProvider())
    _authenticated(client)

    response = client.post("/api/ai/design", json={"text": "eni 180 sm stol"})
    assert response.status_code == 200, response.text
    spec = response.json()["spec"]
    assert spec["furniture"] == "table"
    assert spec["supported"] is True
    assert spec["dimensions"] is None
    assert any("to'liq emas" in warning for warning in spec["warnings"])


def test_unconfigured_openai_provider_returns_503_without_consuming_limit(client, monkeypatch):
    """MEDIUM-1: an unconfigured real provider answers 503 ai_unconfigured and
    does not spend an ai_requests unit."""
    monkeypatch.setenv("APP_AI_PROVIDER", "openai_compatible")
    monkeypatch.delenv("APP_AI_API_KEY", raising=False)
    monkeypatch.delenv("APP_AI_MODEL", raising=False)
    get_settings.cache_clear()
    try:
        _authenticated(client)
        before = _ai_usage()

        response = client.post("/api/ai/design", json={"text": "stol"})

        assert response.status_code == 503, response.text
        assert response.json()["error"]["code"] == "ai_unconfigured"
        assert _ai_usage() == before
    finally:
        get_settings.cache_clear()


def test_ai_request_limit_is_enforced(client, monkeypatch):
    _use_provider(monkeypatch, LocalHeuristicProvider())
    _authenticated(client)
    _set_limit("free", "max_ai_requests", 1)

    first = client.post("/api/ai/design", json={"text": "stol"})
    assert first.status_code == 200

    second = client.post("/api/ai/design", json={"text": "stol"})
    assert second.status_code == 402
    assert second.json()["error"]["code"] == "limit_reached"


# --------------------------------------------------------------------------- #
# Registry selection
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("provider_name", "extra_env", "expected_type"),
    [
        ("local", {}, LocalHeuristicProvider),
        (
            "openai_compatible",
            {"APP_AI_API_KEY": "test-key-not-real", "APP_AI_MODEL": "test-model"},
            OpenAiCompatibleProvider,
        ),
    ],
)
def test_registry_selects_configured_provider(monkeypatch, provider_name, extra_env, expected_type):
    monkeypatch.setenv("APP_AI_PROVIDER", provider_name)
    for key, value in extra_env.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()
    try:
        assert isinstance(get_ai_provider(), expected_type)
    finally:
        get_settings.cache_clear()


def test_registry_reports_none_as_unconfigured(monkeypatch):
    monkeypatch.setenv("APP_AI_PROVIDER", "none")
    get_settings.cache_clear()
    try:
        with pytest.raises(ProviderNotConfigured):
            get_ai_provider()
    finally:
        get_settings.cache_clear()


def test_openai_adapter_without_key_is_not_configured():
    # The adapter itself reports unconfigured and refuses to call out.
    provider = OpenAiCompatibleProvider(
        api_key=None, base_url="https://ai.example.invalid/v1", model=None
    )
    assert provider.is_configured is False
    with pytest.raises(ProviderNotConfigured):
        provider.generate_design(DesignRequest(text="stol"))


def test_registry_reports_openai_without_key_as_unconfigured(monkeypatch):
    """MEDIUM-1: a real provider missing its credentials must be reported as
    unconfigured by the registry (so the API returns 503 and spends no unit)."""
    monkeypatch.setenv("APP_AI_PROVIDER", "openai_compatible")
    monkeypatch.delenv("APP_AI_API_KEY", raising=False)
    monkeypatch.delenv("APP_AI_MODEL", raising=False)
    get_settings.cache_clear()
    try:
        with pytest.raises(ProviderNotConfigured):
            get_ai_provider()
    finally:
        get_settings.cache_clear()


# --------------------------------------------------------------------------- #
# Shared vocabulary / validation
# --------------------------------------------------------------------------- #


def test_build_design_spec_rejects_unknown_furniture():
    with pytest.raises(AiOutputError):
        build_design_spec(RawDesignSpec(furniture="spaceship"), provider="test")


def test_build_design_spec_rejects_non_positive_dimensions():
    raw = RawDesignSpec.model_validate(
        {"furniture": "table", "dimensions": {"width_cm": 0, "height_cm": 75, "depth_cm": 60}}
    )
    with pytest.raises(AiOutputError):
        build_design_spec(raw, provider="test")


def test_build_design_spec_drops_bad_color_with_warning():
    raw = RawDesignSpec(furniture="table", color="not-a-color")
    spec = build_design_spec(raw, provider="test")
    assert spec.color is None
    assert any("Rang" in warning for warning in spec.warnings)


def test_build_design_spec_marks_unsupported_types():
    """Narrowing the supported set marks the type unsupported (mechanism guard)."""
    from app.services.ai import spec as spec_module

    original = spec_module.SUPPORTED_FURNITURE_TYPES
    try:
        spec_module.SUPPORTED_FURNITURE_TYPES = frozenset({spec_module.FurnitureType.TABLE})
        spec = build_design_spec(RawDesignSpec(furniture="bed"), provider="test")
    finally:
        spec_module.SUPPORTED_FURNITURE_TYPES = original

    assert spec.furniture is FurnitureType.BED
    assert spec.supported is False


@pytest.mark.parametrize("furniture", [t.value for t in FurnitureType])
def test_build_design_spec_marks_every_geometry_type_supported(furniture):
    """W13: all eight types that have a builder are reported as supported."""
    spec = build_design_spec(RawDesignSpec(furniture=furniture), provider="test")
    assert spec.furniture.value == furniture
    assert spec.supported is True
    assert not any("qo'llab-quvvatlanmaydi" in warning for warning in spec.warnings)


# --------------------------------------------------------------------------- #
# OpenAI-compatible adapter (offline, via MockTransport)
# --------------------------------------------------------------------------- #


class _NoSleep:
    """Records requested waits instead of sleeping, so tests never really wait."""

    def __init__(self) -> None:
        self.calls: list[float] = []

    def __call__(self, seconds: float) -> None:
        self.calls.append(seconds)


class _FakeClock:
    """A monotonic clock the test advances instead of waiting.

    ``sleep`` advances the same clock, so retry waits count against the request
    budget exactly as they would in production, without costing real time.
    """

    def __init__(self, start: float = 0.0) -> None:
        self.now = start
        self.waits: list[float] = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.waits.append(seconds)
        self.now += seconds


def _provider_with(handler, **kwargs) -> OpenAiCompatibleProvider:
    kwargs.setdefault("max_retries", 0)
    kwargs.setdefault("sleep", _NoSleep())
    return OpenAiCompatibleProvider(
        api_key="test-key-not-real",
        base_url="https://ai.example.invalid/v1",
        model="test-model",
        transport=httpx.MockTransport(handler),
        **kwargs,
    )


def _chat_response(content: str) -> dict:
    return {"choices": [{"message": {"content": content}}]}


_VALID_SPEC = json.dumps(
    {
        "furniture": "table",
        "dimensions": {"width_cm": 160, "height_cm": 75, "depth_cm": 80},
        "confidence": "high",
    }
)


def test_openai_provider_parses_valid_response():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer test-key-not-real"
        inner = json.dumps(
            {
                "furniture": "table",
                "dimensions": {"width_cm": 160, "height_cm": 75, "depth_cm": 80},
                "color": "#8b5a2b",
                "confidence": "high",
            }
        )
        return httpx.Response(200, json=_chat_response(inner))

    spec = _provider_with(handler).generate_design(DesignRequest(text="160x80x75 stol"))
    assert spec.furniture is FurnitureType.TABLE
    assert spec.dimensions is not None
    assert spec.dimensions.width_cm == 160
    assert spec.supported is True


def test_openai_provider_rejects_malformed_json():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_chat_response("not json at all"))

    with pytest.raises(AiOutputError):
        _provider_with(handler).generate_design(DesignRequest(text="stol"))


def test_openai_provider_http_error_raises_provider_error():
    calls: list[int] = []

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(500, json={"error": "upstream"})

    # max_retries=0 from the helper: a retryable status still fails on the first
    # attempt when no retry is allowed.
    with pytest.raises(AiProviderError):
        _provider_with(handler).generate_design(DesignRequest(text="stol"))
    assert len(calls) == 1


def test_openai_provider_error_message_does_not_leak_key():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "unauthorized"})

    provider = _provider_with(handler)
    try:
        provider.generate_design(DesignRequest(text="stol"))
    except AiProviderError as exc:
        assert "test-key-not-real" not in str(exc)
    else:  # pragma: no cover - the call must fail
        raise AssertionError("expected AiProviderError")


def test_local_provider_is_offline_and_deterministic():
    provider = LocalHeuristicProvider()
    assert provider.is_configured is True
    spec = provider.generate_design(DesignRequest(text="yog'och stul"))
    assert spec.furniture is FurnitureType.CHAIR
    assert spec.supported is True  # W13: chair has a builder


# --------------------------------------------------------------------------- #
# A3.4 F1 — bounded retry for transient HTTP failures
# --------------------------------------------------------------------------- #


def test_transient_http_error_is_retried_then_succeeds():
    """One 503 followed by a 200 must recover instead of failing the request."""
    responses = [httpx.Response(503), httpx.Response(200, json=_chat_response(_VALID_SPEC))]
    calls: list[int] = []

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        return responses[len(calls) - 1]

    sleep = _NoSleep()
    spec = _provider_with(handler, max_retries=1, sleep=sleep).generate_design(
        DesignRequest(text="stol")
    )

    assert spec.furniture is FurnitureType.TABLE
    assert len(calls) == 2
    assert len(sleep.calls) == 1


@pytest.mark.parametrize("status", sorted(RETRYABLE_STATUS_CODES))
def test_every_retryable_status_is_retried(status):
    """408/425/429/500/502/503/504 all recover when the retry succeeds."""
    responses = [httpx.Response(status), httpx.Response(200, json=_chat_response(_VALID_SPEC))]
    calls: list[int] = []

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        return responses[len(calls) - 1]

    spec = _provider_with(handler, max_retries=1).generate_design(
        DesignRequest(text="stol")
    )
    assert spec.furniture is FurnitureType.TABLE
    assert len(calls) == 2


def test_retries_are_capped_at_the_configured_limit():
    """A persistent transient error is attempted exactly max_retries + 1 times."""
    calls: list[int] = []

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(503)

    sleep = _NoSleep()
    with pytest.raises(AiProviderError):
        _provider_with(handler, max_retries=2, sleep=sleep).generate_design(
            DesignRequest(text="stol")
        )

    assert len(calls) == 3  # 1 initial attempt + 2 retries
    assert len(sleep.calls) == 2  # only between attempts, never after the last
    assert all(wait <= MAX_RETRY_WAIT_SECONDS for wait in sleep.calls)


@pytest.mark.parametrize("status", [400, 401, 403, 404, 422])
def test_permanent_status_is_not_retried(status):
    """A permanent failure is answered at once: repeating it cannot help."""
    calls: list[int] = []

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(status, json={"error": "permanent"})

    sleep = _NoSleep()
    with pytest.raises(AiProviderError):
        _provider_with(handler, max_retries=3, sleep=sleep).generate_design(
            DesignRequest(text="stol")
        )

    assert len(calls) == 1
    assert sleep.calls == []


def test_zero_retries_means_a_single_attempt():
    calls: list[int] = []

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(429)

    sleep = _NoSleep()
    with pytest.raises(AiProviderError):
        _provider_with(handler, max_retries=0, sleep=sleep).generate_design(
            DesignRequest(text="stol")
        )

    assert len(calls) == 1
    assert sleep.calls == []


def test_retry_after_is_honoured_for_429():
    calls: list[int] = []

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(429, headers={"Retry-After": "2"})
        return httpx.Response(200, json=_chat_response(_VALID_SPEC))

    sleep = _NoSleep()
    spec = _provider_with(handler, max_retries=1, sleep=sleep).generate_design(
        DesignRequest(text="stol")
    )

    assert spec.furniture is FurnitureType.TABLE
    assert sleep.calls == [2.0]


@pytest.mark.parametrize("header", ["3600", "1e9"])
def test_retry_after_is_capped(header):
    """A huge Retry-After must not stall the request for an hour."""
    calls: list[int] = []

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(429, headers={"Retry-After": header})

    sleep = _NoSleep()
    with pytest.raises(AiProviderError):
        _provider_with(handler, max_retries=1, sleep=sleep).generate_design(
            DesignRequest(text="stol")
        )

    assert sleep.calls == [MAX_RETRY_WAIT_SECONDS]


@pytest.mark.parametrize("header", ["not-a-number", "-5", ""])
def test_unusable_retry_after_falls_back_to_backoff(header):
    """Malformed values are ignored instead of breaking the retry path."""
    calls: list[int] = []

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(503, headers={"Retry-After": header})
        return httpx.Response(200, json=_chat_response(_VALID_SPEC))

    sleep = _NoSleep()
    spec = _provider_with(handler, max_retries=1, sleep=sleep).generate_design(
        DesignRequest(text="stol")
    )

    assert spec.furniture is FurnitureType.TABLE
    assert sleep.calls == [RETRY_BACKOFF_SECONDS]


def test_transport_error_is_still_retried():
    """A connection failure keeps its previous retry behaviour."""
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        if len(calls) == 1:
            raise httpx.ConnectError("boom", request=request)
        return httpx.Response(200, json=_chat_response(_VALID_SPEC))

    sleep = _NoSleep()
    spec = _provider_with(handler, max_retries=1, sleep=sleep).generate_design(
        DesignRequest(text="stol")
    )

    assert spec.furniture is FurnitureType.TABLE
    assert len(calls) == 2
    assert len(sleep.calls) == 1


def test_exhausted_retries_keep_the_http_status_in_the_message():
    """The caller still learns which status failed, without any key material."""

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(502)

    with pytest.raises(AiProviderError) as excinfo:
        _provider_with(handler, max_retries=1).generate_design(DesignRequest(text="stol"))

    assert "502" in str(excinfo.value)
    assert "test-key-not-real" not in str(excinfo.value)


def test_retry_does_not_disturb_the_repair_path():
    """A 200 with unusable content is repaired, not retried as a network error."""
    contents = ["not json at all", _VALID_SPEC]
    calls: list[int] = []

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(200, json=_chat_response(contents[len(calls) - 1]))

    sleep = _NoSleep()
    spec = _provider_with(handler, max_retries=1, sleep=sleep).generate_design(
        DesignRequest(text="stol")
    )

    assert spec.furniture is FurnitureType.TABLE
    assert len(calls) == 2  # the repair attempt, not a network retry
    assert sleep.calls == []


def test_unexpected_error_is_not_swallowed():
    """A programming error surfaces instead of being retried into a generic 502."""

    def handler(_: httpx.Request) -> httpx.Response:
        raise RuntimeError("unexpected")

    with pytest.raises(RuntimeError):
        _provider_with(handler, max_retries=2).generate_design(DesignRequest(text="stol"))


# --------------------------------------------------------------------------- #
# A3.4 F2 — one wall-clock budget for the whole request
# --------------------------------------------------------------------------- #


def test_successful_request_is_unaffected_by_the_budget():
    """The happy path still costs one call and no waiting."""

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_chat_response(_VALID_SPEC))

    clock = _FakeClock()
    spec = _provider_with(handler, clock=clock, sleep=clock.sleep, budget=25.0).generate_design(
        DesignRequest(text="stol")
    )

    assert spec.furniture is FurnitureType.TABLE
    assert clock.waits == []


def test_http_call_is_capped_by_the_remaining_budget():
    """A per-call timeout larger than the budget is reduced to what is left."""
    seen: dict[str, dict] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["timeout"] = request.extensions["timeout"]
        return httpx.Response(200, json=_chat_response(_VALID_SPEC))

    # The call timeout (20s) is longer than the budget (8s), so the budget wins.
    clock = _FakeClock()
    _provider_with(handler, timeout=20.0, budget=8.0, clock=clock).generate_design(
        DesignRequest(text="stol")
    )

    assert seen["timeout"]["read"] == 8.0


def test_per_call_timeout_is_used_when_it_is_the_smaller_one():
    seen: dict[str, dict] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["timeout"] = request.extensions["timeout"]
        return httpx.Response(200, json=_chat_response(_VALID_SPEC))

    clock = _FakeClock()
    _provider_with(handler, timeout=3.0, budget=25.0, clock=clock).generate_design(
        DesignRequest(text="stol")
    )

    assert seen["timeout"]["read"] == 3.0


def test_no_retry_starts_after_the_deadline():
    """When the budget is gone a transient error is not retried."""
    calls: list[int] = []
    clock = _FakeClock()

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        clock.now += 30.0  # the provider took longer than the whole budget
        return httpx.Response(503)

    with pytest.raises(AiTimeout):
        _provider_with(
            handler, max_retries=2, clock=clock, sleep=clock.sleep, budget=25.0
        ).generate_design(DesignRequest(text="stol"))

    assert len(calls) == 1
    assert clock.waits == []


def test_retry_wait_counts_against_the_budget():
    """A wait that fits the budget is taken; the retry then runs."""
    calls: list[int] = []
    clock = _FakeClock()

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(429, headers={"Retry-After": "4"})
        return httpx.Response(200, json=_chat_response(_VALID_SPEC))

    spec = _provider_with(
        handler, max_retries=1, clock=clock, sleep=clock.sleep, budget=25.0
    ).generate_design(DesignRequest(text="stol"))

    assert spec.furniture is FurnitureType.TABLE
    assert clock.waits == [4.0]
    assert clock.now == 4.0  # the wait consumed part of the budget


def test_retry_is_abandoned_when_the_wait_would_exceed_the_budget():
    """Retry-After longer than the remaining budget is not waited out."""
    calls: list[int] = []
    clock = _FakeClock()

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        # Only 2s of budget left, but the provider asks for the capped 5s.
        clock.now += 23.0
        return httpx.Response(429, headers={"Retry-After": "5"})

    with pytest.raises(AiTimeout):
        _provider_with(
            handler, max_retries=2, clock=clock, sleep=clock.sleep, budget=25.0
        ).generate_design(DesignRequest(text="stol"))

    assert len(calls) == 1
    assert clock.waits == []


def test_no_repair_starts_after_the_deadline():
    """An unusable answer is not repaired once the budget is spent."""
    calls: list[int] = []
    clock = _FakeClock()

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        clock.now += 30.0
        return httpx.Response(200, json=_chat_response("not json at all"))

    with pytest.raises(AiTimeout):
        _provider_with(handler, clock=clock, sleep=clock.sleep, budget=25.0).generate_design(
            DesignRequest(text="stol")
        )

    assert len(calls) == 1


def test_repair_still_runs_while_budget_remains():
    """The repair path is unchanged when there is time left."""
    calls: list[int] = []
    contents = ["not json at all", _VALID_SPEC]
    clock = _FakeClock()

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(200, json=_chat_response(contents[len(calls) - 1]))

    spec = _provider_with(
        handler, max_retries=1, clock=clock, sleep=clock.sleep, budget=25.0
    ).generate_design(DesignRequest(text="stol"))

    assert spec.furniture is FurnitureType.TABLE
    assert len(calls) == 2


def test_zero_budget_fails_before_any_call():
    """An exhausted budget from the start makes no HTTP request at all."""
    calls: list[int] = []

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(200, json=_chat_response(_VALID_SPEC))

    with pytest.raises(AiTimeout):
        _provider_with(handler, budget=0.0).generate_design(DesignRequest(text="stol"))

    assert calls == []


def test_timeout_is_distinct_from_a_provider_error():
    """A budget overrun is an AiTimeout, not a generic provider failure."""
    clock = _FakeClock()

    def handler(_: httpx.Request) -> httpx.Response:
        clock.now += 30.0
        return httpx.Response(503)

    with pytest.raises(AiTimeout) as excinfo:
        _provider_with(
            handler, max_retries=1, clock=clock, sleep=clock.sleep, budget=25.0
        ).generate_design(DesignRequest(text="stol"))

    assert type(excinfo.value) is not AiProviderError
    assert excinfo.value.code == "ai_timeout"
    assert "test-key-not-real" not in str(excinfo.value)


def test_parallel_requests_have_independent_budgets():
    """A slow request must not shorten another request's deadline."""
    clock = _FakeClock()

    def slow(_: httpx.Request) -> httpx.Response:
        clock.now += 24.0
        return httpx.Response(503)

    def fast(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_chat_response(_VALID_SPEC))

    slow_provider = _provider_with(
        slow, max_retries=1, clock=clock, sleep=clock.sleep, budget=25.0
    )
    fast_provider = _provider_with(
        fast, max_retries=1, clock=clock, sleep=clock.sleep, budget=25.0
    )

    with pytest.raises(AiTimeout):
        slow_provider.generate_design(DesignRequest(text="stol"))

    # The slow request consumed the shared fake clock, but the second provider
    # starts its own deadline, so it still has its full budget.
    spec = fast_provider.generate_design(DesignRequest(text="stol"))
    assert spec.furniture is FurnitureType.TABLE


def test_default_budget_is_below_the_frontend_timeout():
    """The backend must give up before the browser's 30s abort."""
    assert DEFAULT_REQUEST_BUDGET_SECONDS < 30.0


def test_timeout_maps_to_the_ai_timeout_api_error(client, monkeypatch):
    """The endpoint answers a controlled 504 instead of an unhandled 500."""
    clock = _FakeClock()

    def handler(_: httpx.Request) -> httpx.Response:
        clock.now += 30.0
        return httpx.Response(503)

    provider = _provider_with(
        handler, max_retries=1, clock=clock, sleep=clock.sleep, budget=25.0
    )
    _use_provider(monkeypatch, provider)
    _authenticated(client, "deadline@example.com")

    response = client.post("/api/ai/design", json={"text": "180x60x75 sm stol"})

    assert response.status_code == 504
    assert response.json()["error"]["code"] == "ai_timeout"
    assert "test-key-not-real" not in response.text
