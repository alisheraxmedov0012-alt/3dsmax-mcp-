"""Independent binary glTF (.glb) validator.

Used to check what the exporter actually wrote, without asking the exporter.
Sharing no code with three.js is the point: a validator that reuses the writer's
own assumptions can only confirm them. This module reads the bytes and checks
the spec's own invariants, so an embedded texture, an alpha-blended material or
a mis-sized buffer is judged from the file, not from the code that made it.

Only the standard library is used, so it adds no dependency and runs wherever
Python does (CI, a release check, a one-off audit).

Usage::

    python scripts/glb_validate.py model.glb [more.glb ...]

Prints one JSON report per file. Exits 1 if any file fails a check.
"""

from __future__ import annotations

import json
import struct
import sys
import zlib
from hashlib import sha256
from pathlib import Path
from typing import Any

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

#: glTF componentType -> byte size, and accessor type -> component count.
COMPONENT_SIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
TYPE_COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}


class Report:
    """Accumulates PASS/FAIL checks and warnings for one file."""

    def __init__(self, path: str) -> None:
        self.path = path
        self.checks: list[dict[str, str]] = []
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def ok(self, name: str, detail: str = "") -> None:
        self.checks.append({"check": name, "status": "PASS", "detail": detail})

    def fail(self, name: str, detail: str = "") -> None:
        self.checks.append({"check": name, "status": "FAIL", "detail": detail})
        self.errors.append(f"{name}: {detail}")

    def warn(self, message: str) -> None:
        self.warnings.append(message)

    @property
    def verdict(self) -> str:
        return "PASS" if not self.errors else "FAIL"

    def as_dict(self) -> dict[str, Any]:
        return {
            "file": self.path,
            "verdict": self.verdict,
            "checks": self.checks,
            "errors": self.errors,
            "warnings": self.warnings,
        }


def read_png_ihdr(data: bytes) -> dict[str, int] | None:
    """Return PNG geometry, or None if ``data`` is not a structurally valid PNG."""
    if not data.startswith(PNG_SIGNATURE):
        return None
    length = struct.unpack(">I", data[8:12])[0]
    if data[12:16] != b"IHDR" or length != 13:
        return None
    width, height, depth, colour = struct.unpack(">IIBB", data[16:26])

    position, chunks = 8, 0
    while position + 12 <= len(data):
        chunk_length = struct.unpack(">I", data[position : position + 4])[0]
        tag = data[position + 4 : position + 8]
        body = data[position + 8 : position + 8 + chunk_length]
        if len(body) != chunk_length:
            return None
        crc_offset = position + 8 + chunk_length
        crc = struct.unpack(">I", data[crc_offset : crc_offset + 4])[0]
        if zlib.crc32(tag + body) & 0xFFFFFFFF != crc:
            return None
        chunks += 1
        position = crc_offset + 4
        if tag == b"IEND":
            break
    return {"width": width, "height": height, "bitDepth": depth, "colourType": colour, "chunks": chunks}


