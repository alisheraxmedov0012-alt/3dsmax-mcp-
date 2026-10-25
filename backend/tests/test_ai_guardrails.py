"""A3.2 — AI usage guardrails.

Three protections are covered here:

* the per-user daily AI quota, enforced through the existing plan/``UsageCounter``
  path (no second enforcement mechanism),
* a system-wide daily ceiling in the database, so an unset plan limit or a
  misbehaving account cannot drain the provider budget,
* the explicit rejection of a reference-image request, which no provider can
  currently honour.

No provider is contacted: every request is routed to the offline analyzer or the
stub provider through the same ``get_ai_provider`` seam the earlier tests use.
"""
from __future__ import annotations

import threading
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.services.ai.local_provider import LocalHeuristicProvider
from tests.conftest import auth_headers, register
from tests.test_ai import _set_limit, _use_provider

# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _set_global_limit(value: int, monkeypatch) -> None:
    """Override the system-wide AI ceiling for one test."""
    monkeypatch.setenv("APP_AI_GLOBAL_DAILY_LIMIT", str(value))
    get_settings.cache_clear()


def _global_usage(metric: str = "ai_requests") -> int:
    from sqlalchemy import select

    from app.database import SessionLocal
    from app.models import GlobalUsageCounter

    with SessionLocal() as db:
        rows = (
            db.execute(select(GlobalUsageCounter).where(GlobalUsageCounter.metric == metric))
            .scalars()
            .all()
        )
        return sum(row.count for row in rows)


def _user_rows(user_email: str) -> list[tuple[int, str]]:
    """(count, period) per counter row for one user, newest period last."""
    from sqlalchemy import select

    from app.database import SessionLocal
    from app.models import UsageCounter, User

    with SessionLocal() as db:
        user = db.execute(select(User).where(User.email == user_email)).scalar_one()
        rows = (
            db.execute(select(UsageCounter).where(UsageCounter.user_id == user.id))
            .scalars()
            .all()
        )
        return [(row.count, row.period) for row in rows if row.metric == "ai_requests"]


class _CountingProvider:
    """Wraps a provider and counts how many times the backend actually called it."""

    name = "counting"

    def __init__(self) -> None:
        self.calls = 0
        self._inner = LocalHeuristicProvider()

    @property
    def is_configured(self) -> bool:
        return True

    def generate_design(self, request):
        self.calls += 1
        return self._inner.generate_design(request)


@pytest.fixture(autouse=True)
def _restore_settings():
    yield
    get_settings.cache_clear()


# --------------------------------------------------------------------------- #
# Per-user daily quota
# --------------------------------------------------------------------------- #


def test_free_plan_allows_the_configured_daily_allowance(client, monkeypatch):
    """The boundary is inclusive: the Nth request of the day is accepted."""
    _use_provider(monkeypatch, LocalHeuristicProvider())
    _authenticated(client, "quota@example.com")
    _set_limit("free", "max_ai_requests", 3)

    for _ in range(3):
        response = client.post("/api/ai/design", json={"text": "180x60x75 sm stol"})
        assert response.status_code == 200, response.text


def test_request_beyond_the_quota_is_rejected_before_the_provider(client, monkeypatch):
    """The provider must not be called once the allowance is spent."""
    provider = _CountingProvider()
    _use_provider(monkeypatch, provider)
    _authenticated(client, "blocked@example.com")
    _set_limit("free", "max_ai_requests", 1)

    first = client.post("/api/ai/design", json={"text": "180x60x75 sm stol"})
    assert first.status_code == 200
    assert provider.calls == 1

    second = client.post("/api/ai/design", json={"text": "180x60x75 sm stol"})
    assert second.status_code == 402
    assert second.json()["error"]["code"] == "limit_reached"
    # No extra provider call, so no unbilled cost.
    assert provider.calls == 1

    # A refused request is not recorded as a successful use either.
    assert _user_rows("blocked@example.com") == [(1, _today())]


def test_quota_is_tracked_per_user(client, monkeypatch):
    """One user's usage must never consume another user's allowance."""
    _use_provider(monkeypatch, LocalHeuristicProvider())
    _set_limit("free", "max_ai_requests", 1)

    register(client, "first@example.com")
    register(client, "second@example.com")

    a1 = client.post(
        "/api/ai/design",
        headers=auth_headers(client, "first@example.com"),
        json={"text": "180x60x75 sm stol"},
    )
    assert a1.status_code == 200

    a2 = client.post(
        "/api/ai/design",
        headers=auth_headers(client, "first@example.com"),
        json={"text": "180x60x75 sm stol"},
    )
    assert a2.status_code == 402

    # The second account still has its own untouched allowance.
    b1 = client.post(
        "/api/ai/design",
        headers=auth_headers(client, "second@example.com"),
        json={"text": "180x60x75 sm stol"},
    )
    assert b1.status_code == 200


