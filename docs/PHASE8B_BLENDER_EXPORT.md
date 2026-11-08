# Phase 8B.3 — Blender source, FBX and OBJ delivery

> Scope: the Premium Office Desk (`3DSA-DESK-PREM-160`, 160 × 80 × 75 cm) on
> branch `phase8b/desk-foundation`. This record covers the `.blend` source,
> FBX and OBJ/MTL exports, the independent re-import parity run and the export
> manifest. It does not cover the buyer ZIP, the listing or a marketplace upload.

## Input

The GLB is the single source of truth; it was not regenerated.

| Item | Value |
| --- | --- |
| File | `product-output/premium-office-desk.glb` |
| Bytes | 19 933 652 |
| SHA-256 | `c197dfa68a1a484039379edf7e62ec9b406ad1f123d69667bd157ad1b69b13be` |
| Meshes | 24 |
| Triangles | 4 696 |
| Vertices | 11 078 |
| Materials | 4 (`Desk_Tabletop_Oak`, `Desk_Structure_Steel`, `Desk_Drawer_Oak`, `Desk_Hardware_Steel`) |
| Embedded images | 6 × 2048 × 2048 |
| Dimensions | 160 × 80 × 75 cm (W × D × H) |

The SHA-256 is checked before every export; a mismatch stops the run.

## Blender

| Item | Value |
| --- | --- |
| Version | **4.5.9 LTS** (build 2026-04-21) |
| Archive | `blender-4.5.9-linux-x64.tar.xz` from `download.blender.org/release/Blender4.5/` |
| Archive SHA-256 | `dcdc3eca6c9825bb35a8033b689c053f3cb5a9b0cd2a61b2eac2a49436b4ad3d` |
| Install path | `/workspace/.tools/blender-4.5.9/` |
| Package changes | none — no apt, no npm, no new project dependency |

The archive checksum was verified against the official
`blender-4.5.9.sha256` before extraction.

## Deliverables

All files live in `product-output/` (git-ignored).

| File | Bytes | SHA-256 | Unit |
| --- | ---: | --- | --- |
| `premium-office-desk.blend` | 19 370 204 | `3ab85913…583a445d` | metre |
| `premium-office-desk.fbx` | 14 466 972 | `6a499025…7fc29a7b` | centimetre |
| `premium-office-desk.obj` | 729 953 | `55bd47bd…5a4a0ad4` | millimetre |
| `premium-office-desk.mtl` | 1 826 | `6a6d6484…40b3d948` | — |
| `export-manifest.json` | 16 497 | (manifest itself) | — |

`export-manifest.json` records every file hash, the source GLB hash, the Blender
archive hash, units, geometry, materials, image counts and the full parity
result.

## `.blend` source

| Requirement | Result |
| --- | --- |
| Scene unit | METRIC, scale length 1.0, display centimetres |
| Collection | `Premium Office Desk` (the only collection) |
| Meshes | 24 |
| Objects | 30 (24 meshes + 6 hierarchy empties) |
| Materials | 4, exact names preserved |
| Images | 6 × 2048², **all packed** |
| UV maps | 24 layers, no mesh without UV |
| Cameras / lights | 0 / 0 |
| Bounding box | 1.60 × 0.80 × 0.75 m |
| Zero-area polygons | 0 |

The GLB hierarchy is preserved through the importer's empties. No geometry was
joined, decimated, triangulated again or transformed.

## Export settings

**FBX**

- `object_types={'MESH'}` — no cameras, lights or empties in the FBX.
- `global_scale=100` with `apply_unit_scale=True` and
  `apply_scale_options='FBX_SCALE_NONE'` → 160 × 80 × 75 FBX units, with
  `UnitScaleFactor = 1.0` (centimetres).
- `embed_textures=True`, `path_mode='COPY'`, triangles preserved.
- No modifiers were applied, no meshes were joined.

**OBJ/MTL**

- `global_scale=1000` → 1600 × 800 × 750 units (millimetres).
- `path_mode='RELATIVE'`; maps point at `textures/…` beside the MTL.
- `export_uv=True`, `export_normals=True`, `export_pbr_extensions=True`.
- The MTL is post-processed because Blender's writer does not translate the
  glTF `Separate Color → Metallic/Roughness` graph and writes paths relative to
  the `.blend`. The runner writes `Kd 1`, the measured `Pr`/`Pm`, `map_Kd`,
  `map_Bump` and the `map_Pr`/`map_Pm` PBR extensions.

## Parity — independent re-import