def _check_header(raw: bytes, report: Report) -> tuple[bytes | None, bytes | None]:
    if len(raw) < 12:
        report.fail("GLB header", f"file is {len(raw)} bytes, shorter than the 12-byte header")
        return None, None

    magic, version, declared = struct.unpack("<III", raw[:12])
    if magic != GLB_MAGIC:
        report.fail("GLB magic", f"0x{magic:08X}, expected 0x{GLB_MAGIC:08X}")
    else:
        report.ok("GLB magic", "glTF")
    if version != 2:
        report.fail("GLB version", str(version))
    else:
        report.ok("GLB version", "2")
    if declared != len(raw):
        report.fail("GLB declared length", f"header says {declared}, file is {len(raw)}")
    else:
        report.ok("GLB declared length", f"{declared} == file size")

    chunks: list[tuple[int, bytes]] = []
    offset = 12
    while offset + 8 <= len(raw):
        chunk_length, chunk_type = struct.unpack("<II", raw[offset : offset + 8])
        start = offset + 8
        end = start + chunk_length
        if end > len(raw):
            report.fail("chunk bounds", f"chunk at offset {offset} runs past end of file")
            return None, None
        chunks.append((chunk_type, raw[start:end]))
        offset = end
    if offset != len(raw):
        report.fail("chunk alignment", f"{len(raw) - offset} trailing byte(s)")
    else:
        report.ok("chunk alignment", f"{len(chunks)} chunk(s)")

    json_chunk = next((body for kind, body in chunks if kind == CHUNK_JSON), None)
    bin_chunk = next((body for kind, body in chunks if kind == CHUNK_BIN), None)
    if json_chunk is None:
        report.fail("JSON chunk present", "no JSON chunk")
    else:
        report.ok("JSON chunk present", f"{len(json_chunk)} bytes")
    if bin_chunk is None:
        report.fail("BIN chunk present", "no BIN chunk")
    else:
        report.ok("BIN chunk present", f"{len(bin_chunk)} bytes")
    return json_chunk, bin_chunk


def _check_buffer(gltf: dict[str, Any], bin_chunk: bytes, report: Report) -> None:
    buffers = gltf.get("buffers", [])
    if len(buffers) != 1:
        report.fail("buffer count", f"{len(buffers)}, expected 1 for a self-contained .glb")
        return
    buffer = buffers[0]
    if "uri" in buffer:
        report.fail("buffer is embedded", f"external uri {buffer['uri'][:48]}")
        return
    if buffer["byteLength"] > len(bin_chunk):
        report.fail("buffer byteLength", f"{buffer['byteLength']} > BIN chunk {len(bin_chunk)}")
        return
    report.ok("buffer is embedded", f"{buffer['byteLength']} bytes of BIN data")


def _check_buffer_views(gltf: dict[str, Any], bin_chunk: bytes, report: Report) -> list[dict[str, Any]]:
    views = gltf.get("bufferViews", [])
    failures = 0
    for index, view in enumerate(views):
        if view.get("buffer") != 0:
            report.fail(f"bufferView[{index}].buffer", str(view.get("buffer")))
            failures += 1
            continue
        end = view.get("byteOffset", 0) + view["byteLength"]
        if end > len(bin_chunk):
            report.fail(f"bufferView[{index}] bounds", f"ends at {end}, BIN is {len(bin_chunk)}")
            failures += 1
    if views and not failures:
        report.ok("bufferViews within BIN", f"{len(views)} view(s)")
    return views


def _check_accessors(gltf: dict[str, Any], views: list[dict[str, Any]], report: Report) -> list[dict[str, Any]]:
    accessors = gltf.get("accessors", [])
    failures = 0
    for index, accessor in enumerate(accessors):
        view_index = accessor.get("bufferView")
        if view_index is None:
            continue
        if view_index >= len(views):
            report.fail(f"accessor[{index}].bufferView", f"index {view_index} out of range")
            failures += 1
            continue
        component = COMPONENT_SIZE.get(accessor["componentType"])
        components = TYPE_COMPONENTS.get(accessor["type"])
        if component is None or components is None:
            report.fail(
                f"accessor[{index}] type",
                f"componentType={accessor['componentType']} type={accessor['type']}",
            )
            failures += 1
            continue
        stride = views[view_index].get("byteStride") or component * components
        needed = accessor.get("byteOffset", 0) + stride * (accessor["count"] - 1) + component * components
        if needed > views[view_index]["byteLength"]:
            report.fail(
                f"accessor[{index}] fits its bufferView",
                f"needs {needed} bytes, view has {views[view_index]['byteLength']}",
            )
            failures += 1
    if accessors and not failures:
        report.ok("accessors fit their bufferViews", f"{len(accessors)} accessor(s)")
    return accessors


