# Phase 8B.2 — Premium PBR materials and visual quality

> Scope: the Premium Office Desk (`3DSA-DESK-PREM-160`, 160 × 80 × 75 cm) on
> branch `phase8b/desk-foundation`. This record covers the 2K oak/black-satin
> materials, the UV fix, the export-resolution root cause, the regenerated GLB
> and six previews. It does not cover Blender/FBX, the buyer ZIP or the listing.

## Baseline

| Item | Value |
| --- | --- |
| Branch | `phase8b/desk-foundation` |
| HEAD | `6cf78dff453ff2914c2008f81a82639801f8de76` (8B.1 changes uncommitted) |
| Working tree | 8B.1 + 8B.2 changes, no commit/push |
| Product fixture | `src/products/premiumOfficeDesk.ts` |
| Previous report | `docs/PHASE8B_DESK_GEOMETRY.md` |

## Before / after

| Metric | 8B.1 | 8B.2 | Change |
| --- | ---: | ---: | --- |
| Texture resolution | 128 × 128 | **2048 × 2048** | 16× linear |
| GLB images | 4 | **6** (shared oak/steel ORM) | +2 |
| GLB bytes | 768 352 | **18 854 956** | +18.1 MB |
| GLB SHA-256 | `7eca2f67…` | **`e53f3130…`** | new artifact |
| Material slots | 4 | **4** | unchanged |
| Triangles | 5 144 | **4 696** | −448 (plate drawer front) |
| Vertices | 12 422 | **11 078** | −1 344 |
| Bounding box | 160 × 75 × 80 | **160 × 75 × 80** | unchanged |
| External PBR PNGs | 0 | **16 × 2048²** | new |

## Root cause of the 128 px export

`retargetExportTextures()` passed **only the object-level material** to
`applyTextureResolution()`. For a universal desk, that object material has
`metalness`/`roughness` but no `materialId`; the resolver therefore selected the
neutral `default` preset, whose texture kind is `none`. The function returned
`null` and the materials kept the 128 px viewer maps. The requested `512` never
reached the wood/metal slot presets.

The fix:

1. `retargetExportTextures()` reads `getSlotMaterialInfo(material)` and retargets
   with the slot's real preset (`wood-oak-premium` / `metal-satin-black`).
2. `TextureSize` is now `128 | 512 | 1024 | 2048` in the material builder and the
   scene exporter, and export validation accepts all four.
3. Premium maps are an explicit product opt-in (`premiumTextures: true`), so the
   catalogue, tests and ordinary furniture keep their exact 128 px output.
4. The premium presets pin 2048; the product page also requests 2048.
5. A single ORM texture serves `roughnessMap` and `metalnessMap`, so GLTFExporter
   emits one shared metallicRoughness image per material family instead of one
   per material (8 images → 6, 23.1 MB → 18.9 MB).

Verified from the final GLB: **all 6 images are 2048 × 2048**, and every
material references the expected baseColor, metallicRoughness and normal maps.

## Oak PBR

Deterministic procedural oak, 2048², no external asset or licence dependency.

| Characteristic | Value |
| --- | --- |
| Base colour mean | RGB 174, 125, 76 (`#AE7D4C`) |
| Luminance mean / std | 131.8 / 8.7 (subtle, not flat or extreme) |
| Roughness mean / std | 0.521 / 0.014 |
| Metalness | 0.000 (dielectric) |
| Grain direction | variation across V is **2.75×** variation along U → fibres run along U |
| Maps | BaseColor, Normal (OpenGL), ORM (R = 0, G = roughness, B = 0) |

The tabletop and drawer use the same texture family and physical box UVs, so the
grain density is shared. The pattern is multi-scale noise plus noise-warped
growth rings and sparse pores; there is no plain sine stripe.

## Black satin metal

| Characteristic | Value |
| --- | --- |
| Base colour mean | RGB 26, 28, 32 (`#1A1C20`) graphite |
| Luminance std | 1.0 (a dark satin surface, not a flat black fill) |
| Roughness mean / std | 0.340 / 0.012 |
| Metalness mean | 0.970 |
| Maps | BaseColor, Normal, ORM (G = roughness, B = metalness) |