Each format was imported into a fresh Blender scene. FBX was normalised with
`global_scale=0.01` (cm → m) and OBJ with `global_scale=0.001` (mm → m) before
measuring, so the table is comparable in centimetres.

| Check | `.blend` | GLB | FBX | OBJ |
| --- | ---: | ---: | ---: | ---: |
| Meshes | 24 | 24 | 24 | 24 |
| Objects | 30 | 30 | 24 | 24 |
| Triangles | 4 696 | 4 696 | 4 696 | 4 696 |
| Vertices | 11 078 | 11 078 | 11 078 | 11 078 |
| Bounding box (cm) | 160 × 80 × 75 | 160 × 80 × 75 | 160 × 80 × 75 | 160 × 80 × 75 |
| Materials | 4 | 4 | 4 | 4 |
| UV layers | 24 | 24 | 24 | 24 |
| Meshes without UV | 0 | 0 | 0 | 0 |
| Zero-area polygons | 0 | 0 | 0 | 0 |
| Cameras / lights | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Images | 6 packed | 6 embedded | 8 embedded | 8 external |

No triangulation difference appeared: all four formats report 4 696 triangles.
The FBX and OBJ have 24 objects because the hierarchy empties are not exported.

## Material fidelity

| Format | Base colour | Normal | Roughness / metalness | Notes |
| --- | --- | --- | --- | --- |
| GLB | 2K map | 2K map | Shared 2K ORM | Full PBR; the deterministic source |
| `.blend` | 2K map | 2K map | Shared 2K ORM | Packed; node graph identical to the GLB |
| FBX | 2K map (embedded) | 2K map (embedded) | **Maps lost**; constants 0 / 0.533 oak, 0.97 / 0.340 steel | Blender converts the Principled graph to Phong-era channels |
| OBJ/MTL | 2K map | 2K map via `map_Bump` | `map_Pr` / `map_Pm` extension maps + `Pr` / `Pm` constants | Core MTL has no PBR; extension support varies |

FBX embeds **8** images, not 6: per family there are three BaseColor copies
(one per material/reference) plus one shared Normal map. The four unique 2K
files are the oak and steel BaseColor and Normal maps. Roughness and metalness
maps are not carried; the constant channels are set from the measured map means
so a DCC that cannot read the ORM chain still gets plausible values.

OBJ reads **8** unique external maps (BaseColor, Normal, Roughness, Metalness
for the oak and steel families). Blender's importer reads `map_Pr`/`map_Pm`, so
the round trip preserves all four channels in Blender. `map_Bump` is the
portable normal-map convention; some importers treat it as a height map.

The oak and steel families are shared: `Desk_Drawer_Oak` points at
`textures/Desk_Tabletop_Oak_*` and `Desk_Hardware_Steel` at
`textures/Desk_Structure_Steel_*`, because the source maps are byte-identical.

## Reproduce

```bash
# Export + independent parity + manifest (one command)
python3 tools/product/blender-package.py

# Or the two Blender steps separately
/workspace/.tools/blender-4.5.9/blender --background --factory-startup \
  --python tools/product/blender-export.py -- \
  product-output/premium-office-desk.glb product-output

/workspace/.tools/blender-4.5.9/blender --background --factory-startup \
  --python tools/product/blender-parity.py -- \
  product-output/premium-office-desk.blend \
  product-output/premium-office-desk.glb \
  product-output/premium-office-desk.fbx \
  product-output/premium-office-desk.obj
```

The package runner prints `Blender package: PASS` only when every parity check
passes.

## Limitations

- **3ds Max and Maya import is NOT VERIFIED.** Only Blender 4.5.9 LTS was used.
  The FBX is authored in centimetres and the OBJ in millimetres, but DCC-specific
  material and unit handling remains untested.
- FBX cannot carry the ORM chain as authored. The base colour and normal maps
  survive; roughness/metalness become constants. This is a format/toolchain
  limitation, not a hidden success.
- OBJ/MTL is not a PBR format. The `Pr`/`Pm` and `map_Pr`/`map_Pm` extensions
  are written and survive a Blender round trip, but many DCCs ignore them.
- `map_Bump` carries the normal map under the classic bump-map key; some
  importers will interpret it as a height map.
- The `.blend` and FBX binaries are not claimed byte-deterministic (they carry
  timestamps and tool metadata). The GLB remains the deterministic source and
  is unchanged by this phase.
- The OBJ references the shared 2K files in `textures/`; a buyer ZIP must include
  those eight files (or the whole folder) with the MTL.
- No commit, push, PR, deploy or marketplace upload was made in this phase.
