"""W13 — DesignSpec v2: eight types, four languages, explicit dimension semantics.

The fixture corpus (``tests/fixtures/ai_prompts.json``) is deterministic: every
prompt is parsed by the offline provider, so these tests never touch the network
and never call a paid provider.
"""
from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from app.services.ai.base import AiAmbiguousPrompt, AiOutputError, DesignRequest
from app.services.ai.local_provider import LocalHeuristicProvider
from app.services.ai.openai_provider import MAX_REPAIR_ATTEMPTS, OpenAiCompatibleProvider
from app.services.ai.spec import (
    SUPPORTED_FURNITURE_TYPES,
    DesignDetails,
    DesignSpec,
    Dimensions,
    FurnitureType,
    RawDesignSpec,
    build_design_spec,
)
from tests.test_ai import _authenticated, _use_provider

FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "ai_prompts.json"
FIXTURES: list[dict] = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


# --------------------------------------------------------------------------- #
# Corpus shape
# --------------------------------------------------------------------------- #
def test_fixture_corpus_covers_every_type_and_language():
    assert len(FIXTURES) >= 32
    assert {f["expect"]["furniture"] for f in FIXTURES} == {t.value for t in FurnitureType}
    assert {f["lang"] for f in FIXTURES} == {"uz-latn", "uz-cyrl", "ru", "en"}


@pytest.mark.parametrize("fixture", FIXTURES, ids=[f["id"] for f in FIXTURES])
def test_fixture_matches_expected_spec(fixture):
    spec = LocalHeuristicProvider().generate_design(DesignRequest(text=fixture["prompt"]))
    expect = fixture["expect"]

    assert spec.furniture.value == expect["furniture"]
    assert spec.supported is True

    if "dimensions" in expect:
        assert spec.dimensions is not None
        assert spec.dimensions.model_dump() == expect["dimensions"]
    if "color" in expect:
        assert spec.color == expect["color"]
    if "details" in expect:
        assert spec.details is not None
        for key, value in expect["details"].items():
            assert getattr(spec.details, key) == value, key
    if "note_contains" in expect:
        joined = " ".join(spec.notes)
        assert expect["note_contains"] in joined


# --------------------------------------------------------------------------- #
# Dimension semantics
# --------------------------------------------------------------------------- #
def test_all_eight_types_are_supported():
    assert SUPPORTED_FURNITURE_TYPES == frozenset(FurnitureType)


def test_dimensions_are_x_z_y_extents():
    """width = X, depth = Z, height = Y, in that order in a triple."""
    spec = LocalHeuristicProvider().generate_design(DesignRequest(text="180x60x75 sm stol"))
    assert spec.dimensions is not None
    assert spec.dimensions.width_cm == 180
    assert spec.dimensions.depth_cm == 60
    assert spec.dimensions.height_cm == 75


def test_bed_length_maps_to_depth_explicitly():
    """A bed's "length" is the Z extent; the mapping is announced, not silent."""
    spec = LocalHeuristicProvider().generate_design(
        DesignRequest(text="karavot kengligi 160 uzunligi 200 balandligi 40")
    )
    assert spec.dimensions is not None
    assert spec.dimensions.width_cm == 160
    assert spec.dimensions.depth_cm == 200
    assert spec.dimensions.height_cm == 40
    assert any("chuqurlik" in note for note in spec.notes)


def test_bed_length_not_mapped_for_other_types():
    """Only a bed treats "length" as the Z extent; other types ignore the word."""
    spec = LocalHeuristicProvider().generate_design(DesignRequest(text="stol uzunligi 200"))
    assert spec.furniture is FurnitureType.TABLE
    assert spec.dimensions is None  # the word alone is not a dimension for a table


def test_explicit_depth_wins_over_length_for_bed():
    spec = LocalHeuristicProvider().generate_design(
        DesignRequest(text="karavot kengligi 160 chuqurligi 200 uzunligi 195 balandligi 40")
    )
    assert spec.dimensions is not None
    assert spec.dimensions.depth_cm == 200


