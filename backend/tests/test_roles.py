"""Roles, authorization and ownership isolation."""
from __future__ import annotations

from tests.conftest import auth_headers, create_admin_user, login, register


def test_unauthenticated_admin_endpoint_is_blocked(client):
    response = client.get("/api/admin/users")
    assert response.status_code == 401


def test_regular_user_cannot_access_admin_endpoint(client):
    register(client, "user1@example.com")
    auth_headers(client, "user1@example.com")

    response = client.get("/api/admin/users")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_admin_can_access_admin_endpoint(client):
    create_admin_user("admin@example.com")
    login(client, "admin@example.com", "AdminSecret123!")

    response = client.get("/api/admin/users")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_user_cannot_self_promote_to_admin(client):
    register(client, "sneaky@example.com")
    headers = auth_headers(client, "sneaky@example.com")

    # There is no endpoint that accepts a role; attempt to smuggle one anyway.
    response = client.post("/api/auth/register", json={
        "email": "other@example.com",
        "password": "Sup3rSecret!",
        "role": "admin",
    })
    # Unknown fields are ignored; the created account must remain a normal user.
    assert response.status_code in (201, 409)
    if response.status_code == 201:
        assert response.json()["user"]["role"] == "user"

    me = client.get("/api/auth/me", headers=headers).json()
    assert me["role"] == "user"


def test_users_only_see_their_own_projects(client):
    register(client, "owner@example.com")
    owner_headers = auth_headers(client, "owner@example.com")
    owner_import = client.post(
        "/api/projects/import",
        headers=owner_headers,
        json={"projects": [{"client_id": "loc-1", "name": "Owner project", "scene": {"a": 1}}]},
    )
    assert owner_import.status_code == 200

    register(client, "intruder@example.com")
    intruder_headers = auth_headers(client, "intruder@example.com")

    intruder_view = client.get("/api/projects", headers=intruder_headers)
    assert intruder_view.status_code == 200
    assert intruder_view.json() == []