def _check_meshes(
    gltf: dict[str, Any],
    accessors: list[dict[str, Any]],
    report: Report,
) -> None:
    meshes = gltf.get("meshes", [])
    materials = gltf.get("materials", [])
    triangles = 0
    failures = 0
    for mesh_index, mesh in enumerate(meshes):
        for prim_index, primitive in enumerate(mesh.get("primitives", [])):
            label = f"mesh[{mesh_index}].primitive[{prim_index}]"
            attributes = primitive.get("attributes", {})
            if "POSITION" not in attributes:
                report.fail(label, "no POSITION attribute")
                failures += 1
            references = list(attributes.items())
            if "indices" in primitive:
                references.append(("indices", primitive["indices"]))
            for name, accessor_index in references:
                if accessor_index >= len(accessors):
                    report.fail(f"{label}.{name}", f"accessor {accessor_index} out of range")
                    failures += 1
            if "indices" in primitive and primitive["indices"] < len(accessors):
                count = accessors[primitive["indices"]]["count"]
                if count % 3 != 0:
                    report.fail(f"{label} index count", f"{count} is not divisible by 3")
                    failures += 1
                else:
                    triangles += count // 3
            material_index = primitive.get("material")
            if material_index is not None and material_index >= len(materials) and materials:
                report.fail(f"{label}.material", f"index {material_index} out of range")
                failures += 1
    if meshes and not failures:
        report.ok("mesh primitives reference valid data", f"{len(meshes)} mesh(es), {triangles} triangle(s)")


def _check_images(
    gltf: dict[str, Any],
    views: list[dict[str, Any]],
    bin_chunk: bytes,
    report: Report,
) -> list[dict[str, Any]]:
    images = gltf.get("images", [])
    details: list[dict[str, Any]] = []
    failures = 0
    for index, image in enumerate(images):
        if "uri" in image:
            report.fail(f"image[{index}] is embedded", f"external uri {image['uri'][:48]}")
            failures += 1
            continue
        view_index = image.get("bufferView")
        if view_index is None or view_index >= len(views):
            report.fail(f"image[{index}].bufferView", str(view_index))
            failures += 1
            continue
        view = views[view_index]
        start = view.get("byteOffset", 0)
        payload = bin_chunk[start : start + view["byteLength"]]
        ihdr = read_png_ihdr(payload)
        details.append(
            {
                "index": index,
                "mimeType": image.get("mimeType"),
                "bytes": len(payload),
                "png": ihdr,
                "distinctByteValues": len(set(payload)),
                "sha256": sha256(payload).hexdigest()[:16],
            }
        )
        if image.get("mimeType") != "image/png":
            report.fail(f"image[{index}].mimeType", str(image.get("mimeType")))
            failures += 1
        if ihdr is None:
            report.fail(f"image[{index}] is a valid PNG", f"{len(payload)} bytes could not be decoded")
            failures += 1
        elif ihdr["width"] <= 1 and ihdr["height"] <= 1:
            # Guards against a test stub's 1x1 PNG being accepted as a texture.
            report.fail(
                f"image[{index}] is a real texture",
                f"{ihdr['width']}x{ihdr['height']} is a placeholder, not a bitmap",
            )
            failures += 1
    if images and not failures:
        report.ok("images are embedded PNGs", f"{len(images)} image(s)")
    return details


def _check_textures(
    gltf: dict[str, Any],
    image_count: int,
    report: Report,
) -> None:
    textures = gltf.get("textures", [])
    failures = 0
    for index, texture in enumerate(textures):
        if texture.get("source", 0) >= image_count:
            report.fail(f"texture[{index}].source", f"image {texture.get('source')} out of range")
            failures += 1
    if textures and not failures:
        report.ok("textures reference images", f"{len(textures)} texture(s)")


