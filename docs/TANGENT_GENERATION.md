# Tangent generation for glTF normal maps

## Why

glTF 2.0 expects a mesh primitive whose material references `normalTexture` to
carry a `TANGENT` attribute. Without it, the Khronos validator reports
`MESH_PRIMITIVE_GENERATED_TANGENT_SPACE` because the tangent basis is left to the
runtime and is not portable between viewers.

## Algorithm

`src/export/tangents.ts` runs after the geometry guard and before either glTF
writer (`exportRootToGlb` and `exportRootToGltf`).

1. Traverse only visible meshes whose material (or one entry of a material
   array) has a `normalMap`.
2. Skip a mesh when it has no `position`, `normal` or `uv` attribute, when those
   attributes have different counts, when the geometry is not indexed, or when
   it already has a `TANGENT` attribute.
3. Call Three.js `BufferGeometry.computeTangents()`. It implements the per-vertex
   Lengyel method: accumulate the UV-derived S/T directions, Gram-Schmidt
   orthogonalise against the normal, and store handedness in W. The geometry
   stays indexed.
4. Sanitize every generated vertex: normalise XYZ, force W to exactly `+1` or
   `-1`, and replace a zero or non-finite vector with a deterministic tangent
   orthogonal to that vertex's normal.

The result is a four-component float attribute (`VEC4`, component type `5126`),
matching the glTF 2.0 `TANGENT` layout.

## Why not MikkTSpace here?

`BufferGeometryUtils.computeMikkTSpaceTangents()` de-indexes the geometry and
requires an initialised WASM module. De-indexing changes the exported geometry
layout, counter to the requirement that existing geometry be preserved. The
built-in algorithm keeps the indexed mesh and only adds one attribute. It is not
byte-identical to MikkTSpace, but it produces a valid glTF tangent basis and
handles mirrored UVs through W. A future switch to MikkTSpace would need a
deliberate geometry-layout decision.

## Scope and limitations

- Only normal-mapped, visible, indexed meshes with aligned position/normal/UV
  attributes receive tangents.
- Non-indexed geometry is left unchanged; it keeps the validator warning rather
  than receiving a synthetic index.
- Tangents already present in imported files are preserved, not rewritten.
- The exporter's normal-map green-channel handling changes when explicit tangents
  are present: Three.js no longer flips the no-tangent convention. This is the
  intended glTF/Three.js path, not a suppression.
- No polygon, file-size, texture-resolution or UV-layout policy is changed here.

## Verification

`src/export/tangents.test.ts` covers unit, mirrored UV, degenerate UV, non-finite
input, unchanged position/normal/UV data, non-indexed skipping and
normal-map-only selection. `sceneExport.roundtrip.test.ts` checks the exported
GLB: `TANGENT` is a valid VEC4 accessor only on normal-mapped primitives, and
plain primitives have none.

The quality harness (`npm run test:quality`) verifies the resulting file with the
official Khronos validator and Blender. After this change the inspected export
has 0 Khronos errors and 0 warnings (down from 32
`MESH_PRIMITIVE_GENERATED_TANGENT_SPACE` warnings); the remaining 32 `UNUSED_OBJECT`
entries are info-level and come from unused UVs on untextured primitives.
