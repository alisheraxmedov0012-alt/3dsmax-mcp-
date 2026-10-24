"""P0-B / H-1 — the local import endpoint must apply the same scene bounds as
create and update.

Before the fix ``POST /api/projects/import`` stored ``item.scene`` verbatim, so
every bound enforced elsewhere (object count, assemblies, depth, array length,
byte size, non-finite numbers) could be bypassed by importing instead of
creating. These tests pin the contract on the import path and check that a bad
batch leaves no partial state behind.
"""
from __future__ import annotations

import json

from fastapi.testclient import TestClient

from app.config import get_settings
from app.services import scene_payload
from tests.conftest import auth_headers, register
from tests.test_projects_server import SCENE


def _import(client: TestClient, headers: dict[str, str], projects: list[dict]):
    return client.post("/api/projects/import", headers=headers, json={"projects": projects})


def _item(client_id: str, scene) -> dict:
    return {"client_id": client_id, "name": client_id, "scene": scene}


def _post_raw(client: TestClient, headers: dict[str, str], body: str):
    """Send a body the httpx JSON encoder refuses (NaN / Infinity literals)."""
    return client.post(
        "/api/projects/import",
        headers={**headers, "Content-Type": "application/json"},
        content=body,
    )


def _headers(client: TestClient, email: str) -> dict[str, str]:
    register(client, email)
    return auth_headers(client, email)


def _nested(depth: int) -> dict:
    node: dict = {}
    for _ in range(depth):
        node = {"n": node}
    return node


def _error_code(response) -> str:
    return response.json()["error"]["code"]


# ---------------------------------------------------------------------------
# Accepted payloads stay accepted
# ---------------------------------------------------------------------------


def test_import_accepts_a_scene_within_every_bound(client):
    headers = _headers(client, "ok-import@example.com")

    response = _import(
        client,
        headers,
        [_item("ok", {"objects": [{"id": "a"}, {"id": "b"}, {"id": "c"}]})],
    )

    assert response.status_code == 200
    assert response.json()["imported"] == 1


def test_import_accepts_the_exact_object_limit(client):
    headers = _headers(client, "obj-limit@example.com")
    objects = [{"id": str(i)} for i in range(scene_payload.MAX_OBJECTS)]

    response = _import(client, headers, [_item("exact", {"objects": objects})])

    assert response.status_code == 200


def test_import_accepts_the_exact_assembly_limit(client):
    headers = _headers(client, "asm-limit@example.com")
    assemblies = [{"id": str(i)} for i in range(scene_payload.MAX_ASSEMBLIES_PER_SCENE)]

    response = _import(client, headers, [_item("exact-asm", {"assemblies": assemblies})])

    assert response.status_code == 200


# ---------------------------------------------------------------------------
# Each bound is enforced on the import path
# ---------------------------------------------------------------------------


def test_import_rejects_too_many_objects(client):
    headers = _headers(client, "too-many@example.com")
    objects = [{"id": str(i)} for i in range(scene_payload.MAX_OBJECTS + 1)]

    response = _import(client, headers, [_item("big", {"objects": objects})])

    assert response.status_code == 422
    assert _error_code(response) == "scene_too_large"


def test_import_rejects_too_many_assemblies(client):
    headers = _headers(client, "too-many-asm@example.com")
    assemblies = [{"id": str(i)} for i in range(scene_payload.MAX_ASSEMBLIES_PER_SCENE + 1)]

    response = _import(client, headers, [_item("big-asm", {"assemblies": assemblies})])

    assert response.status_code == 422
    assert _error_code(response) == "scene_too_large"


def test_import_rejects_too_deep_scene(client):
    headers = _headers(client, "too-deep@example.com")

    response = _import(
        client, headers, [_item("deep", {"nested": _nested(scene_payload.MAX_SCENE_DEPTH + 5)})]
    )

    assert response.status_code == 422
    assert _error_code(response) == "scene_too_deep"


def test_import_rejects_overlong_array(client):
    headers = _headers(client, "long-array@example.com")
    values = list(range(scene_payload.MAX_ARRAY_LENGTH + 1))

    response = _import(client, headers, [_item("long", {"values": values})])

    assert response.status_code == 422
    assert _error_code(response) == "scene_too_large"


def test_import_rejects_nan(client):
    headers = _headers(client, "nan@example.com")

    body = json.dumps(
        {"projects": [_item("nan", {"value": float("nan")})]}, allow_nan=True
    )
    response = _post_raw(client, headers, body)

    assert response.status_code == 422
    assert _error_code(response) == "scene_non_finite"


def test_import_rejects_infinity(client):
    headers = _headers(client, "inf@example.com")

    body = json.dumps(
        {"projects": [_item("inf", {"value": float("inf")})]}, allow_nan=True
    )
    response = _post_raw(client, headers, body)

    assert response.status_code == 422
    assert _error_code(response) == "scene_non_finite"


