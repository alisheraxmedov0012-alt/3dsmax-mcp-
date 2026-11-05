"""Phase 4.3A — secure texture upload: validation, storage, security."""
from __future__ import annotations

import io

import pytest
from PIL import Image, ImageCms
from PIL.PngImagePlugin import PngInfo

from app.config import get_settings
from app.routers import textures as textures_router
from tests.test_projects_server import _headers


def _png(width: int = 16, height: int = 8, mode: str = "RGBA", color=(20, 40, 60, 255)) -> bytes:
    image = Image.new(mode, (width, height), color)
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def _jpeg(width: int = 16, height: int = 8) -> bytes:
    image = Image.new("RGB", (width, height), (120, 80, 40))
    out = io.BytesIO()
    image.save(out, format="JPEG", quality=90)
    return out.getvalue()


def _webp(width: int = 16, height: int = 8) -> bytes:
    image = Image.new("RGB", (width, height), (30, 90, 120))
    out = io.BytesIO()
    image.save(out, format="WEBP", quality=90)
    return out.getvalue()


def _animated_webp() -> bytes:
    frames = [Image.new("RGB", (8, 8), color) for color in ("red", "blue")]
    out = io.BytesIO()
    frames[0].save(
        out,
        format="WEBP",
        save_all=True,
        append_images=frames[1:],
        duration=100,
        loop=0,
    )
    return out.getvalue()


@pytest.fixture
def local_storage(tmp_path):
    settings = get_settings()
    previous = (settings.storage_backend, settings.storage_dir)
    settings.storage_backend = "local"
    settings.storage_dir = str(tmp_path / "storage")
    try:
        yield settings
    finally:
        settings.storage_backend, settings.storage_dir = previous


def _upload(
    client,
    email: str = "textures@example.com",
    *,
    data: bytes | None = None,
    content_type: str = "image/png",
    filename: str = "texture.png",
    csrf: bool = True,
):
    headers = _headers(client, email)
    if not csrf:
        headers = {}
    return client.post(
        "/api/textures",
        headers=headers,
        files={"file": (filename, data if data is not None else _png(), content_type)},
    )


def test_upload_png_returns_texture_metadata_and_content(client, local_storage):
    uploaded = _upload(client)
    assert uploaded.status_code == 201, uploaded.text
    body = uploaded.json()
    assert body["version"] == 1
    assert body["filename"] == "texture.png"
    assert body["mime_type"] == "image/png"
    assert body["width"] == 16
    assert body["height"] == 8
    assert body["byte_size"] > 0
    assert body["content_hash"].startswith("sha256:")
    assert body["source"] == {"kind": "bitmap", "generator": None}
    assert "storage_key" not in body
    assert "storage_path" not in body

    metadata = client.get(
        f"/api/textures/{body['id']}", headers=_headers(client, "textures@example.com")
    )
    assert metadata.status_code == 200
    assert metadata.json()["id"] == body["id"]

    content = client.get(
        f"/api/textures/{body['id']}/content",
        headers=_headers(client, "textures@example.com"),
    )
    assert content.status_code == 200
    assert content.headers["content-type"] == "image/png"
    assert content.headers["content-disposition"].startswith("inline")
    assert content.headers["x-content-type-options"] == "nosniff"
    assert content.headers["etag"] == f'"{body["content_hash"]}"'
    assert content.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert len(content.content) == body["byte_size"]

    cached = client.get(
        f"/api/textures/{body['id']}/content",
        headers={
            **_headers(client, "textures@example.com"),
            "If-None-Match": content.headers["etag"],
        },
    )
    assert cached.status_code == 304


@pytest.mark.parametrize(
    ("data", "content_type"),
    [(_png(), "image/png"), (_jpeg(), "image/jpeg"), (_webp(), "image/webp")],
)
def test_png_jpeg_webp_are_accepted(client, local_storage, data, content_type):
    response = _upload(client, data=data, content_type=content_type)
    assert response.status_code == 201, response.text
    assert response.json()["mime_type"] == "image/png"


def test_exif_orientation_is_applied_and_metadata_stripped(client, local_storage):
    image = Image.new("RGB", (40, 20), (200, 30, 30))
    exif = Image.Exif()
    exif[274] = 6  # rotate 90 degrees on display
    source = io.BytesIO()
    image.save(source, format="JPEG", exif=exif)

    response = _upload(client, data=source.getvalue(), content_type="image/jpeg")
    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["width"], body["height"]) == (20, 40)

    content = client.get(
        f"/api/textures/{body['id']}/content",
        headers=_headers(client, "textures@example.com"),
    )
    decoded = Image.open(io.BytesIO(content.content))
    assert decoded.size == (20, 40)
    assert not decoded.getexif()