The fine brushed/micro-noise normal and roughness variation is intentionally
subtle; the bevels and frame members catch the studio key/fill/rim lights.

## UV mapping

- Tabletop: physical box projection at a 50 cm tile; grain along the desk length.
- Drawer front: changed from `RoundedBoxGeometry` native face UVs to an extruded
  plate with **physical box UVs**. This removes the 0–1 stretch over 45 × 20 cm
  and makes the oak density match the tabletop. The plate saves 448 triangles,
  which explains the 4 696 triangle total.
- Drawer carcass: flat-shaded custom box with box UVs.
- Visible panels: **0 degenerate UV triangles** in the desk UV test. Lathe
  fasteners still have ≤ 40 degenerate pole triangles each, documented as a
  Phase 8B.2 unwrap item.
- The grommet ring, handle and runners use native UVs; their materials are
  micro-varied metal, so uniform projection would add no visible value.

## Grommet

- Real 8 cm through-hole in the tabletop; ring outer radius 3.96 cm in a 4.00 cm
  hole (0.04 cm clearance), flush top and bottom.
- No coplanar wood/metal surface, so no z-fighting.
- A protruding 0.3 cm lip was not added: it would exceed the 75 cm bounding box.
  The visible flush annulus is the delivered flange equivalent.

## Preview gallery

Six 1920 × 1080 PNGs from the real `SceneViewer.captureProductPreviews()` with a
tighter product margin (`1.1` instead of the default `1.25`).

| Angle | Bytes | Non-background | Content width × height | Warm pixels | Dark pixels |
| --- | ---: | ---: | ---: | ---: | ---: |
| hero | 285 324 | 9.4% | 43.4% × 46.8% | 19.4% | 47.4% |
| front | 193 194 | 7.2% | 48.4% × 37.1% | 13.2% | 60.5% |
| side | 170 908 | 8.1% | 39.2% × 44.4% | 10.2% | 59.6% |
| back | 183 156 | 10.9% | 61.7% × 45.6% | 5.6% | 43.6% |
| top | 424 019 | 23.1% | 45.9% × 53.8% | 39.3% | 45.8% |
| detail | 1 291 031 | 68.1% | 99.2% × 78.7% | 54.6% | 44.8% |

“Warm” counts oak-coloured pixels (R > G > B, R−B > 28); “dark” counts pixels
with luminance < 70, which is the black metal and shadow. The hero shows both
legs/frame (dark) and tabletop (warm); the top view is predominantly oak; the
detail shot is a deliberate close-up of the grommet and the rear tabletop, with
54.6% warm oak and 44.8% dark metal/hole. These are automated coverage checks,
not a human art review.

## Deterministic GLB

Three's `GLTFExporter` appends image bufferViews as each canvas finishes
encoding. Two browser runs produced identical image pixels but different
`images[]`/`bufferViews[]` order, so the pre-canonical SHA differed
(`4e14b126…` vs `2a292f93…`). `tools/product/canonicalGlb.mjs` orders images by
material and map role (BaseColor → Normal → ORM), rebuilds the BIN chunk with
4-byte alignment and remaps every accessor/image reference. Canonicalising both
sample GLBs produced the same SHA-256:
`e53f3130ee5c20ca3040b0f37ac2daae1fe6c65bf8cd148f27d7f621f114c204`.
The delivered GLB is now byte-reproducible across runs.

## Validation

| Check | Result |
| --- | --- |
| `npm test` | **226 files / 3 102 tests PASS** |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| Desk / parity / product tests | 54 PASS; byte-identical legacy vs universal GLB |
| GLB images | **6 × 2048 × 2048** |
| External textures | **16 × 2048 × 2048**, 31 680 664 bytes total |
| Khronos `gltf-validator` | **0 errors, 0 warnings, 0 infos, 0 hints** |
| Repository GLB validator | PASS |
| Golden regression (8 furniture types) | **37 checks, 0 failures**; Blender checks NOT VERIFIED |
| Bounding box | 160 × 75 × 80 cm, `min.y = 0` |
| GLB determinism | two browser samples canonicalise to `e53f3130…`; the Node product test also exports two identical scenes |
| Preview dimensions | 6 × 1920 × 1080 |

