"""Phase 9A.2.8 — independent Blender parity and visual QA.

Run with:

    blender --background --factory-startup --python tools/qa/interior-blender.py -- \
        --glb fixture.glb --fixture fixture.json --out report.json \
        --render-dir qa-output/interior-parity/renders/room-only

The script imports the GLB into an empty scene, measures geometry, materials,
UV and transforms, performs wall-only ray casts through the door/window
openings, optionally renders QA views, and prints one QA_INTERIOR_JSON line.
"""

from __future__ import annotations

import json
import math
import os
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

MARKER = "QA_INTERIOR_JSON:"


def parse_args() -> dict:
    try:
        separator = sys.argv.index("--")
        argv = sys.argv[separator + 1 :]
    except ValueError:
        argv = []
    args: dict[str, str] = {}
    index = 0
    while index < len(argv):
        key = argv[index]
        if key.startswith("--") and index + 1 < len(argv):
            args[key[2:]] = argv[index + 1]
            index += 2
        else:
            index += 1
    return args


def world_triangles(mesh_obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = mesh_obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    matrix = evaluated.matrix_world
    normal_matrix = matrix.to_3x3().inverted().transposed()
    coordinates = [matrix @ vertex.co for vertex in mesh.vertices]
    uv_layer = mesh.uv_layers.active
    triangles = []
    for polygon in mesh.polygons:
        loops = list(polygon.loop_indices)
        world_normal = (normal_matrix @ polygon.normal).normalized()
        for offset in range(1, len(loops) - 1):
            triangle = [loops[0], loops[offset], loops[offset + 1]]
            coords = [coordinates[mesh.loops[loop].vertex_index] for loop in triangle]
            uvs = (
                [tuple(uv_layer.data[loop].uv) for loop in triangle]
                if uv_layer is not None
                else None
            )
            triangles.append((coords, uvs, world_normal))
    evaluated.to_mesh_clear()
    return triangles


def triangle_area(a, b, c) -> float:
    return (b - a).cross(c - a).length / 2.0


def uv_area(uvs) -> float:
    (u0, v0), (u1, v1), (u2, v2) = uvs
    return ((u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)) / 2.0


def inspect_uv(mesh_obj) -> dict:
    mesh = mesh_obj.data
    uv_layer = mesh.uv_layers.active
    if uv_layer is None:
        return {
            "hasUv": False,
            "nonFinite": 0,
            "mirroredTriangles": 0,
            "uvTriangles": 0,
            "derivedTileCm": None,
        }
    non_finite = 0
    for item in uv_layer.data:
        u, v = item.uv
        if not math.isfinite(u) or not math.isfinite(v):
            non_finite += 1

    triangles = world_triangles(mesh_obj)
    mirrored = 0
    uv_triangles = 0
    area_3d = 0.0
    area_uv = 0.0
    for coords, uvs, world_normal in triangles:
        if uvs is None:
            continue
        uv_triangles += 1
        signed_uv = uv_area(uvs)
        # Blender's glTF importer flips the V axis (glTF top-left, Blender
        # bottom-left), so a correctly mapped glTF triangle has the opposite
        # UV sign to its 3D winding. A triangle is mirrored only when the two
        # agree, not when they differ.
        geometric = (coords[1] - coords[0]).cross(coords[2] - coords[0])
        geometry_sign = 1 if geometric.dot(world_normal) > 0 else -1
        uv_sign = 1 if signed_uv > 0 else (-1 if signed_uv < 0 else 0)
        if uv_sign != 0 and uv_sign == geometry_sign:
            mirrored += 1
        area_uv += abs(signed_uv)
        area_3d += triangle_area(*coords)

    # GLB world units are metres; one UV unit maps to tileCm centimetres.
    derived_tile_cm = None
    if area_uv > 1e-12 and area_3d > 1e-12:
        derived_tile_cm = math.sqrt((area_3d * 10000.0) / area_uv)

    return {
        "hasUv": True,
        "nonFinite": non_finite,
        "mirroredTriangles": mirrored,
        "uvTriangles": uv_triangles,
        "derivedTileCm": round(derived_tile_cm, 3) if derived_tile_cm else None,
    }


def inspect_materials() -> list[dict]:
    materials = []
    for material in bpy.data.materials:
        if material.users == 0:
            continue
        base_color = None
        metallic = None
        roughness = None
        alpha = None
        image_nodes = 0
        missing_images = 0
        if material.use_nodes and material.node_tree is not None:
            for node in material.node_tree.nodes:
                if node.type == "BSDF_PRINCIPLED":
                    base_color = [round(value, 4) for value in node.inputs["Base Color"].default_value]
                    metallic = round(node.inputs["Metallic"].default_value, 4)
                    roughness = round(node.inputs["Roughness"].default_value, 4)
                    alpha = round(node.inputs["Alpha"].default_value, 4)
                if node.type == "TEX_IMAGE":
                    image_nodes += 1
                    if node.image is None:
                        missing_images += 1
        materials.append(
            {
                "name": material.name,
                "baseColor": base_color,
                "metallic": metallic,
                "roughness": roughness,
                "alpha": alpha,
                "blendMethod": getattr(material, "surface_render_method", None)
                or getattr(material, "blend_method", None),
                "backfaceCulling": getattr(material, "use_backface_culling", None),
                "imageNodes": image_nodes,
                "missingImages": missing_images,
            }
        )
    return materials


def inspect_images() -> list[dict]:
    images = []
    for image in bpy.data.images:
        if image.users == 0 or image.name == "Render Result":
            continue
        images.append(
            {
                "name": image.name,
                "width": int(image.size[0]),
                "height": int(image.size[1]),
                "source": image.source,
                "filepath": image.filepath or None,
                "packed": image.packed_file is not None,
            }
        )
    return images


def mesh_metrics(meshes) -> dict:
    vertices = sum(len(obj.data.vertices) for obj in meshes)
    polygons = sum(len(obj.data.polygons) for obj in meshes)
    triangles = sum(
        max(1, len(polygon.vertices) - 2)
        for obj in meshes
        for polygon in obj.data.polygons
    )
    zero_area = sum(
        1 for obj in meshes for polygon in obj.data.polygons if polygon.area <= 1e-12
    )
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
            bbox_min = Vector((min(bbox_min[i], world[i]) for i in range(3)))
            bbox_max = Vector((max(bbox_max[i], world[i]) for i in range(3)))
    has_bbox = bool(meshes)
    return {
        "vertices": vertices,
        "polygons": polygons,
        "triangles": triangles,
        "zeroAreaPolygons": zero_area,
        "missingNormals": missing_normals,
        "bboxMinM": [round(value, 4) for value in bbox_min] if has_bbox else None,
        "bboxMaxM": [round(value, 4) for value in bbox_max] if has_bbox else None,
        "bboxM": (
            [round(bbox_max[i] - bbox_min[i], 4) for i in range(3)] if has_bbox else None
        ),
    }


def object_transforms(meshes) -> list[dict]:
    result = []
    for obj in bpy.context.scene.objects:
        if not obj.name.startswith("room:"):
            continue
        translation = obj.matrix_world.translation
        result.append(
            {
                "name": obj.name,
                # Convert Blender (x, y, z) back to scene/glTF (x, z, -y) cm.
                "translationCm": [
                    round(translation.x * 100.0, 3),
                    round(translation.z * 100.0, 3),
                    round(-translation.y * 100.0, 3),
                ],
            }
        )
    return result


def ray_check(meshes, ray: dict) -> dict:
    origin_cm = ray["originCm"]
    direction_cm = ray["directionCm"]
    # Fixture coordinates are scene/glTF space. Blender's importer maps
    # (x, y, z)gltf to (x, -z, y)blender, so convert before casting.
    origin = Vector(
        (origin_cm[0] / 100.0, -origin_cm[2] / 100.0, origin_cm[1] / 100.0)
    )
    direction = Vector(
        (direction_cm[0], -direction_cm[2], direction_cm[1])
    ).normalized()
    fragments = ray.get("objectNameIncludes", [])
    targets = [obj for obj in meshes if any(fragment in obj.name for fragment in fragments)]
    if not targets:
        return {
            "id": ray["id"],
            "status": "FAIL",
            "detail": f"no objects match {fragments}",
        }

    depsgraph = bpy.context.evaluated_depsgraph_get()
    hits = []
    for obj in targets:
        inverse = obj.matrix_world.inverted()
        origin_local = inverse @ origin
        direction_local = (inverse.to_3x3() @ direction).normalized()
        bvh = BVHTree.FromObject(obj, depsgraph)
        location, _normal, index, _distance = bvh.ray_cast(origin_local, direction_local)
        if location is not None:
            world_location = obj.matrix_world @ location
            hits.append(
                {
                    "object": obj.name,
                    "face": index,
                    "distanceCm": round((world_location - origin).length * 100.0, 3),
                }
            )

    blocked = bool(hits)
    expected = ray["expect"] == "block"
    return {
        "id": ray["id"],
        "status": "PASS" if blocked == expected else "FAIL",
        "expect": ray["expect"],
        "blocked": blocked,
        "hits": hits,
        "description": ray["description"],
    }


def object_aabb(obj):
    box = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return {
        "min": Vector((min(point[i] for point in box) for i in range(3))),
        "max": Vector((max(point[i] for point in box) for i in range(3))),
    }


def aabb_overlap_volume(first, second) -> float:
    size = [
        max(0.0, min(first["max"][i], second["max"][i]) - max(first["min"][i], second["min"][i]))
        for i in range(3)
    ]
    return size[0] * size[1] * size[2]


def aabb_gap(first, second) -> float:
    separation = [
        max(0.0, first["min"][i] - second["max"][i], second["min"][i] - first["max"][i])
        for i in range(3)
    ]
    return math.sqrt(sum(value * value for value in separation))


def trim_topology_checks(meshes) -> list[dict]:
    checks = []
    for trim_label, name_fragment in (
        ("baseboard", "room-baseboard"),
        ("crown-molding", "room-crown-molding"),
    ):
        by_side = {"north": [], "east": [], "south": [], "west": []}
        for obj in meshes:
            if name_fragment not in obj.name:
                continue
            for side in by_side:
                if f"-{side}-" in obj.name:
                    by_side[side].append(obj)
                    break
        all_parts = [obj for parts in by_side.values() for obj in parts]
        if not all_parts:
            continue

        overlap = 0.0
        for first_index, first in enumerate(all_parts):
            for second in all_parts[first_index + 1 :]:
                overlap = max(
                    overlap,
                    aabb_overlap_volume(object_aabb(first), object_aabb(second)),
                )
        checks.append(
            check(
                # 1 cm3 is numerical noise for metre-scale AABBs, not a real
                # overlap: a true corner overlap would be thickness x thickness
                # x length, orders of magnitude larger.
                overlap <= 1e-6,
                f"{trim_label} positive-volume overlap {round(overlap, 9)} m3",
            )
        )

        corners = (("north", "east"), ("east", "south"), ("south", "west"), ("west", "north"))
        largest_gap = 0.0
        for left, right in corners:
            if not by_side[left] or not by_side[right]:
                continue
            gap = min(
                aabb_gap(object_aabb(first), object_aabb(second))
                for first in by_side[left]
                for second in by_side[right]
            )
            largest_gap = max(largest_gap, gap)
        checks.append(
            check(
                largest_gap <= 0.005,
                f"{trim_label} largest corner gap {round(largest_gap * 100, 3)} cm",
            )
        )
    return checks


def check(status: bool, detail: str) -> dict:
    return {"status": "PASS" if status else "FAIL", "detail": detail}


def evaluate(fixture: dict, metrics: dict, uv_metrics: dict, transforms: list[dict], rays: list[dict]) -> list[dict]:
    expectations = fixture["expectations"]
    checks = []

    expected_bbox = expectations["bboxCm"]
    tolerance = expectations.get("bboxToleranceCm", 1)
    actual_bbox = metrics["bboxM"]
    # glTF is Y-up and Blender is Z-up: the importer maps (x, y, z)gltf to
    # (x, -z, y)blender. Convert the measured box back to scene axes.
    actual_scene = (
        [actual_bbox[0], actual_bbox[2], actual_bbox[1]] if actual_bbox else None
    )
    bbox_ok = actual_scene is not None and all(
        abs(actual_scene[index] * 100.0 - expected_bbox[index]) <= tolerance
        for index in range(3)
    )
    checks.append(
        check(
            bbox_ok,
            f"bbox cm expected {expected_bbox}, actual {None if actual_scene is None else [round(v * 100, 3) for v in actual_scene]}",
        )
    )

    checks.append(
        check(
            metrics["meshCount"] >= expectations["minMeshes"],
            f"mesh count {metrics['meshCount']} >= {expectations['minMeshes']}",
        )
    )

    baseboard = sum(1 for name in metrics["meshNames"] if "room-baseboard" in name)
    crown = sum(1 for name in metrics["meshNames"] if "room-crown-molding" in name)
    walls = sum(1 for name in metrics["meshNames"] if name.startswith("room-wall-"))
    ceilings = sum(1 for name in metrics["meshNames"] if name.startswith("room-ceiling"))
    checks.append(
        check(walls == expectations["wallParts"], f"wall parts {walls} == {expectations['wallParts']}")
    )
    checks.append(
        check(
            ceilings == expectations["ceilingParts"],
            f"ceiling parts {ceilings} == {expectations['ceilingParts']}",
        )
    )
    checks.append(
        check(
            baseboard == expectations["baseboardParts"],
            f"baseboard parts {baseboard} == {expectations['baseboardParts']}",
        )
    )
    checks.append(
        check(
            crown == expectations["crownParts"],
            f"crown parts {crown} == {expectations['crownParts']}",
        )
    )

    all_names = set(metrics["objectNames"])
    for required in expectations["requiredObjectNames"]:
        checks.append(check(required in all_names, f"required object {required}"))
    for forbidden in expectations["forbiddenObjectNames"]:
        checks.append(check(forbidden not in all_names, f"forbidden object {forbidden}"))
    for fragment in expectations["requiredNameIncludes"]:
        checks.append(
            check(
                any(fragment in name for name in metrics["meshNames"]),
                f"name fragment {fragment}",
            )
        )

    transform_map = {item["name"]: item["translationCm"] for item in transforms}
    for room_id, expected in expectations["roomTranslationsCm"].items():
        actual = transform_map.get(f"room:{room_id}")
        ok = actual is not None and all(
            abs(actual[index] - expected[index]) <= 0.5 for index in range(3)
        )
        checks.append(
            check(ok, f"room:{room_id} translation expected {expected}, actual {actual}")
        )

    checks.append(
        check(metrics["zeroAreaPolygons"] == 0, f"zero-area polygons {metrics['zeroAreaPolygons']}")
    )
    checks.append(
        check(not metrics["missingNormals"], f"missing normals {metrics['missingNormals']}")
    )
    checks.append(
        check(len(metrics["meshesWithoutUv"]) == 0, f"meshes without UV {metrics['meshesWithoutUv']}")
    )
    checks.append(
        check(uv_metrics["nonFinite"] == 0, f"non-finite UV values {uv_metrics['nonFinite']}")
    )
    checks.append(
        check(
            uv_metrics["surfaceMirrored"] == 0,
            f"mirrored room-surface triangles {uv_metrics['surfaceMirrored']}",
        )
    )

    floor_tiles = sorted(
        round(value, 1)
        for value in uv_metrics["floorTilesCm"]
        if value is not None
    )
    expected_floor_tiles = sorted(expectations.get("floorTilesCm", []))
    checks.append(
        check(
            len(floor_tiles) == len(expected_floor_tiles)
            and all(
                abs(floor_tiles[index] - expected_floor_tiles[index]) <= 2.0
                for index in range(len(floor_tiles))
            ),
            f"floor derived tiles {floor_tiles}, expected {expected_floor_tiles}",
        )
    )

    for key, expected_value in (
        ("baseboardTileCm", expectations.get("baseboardTileCm")),
        ("crownTileCm", expectations.get("crownTileCm")),
    ):
        actual = uv_metrics[key]
        ok = expected_value is None or (
            actual is not None and abs(actual - expected_value) <= 2.0
        )
        checks.append(check(ok, f"{key} {actual}, expected {expected_value}"))

    material_by_name = {item["name"]: item for item in metrics["materials"]}
    for name, expected_roughness in expectations.get("materialRoughness", {}).items():
        actual = material_by_name.get(name, {}).get("roughness")
        checks.append(
            check(
                actual is not None and abs(actual - expected_roughness) <= 0.01,
                f"{name} roughness {actual}, expected {expected_roughness}",
            )
        )
    for name, expected_metallic in expectations.get("materialMetallic", {}).items():
        actual = material_by_name.get(name, {}).get("metallic")
        checks.append(
            check(
                actual is not None and abs(actual - expected_metallic) <= 0.01,
                f"{name} metallic {actual}, expected {expected_metallic}",
            )
        )
    glass_expectation = expectations.get("glass")
    if glass_expectation:
        glass_material = material_by_name.get(glass_expectation["material"], {})
        checks.append(
            check(
                glass_material.get("alpha") is not None
                and abs(glass_material["alpha"] - glass_expectation["alpha"]) <= 0.01
                and glass_material.get("blendMethod") == "BLENDED",
                f"{glass_expectation['material']} alpha {glass_material.get('alpha')} blend {glass_material.get('blendMethod')}, expected {glass_expectation['alpha']} BLENDED",
            )
        )

    missing_images = sum(item["missingImages"] for item in metrics["materials"])
    checks.append(check(missing_images == 0, f"missing material images {missing_images}"))
    images = metrics["images"]
    valid_images = all(item["width"] > 0 and item["height"] > 0 for item in images)
    checks.append(
        check(
            len(images) >= expectations["minImages"] and valid_images,
            f"images {len(images)} >= {expectations['minImages']}, valid={valid_images}",
        )
    )

    for ray in rays:
        checks.append(
            {
                "status": ray["status"],
                "detail": f"{ray['id']}: expected {ray.get('expect')} blocked={ray.get('blocked')} hits={ray.get('hits')}",
            }
        )

    return checks


def look_at(camera, location: Vector, target: Vector) -> None:
    camera.location = location
    direction = target - location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def setup_render(render_dir: str) -> None:
    os.makedirs(render_dir, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 8
    scene.cycles.use_denoising = False
    scene.render.resolution_x = 800
    scene.render.resolution_y = 600
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("QA World") if not bpy.data.worlds else bpy.data.worlds[0]
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background is not None:
        background.inputs[0].default_value = (0.05, 0.055, 0.065, 1.0)
        background.inputs[1].default_value = 0.8

    sun_data = bpy.data.lights.new("QA Sun", type="SUN")
    sun_data.energy = 3.0
    sun = bpy.data.objects.new("QA Sun", sun_data)
    sun.rotation_euler = (math.radians(50), math.radians(8), math.radians(35))
    bpy.context.scene.collection.objects.link(sun)

    area_data = bpy.data.lights.new("QA Fill", type="AREA")
    area_data.energy = 600.0
    area_data.size = 4.0
    area = bpy.data.objects.new("QA Fill", area_data)
    area.location = (4.0, 4.5, 4.0)
    look_at(area, area.location, Vector((0.0, 1.0, 0.0)))
    bpy.context.scene.collection.objects.link(area)


def scene_to_blender(x_cm: float, y_cm: float, z_cm: float) -> Vector:
    """Scene/glTF centimetres to Blender metres."""
    return Vector((x_cm / 100.0, -z_cm / 100.0, y_cm / 100.0))


def render_views(render_dir: str, bbox_min, bbox_max, has_desk: bool, rays=None) -> list[str]:
    scene = bpy.context.scene
    camera_data = bpy.data.cameras.new("QA Camera")
    camera_data.lens = 35
    camera = bpy.data.objects.new("QA Camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    fill_data = bpy.data.lights.new("QA Camera Fill", type="POINT")
    fill_data.energy = 150.0
    fill_data.shadow_soft_size = 1.0
    fill = bpy.data.objects.new("QA Camera Fill", fill_data)
    fill.parent = camera
    scene.collection.objects.link(fill)

    center = (bbox_min + bbox_max) / 2.0 if bbox_min is not None else Vector((1.0, 1.0, 1.0))
    extent = bbox_max - bbox_min if bbox_min is not None else Vector((4.0, 3.0, 4.0))
    radius = max(extent.length / 2.0, 0.5)

    door_ray = next((ray for ray in (rays or []) if ray.get("id") == "door-opening"), None)
    door_target = None
    if door_ray is not None:
        origin_cm = door_ray["originCm"]
        direction_cm = door_ray["directionCm"]
        direction = Vector(direction_cm).normalized()
        door_target = scene_to_blender(
            origin_cm[0] + direction.x * 20.0,
            origin_cm[1] + direction.y * 20.0,
            origin_cm[2] + direction.z * 20.0,
        )

    baseboard_target = Vector(
        (
            bbox_min.x + 0.12 if bbox_min is not None else 0.1,
            bbox_min.y + 0.12 if bbox_min is not None else 0.1,
            0.06,
        )
    )
    crown_target = Vector(
        (
            bbox_min.x + 0.16 if bbox_min is not None else 0.1,
            bbox_min.y + 0.16 if bbox_min is not None else 0.1,
            bbox_max.z - 0.2 if bbox_max is not None else 2.6,
        )
    )

    views = {
        "overview": (center + Vector((1.1, 0.75, 1.35)) * radius * 1.35, center),
        "front": (center + Vector((0.0, 0.12, 1.0)) * radius * 1.9, center),
        "side": (center + Vector((1.0, 0.12, 0.0)) * radius * 1.9, center),
        "top": (center + Vector((0.001, 1.0, 0.001)) * radius * 1.9, center),
        "baseboard-closeup": (baseboard_target + Vector((0.7, 0.7, 0.45)), baseboard_target),
        "crown-closeup": (crown_target + Vector((1.5, 1.5, -0.5)), crown_target),
    }
    if door_target is not None:
        views["door-closeup"] = (door_target + Vector((0.9, -1.6, 0.45)), door_target)
    if has_desk:
        views["furniture-overview"] = (
            center + Vector((1.4, -2.2, 0.4)),
            center + Vector((0.0, 0.0, -0.9)),
        )

    written = []
    for name, (location, target) in views.items():
        look_at(camera, location, target)
        scene.render.filepath = os.path.join(render_dir, f"{name}.png")
        bpy.ops.render.render(write_still=True)
        written.append(scene.render.filepath)
    return written


def main() -> int:
    args = parse_args()
    glb = args.get("glb")
    fixture_path = args.get("fixture")
    out_path = args.get("out")
    render_dir = args.get("render-dir")
    if not glb or not fixture_path or not out_path:
        print(MARKER + json.dumps({"ok": False, "error": "missing --glb/--fixture/--out"}))
        return 1

    with open(fixture_path, "r", encoding="utf-8") as handle:
        fixture = json.load(handle)

    result: dict = {"ok": False, "blenderVersion": bpy.app.version_string}
    try:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        import_result = bpy.ops.import_scene.gltf(filepath=glb)
        if "FINISHED" not in import_result:
            raise RuntimeError(f"glTF import returned {import_result!r}")

        depsgraph = bpy.context.evaluated_depsgraph_get()
        bpy.context.view_layer.update()
        objects = list(bpy.context.scene.objects)
        meshes = [obj for obj in objects if obj.type == "MESH"]

        metrics = mesh_metrics(meshes)
        metrics["objectNames"] = [obj.name for obj in objects]
        metrics["meshNames"] = [obj.name for obj in meshes]
        metrics["meshCount"] = len(meshes)
        metrics["objects"] = len(objects)
        metrics["materials"] = inspect_materials()
        metrics["materialCount"] = len(metrics["materials"])
        metrics["images"] = inspect_images()
        metrics["imageCount"] = len(metrics["images"])
        metrics["meshesWithoutUv"] = [
            obj.name for obj in meshes if len(obj.data.uv_layers) == 0
        ]

        uv_by_mesh = []
        surface_mirrored = 0
        floor_tiles = []
        baseboard_tiles = []
        crown_tiles = []
        for obj in meshes:
            uv = inspect_uv(obj)
            uv_by_mesh.append({"name": obj.name, **uv})
            if (
                obj.name.startswith("room-floor")
                or obj.name.startswith("room-wall")
                or obj.name.startswith("room-ceiling")
                or "room-baseboard" in obj.name
                or "room-crown-molding" in obj.name
            ):
                surface_mirrored += uv["mirroredTriangles"]
            if obj.name.startswith("room-floor") and uv["derivedTileCm"] is not None:
                floor_tiles.append(uv["derivedTileCm"])
            if "room-baseboard" in obj.name and uv["derivedTileCm"] is not None:
                baseboard_tiles.append(uv["derivedTileCm"])
            if "room-crown-molding" in obj.name and uv["derivedTileCm"] is not None:
                crown_tiles.append(uv["derivedTileCm"])

        uv_metrics = {
            "meshes": uv_by_mesh,
            "nonFinite": sum(item["nonFinite"] for item in uv_by_mesh),
            "surfaceMirrored": surface_mirrored,
            "floorTilesCm": floor_tiles,
            "baseboardTileCm": (
                round(sum(baseboard_tiles) / len(baseboard_tiles), 3)
                if baseboard_tiles
                else None
            ),
            "crownTileCm": (
                round(sum(crown_tiles) / len(crown_tiles), 3) if crown_tiles else None
            ),
        }

        transforms = object_transforms(meshes)
        rays = [ray_check(meshes, ray) for ray in fixture["expectations"].get("rays", [])]
        checks = evaluate(fixture, metrics, uv_metrics, transforms, rays)
        checks.extend(trim_topology_checks(meshes))

        renders = []
        if render_dir:
            setup_render(render_dir)
            bbox_min = Vector(metrics["bboxMinM"]) if metrics["bboxMinM"] else None
            bbox_max = Vector(metrics["bboxMaxM"]) if metrics["bboxMaxM"] else None
            has_desk = any("desk" in obj.name.lower() for obj in objects)
            renders = render_views(
                render_dir,
                bbox_min,
                bbox_max,
                has_desk,
                fixture["expectations"].get("rays", []),
            )

        failed = [item for item in checks if item["status"] != "PASS"]
        result = {
            "ok": not failed,
            "blenderVersion": bpy.app.version_string,
            "importResult": str(import_result),
            "metrics": metrics,
            "uv": uv_metrics,
            "transforms": transforms,
            "rays": rays,
            "checks": checks,
            "failedChecks": failed,
            "renders": renders,
        }
    except Exception as exc:  # Blender surfaces import failures as exceptions.
        result = {
            "ok": False,
            "blenderVersion": bpy.app.version_string,
            "error": f"{type(exc).__name__}: {exc}",
        }

    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, sort_keys=True, indent=2)
    print(MARKER + json.dumps(result, ensure_ascii=False, sort_keys=True))
    if not result.get("ok"):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