def test_import_rejects_oversized_scene(client):
    """The 2 MB scene cap applies here too.

    ``max_request_bytes`` (1 MB) normally rejects a body this large first, so the
    request cap is raised for this test to reach the scene-size branch.
    """
    settings = get_settings()
    original = settings.max_request_bytes
    settings.max_request_bytes = 8 * 1024 * 1024
    try:
        headers = _headers(client, "huge@example.com")
        # 500 objects x 5000 chars ~ 2.5 MB: under MAX_OBJECTS, over MAX_SCENE_BYTES.
        objects = [{"blob": "x" * 5000} for _ in range(scene_payload.MAX_OBJECTS)]

        response = _import(client, headers, [_item("huge", {"objects": objects})])

        assert response.status_code == 413
        assert _error_code(response) == "scene_too_large"
    finally:
        settings.max_request_bytes = original


# ---------------------------------------------------------------------------
# Validation applies to both branches (new project and idempotent update)
# ---------------------------------------------------------------------------


def test_import_update_of_existing_project_is_validated(client):
    headers = _headers(client, "update-invalid@example.com")

    created = _import(client, headers, [_item("same", SCENE)])
    assert created.status_code == 200
    project_id = created.json()["project_ids"][0]

    bad = _import(
        client,
        headers,
        [_item("same", {"objects": [{}] * (scene_payload.MAX_OBJECTS + 1)})],
    )
    assert bad.status_code == 422
    assert _error_code(bad) == "scene_too_large"

    stored = client.get(f"/api/projects/{project_id}", headers=headers).json()
    # The invalid update changed nothing: scene and version are untouched.
    assert stored["scene"] == SCENE
    assert stored["version"] == 1


def test_import_create_of_new_project_is_validated(client):
    headers = _headers(client, "create-invalid@example.com")

    body = json.dumps(
        {"projects": [_item("new", {"value": float("nan")})]}, allow_nan=True
    )
    response = _post_raw(client, headers, body)

    assert response.status_code == 422
    assert client.get("/api/projects", headers=headers).json() == []


# ---------------------------------------------------------------------------
# Atomicity and isolation
# ---------------------------------------------------------------------------


def test_invalid_item_prevents_the_whole_batch_from_being_saved(client):
    headers = _headers(client, "batch@example.com")

    response = _import(
        client,
        headers,
        [
            _item("first", SCENE),
            _item("second", {"objects": [{}] * (scene_payload.MAX_OBJECTS + 1)}),
            _item("third", SCENE),
        ],
    )

    assert response.status_code == 422
    # Nothing was written: the good items before and after the bad one are absent.
    assert client.get("/api/projects", headers=headers).json() == []


def test_invalid_import_does_not_touch_another_users_project(client):
    headers_b = _headers(client, "owner-b@example.com")
    created = _import(client, headers_b, [_item("shared-id", SCENE)])
    assert created.status_code == 200
    project_id = created.json()["project_ids"][0]

    before = client.get(f"/api/projects/{project_id}", headers=headers_b).json()
    assert before["scene"] == SCENE

    # Logging in as A replaces the client-wide session cookie, so B is re-logged
    # in below before the project is read again.
    headers_a = _headers(client, "intruder-a@example.com")
    bad = _import(
        client,
        headers_a,
        [_item("shared-id", {"objects": [{}] * (scene_payload.MAX_OBJECTS + 1)})],
    )
    assert bad.status_code == 422

    # A cannot see B's project.
    assert client.get(f"/api/projects/{project_id}", headers=headers_a).status_code == 404
    assert client.get("/api/projects", headers=headers_a).json() == []

    # B's project is untouched.
    headers_b = auth_headers(client, "owner-b@example.com")
    stored = client.get(f"/api/projects/{project_id}", headers=headers_b).json()
    assert stored["scene"] == SCENE
    assert stored["version"] == 1


def test_valid_import_still_creates_projects_in_order(client):
    headers = _headers(client, "order@example.com")

    response = _import(client, headers, [_item("a", SCENE), _item("b", SCENE)])

    assert response.status_code == 200
    body = response.json()
    assert body["imported"] == 2
    assert len(body["project_ids"]) == 2
    listed = client.get("/api/projects", headers=headers).json()
    assert {project["client_id"] for project in listed} == {"a", "b"}


# ---------------------------------------------------------------------------
# B-1 - duplicate client ids in one batch
# ---------------------------------------------------------------------------


def _project_counter(email: str) -> int:
    """Read the stored ``projects`` usage counter directly."""
    from sqlalchemy import select

    from app.database import SessionLocal
    from app.models import UsageCounter, User

    with SessionLocal() as db:
        user = db.execute(select(User).where(User.email == email)).scalar_one()
        row = db.execute(
            select(UsageCounter).where(
                UsageCounter.user_id == user.id, UsageCounter.metric == "projects"
            )
        ).scalar_one_or_none()
        return row.count if row else 0


