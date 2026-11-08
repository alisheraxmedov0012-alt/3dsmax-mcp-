"""Build the buyer-facing Blender/FBX/OBJ package from the delivered GLB.

Run with:

    blender --background --factory-startup --python tools/product/blender-export.py -- \
        product-output/premium-office-desk.glb product-output

The GLB is the single source of truth. Nothing is re-generated, decimated or
joined. Images are named after their material family and role before export so
the FBX embeds readable texture names and the OBJ MTL can point at the
already-extracted 2K PNGs.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys

import bpy
import numpy as np
from mathutils import Vector

MARKER = "EXPORT_JSON:"

# Materials sharing a texture family. The first name is the canonical family
# label used for the exported texture files.
FAMILIES = {
    "Desk_Tabletop_Oak": "Desk_Tabletop_Oak",
    "Desk_Drawer_Oak": "Desk_Tabletop_Oak",
    "Desk_Structure_Steel": "Desk_Structure_Steel",
    "Desk_Hardware_Steel": "Desk_Structure_Steel",
}

CANONICAL_ORDER = [
    "Desk_Tabletop_Oak",
    "Desk_Drawer_Oak",
    "Desk_Structure_Steel",
    "Desk_Hardware_Steel",
]


def sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def scene_bbox(meshes: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    lower = Vector((float("inf"),) * 3)
    upper = Vector((float("-inf"),) * 3)
    for obj in meshes:
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            lower = Vector((min(lower[i], world[i]) for i in range(3)))
            upper = Vector((max(upper[i], world[i]) for i in range(3)))
    return lower, upper


def role_images(material: bpy.types.Material) -> dict[str, bpy.types.Image | None]:
    result: dict[str, bpy.types.Image | None] = {
        "base": None,
        "normal": None,
        "orm": None,
    }
    if material.node_tree is None:
        return result
    tree = material.node_tree
    bsdf = next((node for node in tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        return result

    def image_into(socket: str) -> bpy.types.Image | None:
        for link in tree.links:
            if link.to_node == bsdf and link.to_socket.name == socket:
                node = link.from_node
                if node.type == "TEX_IMAGE":
                    return node.image
                for inner in tree.links:
                    if inner.to_node == node and inner.from_node.type == "TEX_IMAGE":
                        return inner.from_node.image
        return None

    result["base"] = image_into("Base Color")
    result["normal"] = image_into("Normal")
    for link in tree.links:
        if (
            link.to_node == bsdf
            and link.to_socket.name in ("Metallic", "Roughness")
            and link.from_node.type == "SEPARATE_COLOR"
        ):
            for inner in tree.links:
                if inner.to_node == link.from_node and inner.from_node.type == "TEX_IMAGE":
                    result["orm"] = inner.from_node.image
    return result


def assign_image_paths(texture_dir: str, scratch_dir: str) -> dict[str, str]:
    assigned: dict[str, str] = {}
    images = {material.name: material for material in bpy.data.materials}
    for name in CANONICAL_ORDER:
        material = images.get(name)
        if material is None:
            continue
        family = FAMILIES[name]
        roles = role_images(material)
        for role, image in roles.items():
            if image is None:
                continue
            if role == "base":
                target = os.path.join(texture_dir, f"{family}_BaseColor.png")
            elif role == "normal":
                target = os.path.join(texture_dir, f"{family}_Normal_OpenGL.png")
            else:
                target = os.path.join(scratch_dir, f"{family}_ORM.png")
                os.makedirs(scratch_dir, exist_ok=True)
                image.filepath_raw = target
                image.file_format = "PNG"
                image.save()
            image.name = os.path.splitext(os.path.basename(target))[0]
            image.filepath_raw = target
            image.file_format = "PNG"
            assigned[image.name] = target
    return assigned


def orm_means(image: bpy.types.Image) -> tuple[float, float]:
    values = np.empty(len(image.pixels), dtype=np.float32)
    image.pixels.foreach_get(values)
    pixels = values.reshape(-1, 4)
    return float(pixels[:, 1].mean()), float(pixels[:, 2].mean())


def patch_mtl(mtl_path: str, means: dict[str, tuple[float, float]]) -> None:
    """Rewrite Blender's MTL with portable relative paths and PBR values.

    Blender resolves the packed image paths relative to the .blend, not the OBJ,
    and its OBJ writer does not understand the Separate Color -> Metallic /
    Roughness graph. This pass keeps the material blocks but writes the 2K
    textures we already extracted and the measured Pr/Pm values.
    """
    with open(mtl_path, encoding="utf-8") as handle:
        lines = handle.readlines()

    blocks: list[list[str]] = []
    current: list[str] | None = None
    bump: dict[str, str] = {}
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("newmtl "):
            current = [line]
            blocks.append(current)
            bump[stripped.split(None, 1)[1]] = "1.0"
            continue
        if current is None:
            continue
        if stripped.startswith("map_Bump"):
            parts = stripped.split()
            if "-bm" in parts:
                bump[blocks[-1][0].strip().split(None, 1)[1]] = parts[parts.index("-bm") + 1]
            continue
        if stripped.startswith(("Kd ", "Pr ", "Pm ", "map_Kd", "map_Pr", "map_Pm")):
            continue
        current.append(line)

    for block in blocks:
        name = block[0].strip().split(None, 1)[1]
        family = FAMILIES.get(name, name)
        roughness, metalness = means.get(family, (0.5, 0.0))
        block.append("Kd 1.000000 1.000000 1.000000\n")
        block.append(f"Pr {roughness:.6f}\n")
        block.append(f"Pm {metalness:.6f}\n")
        block.append(f"map_Kd textures/{family}_BaseColor.png\n")
        block.append(f"map_Bump -bm {bump.get(name, '1.0')} textures/{family}_Normal_OpenGL.png\n")
        block.append(f"map_Pr textures/{family}_Roughness.png\n")
        block.append(f"map_Pm textures/{family}_Metalness.png\n")

    with open(mtl_path, "w", encoding="utf-8") as handle:
        handle.writelines([line for block in blocks for line in block])


def clean_collection(target_name: str) -> bpy.types.Collection:
    scene = bpy.context.scene
    target = bpy.data.collections.get(target_name)
    if target is None:
        target = bpy.data.collections.new(target_name)
        scene.collection.children.link(target)
    for collection in list(bpy.data.collections):
        if collection == target:
            continue
        for obj in list(collection.objects):
            target.objects.link(obj)
            collection.objects.unlink(obj)
        bpy.data.collections.remove(collection)
    return target


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(argv) != 2:
        raise SystemExit("usage: blender-export.py -- <input.glb> <output-dir>")
    glb_path, out_dir = (os.path.abspath(value) for value in argv)
    texture_dir = os.path.join(out_dir, "textures")
    scratch_dir = os.path.join(out_dir, ".blender-orm")
    blend_path = os.path.join(out_dir, "premium-office-desk.blend")
    fbx_path = os.path.join(out_dir, "premium-office-desk.fbx")
    obj_path = os.path.join(out_dir, "premium-office-desk.obj")

    for path in (glb_path, texture_dir):
        if not os.path.exists(path):
            raise SystemExit(f"missing required path: {path}")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = "Premium Office Desk"
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "CENTIMETERS"

    target = bpy.data.collections.new("Premium Office Desk")
    scene.collection.children.link(target)
    layer = bpy.context.view_layer.layer_collection.children[target.name]
    bpy.context.view_layer.active_layer_collection = layer

    bpy.ops.import_scene.gltf(filepath=glb_path)

    for obj in list(bpy.context.scene.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)

    clean_collection("Premium Office Desk")

    assigned = assign_image_paths(texture_dir, scratch_dir)
    bpy.ops.file.pack_all()

    meshes = [obj for obj in scene.objects if obj.type == "MESH"]
    materials = sorted({slot.material.name for obj in meshes for slot in obj.material_slots if slot.material})
    images = [
        image
        for image in bpy.data.images
        if image.users > 0 and image.name != "Render Result" and image.size[0] > 0
    ]
    lower, upper = scene_bbox(meshes)
    size = upper - lower
    triangles = sum(len(poly.vertices) - 2 for obj in meshes for poly in obj.data.polygons)
    zero_area = sum(
        1 for obj in meshes for poly in obj.data.polygons if poly.area <= 1e-12
    )
    uv_layers = sum(len(obj.data.uv_layers) for obj in meshes)
    packed = all(image.packed_file is not None for image in images)

    assert len(meshes) == 24, f"meshes: {len(meshes)}"
    assert triangles == 4696, f"triangles: {triangles}"
    assert len(materials) == 4, f"materials: {materials}"
    assert len(images) == 6, f"images: {len(images)}"
    assert packed, "not every image is packed"
    assert zero_area == 0, f"zero-area polygons: {zero_area}"
    assert abs(size.x - 1.6) < 1e-4 and abs(size.y - 0.8) < 1e-4 and abs(size.z - 0.75) < 1e-4

    bpy.ops.wm.save_as_mainfile(filepath=blend_path, compress=True)
    backup = blend_path + "1"
    if os.path.exists(backup):
        os.remove(backup)

    means = {
        family: orm_means(bpy.data.images[f"{family}_ORM"])
        for family in ("Desk_Tabletop_Oak", "Desk_Structure_Steel")
        if bpy.data.images.get(f"{family}_ORM") is not None
    }
    # FBX converts the Principled graph to Phong-era material channels. The maps
    # drive the .blend; for the FBX copy, give the constant channels the measured
    # family values so a DCC that cannot read the ORM chain at least gets the
    # right base colour multiplier, metallic level and roughness level.
    for name in CANONICAL_ORDER:
        material = bpy.data.materials.get(name)
        if material is None or material.node_tree is None:
            continue
        bsdf = next(
            (node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"),
            None,
        )
        if bsdf is None:
            continue
        roughness, metalness = means.get(FAMILIES[name], (0.5, 0.0))
        bsdf.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
        bsdf.inputs["Metallic"].default_value = metalness
        bsdf.inputs["Roughness"].default_value = roughness

    bpy.ops.export_scene.fbx(
        filepath=fbx_path,
        object_types={"MESH"},
        use_selection=False,
        apply_unit_scale=True,
        apply_scale_options="FBX_SCALE_NONE",
        global_scale=100.0,
        axis_forward="-Z",
        axis_up="Y",
        use_mesh_modifiers=False,
        use_triangles=True,
        mesh_smooth_type="FACE",
        embed_textures=True,
        path_mode="COPY",
        add_leaf_bones=False,
        bake_anim=False,
    )

    bpy.ops.wm.obj_export(
        filepath=obj_path,
        export_selected_objects=False,
        apply_modifiers=False,
        export_uv=True,
        export_normals=True,
        export_materials=True,
        export_pbr_extensions=True,
        export_triangulated_mesh=False,
        path_mode="RELATIVE",
        global_scale=1000.0,
        forward_axis="NEGATIVE_Z",
        up_axis="Y",
    )

    mtl_path = os.path.splitext(obj_path)[0] + ".mtl"
    patch_mtl(mtl_path, means)
    shutil.rmtree(scratch_dir, ignore_errors=True)

    result = {
        "blender": bpy.app.version_string,
        "meshes": len(meshes),
        "objects": len(scene.objects),
        "triangles": triangles,
        "vertices": sum(len(obj.data.vertices) for obj in meshes),
        "zeroAreaPolygons": zero_area,
        "uvLayers": uv_layers,
        "materials": materials,
        "images": [
            {"name": image.name, "width": image.size[0], "height": image.size[1]}
            for image in images
        ],
        "packed": packed,
        "collection": [collection.name for collection in bpy.data.collections],
        "unit": {
            "system": scene.unit_settings.system,
            "scaleLength": scene.unit_settings.scale_length,
            "lengthUnit": scene.unit_settings.length_unit,
        },
        "bboxM": [size.x, size.y, size.z],
        "textureFiles": assigned,
        "files": {
            "blend": {"path": blend_path, "bytes": os.path.getsize(blend_path), "sha256": sha256(blend_path)},
            "fbx": {"path": fbx_path, "bytes": os.path.getsize(fbx_path), "sha256": sha256(fbx_path)},
            "obj": {"path": obj_path, "bytes": os.path.getsize(obj_path), "sha256": sha256(obj_path)},
            "mtl": {
                "path": os.path.splitext(obj_path)[0] + ".mtl",
                "bytes": os.path.getsize(os.path.splitext(obj_path)[0] + ".mtl"),
                "sha256": sha256(os.path.splitext(obj_path)[0] + ".mtl"),
            },
        },
    }
    print(MARKER + json.dumps(result, ensure_ascii=False, sort_keys=True))


main()
