"""Re-import the delivered formats into Blender and report parity.

    blender --background --factory-startup --python tools/product/blender-parity.py -- \
        product-output/premium-office-desk.blend \
        product-output/premium-office-desk.glb \
        product-output/premium-office-desk.fbx \
        product-output/premium-office-desk.obj

The FBX is authored in centimetres and the OBJ in millimetres. They are imported
with the matching normalisation (0.01 and 0.001) so the reported bounding boxes
are comparable in centimetres.
"""

from __future__ import annotations

import json
import sys

import bpy
from mathutils import Vector

MARKER = "PARITY_JSON:"


def reset() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def bbox(meshes: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    lower = Vector((float("inf"),) * 3)
    upper = Vector((float("-inf"),) * 3)
    for obj in meshes:
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            lower = Vector((min(lower[i], world[i]) for i in range(3)))
            upper = Vector((max(upper[i], world[i]) for i in range(3)))
    return lower, upper


def map_roles(material: bpy.types.Material) -> list[str]:
    if material.node_tree is None:
        return []
    roles: set[str] = set()
    images = {node.image.name for node in material.node_tree.nodes if node.type == "TEX_IMAGE" and node.image}
    for node in material.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            for socket in ("Base Color", "Normal", "Metallic", "Roughness"):
                if any(link.to_node == node and link.to_socket.name == socket for link in material.node_tree.links):
                    roles.add(socket)
    if images:
        roles.add("Images:" + ",".join(sorted(images)))
    return sorted(roles)


def inspect(label: str, import_scale: float, declared_unit: str) -> dict:
    scene = bpy.context.scene
    meshes = [obj for obj in scene.objects if obj.type == "MESH"]
    lower, upper = bbox(meshes)
    size = upper - lower
    images = [
        image
        for image in bpy.data.images
        if image.users > 0 and image.name != "Render Result" and image.size[0] > 0
    ]
    materials = sorted({slot.material.name for obj in meshes for slot in obj.material_slots if slot.material})
    return {
        "label": label,
        "importScale": import_scale,
        "declaredUnit": declared_unit,
        "unit": {
            "system": scene.unit_settings.system,
            "scaleLength": scene.unit_settings.scale_length,
            "lengthUnit": scene.unit_settings.length_unit,
        },
        "meshes": len(meshes),
        "objects": len(scene.objects),
        "cameras": sum(1 for obj in scene.objects if obj.type == "CAMERA"),
        "lights": sum(1 for obj in scene.objects if obj.type == "LIGHT"),
        "triangles": sum(len(poly.vertices) - 2 for obj in meshes for poly in obj.data.polygons),
        "vertices": sum(len(obj.data.vertices) for obj in meshes),
        "uvLayers": sum(len(obj.data.uv_layers) for obj in meshes),
        "meshesWithoutUv": [obj.name for obj in meshes if len(obj.data.uv_layers) == 0],
        "zeroAreaPolygons": sum(1 for obj in meshes for poly in obj.data.polygons if poly.area <= 1e-12),
        "bboxUnits": [round(size[i], 6) for i in range(3)],
        "bboxCm": [round(size[i] * 100.0, 4) for i in range(3)],
        "materials": materials,
        "materialMaps": {name: map_roles(bpy.data.materials[name]) for name in materials},
        "images": [
            {
                "name": image.name,
                "width": int(image.size[0]),
                "height": int(image.size[1]),
                "packed": image.packed_file is not None,
            }
            for image in images
        ],
        "collections": [collection.name for collection in bpy.data.collections],
    }


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(argv) != 4:
        raise SystemExit("usage: blender-parity.py -- <blend> <glb> <fbx> <obj>")
    blend_path, glb_path, fbx_path, obj_path = argv
    results: list[dict] = []

    bpy.ops.wm.open_mainfile(filepath=blend_path)
    results.append(inspect("blend", 1.0, "meter"))

    reset()
    bpy.ops.import_scene.gltf(filepath=glb_path)
    results.append(inspect("glb", 1.0, "meter"))

    reset()
    bpy.ops.import_scene.fbx(filepath=fbx_path, global_scale=0.01)
    results.append(inspect("fbx", 0.01, "centimeter"))

    reset()
    bpy.ops.wm.obj_import(
        filepath=obj_path,
        global_scale=0.001,
        forward_axis="NEGATIVE_Z",
        up_axis="Y",
    )
    results.append(inspect("obj", 0.001, "millimeter"))

    print(MARKER + json.dumps(results, ensure_ascii=False, sort_keys=True))


main()