def test_duplicate_client_id_in_batch_returns_422(client):
    headers = _headers(client, "dup@example.com")

    response = _import(
        client,
        headers,
        [_item("same", SCENE), _item("same", SCENE)],
    )

    assert response.status_code == 422
    assert _error_code(response) == "import_duplicate_client_id"


def test_duplicate_client_id_saves_nothing(client):
    headers = _headers(client, "dup-nothing@example.com")

    _import(client, headers, [_item("same", SCENE), _item("same", SCENE)])

    assert client.get("/api/projects", headers=headers).json() == []


def test_duplicate_client_id_does_not_consume_quota(client):
    headers = _headers(client, "dup-quota@example.com")
    before = _project_counter("dup-quota@example.com")

    _import(client, headers, [_item("same", SCENE), _item("same", SCENE)])

    assert _project_counter("dup-quota@example.com") == before
    # A normal import afterwards still succeeds: the counter was not burned.
    ok = _import(client, headers, [_item("fresh", SCENE)])
    assert ok.status_code == 200
    assert ok.json()["imported"] == 1


def test_duplicate_client_id_keeps_an_existing_project_untouched(client):
    headers = _headers(client, "dup-existing@example.com")
    created = _import(client, headers, [_item("same", SCENE)])
    assert created.status_code == 200
    project_id = created.json()["project_ids"][0]

    bad = _import(
        client,
        headers,
        [_item("same", {"objects": [{"id": "changed"}]}), _item("same", SCENE)],
    )
    assert bad.status_code == 422

    stored = client.get(f"/api/projects/{project_id}", headers=headers).json()
    assert stored["scene"] == SCENE
    assert stored["version"] == 1


def test_distinct_client_ids_are_still_accepted(client):
    headers = _headers(client, "distinct@example.com")

    response = _import(client, headers, [_item("a", SCENE), _item("b", SCENE), _item("c", SCENE)])

    assert response.status_code == 200
    assert response.json()["imported"] == 3


def test_duplicate_check_is_scoped_to_the_batch(client):
    """An id already stored by the user may be imported again (idempotent)."""
    headers = _headers(client, "reimport@example.com")
    assert _import(client, headers, [_item("same", SCENE)]).status_code == 200

    again = _import(client, headers, [_item("same", SCENE)])

    assert again.status_code == 200
    assert again.json()["imported"] == 0
    assert again.json()["skipped"] == 1


# ---------------------------------------------------------------------------
# B-1 - transaction boundaries
# ---------------------------------------------------------------------------


def test_successful_import_counts_each_new_project_once(client):
    headers = _headers(client, "quota-count@example.com")
    before = _project_counter("quota-count@example.com")

    response = _import(client, headers, [_item("a", SCENE), _item("b", SCENE)])

    assert response.status_code == 200
    assert response.json()["imported"] == 2
    assert _project_counter("quota-count@example.com") == before + 2


def test_idempotent_reimport_does_not_consume_quota(client):
    headers = _headers(client, "quota-idem@example.com")
    assert _import(client, headers, [_item("same", SCENE)]).status_code == 200
    after_first = _project_counter("quota-idem@example.com")

    again = _import(client, headers, [_item("same", SCENE)])

    assert again.status_code == 200
    assert again.json()["skipped"] == 1
    assert _project_counter("quota-idem@example.com") == after_first


def test_database_failure_during_import_rolls_everything_back(client, monkeypatch):
    """Simulate a DB failure after the rows and the counter were staged.

    The quota increment and the project rows share one transaction, so a commit
    failure must leave neither behind. This is fault injection on the session,
    not a mock of the code under test.
    """
    from sqlalchemy.orm import Session as OrmSession

    headers = _headers(client, "db-fail@example.com")
    before = _project_counter("db-fail@example.com")

    original_commit = OrmSession.commit

    def _boom(self):
        raise RuntimeError("simulated commit failure")

    monkeypatch.setattr(OrmSession, "commit", _boom)
    try:
        try:
            client.post(
                "/api/projects/import",
                headers=headers,
                json={"projects": [_item("a", SCENE), _item("b", SCENE)]},
            )
        except RuntimeError:
            pass
    finally:
        monkeypatch.setattr(OrmSession, "commit", original_commit)

    # No partial rows, and the quota was not burned.
    assert client.get("/api/projects", headers=headers).json() == []
    assert _project_counter("db-fail@example.com") == before

    # The account still works afterwards.
    ok = _import(client, headers, [_item("a", SCENE)])
    assert ok.status_code == 200
    assert ok.json()["imported"] == 1


def test_duplicate_id_batch_leaves_no_partial_rows(client):
    headers = _headers(client, "dup-partial@example.com")

    _import(client, headers, [_item("a", SCENE), _item("b", SCENE), _item("a", SCENE)])

    assert client.get("/api/projects", headers=headers).json() == []
