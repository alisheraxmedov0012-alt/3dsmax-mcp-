"""D2 — the quota unit and the job row must share one transaction.

``enqueue_job()`` used to take the plan quota with an immediate ``commit()`` and
only then insert the job. A request that lost an idempotency race rolled the job
back but kept the unit it had already committed, so one job cost two units.

These tests use the real database and the real unique constraint — nothing is
mocked. A losing request comes either from genuine parallel threads or from a
real duplicate-key violation.

Engine note: SQLite serialises writers, so the parallel tests only show "no
double charge" there. PostgreSQL (the CI ``postgres`` job and any run with
``APP_TEST_POSTGRES_URL`` set) is the engine where the race actually happens, and
``test_a_losing_idempotency_request_refunds_its_unit`` runs only there.
"""
from __future__ import annotations

import os
import threading
import time
from collections.abc import Callable

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.errors import ApiError
from app.models import Job, Plan, UsageCounter, User
from app.services import jobs as jobs_service
from app.services import limits as limits_service
from tests.conftest import register

PG_URL = os.environ.get("APP_TEST_POSTGRES_URL")

METRIC = "ai_requests"
KIND = "ai_generate"


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _set_limit(key: str, value: int) -> None:
    """Configure a plan limit (limits default to unset, so tests must set them)."""
    with SessionLocal() as db:
        plan = db.execute(select(Plan).where(Plan.key == "free")).scalar_one()
        limits = dict(plan.limits or {})
        limits[key] = value
        plan.limits = limits
        db.commit()


def _user_id(email: str) -> str:
    with SessionLocal() as db:
        return db.execute(select(User.id).where(User.email == email)).scalar_one()


def _counter_total(email: str, metric: str = METRIC) -> int:
    """Units consumed for one metric, summed over every period row."""
    with SessionLocal() as db:
        user_id = _user_id(email)
        total = db.execute(
            select(func.coalesce(func.sum(UsageCounter.count), 0)).where(
                UsageCounter.user_id == user_id,
                UsageCounter.metric == metric,
            )
        ).scalar_one()
        return int(total)


def _job_keys(email: str) -> list[str]:
    with SessionLocal() as db:
        user_id = _user_id(email)
        rows = db.execute(select(Job.idempotency_key).where(Job.user_id == user_id)).scalars()
        return list(rows)


def _enqueue_in_own_session(email: str, key: str, kind: str = KIND) -> tuple[str, bool]:
    """Enqueue from a fresh session, exactly as a separate request would."""
    with SessionLocal() as db:
        user = db.execute(select(User).where(User.email == email)).scalar_one()
        job, created = jobs_service.enqueue_job(db, user, kind=kind, idempotency_key=key)
        return job.id, created


def _stored_job(email: str, *, key: str, committed_by: str) -> None:
    """Insert a job row directly (used to create a committed winner)."""
    with SessionLocal() as db:
        db.add(
            Job(
                user_id=_user_id(email),
                kind=KIND,
                status=jobs_service.STATUS_QUEUED,
                idempotency_key=key,
                payload={"seed": committed_by},
                attempts=0,
                max_attempts=1,
                timeout_seconds=30,
            )
        )
        db.commit()


def _run_parallel(
    workers: int, target: Callable[[int], tuple[str, bool]]
) -> tuple[list[tuple[str, bool]], list[Exception]]:
    """Run ``target`` in ``workers`` threads that start at the same moment."""
    results: list[tuple[str, bool]] = []
    errors: list[Exception] = []
    lock = threading.Lock()
    barrier = threading.Barrier(workers, timeout=60)

    def run(index: int) -> None:
        try:
            barrier.wait()  # release together so the race is genuine
            outcome = target(index)
        except Exception as exc:  # collected and asserted by the test
            with lock:
                errors.append(exc)
            return
        with lock:
            results.append(outcome)

    threads = [threading.Thread(target=run, args=(index,)) for index in range(workers)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=120)
        assert not thread.is_alive(), "a worker thread did not finish"

    return results, errors


