"""W10 file storage: upload validation, ownership, path safety, status."""
from __future__ import annotations

from tests.conftest import register
from tests.test_projects_server import _headers

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"0" * 32


def _upload(client, email="files@example.com", *, filename="ref.png", content_type="image/png",
            data=PNG_BYTES, project_id=None):
    headers = _headers(client, email)
    files = {"file": (filename, data, content_type)}
    form = {"project_id": project_id} if project_id else {}
    return client.post("/api/files", headers=headers, files=files, data=form)


def test_storage_status_reports_backend_honestly(client):
    response = client.get("/api/files/status")
    assert response.status_code == 200
    body = response.json()
    assert body["backend"] == "memory"
    # The test/development backend must not claim persistence.
    assert body["persistent"] is False


def test_upload_and_download_own_file(client):
    uploaded = _upload(client)
    assert uploaded.status_code == 201, uploaded.text
    body = uploaded.json()
    assert body["filename"] == "ref.png"
    assert body["format"] == "png"
    assert body["size_bytes"] == len(PNG_BYTES)

    download = client.get(f"/api/files/{body['id']}")
    assert download.status_code == 200
    assert download.content == PNG_BYTES
    assert download.headers["x-content-type-options"] == "nosniff"


def test_unsupported_type_is_rejected(client):
    response = _upload(client, filename="evil.exe", content_type="application/x-msdownload")
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "file_type_unsupported"


def test_oversized_file_is_rejected(client):
    from app.config import get_settings

    settings = get_settings()
    original = settings.storage_max_bytes
    settings.storage_max_bytes = 8
    try:
        response = _upload(client)
        assert response.status_code == 413
        assert response.json()["error"]["code"] == "file_too_large"
    finally:
        settings.storage_max_bytes = original


def test_empty_file_is_rejected(client):
    response = _upload(client, data=b"")
    assert response.status_code == 400


def test_filename_is_sanitized(client):
    response = _upload(client, filename="../../etc/passwd\u0000.png")
    assert response.status_code == 201
    name = response.json()["filename"]
    # The stored display name can never contain a path separator.
    assert "/" not in name
    assert ".." not in name


def test_other_users_file_is_not_found(client):
    created = _upload(client, "a@example.com").json()
    headers_b = _headers(client, "b@example.com")

    assert client.get(f"/api/files/{created['id']}", headers=headers_b).status_code == 404
    assert client.get(f"/api/files/{created['id']}", headers=headers_b).status_code == 404


def test_list_returns_only_own_files(client):
    _upload(client, "a@example.com")
    _upload(client, "b@example.com")

    listing = client.get("/api/files", headers=_headers(client, "a@example.com"))
    assert listing.status_code == 200
    assert len(listing.json()) == 1


def test_file_can_be_linked_to_an_owned_project(client):
    from tests.test_projects_server import SCENE

    headers = _headers(client, "files@example.com")
    project = client.post(
        "/api/projects", headers=headers, json={"name": "P", "scene": SCENE}
    ).json()

    response = _upload(client, project_id=project["id"])
    assert response.status_code == 201
    assert response.json()["project_id"] == project["id"]


def test_linking_to_another_users_project_is_rejected(client):
    from tests.test_projects_server import SCENE

    headers_b = _headers(client, "b@example.com")
    other_project = client.post(
        "/api/projects", headers=headers_b, json={"name": "B", "scene": SCENE}
    ).json()

    # ``a`` tries to attach a file to ``b``'s project -> not found (no IDOR).
    response = _upload(client, "a@example.com", project_id=other_project["id"])
    assert response.status_code == 404


def test_upload_requires_auth_and_csrf(client):
    # Unauthenticated.
    assert client.post(
        "/api/files", files={"file": ("a.png", PNG_BYTES, "image/png")}
    ).status_code == 401

    register(client, "files@example.com")
    # Authenticated but no CSRF token.
    assert (
        client.post(
            "/api/files", files={"file": ("a.png", PNG_BYTES, "image/png")}
        ).status_code
        == 403
    )
