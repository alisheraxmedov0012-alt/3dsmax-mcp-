# Export quality budgets and preflight

## Purpose

Before a 3D file is written, the export scene is measured against a quality
profile. The result is a structured list of `PASS`, `WARNING` and `BLOCK`
checks. Warnings are reported but do not stop the download; a BLOCK aborts the
export with the same result attached to the error.

This is a personal-project quality gate. It does not resize textures, simplify
geometry or otherwise change the user's model.

## Profiles

| Profile | Geometry (tri / verts / meshes / objects) | GLB / package | Texture max | Budget overrun |
| --- | --- | --- | --- | --- |
| Qoralama | 1M / 2M / 2000 / 500 | 128 / 256 MiB | 8192 px, 64 MP | WARNING |
| Standart | 250k / 500k / 500 / 100 | 32 / 64 MiB | 4096 px, 32 MP | WARNING |
| Yuqori sifat | 100k / 200k / 250 / 50 | 16 / 32 MiB | 4096 px, 16 MP | BLOCK |
| Maxsus | Standard defaults, overridable at runtime | — | — | WARNING or BLOCK |

All profiles also require UVs for textured materials, finite positions/UVs/
normals, valid normals and tangents, resolvable materials and textures, and
tangents for normal-mapped indexed meshes.

`src/export/quality/profiles.ts` is the source of truth. `createCustomProfile()`
merges runtime overrides into a Standard base without mutating the built-in
profiles. The export panel exposes the common geometry, size, texture and UV
limits; the full `QualityLimits` shape is available to programmatic callers.

## API

```ts
import { preflightExportScene } from './src/export/quality/preflight';
import { resolveQualityProfile } from './src/export/quality/profiles';

const result = preflightExportScene(sceneData, {
  profile: resolveQualityProfile('standard'),
  format: 'glb',
  includeRoom: true,
});
```

`evaluateQualityPreflight(metrics, profile, { format, actualFileBytes,
actualTexturePayloadBytes })` is the pure evaluator. `collectQualityMetrics(scene)`
is read-only and reuses the existing geometry, normal and UV validators.

Each check has a stable `id`, `category`, `status`, `actual`, `limit`, `message`,
`remediation` and `certainty` (`exact`, `approximate` or `not_verified`). The
overall result also carries `summary` counts, profile information and a
user-facing `message`.

## Metric semantics

Geometry metrics are split by scope:

| Metric | Scope |
| --- | --- |
| `uniqueGeometryTriangles` / `uniqueGeometryVertices` | Each distinct `BufferGeometry` once; storage/buffer diagnostics |
| `sceneTriangles` / `sceneVertices` | Every visible mesh node, multiplied by `InstancedMesh.count` |
| `meshNodes` | Visible exported mesh nodes |
| `objectGroups` | Visible top-level export groups (room plus scene objects) |
| `sceneNodes` | Visible scene nodes before the synthetic metre-scale root |
| `instancedMeshNodes` / `instancedInstances` | InstancedMesh nodes and their total instance count |

`maxTriangles` and `maxVertices` are scene-instance budgets. Unique geometry
values remain visible as diagnostics and for file/buffer complexity.

## Diagnostics

- UV: exact range/count/finite/degenerate checks, bounded approximate overlap
  candidates, and approximate texel density when texture dimensions and
  world-space area are available.
- Textures: exact dimensions/pixels/formats, exact or estimated payload bytes,
  and `NOT VERIFIED` when image data is unavailable.
- Materials: base-colour, metallic/roughness, alpha/alphaTest, normal-map UV and
  texture-reference diagnostics. All are read-only.
- Golden regression: the standard harness output is compared with a versioned
  baseline; geometry changes are exact failures and GLB size has a small
  tolerance.

## Export integration

`exportSceneToFormat(format, data, metadata, { qualityProfile })` runs preflight
on the scene the selected exporter actually uses:

- GLB/glTF: before the exporter runs, on the textured scene.
- OBJ/STL/3MF: before the exporter runs, on the built scene.
- JSON: no mesh preflight (it is scene data, not a 3D deliverable).

A `BLOCK` raises `ExportError('quality_blocked')` with the structured result.
A `WARNING` lets the export continue and returns `artifact.quality`. After the
artifact exists, the file size and embedded image payload are re-checked with
exact values, so an estimate can never hide an oversized result.

## Quality Harness

`tools/glb-harness/export.html` runs the same Standard profile and posts
`quality-stats.json` after producing the GLB. `tools/qa/quality-harness.mjs`
adds a `qualityBudget` component to the JSON/Markdown report. A budget BLOCK
fails the harness; a budget WARNING is recorded as a passing result with details.
The Khronos validator and Blender checks are unchanged.

## Commands

```bash
npm run test:quality
```

## Limitations

- Individual texture bytes are an RGBA estimate when the runtime image exposes
  pixels instead of an encoded blob. The total embedded payload is exact after
  export (GLB buffer views or glTF data URIs).
- The UI "Tekshirish" preview builds the untextured export scene, so external
  bitmap dimensions are exact only in the export-time preflight.
- No automatic geometry simplification, texture resizing/compression or UV
  remapping is performed. A BLOCK tells the user what to fix.
- The check evaluates the export scene, not the saved scene parameters. Hidden
  objects and the room follow the same inclusion rules as the exporter.