# --------------------------------------------------------------------------- #
# 1. Same idempotency key, parallel
# --------------------------------------------------------------------------- #


def test_parallel_same_key_creates_one_job_and_charges_one_unit(client):
    """One key means one job and one unit, however many requests race."""
    email = "atomic-same-key@example.com"
    register(client, email)
    workers = 16

    results, errors = _run_parallel(
        workers, lambda _index: _enqueue_in_own_session(email, "race-key")
    )

    assert errors == [], f"unexpected errors: {errors!r}"
    assert len({job_id for job_id, _created in results}) == 1
    # Exactly one request actually created the job; the rest got it back.
    assert sum(1 for _job_id, created in results if created) == 1
    assert _job_keys(email) == ["race-key"]
    assert _counter_total(email) == 1


# --------------------------------------------------------------------------- #
# 2. Distinct keys, parallel
# --------------------------------------------------------------------------- #


def test_parallel_distinct_keys_never_exceed_the_limit(client):
    """The atomic check-and-take keeps the counter and the job count at the cap."""
    email = "atomic-cap@example.com"
    register(client, email)
    limit = 5
    workers = 16
    _set_limit("max_ai_requests", limit)

    results, errors = _run_parallel(
        workers, lambda index: _enqueue_in_own_session(email, f"cap-{index}")
    )

    assert len(results) == limit
    assert len(errors) == workers - limit
    assert all(
        isinstance(error, ApiError) and error.code == "limit_reached" for error in errors
    ), f"unexpected errors: {errors!r}"
    assert len(_job_keys(email)) == limit
    assert _counter_total(email) == limit


# --------------------------------------------------------------------------- #
# 3. Idempotency conflict
# --------------------------------------------------------------------------- #


