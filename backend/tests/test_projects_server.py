"""W10 server-side projects: CRUD, ownership, versioning and validation."""
from __future__ import annotations

from tests.conftest import register

SCENE = {
    "schemaVersion": 3,
    "room": {"widthCm": 400, "lengthCm": 500, "heightCm": 280},
    "objects": [],
}


def _headers(client, email):
    """Register (idempotently) and return fresh authenticated CSRF headers."""
    response = client.post(
        "/api/auth/register", json={"email": email, "password": "Sup3rSecret!"}
    )
    assert response.status_code in (201, 409), response.text
    login = client.post(
        "/api/auth/login", json={"email": email, "password": "Sup3rSecret!"}
    )
    assert login.status_code == 200, login.text
    return {"X-CSRF-Token": login.json()["csrf_token"]}


def _create(client, email="owner@example.com", name="Loyiha", scene=None):
    headers = _headers(client, email)
    return client.post(
        "/api/projects", headers=headers, json={"name": name, "scene": scene or SCENE}
    )


def test_create_and_read_project(client):
    response = _create(client)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["name"] == "Loyiha"
    assert body["version"] == 1
    assert body["schema_version"] == 3
    assert body["scene"]["room"]["widthCm"] == 400

    read = client.get(f"/api/projects/{body['id']}")
    assert read.status_code == 200
    assert read.json()["id"] == body["id"]


def test_list_returns_only_own_projects(client):
    _create(client, "a@example.com", "A loyiha")
    _create(client, "b@example.com", "B loyiha")

    listing = client.get("/api/projects", headers=_headers(client, "a@example.com"))
    assert listing.status_code == 200
    assert [row["name"] for row in listing.json()] == ["A loyiha"]


def test_other_users_project_is_not_found(client):
    created = _create(client, "a@example.com").json()
    headers_b = _headers(client, "b@example.com")

    # IDOR: another user's project is not readable, mutable or deletable.
    assert client.get(f"/api/projects/{created['id']}", headers=headers_b).status_code == 404
    assert (
        client.patch(
            f"/api/projects/{created['id']}", headers=headers_b, json={"name": "hijack"}
        ).status_code
        == 404
    )
    assert client.delete(f"/api/projects/{created['id']}", headers=headers_b).status_code == 404

    # The owner still sees it unchanged.
    headers_a = _headers(client, "a@example.com")
    assert client.get(f"/api/projects/{created['id']}", headers=headers_a).json()["name"] == "Loyiha"


def test_update_bumps_version_and_rename(client):
    created = _create(client).json()
    headers = _headers(client, "owner@example.com")

    updated = client.patch(
        f"/api/projects/{created['id']}", headers=headers, json={"name": "Yangi nom"}
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Yangi nom"
    assert updated.json()["version"] == 2


def test_version_conflict_is_rejected(client):
    created = _create(client).json()
    headers = _headers(client, "owner@example.com")

    first = client.patch(
        f"/api/projects/{created['id']}",
        headers=headers,
        json={"name": "v2", "expected_version": 1},
    )
    assert first.status_code == 200

    # A stale client (still on version 1) cannot overwrite newer work.
    stale = client.patch(
        f"/api/projects/{created['id']}",
        headers=headers,
        json={"name": "stale", "expected_version": 1},
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "version_conflict"


def test_invalid_scene_container_version_is_rejected_without_corrupting(client):
    created = _create(client).json()
    headers = _headers(client, "owner@example.com")

    bad = client.patch(
        f"/api/projects/{created['id']}",
        headers=headers,
        json={"scene": {"format": "3d-studio-ai-scene", "version": 99, "scene": {}}},
    )
    assert bad.status_code == 422
    assert bad.json()["error"]["code"] == "scene_version"

    # The stored scene is untouched.
    assert client.get(f"/api/projects/{created['id']}", headers=headers).json()["scene"] == SCENE


def test_non_finite_scene_value_is_rejected(client):
    headers = _headers(client, "owner@example.com")
    # ``NaN`` is accepted by Python's json module but is not valid JSON for other
    # clients; the server validator must refuse it rather than returning 500.
    response = client.post(
        "/api/projects",
        headers={**headers, "Content-Type": "application/json"},
        content=b'{"name":"x","scene":{"room":{"widthCm":NaN}}}',
    )
    assert response.status_code in (400, 422)


def test_delete_project(client):
    created = _create(client).json()
    headers = _headers(client, "owner@example.com")

    assert client.delete(f"/api/projects/{created['id']}", headers=headers).status_code == 204
    assert client.get(f"/api/projects/{created['id']}", headers=headers).status_code == 404


def test_create_requires_csrf(client):
    register(client, "owner@example.com")
    # No CSRF header -> rejected even though the session cookie is valid.
    response = client.post("/api/projects", json={"name": "x", "scene": SCENE})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "csrf_failed"


def test_create_requires_authentication(client):
    response = client.post("/api/projects", json={"name": "x", "scene": SCENE})
    assert response.status_code == 401
