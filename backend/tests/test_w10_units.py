"""W10 unit and security tests for the new backend modules."""
from __future__ import annotations

import pytest

from app.errors import ApiError
from app.services import jobs as jobs_service
from app.services import scene_payload
from app.services.storage import (
    LocalStorageAdapter,
    MemoryStorageAdapter,
    generate_storage_key,
    resolve_format,
    sanitize_filename,
    validate_size,
)

# ---------------------------------------------------------------------------
# scene payload validation (untrusted input)
# ---------------------------------------------------------------------------


def test_extract_scene_accepts_a_bare_scene():
    scene = {"room": {"widthCm": 400}, "objects": []}
    assert scene_payload.extract_scene(scene) == scene


def test_extract_scene_unwraps_a_valid_container():
    scene = {"room": {}, "objects": []}
    payload = {"format": scene_payload.SCENE_JSON_FORMAT, "version": 1, "scene": scene}
    assert scene_payload.extract_scene(payload) == scene


def test_extract_scene_rejects_wrong_format_and_version():
    with pytest.raises(ApiError) as wrong_format:
        scene_payload.extract_scene({"format": "other", "version": 1, "scene": {}})
    assert wrong_format.value.code == "scene_format"

    with pytest.raises(ApiError) as wrong_version:
        scene_payload.extract_scene(
            {"format": scene_payload.SCENE_JSON_FORMAT, "version": 2, "scene": {}}
        )
    assert wrong_version.value.code == "scene_version"


def test_extract_scene_rejects_non_finite_values():
    with pytest.raises(ApiError) as exc:
        scene_payload.extract_scene({"room": {"widthCm": float("nan")}})
    assert exc.value.code == "scene_non_finite"

    with pytest.raises(ApiError):
        scene_payload.extract_scene({"objects": [{"scale": float("inf")}]})


def test_extract_scene_rejects_non_dict_and_too_many_objects():
    with pytest.raises(ApiError):
        scene_payload.extract_scene(["not", "a", "dict"])
    with pytest.raises(ApiError) as exc:
        scene_payload.extract_scene({"objects": [{}] * (scene_payload.MAX_OBJECTS + 1)})
    assert exc.value.code == "scene_too_large"


# ---------------------------------------------------------------------------
# storage helpers
# ---------------------------------------------------------------------------


def test_sanitize_filename_strips_paths_and_control_chars():
    assert "/" not in sanitize_filename("../../etc/passwd")
    assert sanitize_filename("a b*c.png") == "a-b-c.png"
    assert sanitize_filename("") == "file"
    assert len(sanitize_filename("x" * 500)) <= 100


def test_resolve_format_only_allows_the_allow_list():
    assert resolve_format("image/png") == "png"
    with pytest.raises(ApiError) as exc:
        resolve_format("application/x-msdownload")
    assert exc.value.code == "file_type_unsupported"


def test_validate_size_rejects_empty(monkeypatch):
    with pytest.raises(ApiError) as exc:
        validate_size(0)
    assert exc.value.code == "file_empty"


def test_generate_storage_key_is_scoped_and_not_user_controlled():
    key = generate_storage_key("user-1", "png")
    assert key.startswith("user-1/")
    assert key.endswith(".png")
    assert ".." not in key


def test_memory_adapter_round_trip():
    adapter = MemoryStorageAdapter()
    assert adapter.exists("k") is False
    adapter.put("k", b"data")
    assert adapter.get("k") == b"data"
    adapter.delete("k")
    assert adapter.exists("k") is False


def test_local_adapter_rejects_path_traversal(tmp_path):
    adapter = LocalStorageAdapter(str(tmp_path))
    # A tampered key must never escape the storage root.
    with pytest.raises(ApiError) as exc:
        adapter.get("../escape.txt")
    assert exc.value.code == "file_key_invalid"

    # A normal key round-trips.
    adapter.put("u/a.png", b"bytes")
    assert adapter.get("u/a.png") == b"bytes"


# ---------------------------------------------------------------------------
# job service state machine
# ---------------------------------------------------------------------------


def test_job_state_machine_blocks_illegal_transitions():
    from app.models import Job

    job = Job(kind="noop", status=jobs_service.STATUS_SUCCEEDED, idempotency_key="k", payload={})
    # A succeeded job is terminal; it cannot be moved back to running.
    with pytest.raises(ApiError) as exc:
        jobs_service._transition(job, jobs_service.STATUS_RUNNING)
    assert exc.value.code == "job_invalid_transition"


def test_job_transitions_are_declared_for_every_status():
    for status in jobs_service.ALL_STATUSES:
        assert status in jobs_service.ALLOWED_TRANSITIONS


def test_succeeded_and_cancelled_are_final_states():
    # ``failed`` is deliberately not final — it can be requeued for a retry.
    assert jobs_service.ALLOWED_TRANSITIONS[jobs_service.STATUS_SUCCEEDED] == frozenset()
    assert jobs_service.ALLOWED_TRANSITIONS[jobs_service.STATUS_CANCELLED] == frozenset()
    assert jobs_service.ALLOWED_TRANSITIONS[jobs_service.STATUS_FAILED] == frozenset(
        {jobs_service.STATUS_QUEUED}
    )
