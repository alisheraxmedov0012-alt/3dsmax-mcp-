# Phase 8B.1 — Premium Office Desk geometry

> Scope: the first commercial product, `Premium Office Desk` (160 × 80 × 75 cm).
> This record covers geometry v2, the product fixture and the measurement harness.
> 2K PBR, Blender/FBX, the buyer ZIP and the listing are later phases.

## Baseline

| Item | Value |
| --- | --- |
| Repository | `alisheraxmedov0012-alt/3dsmax-mcp-` |
| Base branch | `recovery/b1-b3-72c26f27` |
| Base SHA | `6cf78dff453ff2914c2008f81a82639801f8de76` |
| Working branch | `phase8b/desk-foundation` |
| Working tree at start | clean |
| Committed | no (review-first delivery) |

## Before / after

The "before" numbers were measured at the base SHA in Node without a canvas, so
they contain no textures. The after GLB is produced by the browser harness with
the shipped procedural maps; compare triangles/vertices, not bytes.

| Metric | Before (base) | After (v2) | Target |
| --- | ---: | ---: | --- |
| Mesh nodes | 16 | **24** | 20–28 |
| Triangles | 4 848 | **5 144** | 5 000–12 000 |
| Vertices | 11 461 | **12 422** | ≤ 30 000 |
| Material slots | 4 | **4** | 4–5 |
| GLB bytes | 395 408 (untextured) | **768 352** | — |
| Tabletop triangles | 3 468 | **768** | 400–800 |
| Leg triangles | 12 each | **300 each** | 150–350 |
| Bounding box | 160 × 75 × 80 | **160 × 75 × 80** | ±0.1 cm |
| Floor contact | y = 0 | **y = 0** | ±0.01 cm |

GLB SHA-256: `7eca2f67d012670b35d8996a98bfbc611dbb08c1092f1d053011f6d661afc962`.

## Per-part metrics

| Part | Triangles | Vertices |
| --- | ---: | ---: |
| `desk-tabletop` | 768 | 2 304 |
| `desk-leg-nw` / `ne` / `sw` / `se` | 300 each | 900 each |
| `desk-leg-plate-nw` / `ne` / `sw` / `se` | 92 each | 276 each |
| `desk-frame` | 96 | 288 |
| `desk-support-front` / `back` | 300 each | 900 each |
| `desk-drawer` | 60 | 120 |
| `desk-drawer-front` | 588 | 1 764 |
| `desk-bolt-1…4` | 80 each | 54 each |
| `desk-screw-1…2` | 80 each | 54 each |
| `desk-drawer-handle` | 384 | 225 |
| `desk-drawer-runner-left` / `right` | 108 each | 324 each |
| `desk-grommet` | 384 | 245 |
| **Total** | **5 144** | **12 422** |

## Structural changes

### Tabletop

- Replaced the `roundedBox` with `segments: 8` (3 468 triangles, full-face
  subdivision) by an extruded rounded-rectangle plate.
- 1 cm corner radius, 0.25 cm edge roundover, 3 cm thickness, **768 triangles**.
- The cable grommet now has a **real through-hole** (8 cm) cut into the plate;
  a downward ray at the hole centre hits neither the tabletop nor the ring.
- Box UV projection keeps the wood grain at a uniform 50 cm tile.

### Grommet

- The ring sits inside the hole with a 0.04 cm clearance (3.96 cm outer radius in
  a 4.00 cm hole), top and bottom flush with the tabletop.
- No coplanar wood surface remains, so the previous z-fighting risk is removed.
- 48 radial segments, 384 triangles.
- A protruding 0.3 cm lip was not added: it would exceed the 75 cm bounding
  box. The delivered ring is flush; a counterbored lip is a Phase 8B.2 detail.

### Legs and mounting plates

- 5 × 5 × 72 cm legs with a 0.2 cm roundover, 300 triangles each.
- Added four 8 × 0.4 × 8 cm welded mounting plates under the tabletop (92
  triangles each), so the leg-to-top joint has visible structure instead of a
  hidden butt joint.
- Bolts moved under the plates, heads visible from below; 8 segments, 80
  triangles each.

### Drawer — the main constructive fix

The base layout placed the drawer centre at `z = 0`:

| Surface | Base | v2 |
| --- | ---: | ---: |
| Drawer front plane | z = +25 | **z = +34** |
| Frame front plane | z = +35 | z = +35 |
| Tabletop front edge | z = +40 | z = +40 |
| Drawer top | y = 72 | **y = 65.7** |
| Frame bottom | y = 66 | y = 66 |
| Drawer right edge | x = 72 | **x = 69.5** |
| Leg inner face | x = 70 | x = 70 |

The v2 drawer is 1 cm behind the frame front, 0.3 cm below the frame, and 0.5 cm
clear of the right leg. It has a 2 cm applied front panel, a bar handle, two
runners, and a flat-shaded carcass (face normals) so the box edges stay sharp.
The assembly is 1 224 triangles and clears the supports, frame and all four legs.

### Frame and supports

- Frame bevel 0.15 cm, 96 triangles; frame + supports total 696 triangles
  (inside the 400–1 200 frame-assembly target).
- Supports have a 0.15 cm roundover (300 triangles each).

### Materials

| Slot | Material name |
| --- | --- |
| Tabletop | `Desk_Tabletop_Oak` |
| Structure | `Desk_Structure_Steel` |
| Drawer | `Desk_Drawer_Oak` |
| Hardware | `Desk_Hardware_Steel` |

All names are unique, ASCII and space-free. The universal definition carries the
same names, so `buildDesk()` and the `desk.computer` adapter still export
byte-identical GLBs.

## UV and tangents

