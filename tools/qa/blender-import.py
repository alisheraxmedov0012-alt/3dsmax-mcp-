"""Headless Blender import inspection for the local quality harness.

Run with:

    blender --background --factory-startup --python tools/qa/blender-import.py -- model.glb

The script prints exactly one line prefixed with QA_BLENDER_JSON: so the Node
harness can extract machine-readable data from Blender's own log output.
"""

from __future__ import annotations

import json
import math
import sys

import bpy
from mathutils import Vector

MARKER = "QA_BLENDER_JSON:"


def emit(result: dict) -> None:
    print(MARKER + json.dumps(result, ensure_ascii=False, sort_keys=True))


def inspect(path: str) -> dict:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    import_result = bpy.ops.import_scene.gltf(filepath=path)
    if "FINISHED" not in import_result:
        raise RuntimeError(f"glTF import returned {import_result!r}")

    objects = list(bpy.context.scene.objects)
    meshes = [obj for obj in objects if obj.type == "MESH"]

    vertices = sum(len(obj.data.vertices) for obj in meshes)
    polygons = sum(len(obj.data.polygons) for obj in meshes)
    triangles = sum(
        max(1, len(polygon.vertices) - 2)
        for obj in meshes
        for polygon in obj.data.polygons
    )
    zero_area = sum(
        1
        for obj in meshes
        for polygon in obj.data.polygons
        if polygon.area <= 1e-12
    )

    material_names = sorted(
        {
            slot.material.name
            for obj in meshes
            for slot in obj.material_slots
            if slot.material is not None
        }
    )
    images = sorted(
        {
            (image.name, int(image.size[0]), int(image.size[1]))
            for image in bpy.data.images
            if image.users > 0 and image.name != "Render Result" and image.size[0] > 0
        }
    )

    uv_layers = sum(len(obj.data.uv_layers) for obj in meshes)
    meshes_without_uv = [obj.name for obj in meshes if len(obj.data.uv_layers) == 0]
    missing_normals = [
        obj.name
        for obj in meshes
        if obj.data.attributes.get("normal") is None and not obj.data.has_custom_normals
    ]

    bbox_min = Vector((math.inf, math.inf, math.inf))
    bbox_max = Vector((-math.inf, -math.inf, -math.inf))
    for obj in meshes:
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            bbox_min = Vector((min(bbox_min[index], world[index]) for index in range(3)))
            bbox_max = Vector((max(bbox_max[index], world[index]) for index in range(3)))
    has_bbox = bool(meshes)
    bbox_m = (
        [round(bbox_max[index] - bbox_min[index], 4) for index in range(3)]
        if has_bbox
        else None
    )

    return {
        "ok": True,
        "blenderVersion": bpy.app.version_string,
        "importResult": str(import_result),
        "objects": len(objects),
        "meshes": len(meshes),
        "vertices": vertices,
        "polygons": polygons,
        "triangles": triangles,
        "materials": len(material_names),
        "materialNames": material_names,
        "images": len(images),
        "imageInfo": [
            {"name": name, "width": width, "height": height}
            for name, width, height in images
        ],
        "uvLayers": uv_layers,
        "meshesWithoutUv": meshes_without_uv,
        "missingNormals": missing_normals,
        "zeroAreaPolygons": zero_area,
        "bboxM": bbox_m,
        "bboxMin": [round(value, 4) for value in bbox_min] if has_bbox else None,
        "bboxMax": [round(value, 4) for value in bbox_max] if has_bbox else None,
        "objectNamesSample": [obj.name for obj in objects[:10]],
    }


def main() -> int:
    try:
        separator = sys.argv.index("--")
        path = sys.argv[separator + 1]
    except (ValueError, IndexError):
        emit({"ok": False, "error": "Usage: blender-import.py -- model.glb"})
        return 1

    try:
        result = inspect(path)
    except Exception as exc:  # Blender surfaces import failures as exceptions.
        result = {
            "ok": False,
            "blenderVersion": bpy.app.version_string,
            "error": f"{type(exc).__name__}: {exc}",
        }

    emit(result)
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
