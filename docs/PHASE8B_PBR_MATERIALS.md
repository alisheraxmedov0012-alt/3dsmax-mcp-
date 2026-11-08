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
| GLB bytes | 768 352 | **19 933 652** | +19.2 MB |
| GLB SHA-256 | `7eca2f67…` | **`c197dfa6…`** | new artifact (natural-oak revision) |
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
   per material (8 images → 6, 23.1 MB → 18.9 MB; 19.9 MB after the natural-oak revision).

Verified from the final GLB: **all 6 images are 2048 × 2048**, and every
material references the expected baseColor, metallicRoughness and normal maps.

## Oak PBR

Deterministic procedural oak, 2048², no external asset or licence dependency.

| Characteristic | Value |
| --- | --- |
| Base colour mean | RGB 183, 128, 94 (`#B7805E`) |
| Base colour range | R 155–187, G 115–140, B 80–97; no near-black pixels |
| Luminance mean / std | 136.7 / 3.7 (quiet tone variation) |
| Roughness mean / std | 0.533 / 0.009 (range 0.514–0.627) |
| Metalness | 0.000 (dielectric) |
| Grain direction | variation across V is **2.80×** variation along U → fibres run along U |
| Tiling | seamless on both axes; wrapped-edge delta is below the interior neighbour delta |
| Maps | BaseColor, Normal (OpenGL), ORM (R = 0, G = roughness, B = 0) |

The tabletop and drawer use the same texture family and physical box UVs, so the
grain density is shared; the two BaseColor files are byte-identical. The pattern
is a tileable anisotropic fibre field (medium + fine + tooth scales), sparse
elongated pores, and seven low-amplitude rings per 50 cm tile. The rings only
modulate tone; there are no hard sinusoidal stripes.

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

## Natural oak revision (8B.2 follow-up)

The human review returned **PASS-with-notes**: the oak read as artificial, with
black and dark-orange wavy bands. Two independent causes were found.

1. **Generator.** The old field used 17 sine-warped rings per 50 cm tile (≈3 cm
   spacing) with a large albedo and height contribution. That is both too regular
   and too high-contrast for oak.
2. **Preview pipeline.** `applyMaterialSettings()` regenerated every non-bitmap
   material at 128 px and set the material colour to the slot colour. On the
   premium desk that replaced the 2048² oak with a 128 px set, tinted the baked
   albedo a second time and dropped the roughness/metalness maps. The previews
   therefore never showed the 2K material that the GLB shipped.

The revision:

- Replaces the ring-driven field with a tileable anisotropic fibre field
  (medium, fine and tooth scales), sparse elongated pores and seven
  low-amplitude rings. Colour stays inside R 155–187/G 115–140/B 80–97, so no
  black grain can appear.
- Preserves 2K premium maps in the viewer, keeps the baked albedo untinted and
  wires the shared ORM into roughness/metalness.
- Scales the product studio lights to 0.55 because the true mid-tone oak albedo
  is much brighter than the previous tinted fallback; without that, red clipped
  in 97.6% of the detail shot. Tone mapping stays off so the backdrop remains
  exactly `#f4f4f6`.

Measured result in `preview-detail.png`: near-black pixels (luminance < 40) fell
from **18.4% to 0.17%**, red clipping is **0%**, and the grommet is a clean
212 × 52 px ring component with a visible through-hole. The metal generator,
metal map bytes and all geometry are untouched.

## Preview gallery

Six 1920 × 1080 PNGs from the real `SceneViewer.captureProductPreviews()` with a
tighter product margin (`1.1` instead of the default `1.25`). They now render
the same 2048² maps that the GLB contains.

| Angle | Bytes | Non-background | Content width × height | Warm pixels | Dark pixels |
| --- | ---: | ---: | ---: | ---: | ---: |
| hero | 208 271 | 9.4% | 43.4% × 46.8% | 36.6% | 31.8% |
| front | 185 203 | 7.2% | 48.4% × 37.1% | 28.6% | 42.4% |
| side | 159 176 | 8.1% | 39.2% × 44.4% | 29.7% | 34.5% |
| back | 165 447 | 10.9% | 61.7% × 45.6% | 17.3% | 25.6% |
| top | 581 788 | 23.1% | 45.9% × 53.8% | 77.5% | 0.3% |
| detail | 1 854 814 | 68.1% | 99.2% × 78.7% | 99.3% | 0.4% |

“Warm” and “dark” are percentages of the non-background pixels. Warm counts oak
(R > G > B, R−B > 28) and dark counts luminance < 70 (black metal and shadow).
The detail shot is a close-up of the grommet and rear tabletop, so almost the
whole subject is oak; the grommet is only 0.4% of the pixels but forms a clean
212 × 52 px ring component with a through-hole. These are automated coverage
checks. The previous gallery received a human PASS-with-notes; this revised
gallery still needs the same sign-off.

