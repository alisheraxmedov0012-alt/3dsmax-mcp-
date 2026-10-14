"""Local (localStorage) project import safety."""
from __future__ import annotations

from tests.conftest import auth_headers, register


def _import(client, headers, projects):
    return client.post("/api/projects/import", headers=headers, json={"projects": projects})


def test_import_requires_authentication(client):
    response = client.post("/api/projects/import", json={"projects": []})
    assert response.status_code == 401


def test_import_requires_csrf(client):
    register(client, "noc@example.com")
    response = client.post(
        "/api/projects/import",
        json={"projects": [{"client_id": "a", "name": "A", "scene": {}}]},
    )
    assert response.status_code == 403


def test_import_creates_projects_and_is_idempotent(client):
    register(client, "importer@example.com")
    headers = auth_headers(client, "importer@example.com")

    payload = [
        {"client_id": "local-1", "name": "Bir", "scene": {"objects": []}},
        {"client_id": "local-2", "name": "Ikki", "scene": {"objects": []}},
    ]
    first = _import(client, headers, payload)
    assert first.status_code == 200
    assert first.json()["imported"] == 2

    # Re-import: no duplicates, no data loss.
    second = _import(client, headers, payload)
    assert second.status_code == 200
    assert second.json()["imported"] == 0
    assert second.json()["skipped"] == 2

    listed = client.get("/api/projects", headers=headers).json()
    assert len(listed) == 2


def test_import_rejects_oversized_batch(client):
    register(client, "big@example.com")
    headers = auth_headers(client, "big@example.com")
    payload = [
        {"client_id": f"c{i}", "name": f"P{i}", "scene": {}} for i in range(501)
    ]
    response = _import(client, headers, payload)
    assert response.status_code == 422


def test_import_validates_items(client):
    register(client, "bad@example.com")
    headers = auth_headers(client, "bad@example.com")
    response = _import(client, headers, [{"client_id": "", "name": "X", "scene": {}}])
    assert response.status_code == 422


def test_import_isolated_between_users(client):
    register(client, "u1@example.com")
    h1 = auth_headers(client, "u1@example.com")
    _import(client, h1, [{"client_id": "shared", "name": "U1", "scene": {}}])

    register(client, "u2@example.com")
    h2 = auth_headers(client, "u2@example.com")
    # Same client_id for another user creates their own separate project.
    _import(client, h2, [{"client_id": "shared", "name": "U2", "scene": {}}])

    assert len(client.get("/api/projects", headers=h1).json()) == 1
    assert len(client.get("/api/projects", headers=h2).json()) == 1