def test_quota_counts_a_failed_provider_call(client, monkeypatch):
    """A call that reached the provider consumes quota even if it failed.

    The money may already have been spent, so the allowance must reflect the
    attempt rather than only the successes. The usage ledger still records only
    successful operations, which is a different question (audit, not blocking).
    """
    from app.services.ai.base import AiProviderError

    class _Failing:
        name = "failing"

        @property
        def is_configured(self) -> bool:
            return True

        def generate_design(self, request):
            raise AiProviderError("provider down")

    _use_provider(monkeypatch, _Failing())
    _authenticated(client, "fails@example.com")
    _set_limit("free", "max_ai_requests", 1)

    first = client.post("/api/ai/design", json={"text": "180x60x75 sm stol"})
    assert first.status_code == 502

    # The attempt consumed the single allowed request.
    second = client.post("/api/ai/design", json={"text": "180x60x75 sm stol"})
    assert second.status_code == 402
    assert _user_rows("fails@example.com") == [(1, _today())]


def test_quota_applies_to_a_new_day(client, monkeypatch):
    """A daily limit must refill on the next UTC day, not once per lifetime."""
    from app.services import limits

    _use_provider(monkeypatch, LocalHeuristicProvider())
    _authenticated(client, "daily@example.com")
    _set_limit("free", "max_ai_requests", 1)

    assert client.post("/api/ai/design", json={"text": "stol"}).status_code == 200
    assert client.post("/api/ai/design", json={"text": "stol"}).status_code == 402

    # Move the counter period forward as the next day would.
    original = limits.period_for
    try:
        limits.period_for = lambda metric, now=None: "2999-01-01"
        assert client.post("/api/ai/design", json={"text": "stol"}).status_code == 200
    finally:
        limits.period_for = original

    # Yesterday's row is still there and still spent.
    periods = {period: count for count, period in _user_rows("daily@example.com")}
    assert periods[_today()] == 1
    assert periods["2999-01-01"] == 1


# --------------------------------------------------------------------------- #
# System-wide daily ceiling
# --------------------------------------------------------------------------- #


def test_global_ceiling_stops_the_platform_across_users(client, monkeypatch):
    """The ceiling is system-wide, so a second account cannot exceed it either."""
    _use_provider(monkeypatch, LocalHeuristicProvider())
    _set_global_limit(1, monkeypatch)
    _authenticated(client, "platform-a@example.com")
    register(client, "platform-b@example.com")

    first = client.post(
        "/api/ai/design",
        headers=auth_headers(client, "platform-a@example.com"),
        json={"text": "stol"},
    )
    assert first.status_code == 200
    assert _global_usage() == 1

    second = client.post(
        "/api/ai/design",
        headers=auth_headers(client, "platform-b@example.com"),
        json={"text": "stol"},
    )
    assert second.status_code == 503
    assert second.json()["error"]["code"] == "ai_capacity_reached"
    assert "Retry-After" in second.headers
    assert _global_usage() == 1


def test_global_ceiling_blocks_the_provider_call(client, monkeypatch):
    """When the platform budget is spent no provider call may start."""
    provider = _CountingProvider()
    _use_provider(monkeypatch, provider)
    _set_global_limit(0, monkeypatch)  # 0 disables the check, so use 1 below
    _set_global_limit(1, monkeypatch)
    _authenticated(client, "spend@example.com")
    _set_limit("free", "max_ai_requests", 50)

    assert client.post("/api/ai/design", json={"text": "stol"}).status_code == 200
    assert provider.calls == 1

    blocked = client.post("/api/ai/design", json={"text": "stol"})
    assert blocked.status_code == 503
    assert provider.calls == 1


def test_user_quota_is_not_consumed_when_the_platform_is_full(client, monkeypatch):
    """A refused request must not cost the user one of their own requests."""
    _use_provider(monkeypatch, LocalHeuristicProvider())
    _set_global_limit(1, monkeypatch)
    _authenticated(client, "fair@example.com")
    _set_limit("free", "max_ai_requests", 5)

    assert client.post("/api/ai/design", json={"text": "stol"}).status_code == 200
    # Platform budget spent; the next call is refused by the ceiling.
    assert client.post("/api/ai/design", json={"text": "stol"}).status_code == 503

    # The user's own counter only shows the one request that actually ran.
    periods = {period: count for count, period in _user_rows("fair@example.com")}
    assert periods[_today()] == 1


def test_global_counter_survives_a_new_database_session(client, monkeypatch):
    """The ceiling lives in the database, so a fresh session sees it."""
    from app.database import SessionLocal
    from app.services.limits import consume_global, global_usage

    with SessionLocal() as db:
        consume_global(db, "ai_requests", limit=5)
    # A brand-new session (as a restarted process would open) still sees it.
    with SessionLocal() as db:
        assert global_usage(db, "ai_requests") == 1
        consume_global(db, "ai_requests", limit=5)
    with SessionLocal() as db:
        assert global_usage(db, "ai_requests") == 2