def test_icc_profile_and_png_text_chunks_are_stripped(client, local_storage):
    profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))
    source = io.BytesIO()
    Image.new("RGB", (8, 8), (20, 30, 40)).save(
        source, format="JPEG", icc_profile=profile.tobytes()
    )
    jpeg = _upload(client, data=source.getvalue(), content_type="image/jpeg")
    assert jpeg.status_code == 201, jpeg.text
    jpeg_content = client.get(
        f"/api/textures/{jpeg.json()['id']}/content",
        headers=_headers(client, "textures@example.com"),
    )
    jpeg_meta = Image.open(io.BytesIO(jpeg_content.content))
    assert "icc_profile" not in jpeg_meta.info

    png = io.BytesIO()
    info = PngInfo()
    info.add_text("Comment", "private metadata")
    Image.new("RGB", (8, 8), (50, 60, 70)).save(png, format="PNG", pnginfo=info)
    png_response = _upload(client, data=png.getvalue())
    assert png_response.status_code == 201, png_response.text
    png_content = client.get(
        f"/api/textures/{png_response.json()['id']}/content",
        headers=_headers(client, "textures@example.com"),
    )
    png_meta = Image.open(io.BytesIO(png_content.content))
    assert "Comment" not in png_meta.info


def test_transparency_is_preserved(client, local_storage):
    source = io.BytesIO()
    Image.new("RGBA", (4, 4), (255, 0, 0, 0)).save(source, format="PNG")

    response = _upload(client, data=source.getvalue())
    assert response.status_code == 201, response.text
    content = client.get(
        f"/api/textures/{response.json()['id']}/content",
        headers=_headers(client, "textures@example.com"),
    )
    decoded = Image.open(io.BytesIO(content.content))
    assert decoded.mode == "RGBA"
    assert decoded.getpixel((0, 0))[3] == 0


def test_spoofed_mime_is_rejected(client, local_storage, tmp_path):
    response = _upload(client, data=_jpeg(), content_type="image/png")
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "texture_mime_mismatch"
    assert client.get("/api/textures", headers=_headers(client, "textures@example.com")).json() == []
    assert list((tmp_path / "storage").rglob("*.png")) == []


def test_fake_or_truncated_png_is_rejected(client, local_storage):
    fake = b"\x89PNG\r\n\x1a\n" + b"0" * 32
    response = _upload(client, data=fake)
    assert response.status_code == 422
    assert response.json()["error"]["code"] in {"texture_corrupt", "texture_decode_failed"}


def test_svg_is_rejected(client, local_storage):
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    response = _upload(client, data=svg, content_type="image/svg+xml")
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "texture_type_unsupported"


def test_gif_is_rejected(client, local_storage):
    out = io.BytesIO()
    Image.new("P", (4, 4)).save(out, format="GIF")
    response = _upload(client, data=out.getvalue(), content_type="image/gif")
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "texture_type_unsupported"


def test_animated_webp_is_rejected(client, local_storage):
    response = _upload(client, data=_animated_webp(), content_type="image/webp")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "texture_animated"


def test_oversized_upload_is_rejected(client, local_storage, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "texture_max_bytes", 100)
    response = _upload(client, data=_png(32, 32))
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "texture_too_large"


def test_dimension_limit_is_rejected(client, local_storage, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "texture_max_dimension", 10)
    response = _upload(client, data=_png(20, 10))
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "texture_dimensions_too_large"


def test_pixel_limit_is_rejected(client, local_storage, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "texture_max_dimension", 100)
    monkeypatch.setattr(settings, "texture_max_pixels", 100)
    response = _upload(client, data=_png(20, 20))
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "texture_dimensions_too_large"


def test_decompression_bomb_is_rejected_without_decoding(client, local_storage):
    out = io.BytesIO()
    Image.new("1", (10_000, 10_000)).save(out, format="PNG")
    response = _upload(client, data=out.getvalue())
    assert response.status_code == 413
    assert response.json()["error"]["code"] in {
        "texture_too_large",
        "texture_dimensions_too_large",
    }


def test_duplicate_upload_returns_same_texture(client, local_storage, tmp_path):
    data = _png(12, 12)
    first = _upload(client, data=data)
    second = _upload(client, data=data)

    assert first.status_code == 201
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]

    listing = client.get("/api/textures", headers=_headers(client, "textures@example.com"))
    assert len(listing.json()) == 1
    assert len(list((tmp_path / "storage").rglob("*.png"))) == 1


