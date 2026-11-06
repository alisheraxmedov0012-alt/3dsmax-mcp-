# Phase 7 — Final Quality Report

> Personal-use 3D Studio AI. No accounts, subscriptions, payments, marketplace or
> commercial platform features are in scope.

## Baseline

| Item | Value |
| --- | --- |
| Repository | `alisheraxmedov0012-alt/3dsmax-mcp-` |
| Branch | `recovery/b1-b3-72c26f27` |
| Accepted baseline SHA | `b2316527268524fd490c5d44d421a18cf6041cde` |
| Working tree at acceptance | clean |
| Local / upstream | `0 / 0` |

## Acceptance matrix

| # | Requirement | Result | Evidence | Remaining limitation |
| --- | --- | --- | --- | --- |
| 1 | Geometry validation | **PASS** | `validateGeometry`, `geometryGuard`; quality preflight `invalidGeometries=0`, `nonFiniteVertices=0`, `degenerateTriangles=0`; Khronos 0 errors | None for validated geometry |
| 2 | Mesh and normals | **PASS** | `validateNormals`; 1536 unit normals in the inspected GLB; Blender `missingNormals=[]`; tangent generation tests | No MikkTSpace migration |
| 3 | UV quality | **PARTIAL** | `validateUvGeometry`; `uvDegenerateTriangles=0` exact; overlap 2540 **approximate**; texel density **approximately** 2.560 texels/cm where available | Overlap/texel density are approximate; untextured parts are `NOT VERIFIED` |
| 4 | Texture resolution | **PASS** | 8 images, 128×128 each; 131,072 total pixels; max 128 against 4096 limit; exact embedded payload 154,216 bytes | Per-texture bytes are estimates for procedural bitmaps |
| 5 | Materials | **PASS** | 10 materials; `invalidBaseColors=0`, `invalidPbrMaterials=0`, `invalidAlphaMaterials=0`, `normalMappedWithoutUv=0`; normal-mapped nodes 35/35 tangent-covered | No ORM map; no visual material review |
| 6 | Polygon count | **PASS** | Scene 804 triangles / 250,000 limit; 1608 vertices / 500,000; 67 mesh nodes / 500; unique geometry 768/1536 | Budget uses instance-aware scene totals |
| 7 | File size | **PASS** | GLB 297,864 bytes / 32 MiB; embedded texture payload 154,216 bytes / 32 MiB, exact after export | Individual payload bytes estimated |
| 8 | Blender import | **PASS** | Blender 4.2.9 LTS: 77 objects, 67 meshes, 1608 vertices, 804 triangles, 10 materials, 8 images, 67 UV layers, 0 zero-area polygons | Blender is optional in ordinary runs |
| 9 | Khronos GLB validator | **PASS** | `gltf-validator@2.0.0-dev.3.10`: 0 errors, 0 warnings, 32 info-level `UNUSED_OBJECT`, 0 hints | Info messages remain visible |
| 10 | Export/import round-trip | **PASS** | `exportImportRoundtrip.test.ts`; `npm run test:glb`; `npm run test:import` | — |
| 11 | Viewer test | **PASS** | `test:glb` viewer render 6.3% non-background; `test:import` selection/move/hide/delete/export flows | Technical render check, not human visual review |
| 12 | CI lint | **PASS** | `frontend` log: 0 warnings/0 errors; frontend, backend, postgres and redis jobs success | Heavy `test:quality` is local/release-gate |
| 13 | Regression tests | **PASS** | 225 test files / 3092 tests; golden regression 37/37 PASS; versioned baseline | Golden baseline must be updated deliberately |
| 14 | Final quality report | **PASS** | This document plus `qa-output/quality-report.json` / `.md` | Generated reports are ignored by Git |

## Real GLB metrics

| Metric | Value |
| --- | ---: |
| GLB bytes | 297,864 |
| SHA-256 | `1cc011ed1dbc5c016ff878491b240a8ada9775de7f866da01736bb5d014ba52e` |
| Unique geometries | 64 |
| Unique geometry triangles | 768 |
| Unique geometry vertices | 1536 |
| Mesh nodes | 67 |
| Scene triangles | 804 |
| Scene vertices | 1608 |
| Object groups | 9 |
| Scene nodes before synthetic metre root | 76 |
| GLB scene nodes (including synthetic root) | 77 |
| InstancedMesh nodes / instances | 0 / 0 |
| Materials / textures / images | 10 / 8 / 8 |
| Texture pixels | 131,072 |
| Embedded texture payload | 154,216 bytes, exact |
| Normal-mapped nodes / tangent-covered | 35 / 35 |

The 768 vs 804 and 1536 vs 1608 differences are the reused `table-leg` mesh:
one unique geometry, four exported mesh nodes.

## Khronos

```text
validatorVersion: 2.0.0-dev.3.10
errors:   0
warnings: 0
infos:    32
hints:    0
codes:    UNUSED_OBJECT × 32
```

## Blender

```text
status: PASS
version: 4.2.9 LTS
objects: 77, meshes: 67
vertices: 1608, triangles: 804
materials: 10, images: 8, UV layers: 67
zero-area polygons: 0
```

## Golden regression

Baseline: `tools/qa/golden/quality-baseline.json` v1.

```text
status: PASS
checks: 37 / 37 PASS
failures: 0
not verified: 0
```

Geometry, mesh, material and image counts are exact; GLB bytes use a 4 KiB / 2%
tolerance.

## UV, texture and material diagnostics

- UV: exact range/finite/count checks pass; 0 degenerate UV triangles; 2540
  **approximate** overlap candidates are informational because tiled/procedural
  UVs may legitimately repeat texture space; texel density is **approximately**
  2.560 texels/cm where a base-colour texture and world area are available.
- Texture: widths/heights, total pixels and formats exact; aggregate embedded
  payload exact after export; per-texture procedural bytes are estimated.
- Materials: all base-colour, PBR range, alpha/alphaTest, normal-map UV and
  texture-reference checks pass. Validation is read-only.

## Known limitations

- UV overlap and texel density are approximate, bounded diagnostics, not exact
  island analysis.
- Per-texture payload bytes for procedural bitmaps are RGBA estimates; the
  aggregate produced payload is exact.
- `sceneNodes` is measured before the synthetic metre-scale export root; GLB has
  one additional root node.
- Blender checks are optional and `NOT VERIFIED` when Blender is absent.
- Visual validation is limited to viewer render pixels and Blender import; no
  human visual review or pixel-level normal-map direction comparison.
- No automatic geometry repair, UV unwrap, texture resize/compression or
  MikkTSpace migration.
- The heavy `test:quality` harness remains outside ordinary CI.

## Final verdict

**PASS WITH LIMITATIONS.**

Phase 7’s technical quality requirements are satisfied for personal use: Khronos
reports 0 errors and 0 warnings, Blender imports the GLB cleanly, golden
regression passes 37/37, and the full test/build suite is green. The remaining
items are measurement limitations (approximate UV overlap/texel density and
estimated per-texture payload), not blocking defects.
