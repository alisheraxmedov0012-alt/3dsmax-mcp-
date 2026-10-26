"""Import must apply the same scene validation as server-side create/update.

``POST /api/projects/import`` used to store ``item.scene`` verbatim, so NaN
values, oversized scenes and bad container versions reached the database through
this one path while ``POST``/``PATCH /projects`` rejected them. These tests pin
the shared behaviour so the gap cannot come back.
"""
from __future__ import annotations

from app.services.scene_payload import DEFAULT_SCENE_SCHEMA_VERSION, MAX_SCENE_BYTES
from tests.conftest import auth_headers, register

SCENE = {
    "schemaVersion": 3,
    "room": {"widthCm": 400, "lengthCm": 500, "heightCm": 280},
    "objects": [],
}

#: ``httpx`` refuses to serialise ``float("nan")``, but Python's ``json`` module
#: *accepts* the ``NaN`` literal when parsing — which is exactly how a
#: non-finite value can arrive. Sending the body as raw text reproduces that.
NAN_BODY = (
    '{"projects": [{"client_id": "nan-1", "name": "NaN",'
    ' "scene": {"room": {"widthCm": NaN}}}]}'
)
INF_BODY = (
    '{"projects": [{"client_id": "inf-1", "name": "Inf",'
    ' "scene": {"objects": [{"scale": Infinity}]}}]}'
)


def _import(client, headers, projects):
    return client.post("/api/projects/import", headers=headers, json={"projects": projects})


def _import_raw(client, headers, body: str):
    return client.post(
        "/api/projects/import",
        headers={**headers, "Content-Type": "application/json"},
        content=body.encode(),
    )


def _import_chunked(client, headers, body: bytes, chunk: int = 64 * 1024):
    """Post without Content-Length so the body-size middleware cannot pre-reject.

    That middleware only inspects a *declared* length, so a chunked request is
    the case where the scene-level byte cap is the remaining guard. That is what
    this helper exercises.
    """

    def generate():
        for start in range(0, len(body), chunk):
            yield body[start : start + chunk]

    return client.post(
        "/api/projects/import",
        headers={**headers, "Content-Type": "application/json"},
        content=generate(),
    )


def _item(client_id="local-1", name="Bir", scene=None):
    return {"client_id": client_id, "name": name, "scene": SCENE if scene is None else scene}


def _ready(client, email="importer@example.com"):
    register(client, email)
    return auth_headers(client, email)


def test_import_rejects_nan_scene_value(client):
    headers = _ready(client)

    response = _import_raw(client, headers, NAN_BODY)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "scene_non_finite"


def test_import_rejects_infinite_scene_value(client):
    headers = _ready(client)

    response = _import_raw(client, headers, INF_BODY)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "scene_non_finite"


def test_import_rejects_oversized_scene(client):
    headers = _ready(client)
    notes = "x" * (MAX_SCENE_BYTES + 1)
    body = (
        '{"projects": [{"client_id": "big-1", "name": "Big", "scene": {"notes": "'
        + notes
        + '"}}]}'
    ).encode()

    response = _import_chunked(client, headers, body)

    assert response.status_code == 413, response.text
    assert response.json()["error"]["code"] == "scene_too_large"


def test_import_rejects_bad_container_format_and_version(client):
    headers = _ready(client)

    wrong_format = _import(
        client,
        headers,
        [_item(scene={"format": "other", "version": 1, "scene": {}})],
    )
    assert wrong_format.status_code == 422
    assert wrong_format.json()["error"]["code"] == "scene_format"

    wrong_version = _import(
        client,
        headers,
        [_item(scene={"format": "3d-studio-ai-scene", "version": 99, "scene": {}})],
    )
    assert wrong_version.status_code == 422
    assert wrong_version.json()["error"]["code"] == "scene_version"


def test_import_unwraps_a_valid_container(client):
    headers = _ready(client)

    response = _import(
        client,
        headers,
        [_item(scene={"format": "3d-studio-ai-scene", "version": 1, "scene": SCENE})],
    )

    assert response.status_code == 200, response.text
    project_id = response.json()["project_ids"][0]
    stored = client.get(f"/api/projects/{project_id}", headers=headers).json()
    # The wrapper is not stored; the scene inside it is.
    assert "format" not in stored["scene"]
    assert stored["scene"]["room"]["widthCm"] == 400


def test_import_rejects_too_many_objects(client):
    headers = _ready(client)
    scene = {"objects": [{}] * 501}

    response = _import(client, headers, [_item(scene=scene)])

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "scene_too_large"


def test_import_stores_the_current_schema_version(client):
    headers = _ready(client)

    response = _import(client, headers, [_item()])

    assert response.status_code == 200, response.text
    project_id = response.json()["project_ids"][0]
    stored = client.get(f"/api/projects/{project_id}", headers=headers).json()
    assert stored["schema_version"] == DEFAULT_SCENE_SCHEMA_VERSION


def test_rejected_import_does_not_overwrite_an_existing_project(client):
    headers = _ready(client, "overwrite@example.com")

    first = _import(client, headers, [_item(client_id="same", scene={"objects": []})])
    assert first.status_code == 200
    project_id = first.json()["project_ids"][0]

    # Same client_id, but a payload the validator refuses.
    rejected = _import_raw(
        client,
        headers,
        '{"projects": [{"client_id": "same", "name": "Buzuq",'
        ' "scene": {"room": {"widthCm": NaN}}}]}',
    )
    assert rejected.status_code == 422

    stored = client.get(f"/api/projects/{project_id}", headers=headers).json()
    assert stored["scene"] == {"objects": []}
    assert stored["version"] == 1
    assert stored["name"] == "Bir"


def test_valid_import_over_existing_project_is_validated_and_versioned(client):
    headers = _ready(client, "reimport@example.com")

    first = _import(client, headers, [_item(client_id="same", scene={"objects": []})])
    project_id = first.json()["project_ids"][0]

    second = _import(client, headers, [_item(client_id="same", scene=SCENE)])
    assert second.status_code == 200
    assert second.json()["imported"] == 0
    assert second.json()["skipped"] == 1

    stored = client.get(f"/api/projects/{project_id}", headers=headers).json()
    assert stored["scene"]["room"]["widthCm"] == 400
    assert stored["version"] == 2
    assert stored["schema_version"] == DEFAULT_SCENE_SCHEMA_VERSION


def test_invalid_item_rejects_the_whole_batch(client):
    headers = _ready(client, "batch@example.com")

    response = _import_raw(
        client,
        headers,
        '{"projects": ['
        '{"client_id": "good-1", "name": "Yaxshi", "scene": {"objects": []}},'
        '{"client_id": "bad-1", "name": "Buzuq", "scene": {"room": {"heightCm": NaN}}}'
        "]}",
    )

    assert response.status_code == 422
    # Nothing from the batch was written, so a retry starts from a clean slate.
    listed = client.get("/api/projects", headers=headers).json()
    assert listed == []