GLB SHA-256:
`e53f3130ee5c20ca3040b0f37ac2daae1fe6c65bf8cd148f27d7f621f114c204`.

## External texture files

Written by the runner from the final GLB, so they are byte-identical to the
delivered channels. Sixteen files (four materials × four roles):

```
textures/Desk_Tabletop_Oak_BaseColor.png
textures/Desk_Tabletop_Oak_Normal_OpenGL.png
textures/Desk_Tabletop_Oak_Roughness.png
textures/Desk_Tabletop_Oak_Metalness.png
textures/Desk_Drawer_Oak_…
textures/Desk_Structure_Steel_…
textures/Desk_Hardware_Steel_…
```

ORM channel layout in the GLB: **R = occlusion (0), G = roughness,
B = metalness**. Roughness and metalness PNGs are split from the ORM image by
the runner. The wood and steel families are duplicated per material name for
buyer clarity; the GLB itself shares six images.

## Limitations

- The maps are deterministic procedural sets, not authored photographic
  textures. They are physically plausible and 2K, but a human art review is
  still required before a marketplace claim of “photoreal” quality.
- The GLB is 18.9 MB because of six 2K PNGs. Compression/KTX2 is a later
  delivery optimisation.
- Blender is absent, so Blender import is **NOT VERIFIED**.
- The grommet flange is flush; a counterbored protruding lip remains a later
  detail.
- Fastener UV poles keep a bounded number of degenerate triangles.
- No FBX, `.blend`, buyer ZIP, listing or marketplace upload in this phase.
- Preview renders are WebGL/SwiftShader captures, not Cycles renders; they prove
  material assignment and framing, not photoreal lighting.

## Files changed

- `src/materials/types.ts` — `TextureSize`, `TextureKind` oak/satin.
- `src/materials/presets.ts` — `wood-oak-premium`, `metal-satin-black`, premium
  fields.
- `src/materials/textures.ts` — deterministic 2K oak/satin generator with
  BaseColor, Normal and shared ORM maps.
- `src/materials/buildMaterial.ts` — premium opt-in, 2K size, ORM wiring,
  descriptor reuse.
- `src/export/sceneExport.ts` — slot-preset retarget, 2048 acceptance.
- `src/scene/types.ts`, `src/scene/buildSceneObject.ts` — `premiumTextures`
  scene flag.
- `src/products/premiumOfficeDesk.ts` — product opts into premium maps and the
  1/1 scalar map-driven PBR values.
- `src/geometry/components/{types,structural}.ts` — plate panels with box UVs.
- `src/geometry/furniture/desk/{solver,desk.test,builder.test}.ts` — plate drawer
  front, centring, tolerance and triangle-range update.
- `src/geometry/furniture/desk/{builder,index}.ts`,
  `src/geometry/universal/definitions/deskComputer.ts` — premium material ids.
- `src/viewer/cameraAngles.ts`, `src/viewer/SceneViewer.ts` — optional product
  framing margin.
- `tools/product/{desk-product.html,build.mjs,glbTextures.mjs}` — 2K export,
  external texture extraction, preview coverage metrics.
- `src/materials/catalog.test.ts`, `src/scene/universalScene.test.ts`,
  `src/materials/*` tests — new preset expectations.

## Verdict

**PASS for the 8B.2 scope, with recorded limitations.** The product now carries
real 2048 × 2048 BaseColor/Normal/Roughness/Metalness maps, a coherent oak grain
direction, a dark satin metal with plausible PBR values, clean visible-panel UVs,
a real grommet hole, and a regenerated 18.9 MB GLB that passes Khronos with zero
errors and warnings. The six previews are larger in frame and show both material
families. Blender import and human visual sign-off remain the next gates.