def test_global_counter_is_atomic_under_parallel_requests(client, monkeypatch):
    """Parallel consumers cannot overshoot the ceiling.

    Each worker opens its own session, exactly as a separate request (or a
    separate backend replica) would, so this exercises the database-level
    check-and-take rather than one shared in-process counter.
    """
    from app.database import SessionLocal
    from app.errors import ApiError
    from app.services.limits import consume_global

    limit = 5
    workers = 24
    accepted: list[int] = []
    rejected: list[int] = []
    lock = threading.Lock()

    def worker() -> None:
        with SessionLocal() as db:
            try:
                consume_global(db, "ai_requests", limit=limit)
            except ApiError:
                with lock:
                    rejected.append(1)
                return
            with lock:
                accepted.append(1)

    threads = [threading.Thread(target=worker) for _ in range(workers)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(accepted) == limit, f"accepted {len(accepted)} of {workers} with limit {limit}"
    assert len(rejected) == workers - limit
    assert _global_usage() == limit


def test_global_ceiling_can_be_disabled(client, monkeypatch):
    """Zero means "no ceiling", which is the pre-A3.2 behaviour."""
    _use_provider(monkeypatch, LocalHeuristicProvider())
    _set_global_limit(0, monkeypatch)
    _authenticated(client, "nocap@example.com")
    _set_limit("free", "max_ai_requests", 50)

    for _ in range(3):
        assert client.post("/api/ai/design", json={"text": "stol"}).status_code == 200
    assert _global_usage() == 0


# --------------------------------------------------------------------------- #
# Reference images
# --------------------------------------------------------------------------- #


def test_image_request_is_rejected_with_a_stable_code(client, monkeypatch):
    """A reference image is refused instead of silently treated as text."""
    provider = _CountingProvider()
    _use_provider(monkeypatch, provider)
    _authenticated(client, "image@example.com")

    response = client.post(
        "/api/ai/design",
        json={"text": "shu rasmga o'xshash stol", "image_filename": "stol.jpg"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "ai_image_not_supported"
    assert "rasm" in response.json()["error"]["message"].lower()
    # Nothing was sent to the provider and no quota was consumed.
    assert provider.calls == 0
    assert _user_rows("image@example.com") == []


def test_image_request_is_rejected_even_when_the_provider_is_unconfigured(client, monkeypatch):
    """The image is a request problem, so it is reported before the 503."""
    from app.services.ai.base import ProviderNotConfigured

    _use_provider(monkeypatch, ProviderNotConfigured("not configured"))
    _authenticated(client, "image2@example.com")

    response = client.post(
        "/api/ai/design",
        json={"text": "stol", "image_filename": "stol.png"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "ai_image_not_supported"


def test_text_requests_still_work_alongside_the_image_guard(client, monkeypatch):
    """The guard must not disturb the normal text path."""
    _use_provider(monkeypatch, LocalHeuristicProvider())
    _authenticated(client, "text@example.com")
    _set_limit("free", "max_ai_requests", 5)

    response = client.post("/api/ai/design", json={"text": "180x60x75 sm stol"})
    assert response.status_code == 200
    body = response.json()
    assert body["spec"]["furniture"] == "table"
    # An explicitly null image field is not a request for image analysis.
    again = client.post(
        "/api/ai/design", json={"text": "180x60x75 sm stol", "image_filename": None}
    )
    assert again.status_code == 200


# --------------------------------------------------------------------------- #
# Counting rules
# --------------------------------------------------------------------------- #


def test_repair_attempts_do_not_consume_extra_quota(client, monkeypatch):
    """Repair and network retries are internal to one request.

    One accepted request consumes exactly one unit, however many provider HTTP
    calls it needed internally (worst case three: two network attempts and one
    repair). This is the rule the report documents.
    """
    from app.services.ai.base import AiOutputError

    class _Repairing:
        name = "repairing"

        def __init__(self) -> None:
            self.calls = 0

        @property
        def is_configured(self) -> bool:
            return True

        def generate_design(self, request):
            self.calls += 1
            raise AiOutputError("bad output")

    provider = _Repairing()
    _use_provider(monkeypatch, provider)
    _authenticated(client, "repair@example.com")
    _set_limit("free", "max_ai_requests", 2)

    # Fails at the provider boundary; still exactly one unit consumed.
    assert client.post("/api/ai/design", json={"text": "stol"}).status_code == 422
    periods = {period: count for count, period in _user_rows("repair@example.com")}
    assert periods[_today()] == 1


def _today() -> str:
    return datetime.now(UTC).date().isoformat()


def _authenticated(client: TestClient, email: str) -> TestClient:
    register(client, email)
    return client
