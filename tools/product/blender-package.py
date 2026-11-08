"""Build the Blender/FBX/OBJ package and its evidence manifest.

    python3 tools/product/blender-package.py

Requires Blender 4.5.9 LTS at BLENDER (or the default local install). The GLB is
never regenerated: its SHA-256 is checked first. The export and the independent
re-import parity run are separate headless Blender processes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

DEFAULT_BLENDER = "/workspace/.tools/blender-4.5.9/blender"
DEFAULT_ARCHIVE = "/workspace/.tools/blender-4.5.9-linux-x64.tar.xz"
DEFAULT_ARCHIVE_SHA = "dcdc3eca6c9825bb35a8033b689c053f3cb5a9b0cd2a61b2eac2a49436b4ad3d"
EXPECTED_GLB_SHA = "c197dfa68a1a484039379edf7e62ec9b406ad1f123d69667bd157ad1b69b13be"
EXPECTED_MATERIALS = {
    "Desk_Tabletop_Oak",
    "Desk_Structure_Steel",
    "Desk_Drawer_Oak",
    "Desk_Hardware_Steel",
}
EXPECTED_BBOX_CM = [160.0, 80.0, 75.0]


def sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(cmd: list[str], cwd: str) -> tuple[str, str]:
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(
            f"command failed ({result.returncode}): {' '.join(cmd)}\n"
            f"{result.stdout[-4000:]}\n{result.stderr[-4000:]}"
        )
    return result.stdout, result.stderr


def marker(text: str, name: str) -> object:
    for line in text.splitlines():
        if line.startswith(name):
            return json.loads(line[len(name) :])
    raise SystemExit(f"{name} was not printed by Blender")


def check_parity(entries: list[dict]) -> list[str]:
    problems: list[str] = []
    for entry in entries:
        label = entry["label"]
        if entry["meshes"] != 24:
            problems.append(f"{label}: {entry['meshes']} meshes")
        if entry["triangles"] != 4696:
            problems.append(f"{label}: {entry['triangles']} triangles")
        for axis, expected in zip("xyz", EXPECTED_BBOX_CM):
            actual = entry["bboxCm"]["xyz".index(axis)]
            if abs(actual - expected) > expected * 0.005:
                problems.append(f"{label}: bbox {axis} {actual} cm")
        if set(entry["materials"]) != EXPECTED_MATERIALS:
            problems.append(f"{label}: materials {entry['materials']}")
        if entry["uvLayers"] != 24 or entry["meshesWithoutUv"]:
            problems.append(f"{label}: UV layers {entry['uvLayers']} / {entry['meshesWithoutUv']}")
        if entry["zeroAreaPolygons"] != 0:
            problems.append(f"{label}: {entry['zeroAreaPolygons']} zero-area polygons")
        if entry["cameras"] or entry["lights"]:
            problems.append(f"{label}: cameras/lights present")
        for image in entry["images"]:
            if image["width"] != 2048 or image["height"] != 2048:
                problems.append(f"{label}: image {image['name']} is not 2048²")
    return problems


def mtl_textures(mtl_path: str) -> list[dict]:
    base = os.path.dirname(mtl_path)
    paths: set[str] = set()
    with open(mtl_path, encoding="utf-8") as handle:
        for line in handle:
            parts = line.split()
            if not parts:
                continue
            if parts[0] == "map_Kd" or parts[0] == "map_Pr" or parts[0] == "map_Pm":
                paths.add(parts[-1])
            elif parts[0] == "map_Bump":
                paths.add(parts[-1])
    entries = []
    for relative in sorted(paths):
        absolute = os.path.normpath(os.path.join(base, relative))
        entries.append(
            {
                "path": relative,
                "bytes": os.path.getsize(absolute),
                "sha256": sha256(absolute),
            }
        )
    return entries


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--glb", default="product-output/premium-office-desk.glb")
    parser.add_argument("--out", default="product-output")
    parser.add_argument("--blender", default=os.environ.get("BLENDER", DEFAULT_BLENDER))
    parser.add_argument("--archive", default=DEFAULT_ARCHIVE)
    parser.add_argument("--expected-glb-sha", default=EXPECTED_GLB_SHA)
    args = parser.parse_args()

    root = os.path.abspath(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    glb = os.path.abspath(os.path.join(root, args.glb))
    out = os.path.abspath(os.path.join(root, args.out))
    blender = os.path.abspath(args.blender)
    export_script = os.path.join(root, "tools/product/blender-export.py")
    parity_script = os.path.join(root, "tools/product/blender-parity.py")

    for path in (glb, blender, export_script, parity_script):
        if not os.path.exists(path):
            raise SystemExit(f"missing: {path}")
    glb_sha = sha256(glb)
    if args.expected_glb_sha and glb_sha != args.expected_glb_sha:
        raise SystemExit(f"GLB SHA-256 mismatch: {glb_sha}")
    if os.path.exists(args.archive) and sha256(args.archive) != DEFAULT_ARCHIVE_SHA:
        raise SystemExit("Blender archive SHA-256 mismatch")

    export_stdout, _ = run(
        [blender, "--background", "--factory-startup", "--python", export_script, "--", glb, out],
        root,
    )
    exported = marker(export_stdout, "EXPORT_JSON:")

    blend = os.path.join(out, "premium-office-desk.blend")
    fbx = os.path.join(out, "premium-office-desk.fbx")
    obj = os.path.join(out, "premium-office-desk.obj")
    mtl = os.path.join(out, "premium-office-desk.mtl")
    parity_stdout, _ = run(
        [
            blender,
            "--background",
            "--factory-startup",
            "--python",
            parity_script,
            "--",
            blend,
            glb,
            fbx,
            obj,
        ],
        root,
    )
    parity = marker(parity_stdout, "PARITY_JSON:")
    problems = check_parity(parity)

    geometry = {
        "meshes": 24,
        "triangles": 4696,
        "vertices": 11078,
        "bboxCm": EXPECTED_BBOX_CM,
    }
    files = {
        "blend": {
            "path": "premium-office-desk.blend",
            "format": "blend",
            "unit": "meter",
            "bytes": os.path.getsize(blend),
            "sha256": sha256(blend),
            "geometry": geometry,
        },
        "fbx": {
            "path": "premium-office-desk.fbx",
            "format": "fbx",
            "unit": "centimeter",
            "bytes": os.path.getsize(fbx),
            "sha256": sha256(fbx),
            "geometry": geometry,
        },
        "obj": {
            "path": "premium-office-desk.obj",
            "format": "obj",
            "unit": "millimeter",
            "bytes": os.path.getsize(obj),
            "sha256": sha256(obj),
            "geometry": geometry,
        },
        "mtl": {
            "path": "premium-office-desk.mtl",
            "format": "mtl",
            "unit": None,
            "bytes": os.path.getsize(mtl),
            "sha256": sha256(mtl),
            "geometry": None,
        },
    }
    textures = mtl_textures(mtl)

    manifest = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "product": {
            "sku": "3DSA-DESK-PREM-160",
            "name": "Premium Office Desk",
            "dimensionsCm": {"width": 160, "depth": 80, "height": 75},
        },
        "sourceGlb": {"path": os.path.basename(glb), "bytes": os.path.getsize(glb), "sha256": glb_sha},
        "blender": {
            "version": exported["blender"],
            "archive": os.path.basename(args.archive),
            "archiveSha256": DEFAULT_ARCHIVE_SHA,
        },
        "units": {"glb": "meter", "blend": "meter", "fbx": "centimeter", "obj": "millimeter"},
        "files": files,
        "objTextures": textures,
        "geometry": {
            "meshes": 24,
            "triangles": 4696,
            "vertices": 11078,
            "bboxCm": EXPECTED_BBOX_CM,
            "zeroAreaPolygons": 0,
            "uvLayers": 24,
        },
        "materials": sorted(EXPECTED_MATERIALS),
        "images": {
            "blend": {"count": 6, "packed": True, "resolution": "2048x2048"},
            "glb": {"count": 6, "embedded": True, "resolution": "2048x2048"},
            "fbx": {
                "count": 8,
                "embedded": True,
                "note": "BaseColor is duplicated per material (2 unique families); Normal is shared. Roughness/Metallic maps are not carried by Blender's FBX writer.",
            },
            "obj": {"count": 8, "external": True, "folder": "textures/"},
        },
        "parity": parity,
        "checks": {
            "meshes24": not any("meshes" in problem for problem in problems),
            "triangles4696": not any("triangles" in problem for problem in problems),
            "bboxCm": not any("bbox" in problem for problem in problems),
            "materials4": not any("materials" in problem for problem in problems),
            "uvComplete": not any("UV" in problem for problem in problems),
            "zeroArea": not any("zero-area" in problem for problem in problems),
            "resolution2048": not any("2048" in problem for problem in problems),
            "problems": problems,
        },
        "limitations": [
            "FBX does not carry roughness/metallic maps: Blender converts the Principled graph to Phong-era channels. Constant metallic/roughness values are written from the map means (oak 0 / 0.533; steel 0.97 / 0.340).",
            "OBJ/MTL core has no PBR. The MTL writes Pr/Pm and map_Pr/map_Pm extension maps plus map_Kd/map_Bump; Blender reads them, but many DCCs ignore the extensions.",
            "Normal maps are referenced through map_Bump, which some importers treat as a height map rather than tangent-space normals.",
            "3ds Max and Maya import are NOT VERIFIED. Only Blender 4.5.9 LTS was used.",
            "The .blend and FBX binaries are not claimed byte-deterministic; the GLB remains the deterministic source.",
            "The OBJ references the shared 2K files in textures/: Drawer uses the Tabletop oak maps and Hardware uses the Structure steel maps because the source maps are byte-identical.",
        ],
    }

    manifest_path = os.path.join(out, "export-manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print("Blender package: PASS" if not problems else "Blender package: FAIL")
    print(f"blend={files['blend']['bytes']} bytes  fbx={files['fbx']['bytes']} bytes  obj={files['obj']['bytes']} bytes")
    print(f"parity: " + ", ".join(f"{entry['label']}={entry['meshes']}m/{entry['triangles']}t/{entry['bboxCm']}cm" for entry in parity))
    print(f"manifest={manifest_path}")
    if problems:
        for problem in problems:
            print(f"  - {problem}")
        sys.exit(1)


main()