# --------------------------------------------------------------------------- #
# Rejection paths
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "prompt",
    [
        "menga mebel kerak",
        "180x60x75",
        "salom, nima gap",
    ],
)
def test_ambiguous_prompt_is_rejected(prompt):
    with pytest.raises(AiAmbiguousPrompt):
        LocalHeuristicProvider().generate_design(DesignRequest(text=prompt))


def test_ambiguous_prompt_maps_to_422_with_code(client, monkeypatch):
    _use_provider(monkeypatch, LocalHeuristicProvider())
    _authenticated(client, "w13-ambiguous@example.com")

    response = client.post("/api/ai/design", json={"text": "menga mebel kerak"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "ai_ambiguous_type"


@pytest.mark.parametrize("value", [0, -5, 5000])
def test_out_of_bounds_dimensions_are_rejected(value):
    with pytest.raises(AiOutputError):
        build_design_spec(
            RawDesignSpec(
                furniture="table",
                dimensions=Dimensions(width_cm=value, height_cm=75, depth_cm=60),
            ),
            provider="test",
        )


def test_non_finite_dimension_is_rejected():
    with pytest.raises(AiOutputError):
        build_design_spec(
            RawDesignSpec(
                furniture="table",
                dimensions=Dimensions(width_cm=float("nan"), height_cm=75, depth_cm=60),
            ),
            provider="test",
        )


def test_missing_dimensions_keep_defaults_with_warning():
    spec = build_design_spec(RawDesignSpec(furniture="wardrobe"), provider="test")
    assert spec.dimensions is None
    assert any("standart" in warning for warning in spec.warnings)


def test_impossible_seat_height_is_rejected():
    with pytest.raises(AiOutputError):
        build_design_spec(
            RawDesignSpec(
                furniture="chair",
                dimensions=Dimensions(width_cm=45, height_cm=90, depth_cm=50),
                details=DesignDetails(seatHeightCm=95),
            ),
            provider="test",
        )


def test_impossible_headboard_is_rejected():
    with pytest.raises(AiOutputError):
        build_design_spec(
            RawDesignSpec(
                furniture="bed",
                dimensions=Dimensions(width_cm=160, height_cm=40, depth_cm=200),
                details=DesignDetails(headboardHeightCm=20),
            ),
            provider="test",
        )


def test_negative_detail_is_rejected():
    with pytest.raises(AiOutputError):
        build_design_spec(
            RawDesignSpec(furniture="wardrobe", details=DesignDetails(shelfCount=-1)),
            provider="test",
        )


# --------------------------------------------------------------------------- #
# Backward compatibility
# --------------------------------------------------------------------------- #
def test_spec_without_details_still_parses():
    """A stored W1 spec has no ``details`` key and must keep working."""
    payload = {
        "furniture": "table",
        "dimensions": {"width_cm": 120, "height_cm": 75, "depth_cm": 60},
        "color": "#a9744f",
        "confidence": "high",
    }
    spec = DesignSpec.model_validate(payload)
    assert spec.details is None
    assert spec.furniture is FurnitureType.TABLE


def test_spec_with_supported_false_still_parses():
    """An old build may have stored ``supported: false``; it must not crash."""
    spec = DesignSpec.model_validate({"furniture": "sofa", "supported": False})
    assert spec.supported is False


# --------------------------------------------------------------------------- #
# Bounded repair
# --------------------------------------------------------------------------- #
def _provider(handler, *, max_retries: int = 0) -> OpenAiCompatibleProvider:
    return OpenAiCompatibleProvider(
        api_key="test-key-not-real",
        base_url="https://ai.example.invalid/v1",
        model="test-model",
        max_retries=max_retries,
        transport=httpx.MockTransport(handler),
    )


def _chat(content: str) -> dict:
    return {"choices": [{"message": {"content": content}}]}


def test_repair_recovers_on_the_second_attempt():
    calls = {"n": 0}
    valid = json.dumps({"furniture": "chair", "color": None})

    def handler(_: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json=_chat("not json" if calls["n"] == 1 else valid))

    spec = _provider(handler).generate_design(DesignRequest(text="stul"))
    assert spec.furniture is FurnitureType.CHAIR
    assert calls["n"] == 2


def test_repair_is_bounded():
    calls = {"n": 0}

    def handler(_: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json=_chat("not json"))

    with pytest.raises(AiOutputError):
        _provider(handler).generate_design(DesignRequest(text="stol"))
    assert calls["n"] == 1 + MAX_REPAIR_ATTEMPTS


def test_semantic_rejection_is_not_repaired():
    """An unknown type will not improve by asking again, so it is not retried."""
    calls = {"n": 0}

    def handler(_: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json=_chat(json.dumps({"furniture": "spaceship"})))

    with pytest.raises(AiOutputError):
        _provider(handler).generate_design(DesignRequest(text="raketa"))
    # One initial call plus one repair attempt, then stop.
    assert calls["n"] == 1 + MAX_REPAIR_ATTEMPTS


# --------------------------------------------------------------------------- #
# Usage ledger
# --------------------------------------------------------------------------- #
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


def test_one_request_writes_exactly_one_ledger_row(client, monkeypatch):
    _use_provider(monkeypatch, LocalHeuristicProvider())
    _authenticated(client, "w13-ledger@example.com")

    response = client.post("/api/ai/design", json={"text": "180x60x75 sm stol"})
    assert response.status_code == 200

    rows = _usage_rows("w13-ledger@example.com")
    assert len(rows) == 1
    assert rows[0].operation == "ai.generate"
    assert rows[0].provider == "local"
    assert rows[0].cost_kind == "unknown"
    assert rows[0].cost_micros is None
    assert rows[0].meta == {"furniture": "table"}


def test_ledger_records_actual_provider_and_duration(client, monkeypatch):
    _use_provider(monkeypatch, LocalHeuristicProvider())
    _authenticated(client, "w13-ledger2@example.com")

    client.post("/api/ai/design", json={"text": "divan 200x90x85"})
    rows = _usage_rows("w13-ledger2@example.com")
    assert len(rows) == 1
    assert rows[0].duration_ms is not None and rows[0].duration_ms >= 0


def test_rejected_request_writes_no_ledger_row(client, monkeypatch):
    _use_provider(monkeypatch, LocalHeuristicProvider())
    _authenticated(client, "w13-ledger3@example.com")

    response = client.post("/api/ai/design", json={"text": "menga mebel kerak"})
    assert response.status_code == 422
    assert _usage_rows("w13-ledger3@example.com") == []


def test_duplicate_ledger_key_is_idempotent(client, monkeypatch):
    from sqlalchemy import select

    from app.database import SessionLocal
    from app.models import User
    from app.services.usage import record_usage

    _authenticated(client, "w13-ledger4@example.com")
    with SessionLocal() as db:
        user = db.execute(select(User).where(User.email == "w13-ledger4@example.com")).scalar_one()
        first, created_first = record_usage(
            db, user, operation="ai.generate", idempotency_key="same-key"
        )
        second, created_second = record_usage(
            db, user, operation="ai.generate", idempotency_key="same-key"
        )
    assert created_first is True
    assert created_second is False
    assert first.id == second.id


# --------------------------------------------------------------------------- #
# Secret hygiene
# --------------------------------------------------------------------------- #
def test_api_key_never_appears_in_the_response(client, monkeypatch):
    _use_provider(monkeypatch, LocalHeuristicProvider())
    _authenticated(client, "w13-secret@example.com")

    response = client.post("/api/ai/design", json={"text": "stol 120x60x75"})
    body = response.text.lower()
    assert "api_key" not in body
    assert "test-key-not-real" not in body