def test_unit_and_job_are_rolled_back_together_on_a_duplicate_key(client):
    """Deterministic proof of the shared transaction boundary.

    The unit is taken with ``commit=False`` and the duplicate insert fails in the
    same session, so the real unique constraint aborts both. Before the fix the
    unit was committed on its own and survived this rollback.
    """
    email = "atomic-tx@example.com"
    register(client, email)
    key = "tx-key"
    _stored_job(email, key=key, committed_by="winner")

    with SessionLocal() as db:
        user = db.execute(select(User).where(User.email == email)).scalar_one()
        limits_service.enforce_limit(db, user, METRIC, increment=1, commit=False)
        db.add(
            Job(
                user_id=user.id,
                kind=KIND,
                status=jobs_service.STATUS_QUEUED,
                idempotency_key=key,
                payload={},
                attempts=0,
                max_attempts=1,
                timeout_seconds=30,
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()

    assert _counter_total(email) == 0, "the unit was not refunded by the rollback"
    assert _job_keys(email) == [key]


@pytest.mark.skipif(
    not PG_URL,
    reason="real row-lock interleaving needs PostgreSQL; SQLite locks the whole database",
)
def test_a_losing_idempotency_request_refunds_its_unit(client):
    """The same property through ``enqueue_job`` itself, with a genuine race.

    A holder keeps the key in an open, uncommitted transaction: the row is
    invisible to the loser's SELECT (READ COMMITTED), so the loser takes the unit
    and then blocks on the unique index until the holder commits. It must come out
    of that with its unit refunded.

    The holder is held for ``HOLD_SECONDS`` so the loser provably blocks: an
    elapsed time at least that long is the evidence that the conflict path ran
    rather than the cheap "job already exists" path. Without that assertion this
    test could pass through the wrong branch and prove nothing.
    """
    email = "atomic-race@example.com"
    register(client, email)
    key = "race-key"
    user_id = _user_id(email)

    HOLD_SECONDS = 1.0
    holder_ready = threading.Event()
    release_holder = threading.Event()

    def hold_the_key() -> None:
        with SessionLocal() as holder:
            holder.add(
                Job(
                    user_id=user_id,
                    kind=KIND,
                    status=jobs_service.STATUS_QUEUED,
                    idempotency_key=key,
                    payload={"seed": "holder"},
                    attempts=0,
                    max_attempts=1,
                    timeout_seconds=30,
                )
            )
            holder.flush()  # written, not committed -> invisible, index entry held
            holder_ready.set()
            # Keep the index entry until the loser has had time to reach the
            # blocking INSERT.
            release_holder.wait(timeout=HOLD_SECONDS)
            holder.commit()

    holder = threading.Thread(target=hold_the_key)
    holder.start()
    assert holder_ready.wait(timeout=30), "the holder never reached its flush"

    started = time.monotonic()
    results, errors = _run_parallel(1, lambda _index: _enqueue_in_own_session(email, key))
    elapsed = time.monotonic() - started

    holder.join(timeout=30)
    assert not holder.is_alive(), "the holder thread did not finish"

    assert errors == [], f"unexpected errors: {errors!r}"
    assert len(results) == 1
    _job_id, created = results[0]
    assert created is False, "the loser must not report a new job"
    assert elapsed >= HOLD_SECONDS * 0.5, (
        f"the loser returned in {elapsed:.3f}s, so it never blocked on the holder"
        " — the conflict path did not run and this test proved nothing"
    )
    assert _job_keys(email) == [key]
    assert _counter_total(email) == 0, "the loser paid for a job it never created"


# --------------------------------------------------------------------------- #
# 4. Limit exhausted
# --------------------------------------------------------------------------- #


def test_limit_reached_consumes_nothing(client):
    email = "atomic-zero@example.com"
    register(client, email)
    _set_limit("max_ai_requests", 0)

    with pytest.raises(ApiError) as excinfo:
        _enqueue_in_own_session(email, "blocked-1")

    assert excinfo.value.code == "limit_reached"
    assert _job_keys(email) == []
    assert _counter_total(email) == 0


def test_a_partly_used_quota_is_not_charged_when_the_next_one_is_refused(client):
    """The last unit is not lost when the following request is refused."""
    email = "atomic-partial@example.com"
    register(client, email)
    _set_limit("max_ai_requests", 1)

    _job_id, created = _enqueue_in_own_session(email, "first")
    assert created is True
    assert _counter_total(email) == 1

    with pytest.raises(ApiError) as excinfo:
        _enqueue_in_own_session(email, "second")
    assert excinfo.value.code == "limit_reached"

    assert _counter_total(email) == 1, "a refused request must not consume a unit"
    assert _job_keys(email) == ["first"]


# --------------------------------------------------------------------------- #
# 5. Existing job
# --------------------------------------------------------------------------- #


def test_returning_an_existing_job_does_not_consume_again(client):
    email = "atomic-repeat@example.com"
    register(client, email)

    first_id, first_created = _enqueue_in_own_session(email, "dup")
    second_id, second_created = _enqueue_in_own_session(email, "dup")

    assert first_created is True
    assert second_created is False
    assert first_id == second_id
    assert _counter_total(email) == 1


# --------------------------------------------------------------------------- #
# 6. enqueue_job contract
# --------------------------------------------------------------------------- #


def test_a_successful_enqueue_leaves_the_job_committed(client):
    """``enqueue_job`` still commits; ``commit=False`` only defers the counter."""
    email = "atomic-contract@example.com"
    register(client, email)

    job_id, created = _enqueue_in_own_session(email, "contract-1")

    assert created is True
    with SessionLocal() as db:
        stored = db.get(Job, job_id)
        assert stored is not None, "the job must be visible to a new session"
        assert stored.idempotency_key == "contract-1"


def test_a_kind_without_a_metric_still_creates_its_job(client):
    """``noop`` consumes no quota but must still be stored (unchanged path)."""
    email = "atomic-noop@example.com"
    register(client, email)

    job_id, created = _enqueue_in_own_session(email, "noop-1", kind="noop")

    assert created is True
    assert _counter_total(email) == 0
    with SessionLocal() as db:
        assert db.get(Job, job_id) is not None
