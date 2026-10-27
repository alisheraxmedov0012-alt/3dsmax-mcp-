"""Tests for the independent .glb validator.

Each test builds a synthetic .glb in memory, so the validator is exercised
against bytes we control rather than against the exporter under test. That keeps
the check honest: a change in three.js cannot silently make these tests pass.
"""

from __future__ import annotations

import json
import struct
import zlib
from pathlib import Path

import pytest

from scripts.glb_validate import main, validate_glb

GLB_MAGIC = 0x46546C67
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def make_png(width: int = 128, height: int = 128) -> bytes:
    """A structurally valid RGBA PNG, CRC included, built with the stdlib."""

    def chunk(tag: bytes, body: bytes) -> bytes:
        return (
            struct.pack(">I", len(body))
            + tag
            + body
            + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    row = b"\x00" + bytes((180, 120, 60, 255)) * width
    idat = zlib.compress(row * height, 9)
    return PNG_SIGNATURE + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def build_bin(png: bytes) -> tuple[bytes, dict[str, int]]:
    """BIN payload for a triangle plus one embedded image; returns offsets."""
    positions = b"".join(
        struct.pack("<3f", *vertex) for vertex in ((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0))
    )
    indices = struct.pack("<3H", 0, 1, 2)
    indices += b"\x00" * ((4 - len(indices) % 4) % 4)
    payload = positions + indices + png
    return payload, {
        "positions": len(positions),
        "indices": 6,
        "image": len(png),
        "imageOffset": len(positions) + len(indices),
    }


def build_gltf(png: bytes, _off: dict[str, int], *, alpha_mode: str = "BLEND") -> dict:
    sizes = build_bin(png)[1]
    return {
        "asset": {"version": "2.0"},
        "scenes": [{"nodes": [0]}],
        "scene": 0,
        "nodes": [{"name": "triangle", "mesh": 0}],
        "meshes": [
            {
                "name": "triangle",
                "primitives": [{"attributes": {"POSITION": 0}, "indices": 1, "material": 0}],
            }
        ],
        "materials": [
            {
                "name": "triangle-material",
                "alphaMode": alpha_mode,
                "pbrMetallicRoughness": {
                    "baseColorTexture": {"index": 0},
                    "metallicFactor": 0.05,
                    "roughnessFactor": 0.6,
                },
                "normalTexture": {"index": 0},
            }
        ],
        "textures": [{"source": 0, "sampler": 0}],
        "images": [{"mimeType": "image/png", "bufferView": 2}],
        "samplers": [{}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"},
            {"bufferView": 1, "componentType": 5123, "count": 3, "type": "SCALAR"},
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": sizes["positions"]},
            {"buffer": 0, "byteOffset": sizes["positions"], "byteLength": sizes["indices"]},
            {"buffer": 0, "byteOffset": sizes["imageOffset"], "byteLength": sizes["image"]},
        ],
        "buffers": [{"byteLength": None}],
    }


def assemble(gltf: dict, payload: bytes, *, magic: int = GLB_MAGIC, declared: int | None = None) -> bytes:
    gltf["buffers"][0]["byteLength"] = len(payload)
    json_bytes = json.dumps(gltf, separators=(",", ":")).encode()
    json_bytes += b" " * ((4 - len(json_bytes) % 4) % 4)
    payload += b"\x00" * ((4 - len(payload) % 4) % 4)
    body = (
        struct.pack("<II", len(json_bytes), JSON_CHUNK)
        + json_bytes
        + struct.pack("<II", len(payload), BIN_CHUNK)
        + payload
    )
    total = 12 + len(body)
    return struct.pack("<III", magic, 2, declared if declared is not None else total) + body


def make_glb(tmp_path: Path, *, png: bytes | None = None, alpha_mode: str = "BLEND", name: str = "m.glb", **kwargs) -> Path:
    png = png if png is not None else make_png()
    payload, offsets = build_bin(png)
    gltf = build_gltf(png, offsets, alpha_mode=alpha_mode)
    target = tmp_path / name
    target.write_bytes(assemble(gltf, payload, **kwargs))
    return target


def statuses(report: dict) -> dict[str, str]:
    return {check["check"]: check["status"] for check in report["checks"]}


def test_valid_glb_passes(tmp_path: Path) -> None:
    report = validate_glb(make_glb(tmp_path))

    assert report["verdict"] == "PASS", report["errors"]
    assert report["errors"] == []
    assert report["counts"]["images"] == 1
    assert report["counts"]["textures"] == 1
    assert report["counts"]["materials"] == 1
    assert report["imageDetails"][0]["png"]["width"] == 128
    assert report["materialDetails"][0]["alphaMode"] == "BLEND"


def test_reports_texture_and_material_wiring(tmp_path: Path) -> None:
    report = validate_glb(make_glb(tmp_path))
    status = statuses(report)

    assert status["baseColorTexture is wired"] == "PASS"
    assert status["normalTexture is wired"] == "PASS"
    assert status["alphaMode BLEND"] == "PASS"
    assert report["materialDetails"][0]["baseColorTexture"] == 0
    assert report["materialDetails"][0]["normalTexture"] == 0
    assert report["materialDetails"][0]["metallicFactor"] == 0.05
    assert report["materialDetails"][0]["roughnessFactor"] == 0.6


def test_rejects_bad_magic(tmp_path: Path) -> None:
    report = validate_glb(make_glb(tmp_path, magic=0x12345678))

    assert report["verdict"] == "FAIL"
    assert any("GLB magic" in error for error in report["errors"])


def test_rejects_length_mismatch(tmp_path: Path) -> None:
    report = validate_glb(make_glb(tmp_path, declared=999_999))

    assert report["verdict"] == "FAIL"
    assert any("declared length" in error for error in report["errors"])


def test_rejects_one_by_one_placeholder_texture(tmp_path: Path) -> None:
    """A 1x1 PNG is what a canvas-less test stub produces, not a real texture."""
    report = validate_glb(make_glb(tmp_path, png=make_png(1, 1)))

    assert report["verdict"] == "FAIL"
    assert any("real texture" in error for error in report["errors"])


def test_accepts_opaque_material(tmp_path: Path) -> None:
    """An opaque model is correct, so the absent BLEND must not fail the file.

    Every other material check still applies; only the *presence* of alpha
    blending is recorded as not applicable instead of as a failure.
    """
    report = validate_glb(make_glb(tmp_path, alpha_mode="OPAQUE"))

    assert report["verdict"] == "PASS", report["errors"]
    assert report["errors"] == []
    status = statuses(report)
    assert status["alphaMode BLEND"] == "NOT APPLICABLE"
    # The rest of the material wiring is untouched by the change.
    assert status["baseColorTexture is wired"] == "PASS"
    assert status["normalTexture is wired"] == "PASS"
    assert report["materialDetails"][0]["alphaMode"] == "OPAQUE"


def _rewrite_json_chunk(path: Path, mutate) -> None:
    """Rewrite the JSON chunk of a .glb in place, so a test can plant a defect."""
    raw = path.read_bytes()
    json_length = struct.unpack("<I", raw[12:16])[0]
    gltf = json.loads(raw[20 : 20 + json_length].decode())
    mutate(gltf)
    json_bytes = json.dumps(gltf, separators=(",", ":")).encode()
    json_bytes += b" " * ((4 - len(json_bytes) % 4) % 4)
    rest = raw[20 + json_length :]
    body = struct.pack("<II", len(json_bytes), JSON_CHUNK) + json_bytes + rest
    path.write_bytes(struct.pack("<III", GLB_MAGIC, 2, 12 + len(body)) + body)


def test_accepts_a_model_with_no_alpha_mode_at_all(tmp_path: Path) -> None:
    """`alphaMode` is optional in glTF; its default is OPAQUE."""
    path = make_glb(tmp_path, alpha_mode="OPAQUE")
    _rewrite_json_chunk(path, lambda gltf: gltf["materials"][0].pop("alphaMode"))

    report = validate_glb(path)

    assert report["verdict"] == "PASS", report["errors"]
    assert statuses(report)["alphaMode BLEND"] == "NOT APPLICABLE"
    assert report["materialDetails"][0]["alphaMode"] == "OPAQUE"


def test_accepts_mask_alpha_without_demanding_blend(tmp_path: Path) -> None:
    """MASK is a valid alpha mode, but it is not blending either."""
    report = validate_glb(make_glb(tmp_path, alpha_mode="MASK"))

    assert report["verdict"] == "PASS", report["errors"]
    assert statuses(report)["alphaMode BLEND"] == "NOT APPLICABLE"
    assert report["materialDetails"][0]["alphaMode"] == "MASK"


def test_rejects_an_unknown_alpha_mode(tmp_path: Path) -> None:
    """A value outside the spec's three modes is a structural defect."""
    report = validate_glb(make_glb(tmp_path, alpha_mode="BLENDED"))

    assert report["verdict"] == "FAIL"
    assert any("alphaMode" in error for error in report["errors"])
    assert any("BLENDED" in error for error in report["errors"])


def test_blend_still_passes_and_keeps_its_structural_checks(tmp_path: Path) -> None:
    """A BLEND model passes, and a broken texture index inside it still fails."""
    ok = validate_glb(make_glb(tmp_path, alpha_mode="BLEND", name="blend-ok.glb"))
    assert ok["verdict"] == "PASS", ok["errors"]
    assert statuses(ok)["alphaMode BLEND"] == "PASS"
    assert ok["materialDetails"][0]["alphaMode"] == "BLEND"

    broken = make_glb(tmp_path, alpha_mode="BLEND", name="blend-broken.glb")
    _rewrite_json_chunk(
        broken,
        lambda gltf: gltf["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"].update(
            {"index": 99}
        ),
    )
    report = validate_glb(broken)
    assert report["verdict"] == "FAIL"
    assert any("baseColorTexture" in error for error in report["errors"])


def test_rejects_buffer_view_outside_bin(tmp_path: Path) -> None:
    path = make_glb(tmp_path)
    raw = bytearray(path.read_bytes())
    json_length = struct.unpack("<I", raw[12:16])[0]
    gltf = json.loads(raw[20 : 20 + json_length].decode())
    gltf["bufferViews"][2]["byteLength"] = 10_000
    json_bytes = json.dumps(gltf, separators=(",", ":")).encode()
    json_bytes += b" " * ((4 - len(json_bytes) % 4) % 4)
    rest = raw[20 + json_length :]
    body = struct.pack("<II", len(json_bytes), JSON_CHUNK) + json_bytes + rest
    path.write_bytes(struct.pack("<III", GLB_MAGIC, 2, 12 + len(body)) + body)

    report = validate_glb(path)

    assert report["verdict"] == "FAIL"
    assert any("bounds" in error for error in report["errors"])


def test_rejects_unparseable_json(tmp_path: Path) -> None:
    path = tmp_path / "broken.glb"
    bad = b"{not json"
    bad += b" " * ((4 - len(bad) % 4) % 4)
    body = struct.pack("<II", len(bad), JSON_CHUNK) + bad
    path.write_bytes(struct.pack("<III", GLB_MAGIC, 2, 12 + len(body)) + body)

    report = validate_glb(path)

    assert report["verdict"] == "FAIL"
    assert any("JSON chunk parses" in error for error in report["errors"])


def test_rejects_external_image_uri(tmp_path: Path) -> None:
    path = make_glb(tmp_path)
    raw = path.read_bytes()
    json_length = struct.unpack("<I", raw[12:16])[0]
    gltf = json.loads(raw[20 : 20 + json_length].decode())
    gltf["images"] = [{"mimeType": "image/png", "uri": "textures/wood.png"}]
    json_bytes = json.dumps(gltf, separators=(",", ":")).encode()
    json_bytes += b" " * ((4 - len(json_bytes) % 4) % 4)
    rest = raw[20 + json_length :]
    body = struct.pack("<II", len(json_bytes), JSON_CHUNK) + json_bytes + rest
    path.write_bytes(struct.pack("<III", GLB_MAGIC, 2, 12 + len(body)) + body)

    report = validate_glb(path)

    assert report["verdict"] == "FAIL"
    assert any("embedded" in error for error in report["errors"])


def test_cli_exit_codes(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    good = make_glb(tmp_path, name="good.glb")
    bad = make_glb(tmp_path, name="bad.glb", magic=0xDEADBEEF)

    assert main([str(good)]) == 0
    assert main([str(bad)]) == 1
    assert main([]) == 2
    assert "usage:" in capsys.readouterr().err


def test_cli_prints_json_report(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    good = make_glb(tmp_path, name="good.glb")

    assert main([str(good)]) == 0
    output = json.loads(capsys.readouterr().out)

    assert list(output) == [str(good)]
    assert output[str(good)]["verdict"] == "PASS"
    assert output[str(good)]["sha256"]
