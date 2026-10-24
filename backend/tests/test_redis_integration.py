"""Redis integration tests against a real server (RD-3).

These are **not** the fake-client unit tests in ``test_security.py``: every check
here talks to a live Redis over the network. They exist because the limiter's
real behaviour — INCR/EXPIRE on a shared key, cross-worker counting, and what a
dead server looks like over a socket — cannot be established from a Python dict.

Enable them by pointing ``APP_TEST_REDIS_URL`` at a throwaway instance::

    APP_TEST_REDIS_URL=redis://127.0.0.1:6379/0 python -m pytest -m redis

Without the variable the module is skipped (visible as *skipped*, never as
passed). With the variable set but the server unreachable the tests **fail**:
a silent green run over a dead dependency would be worse than no test.

Isolation: every test works under a per-module random namespace and the client
only ever deletes keys carrying that namespace, so a shared development Redis
keeps its other data.
"""
from __future__ import annotations

import os
import time
import uuid

import pytest

REDIS_URL = os.environ.get("APP_TEST_REDIS_URL")

pytestmark = [
    pytest.mark.redis,
    pytest.mark.skipif(
        not REDIS_URL,
        reason="APP_TEST_REDIS_URL o'rnatilmagan (haqiqiy Redis serveri yo'q)",
    ),
]

#: A port nothing listens on, used for the fail-closed cases. Connecting here is
#: a real socket failure — not a mocked exception.
CLOSED_PORT_URL = "redis://127.0.0.1:6399/0"


@pytest.fixture(scope="module")
def redis_client():
    """A real client. Fails (never skips) when the configured server is down."""
    import redis

    client = redis.Redis.from_url(REDIS_URL, socket_timeout=2, socket_connect_timeout=2)
    try:
        client.ping()
    except Exception as exc:
        pytest.fail(
            "APP_TEST_REDIS_URL o'rnatilgan, lekin server javob bermadi "
            f"({type(exc).__name__}). Integratsion testlar yashil bo'lib qolmasligi uchun to'xtatildi.",
            pytrace=False,
        )
    yield client
    client.close()


@pytest.fixture(scope="module")
def namespace() -> str:
    """Random per-run prefix so parallel runs and leftovers never collide."""
    return f"itest-{uuid.uuid4().hex[:12]}"


def _redis_keys(client, namespace: str) -> list[str]:
    return [key for key in client.scan_iter(match=f"rl:{namespace}*")]


def _purge(client, namespace: str) -> int:
    """Delete only the keys this module created. Returns how many were removed."""
    keys = _redis_keys(client, namespace)
    if keys:
        client.delete(*keys)
    return len(keys)


@pytest.fixture(autouse=True)
def _cleanup(redis_client, namespace):
    """Remove this module's keys before and after each test."""
    _purge(redis_client, namespace)
    yield
    _purge(redis_client, namespace)


def _limiter(client, max_events: int, window_seconds: int = 60):
    from app.rate_limit import RedisRateLimiter

    return RedisRateLimiter(client, max_events=max_events, window_seconds=window_seconds)


def _raw_key(key: str, window_seconds: int) -> str:
    return f"rl:{key}:{int(time.time() // window_seconds)}"


# ---------------------------------------------------------------------------
# 1. Connection and ping
# ---------------------------------------------------------------------------


def test_ping_reaches_the_real_server(redis_client):
    assert redis_client.ping() is True
    # The limiter's own probe uses the same client.
    assert _limiter(redis_client, 5).ping() is True


# ---------------------------------------------------------------------------
# 2. The counter lives in Redis, not in the process
# ---------------------------------------------------------------------------


def test_counter_is_written_to_redis(redis_client, namespace):
    key = f"{namespace}-count"
    limiter = _limiter(redis_client, max_events=10, window_seconds=60)

    for _ in range(3):
        limiter.check(key)

    stored = redis_client.get(_raw_key(key, 60))
    assert stored is not None, "the counter must exist as a Redis key"
    assert int(stored) == 3


def test_counter_is_shared_across_separate_limiter_instances(redis_client, namespace):
    """Two limiters = two "workers"; both must see the same counter."""
    key = f"{namespace}-shared"
    first = _limiter(redis_client, max_events=5, window_seconds=60)
    second = _limiter(redis_client, max_events=5, window_seconds=60)

    first.check(key)
    first.check(key)
    second.check(key)

    assert int(redis_client.get(_raw_key(key, 60))) == 3


def test_second_worker_hits_the_limit_set_by_the_first(redis_client, namespace):
    from app.errors import ApiError

    key = f"{namespace}-cross"
    worker_a = _limiter(redis_client, max_events=2, window_seconds=60)
    worker_b = _limiter(redis_client, max_events=2, window_seconds=60)

    worker_a.check(key)
    worker_a.check(key)

    with pytest.raises(ApiError) as excinfo:
        worker_b.check(key)
    assert excinfo.value.status_code == 429


# ---------------------------------------------------------------------------
# 3. Limit exceeded -> the documented rate-limit response
# ---------------------------------------------------------------------------