- Tabletop and frame use box projection for tiled wood/steel detail.
- Beveled parts that degenerated under normal-based box projection (legs, drawer
  front, runners, handle, grommet) use their native face UVs instead. Visible
  panels have **0 degenerate UV triangles**.
- Lathe fasteners converge on a 0.005 cm pole; their cap UVs contain a bounded
  number of degenerate triangles (≤ 40 per fastener). This is recorded as a
  Phase 8B.2 unwrap item, not hidden.
- The product GLB opts into `indexNonIndexedTangents` so every normal-mapped mesh
  carries TANGENT. Without it, the glTF exporter splits two shared materials into
  tangent/no-tangent variants, producing duplicate material names.

## Product fixture

`src/products/premiumOfficeDesk.ts` exposes:

- SKU `3DSA-DESK-PREM-160`, slug `premium-office-desk-160x80x75`;
- one `desk.computer` scene object with `DEFAULT_DESK_SPEC`;
- neutral studio lighting, `#f4f4f6` background, high quality;
- listing title, category, 15 English tags and a description limited to real
  features;
- `authorship: 'procedural'`, `aiGenerated: false`;
- `license`, `price` and `author` left `null` until decided.

Tests prove the scene object, 24 named meshes, exact bounds, floor contact and
byte-identical GLBs from two independent exports.

## Measurement harness

`npm run product:desk` starts the artifact sink and Vite, opens
`tools/product/desk-product.html` in Chromium, and writes:

| File | Contents |
| --- | --- |
| `premium-office-desk.glb` | Desk only, room excluded |
| `preview-hero.png` … `preview-detail.png` | Six 1920 × 1080 captures |
| `product-metrics.json` | Per-part metrics, bounds, GLB summary, SHA-256, preview stats |

The page drives the real `buildSceneObject`, `SceneViewer.captureProductPreviews`
and `exportSceneToGlb`; it does not duplicate the pipeline. Completion is
signalled by `product-metrics.json`, because the viewer keeps a render loop alive
and the browser does not exit by itself. If Chromium is missing the runner exits
with code 2 and writes no placeholder image.

Preview sizes and non-background ratios:

| Angle | Bytes | Non-background |
| --- | ---: | ---: |
| hero | 251 089 | 7.2% |
| front | 170 926 | 5.3% |
| side | 146 358 | 5.5% |
| back | 155 702 | 7.5% |
| top | 359 807 | 17.8% |
| detail | 407 000 | 12.6% |

## Validation

| Check | Result |
| --- | --- |
| `npm test` | **226 files / 3 102 tests PASS** |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS (0 warnings) |
| `npm run build` | PASS |
| `deskParity.test.ts` | PASS, byte-identical legacy vs universal GLB |
| Desk Khronos validator | **0 errors, 0 warnings, 0 infos, 0 hints** |
| Embedded textures | 4 images, 128 × 128 each (65 536 pixels), 0 external URIs |
| Repository GLB validator | PASS |
| Golden regression (eight furniture types) | **37 checks, 0 failures**; 8 Blender-dependent checks NOT VERIFIED |
| Bounding box | 160 × 75 × 80 cm, `min.y = 0` |
| GLB determinism | two independent scene exports share one SHA-256 |
| UV diagnostics | visible panels 0 degenerate; fastener poles bounded |

## Limitations

- Textures are still the 128 × 128 procedural maps (4 images). The export
  request asks for 512 px, but the embedded images report 128 px; this is
  investigated in 8B.2 rather than claimed as fixed.
- Blender is absent in this environment, so Blender import is **NOT VERIFIED**.
- No human professional visual review has been signed off. The six captures prove
  the capture path and distinct angles, not marketplace quality.
- `desk.gaming`, `desk.writing` and `table.dining` share the solver but adapt base
  parts by id. They intentionally use `solveDesk(..., { detail: 'standard' })`
  and keep their previous geometry and golden output. Migrating them is a later
  product decision.
- No FBX, `.blend`, buyer ZIP, listing or marketplace upload is part of this phase.
- The tax and payout questions remain open for the commercial phase.

## Files changed

New:

- `src/products/premiumOfficeDesk.ts`, `index.ts`, `premiumOfficeDesk.test.ts`
- `src/geometry/furniture/desk/solverStandard.ts`
- `tools/product/desk-product.html`, `build.mjs`, `vite.config.mjs`, `README.md`
- `docs/PHASE8B_DESK_GEOMETRY.md`

Changed:

- `src/geometry/furniture/desk/solver.ts` (premium geometry, `detail` option)
- `src/geometry/furniture/desk/builder.ts` (material names)
- `src/geometry/components/{types,recipes,structural,furniture,factory,index}.ts`
  (plate/hole, leg/frame/support bevel, flat-shaded drawer, UV policy)
- `src/geometry/universal/{types,build}.ts`,
  `definitions/deskComputer.ts` (material names, UV propagation)
- `definitions/{deskGaming,deskWriting,tableDining}.ts` (standard detail)
- `src/export/{tangents,sceneExport}.ts` (opt-in tangent indexing)
- `src/viewer/SceneViewer.ts` (disposed guard for the render loop)
- `tools/glb-harness/server.py` (product routes)
- `package.json`, `.gitignore`
- desk, universal, export and viewer tests updated for the new counts and names

## Verdict

**PASS for the 8B.1 scope, with recorded limitations.** The desk now has a clean
24-part, 5 144-triangle construction with a real grommet hole, an accessible
drawer and a professional material structure. Khronos, determinism, parity and
the eight-type golden regression all pass. The product is **not yet
marketplace-ready**: 2K PBR, Blender/FBX, the buyer ZIP, renders and the listing
are the remaining 8B work.
