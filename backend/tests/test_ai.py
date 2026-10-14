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
    DesignRequest,
    ProviderNotConfigured,
)
from app.services.ai.local_provider import LocalHeuristicProvider
from app.services.ai.openai_provider import OpenAiCompatibleProvider
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
    _use_provider(monkeypatch, LocalHeuristicProvider())
    _authenticated(client)

    response = client.post("/api/ai/design", json={"text": "qizil divan"})
    assert response.status_code == 200, response.text
    spec = response.json()["spec"]
    assert spec["furniture"] == "sofa"
    assert spec["supported"] is False
    assert any("W2" in warning for warning in spec["warnings"])


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
    ("provider_name", "expected_type"),
    [("local", LocalHeuristicProvider), ("openai_compatible", OpenAiCompatibleProvider)],
)
def test_registry_selects_configured_provider(monkeypatch, provider_name, expected_type):
    monkeypatch.setenv("APP_AI_PROVIDER", provider_name)
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


def test_openai_provider_without_key_is_not_configured(monkeypatch):
    monkeypatch.setenv("APP_AI_PROVIDER", "openai_compatible")
    monkeypatch.delenv("APP_AI_API_KEY", raising=False)
    get_settings.cache_clear()
    try:
        provider = get_ai_provider()
        assert provider.is_configured is False
        with pytest.raises(ProviderNotConfigured):
            provider.generate_design(DesignRequest(text="stol"))
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
    spec = build_design_spec(RawDesignSpec(furniture="bed"), provider="test")
    assert spec.furniture is FurnitureType.BED
    assert spec.supported is False


# --------------------------------------------------------------------------- #
# OpenAI-compatible adapter (offline, via MockTransport)
# --------------------------------------------------------------------------- #


def _provider_with(handler, **kwargs) -> OpenAiCompatibleProvider:
    return OpenAiCompatibleProvider(
        api_key="test-key-not-real",
        base_url="https://ai.example.invalid/v1",
        model="test-model",
        max_retries=kwargs.pop("max_retries", 0),
        transport=httpx.MockTransport(handler),
        **kwargs,
    )


def _chat_response(content: str) -> dict:
    return {"choices": [{"message": {"content": content}}]}


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
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "upstream"})

    with pytest.raises(AiProviderError):
        _provider_with(handler).generate_design(DesignRequest(text="stol"))


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
    assert spec.supported is False  # chair is a W2 type