## Deterministic GLB

Three's `GLTFExporter` appends image bufferViews as each canvas finishes
encoding. Two browser runs produced identical image pixels but different
`images[]`/`bufferViews[]` order, so the pre-canonical SHA differed
(`4e14b126…` vs `2a292f93…`). `tools/product/canonicalGlb.mjs` orders images by
material and map role (BaseColor → Normal → ORM), rebuilds the BIN chunk with
4-byte alignment and remaps every accessor/image reference. After the natural-oak
revision, two consecutive full product runs produced byte-identical output for
the GLB and all six previews. The delivered GLB is
`c197dfa68a1a484039379edf7e62ec9b406ad1f123d69667bd157ad1b69b13be`.

## Validation

| Check | Result |
| --- | --- |
| Full suite (8B.2 baseline) | **226 files / 3 102 tests PASS**; not rerun for the oak revision, per the task brief |
| Targeted revision tests | **149 PASS** across 10 material/product/export files |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS (oxlint) |
| `npm run build` | PASS (8B.2 baseline; no build-affecting config changed) |
| Desk / parity / product tests | 54 PASS; byte-identical legacy vs universal GLB |
| GLB images | **6 × 2048 × 2048** |
| External textures | **16 × 2048 × 2048**, 32 607 730 bytes total |
| Khronos `gltf-validator` | **0 errors, 0 warnings, 0 infos, 0 hints** |
| Repository GLB validator | PASS |
| Golden regression (8 furniture types) | **37 checks, 0 failures** (8B.2 baseline; non-oak kinds unchanged) |
| Bounding box | 160 × 75 × 80 cm, `min.y = 0` |
| GLB determinism | two consecutive full runs produced byte-identical GLB **and** previews |
| Preview dimensions | 6 × 1920 × 1080 |

GLB SHA-256:
`c197dfa68a1a484039379edf7e62ec9b406ad1f123d69667bd157ad1b69b13be`
(19 933 652 bytes).

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
  textures. They are physically plausible and 2K. The first gallery received a
  human **PASS-with-notes**; the natural-oak revision still needs the same
  sign-off before any “photoreal” marketplace claim.
- The GLB is 19.9 MB because of six 2K PNGs. Compression/KTX2 is a later
  delivery optimisation.
- Blender is absent, so Blender import is **NOT VERIFIED**.
- The grommet flange is flush; a counterbored protruding lip remains a later
  detail.
- Fastener UV poles keep a bounded number of degenerate triangles.
- No FBX, `.blend`, buyer ZIP, listing or marketplace upload in this phase.
- Preview renders are WebGL/SwiftShader captures, not Cycles renders. They now
  prove material assignment at the delivered 2K resolution; they do not prove
  photoreal lighting.
- Fixing the premium viewer path also makes the metal render from its existing
  2K maps and ORM instead of the old 128 px tinted fallback. The metal generator,
  map bytes and geometry are unchanged, so its look shifts slightly in previews.

## Files changed

- `src/materials/types.ts` — `TextureSize`, `TextureKind` oak/satin.
- `src/materials/presets.ts` — `wood-oak-premium`, `metal-satin-black`, premium
  fields.
- `src/materials/textures.ts` — deterministic 2K oak/satin generator with
  BaseColor, Normal and shared ORM maps; tileable natural-oak fibre/pore field.
- `src/materials/textures.test.ts` — oak colour/contrast, fibre direction,
  tiling and dielectric ORM assertions.
- `src/materials/updateMaterial.ts` — keeps premium 2K maps, untinted baked
  albedo and ORM wiring when the editor projects scene settings onto a material.
- `src/materials/buildMaterial.ts` — premium opt-in, 2K size, ORM wiring,
  descriptor reuse.
- `src/export/sceneExport.ts` — slot-preset retarget, 2048 acceptance.
- `src/scene/types.ts`, `src/scene/buildSceneObject.ts` — `premiumTextures`
  scene flag.
- `src/products/premiumOfficeDesk.ts` — product opts into premium maps and the
  1/1 scalar map-driven PBR values; studio lights scaled to expose the true oak
  albedo without clipping.
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

**PASS for the 8B.2 scope, revised after the human review.** The product carries
real 2048 × 2048 BaseColor/Normal/Roughness/Metalness maps, a quiet tileable oak
grain that runs along the desk, sparse pores, a dark satin metal, clean
visible-panel UVs, a real grommet hole, and a 19.9 MB GLB that passes Khronos
with zero errors, warnings, infos and hints. Two consecutive runs are
byte-identical for the GLB and all six previews. The preview pipeline now renders
the delivered 2K maps instead of the old 128 px tinted fallback, and the detail
shot no longer contains the black banding that triggered the revision.

Remaining gates: human sign-off of the revised gallery, Blender import
(Phase 8B.3), the buyer ZIP and the listing.