def test_duplicate_across_users_is_separate(client, local_storage, tmp_path):
    data = _png(12, 12)
    first = _upload(client, "a@example.com", data=data)
    second = _upload(client, "b@example.com", data=data)

    assert first.status_code == 201
    assert second.status_code == 201
    assert second.json()["id"] != first.json()["id"]
    assert len(list((tmp_path / "storage").rglob("*.png"))) == 2


def test_other_users_cannot_read_texture(client, local_storage):
    created = _upload(client, "owner@example.com").json()
    other = _headers(client, "intruder@example.com")

    assert client.get(f"/api/textures/{created['id']}", headers=other).status_code == 404
    assert (
        client.get(f"/api/textures/{created['id']}/content", headers=other).status_code == 404
    )
    assert client.get("/api/textures", headers=other).json() == []


def test_upload_requires_authentication_and_csrf(client, local_storage):
    assert (
        client.post(
            "/api/textures",
            files={"file": ("a.png", _png(), "image/png")},
        ).status_code
        == 401
    )

    assert _upload(client, csrf=False).status_code == 403


def test_memory_storage_rejects_texture_upload(client):
    # Default test settings use the in-process adapter: no durable bytes.
    response = _upload(client)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "storage_not_persistent"
    assert client.get("/api/textures", headers=_headers(client, "textures@example.com")).json() == []


def test_storage_status_verifies_local_write(client, local_storage):
    response = client.get("/api/files/status")
    assert response.status_code == 200
    body = response.json()
    assert body["backend"] == "local"
    assert body["available"] is True
    assert body["persistent"] is True
    assert body["verified"] is True


def test_unwritable_storage_is_not_claimed_persistent(client, tmp_path):
    settings = get_settings()
    previous = (settings.storage_backend, settings.storage_dir)
    blocker = tmp_path / "blocked"
    blocker.write_text("not a directory")
    settings.storage_backend = "local"
    settings.storage_dir = str(blocker)
    try:
        status = client.get("/api/files/status")
        body = status.json()
        assert body["available"] is False
        assert body["persistent"] is False
        assert body["verified"] is False

        response = _upload(client)
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "storage_not_persistent"
    finally:
        settings.storage_backend, settings.storage_dir = previous


def test_per_user_quota_is_enforced(client, local_storage, tmp_path, monkeypatch):
    first = _upload(client, data=_png(10, 10))
    assert first.status_code == 201
    used = first.json()["byte_size"]

    settings = get_settings()
    monkeypatch.setattr(settings, "storage_max_user_bytes", used + 10)

    second = _upload(client, data=_png(11, 11, color=(1, 2, 3, 255)))
    assert second.status_code == 413
    assert second.json()["error"]["code"] == "storage_quota_exceeded"

    listing = client.get("/api/textures", headers=_headers(client, "textures@example.com"))
    assert len(listing.json()) == 1
    assert len(list((tmp_path / "storage").rglob("*.png"))) == 1


def test_storage_write_failure_leaves_no_record(client, local_storage, monkeypatch):
    class FailingAdapter:
        name = "failing"
        is_persistent = True

        def put(self, key, data):
            raise OSError("disk unavailable")

        def get(self, key):
            raise AssertionError("unreachable")

        def delete(self, key):
            return None

        def exists(self, key):
            return False

    monkeypatch.setattr(
        textures_router.storage_service, "get_storage_adapter", lambda: FailingAdapter()
    )

    response = _upload(client)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "storage_write_failed"
    listing = client.get("/api/textures", headers=_headers(client, "textures@example.com"))
    assert listing.json() == []


def test_generic_file_api_listing_excludes_textures(client, local_storage):
    _upload(client, data=_png(10, 10))
    headers = _headers(client, "textures@example.com")
    generic = client.post(
        "/api/files",
        headers=headers,
        files={"file": ("generic.png", _png(9, 9), "image/png")},
    )
    assert generic.status_code == 201, generic.text

    files = client.get("/api/files", headers=headers)
    assert len(files.json()) == 1
    assert files.json()[0]["id"] == generic.json()["id"]

    textures = client.get("/api/textures", headers=headers)
    assert len(textures.json()) == 1


def test_filename_is_normalized_to_png(client, local_storage):
    response = _upload(client, filename="../../evil.jpg")
    assert response.status_code == 201
    listing = client.get("/api/textures", headers=_headers(client, "textures@example.com"))
    entry = listing.json()[0]
    assert entry["id"] == response.json()["id"]
    # The API does not expose storage paths; the download uses a sanitized name.
    content = client.get(
        f"/api/textures/{entry['id']}/content",
        headers=_headers(client, "textures@example.com"),
    )
    assert ".." not in content.headers["content-disposition"]
    assert content.headers["content-disposition"].endswith('.png"')