def _check_materials(
    gltf: dict[str, Any],
    texture_count: int,
    report: Report,
) -> list[dict[str, Any]]:
    materials = gltf.get("materials", [])
    details: list[dict[str, Any]] = []
    has_base_colour = has_normal = has_blend = False

    for index, material in enumerate(materials):
        pbr = material.get("pbrMetallicRoughness", {})
        base = pbr.get("baseColorTexture")
        normal = material.get("normalTexture")
        details.append(
            {
                "index": index,
                "name": material.get("name"),
                "baseColorTexture": None if base is None else base.get("index"),
                "normalTexture": None if normal is None else normal.get("index"),
                "metallicFactor": pbr.get("metallicFactor"),
                "roughnessFactor": pbr.get("roughnessFactor"),
                "alphaMode": material.get("alphaMode", "OPAQUE"),
            }
        )
        for label, reference in (("baseColorTexture", base), ("normalTexture", normal)):
            if reference is None:
                continue
            texture_index = reference.get("index")
            if texture_index is None or texture_index >= texture_count:
                report.fail(f"material[{index}].{label}", f"texture {texture_index} out of range")
        if base is not None:
            has_base_colour = True
        if normal is not None:
            has_normal = True
        if material.get("alphaMode") == "BLEND":
            has_blend = True

    if materials:
        if has_base_colour:
            report.ok("baseColorTexture is wired", "a material points at a base colour texture")
        else:
            report.fail("baseColorTexture is wired", "no material references a base colour texture")
        if has_normal:
            report.ok("normalTexture is wired", "a material points at a normal map")
        else:
            report.fail("normalTexture is wired", "no material references a normal map")
        if has_blend:
            report.ok("alphaMode BLEND", "a transparent material is exported as BLEND")
        else:
            report.fail("alphaMode BLEND", "no material uses BLEND")
    return details


def validate_glb(path: str | Path) -> dict[str, Any]:
    """Validate one .glb file and return a JSON-serialisable report."""
    path = str(path)
    report = Report(path)
    raw = Path(path).read_bytes()

    report_data: dict[str, Any] = {}
    json_chunk, bin_chunk = _check_header(raw, report)
    if json_chunk is None:
        report_data.update(report.as_dict())
        report_data.update({"bytes": len(raw), "sha256": sha256(raw).hexdigest()})
        return report_data
    # A missing BIN chunk is already reported; keep going so the JSON is still
    # inspected instead of the whole report collapsing to one error.
    bin_chunk = bin_chunk or b""

    try:
        gltf = json.loads(json_chunk.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        report.fail("JSON chunk parses", str(exc))
        report_data.update(report.as_dict())
        return report_data
    report.ok("JSON chunk parses", f"{len(gltf)} top-level key(s)")

    version = gltf.get("asset", {}).get("version")
    if version != "2.0":
        report.fail("asset.version", str(version))
    else:
        report.ok("asset.version", "2.0")

    _check_buffer(gltf, bin_chunk, report)
    views = _check_buffer_views(gltf, bin_chunk, report)
    accessors = _check_accessors(gltf, views, report)
    _check_meshes(gltf, accessors, report)
    image_details = _check_images(gltf, views, bin_chunk, report)
    textures = gltf.get("textures", [])
    _check_textures(gltf, len(image_details), report)
    material_details = _check_materials(gltf, len(textures), report)

    report_data.update(report.as_dict())
    report_data.update(
        {
            "bytes": len(raw),
            "sha256": sha256(raw).hexdigest(),
            "counts": {
                "nodes": len(gltf.get("nodes", [])),
                "meshes": len(gltf.get("meshes", [])),
                "materials": len(gltf.get("materials", [])),
                "textures": len(textures),
                "images": len(gltf.get("images", [])),
                "bufferViews": len(views),
                "accessors": len(accessors),
            },
            "imageDetails": image_details,
            "materialDetails": material_details,
        }
    )
    return report_data


def main(argv: list[str] | None = None) -> int:
    paths = (argv if argv is not None else sys.argv[1:])
    if not paths:
        sys.stderr.write("usage: glb_validate.py FILE.glb [FILE.glb ...]\n")
        return 2

    reports = {path: validate_glb(path) for path in paths}
    print(json.dumps(reports, indent=2))
    return 0 if all(report["verdict"] == "PASS" for report in reports.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