def test_limit_exceeded_returns_429_with_retry_after(redis_client, namespace):
    from app.errors import ApiError

    limiter = _limiter(redis_client, max_events=2, window_seconds=45)
    key = f"{namespace}-limited"

    limiter.check(key)
    limiter.check(key)

    with pytest.raises(ApiError) as excinfo:
        limiter.check(key)

    error = excinfo.value
    assert error.status_code == 429
    assert error.code == "rate_limited"
    assert error.headers["Retry-After"] == "45"


# ---------------------------------------------------------------------------
# 4. Independent keys do not share a counter
# ---------------------------------------------------------------------------


def test_distinct_keys_keep_separate_counters(redis_client, namespace):
    from app.errors import ApiError

    limiter = _limiter(redis_client, max_events=2, window_seconds=60)
    key_a = f"{namespace}-a"
    key_b = f"{namespace}-b"

    limiter.check(key_a)
    limiter.check(key_a)
    limiter.check(key_b)

    with pytest.raises(ApiError):
        limiter.check(key_a)

    # key_b is unaffected by key_a being exhausted.
    limiter.check(key_b)
    assert int(redis_client.get(_raw_key(key_a, 60))) == 3
    assert int(redis_client.get(_raw_key(key_b, 60))) == 2


# ---------------------------------------------------------------------------
# 5. Fail-closed when the server is unreachable
# ---------------------------------------------------------------------------


def test_unreachable_server_fails_closed():
    import redis

    from app.errors import ApiError
    from app.rate_limit import RedisRateLimiter

    client = redis.Redis.from_url(CLOSED_PORT_URL, socket_timeout=1, socket_connect_timeout=1)
    limiter = RedisRateLimiter(client, max_events=100, window_seconds=60)

    with pytest.raises(ApiError) as excinfo:
        limiter.check("itest-unreachable")

    error = excinfo.value
    assert error.status_code == 503
    assert error.code == "rate_limit_unavailable"
    # Fail closed: it refuses, it does not allow the request through.


def test_ping_reports_false_when_the_server_is_unreachable():
    import redis

    from app.rate_limit import RedisRateLimiter

    client = redis.Redis.from_url(CLOSED_PORT_URL, socket_timeout=1, socket_connect_timeout=1)
    limiter = RedisRateLimiter(client, max_events=5, window_seconds=60)

    assert limiter.ping() is False


# ---------------------------------------------------------------------------
# 6. Readiness reflects the real store
# ---------------------------------------------------------------------------


def test_readiness_is_ready_with_a_live_store(client, monkeypatch, redis_client):
    from app import rate_limit as rl

    limiter = _limiter(redis_client, max_events=10)
    monkeypatch.setattr(rl, "_ADAPTER", {"value": limiter})
    monkeypatch.setattr(rl, "get_rate_limiter", lambda: limiter)

    response = client.get("/api/health/ready")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["rate_limit_store"] == "ok"
    assert body["checks"]["rate_limit_store"] is True


def test_readiness_is_not_ready_with_an_unreachable_store(client, monkeypatch):
    import redis

    from app import rate_limit as rl
    from app.rate_limit import RedisRateLimiter

    dead = redis.Redis.from_url(CLOSED_PORT_URL, socket_timeout=1, socket_connect_timeout=1)
    limiter = RedisRateLimiter(dead, max_events=10, window_seconds=60)
    monkeypatch.setattr(rl, "_ADAPTER", {"value": limiter})
    monkeypatch.setattr(rl, "get_rate_limiter", lambda: limiter)

    response = client.get("/api/health/ready")

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "not_ready"
    assert body["rate_limit_store"] == "unavailable"
    assert body["checks"]["rate_limit_store"] is False


def test_liveness_stays_up_when_the_store_is_down(client, monkeypatch):
    import redis

    from app import rate_limit as rl
    from app.rate_limit import RedisRateLimiter

    dead = redis.Redis.from_url(CLOSED_PORT_URL, socket_timeout=1, socket_connect_timeout=1)
    limiter = RedisRateLimiter(dead, max_events=10, window_seconds=60)
    monkeypatch.setattr(rl, "_ADAPTER", {"value": limiter})
    monkeypatch.setattr(rl, "get_rate_limiter", lambda: limiter)

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


# ---------------------------------------------------------------------------
# 7. Cleanup is scoped to this module's namespace
# ---------------------------------------------------------------------------


def test_cleanup_removes_only_this_namespace(redis_client, namespace):
    own = f"rl:{namespace}-own:1"
    foreign = f"rl:itest-foreign-{uuid.uuid4().hex[:8]}:1"
    redis_client.set(own, 1)
    redis_client.set(foreign, 1)

    removed = _purge(redis_client, namespace)

    assert removed == 1
    assert redis_client.exists(own) == 0
    # Someone else's key survives.
    assert redis_client.exists(foreign) == 1
    redis_client.delete(foreign)


def test_limiter_leaves_no_keys_behind_after_cleanup(redis_client, namespace):
    limiter = _limiter(redis_client, max_events=5, window_seconds=60)
    limiter.check(f"{namespace}-leftover")

    assert _redis_keys(redis_client, namespace) != []
    _purge(redis_client, namespace)
    assert _redis_keys(redis_client, namespace) == []
