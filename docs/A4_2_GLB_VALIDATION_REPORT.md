# A4.2 — GLB export validation report

Scope: prove what the `.glb` export actually contains, from the file itself, so
the A4.1 capability declaration is backed by evidence and not by a test stub.

This report records a measurement, not a promise. Everything below was read out
of a real `.glb` produced by the shipped pipeline.

**Result: PASS** for every check that a tool in this environment could perform.
Blender and the official Khronos validator were **not available**, so those two
checks remain **NOT VERIFIED** — see [What was not verified](#what-was-not-verified).

## Method

1. `exportSceneToGlb` from `src/export/sceneExport.ts` was called in **headless
   Chromium** (`/usr/bin/chromium --headless=new`, WebGL 2.0 via SwiftShader),
   so the textures came from a real 2D canvas.
   A `jsdom` canvas stub was **not** used: that stub returns a 1×1 PNG, which is
   a placeholder and would prove nothing about texture content.
2. The scene held all eight `FURNITURE_TYPES`, each with a real PBR preset
   (`wood-oak`, `metal-steel`, `fabric-linen`, `leather-brown`, `glass-clear`,
   `plastic-white`, `painted-red`), plus the room.
3. The resulting bytes were validated twice, by two independent readers:
   - `backend/scripts/glb_validate.py` (this repo, stdlib only, shares no code
     with three.js);
   - a throwaway audit script using `struct`/`zlib` only.
4. The file was then re-parsed with `GLTFLoader.parse` and rendered, and the
   framebuffer was read back with `gl.readPixels` to confirm it draws content.

## Artifacts

Produced outside the repository (build output, regenerable — not committed):

| File | Bytes | SHA-256 (first 16) |
| --- | --- | --- |
| `model-with-room.glb` | 272 076 | `15aabce6e1f9b746` |
| `model-furniture-only.glb` | 263 128 | `f140598c2f8f2d41` |
| `render-with-room.png` | 48 020 | 1280×720 screenshot |

Header bytes of `model-with-room.glb`:
`67 6c 54 46` (`glTF`) · `02 00 00 00` (version 2) · `cc 26 04 00` (272 076).

## Structure

| Check | Result | Detail |
| --- | --- | --- |
| GLB magic | PASS | `0x46546C67` |
| GLB version | PASS | `2` |
| Declared length equals file size | PASS | `272076 == 272076` (both files) |
| Chunk alignment, no trailing bytes | PASS | 2 chunks |
| JSON chunk | PASS | 64 004 bytes, parses |
| BIN chunk | PASS | 208 044 bytes |
| `asset.version` | PASS | `2.0` |
| Buffer embedded, no external `uri` | PASS | 0 external URIs |
| bufferViews inside BIN | PASS | 264 / 264 |
| Accessors fit their bufferViews | PASS | 256 / 256 |
| Mesh primitives reference valid data | PASS | 64 meshes, **768 triangles** |
| Textures reference images | PASS | 8 / 8 |

## Textures

8 images, 8 textures. Every image is an embedded `image/png`, **128×128 RGBA**
(colour type 6), and every PNG chunk CRC was verified.

| # | Size | Bytes | Distinct byte values |
| --- | --- | --- | --- |
| 0 | 128×128 | 11 840 | 256 |
| 1 | 128×128 | 24 480 | 256 |
| 2 | 128×128 | 16 316 | 256 |
| 3 | 128×128 | 27 884 | 256 |
| 4 | 128×128 | 1 772 | 241 |
| 5 | 128×128 | 1 416 | 245 |
| 6 | 128×128 | 21 836 | 256 |
| 7 | 128×128 | 48 740 | 256 |

None is 1×1, and the byte spread is high — these are real procedural bitmaps,
not placeholder data. The validator fails an image whose width and height are
both ≤ 1 for exactly that reason.

## Materials

| Material | baseColorTexture | normalTexture | metallic | roughness | alphaMode |
| --- | --- | --- | --- | --- | --- |
| `table-material` | 0 | 1 | 0.05 | 0.6 | OPAQUE |
| `chair-material` | 2 | 3 | 0.05 | 0.6 | OPAQUE |
| `armchair-material` | 4 | 5 | 0.05 | 0.6 | OPAQUE |
| `sofa-material` | 6 | 7 | 0.05 | 0.6 | OPAQUE |
| `bed-material` (glass preset) | — | — | 0.0 | 0.05 | **BLEND** |
| `wardrobe-material` | — | — | 0.05 | 0.6 | OPAQUE |
| `shelf-material` | — | — | 0.05 | 0.6 | OPAQUE |
| `dresser-material` | 0 (shared) | 1 | 0.05 | 0.6 | OPAQUE |
| room materials (2) | — | — | 0.0 | 0.95 / 0.9 | OPAQUE |

Observations:

- `alphaMode: BLEND` appears on the glass material, and glass carries no invented
  texture — the exporter's intended behaviour.
- Textures are **shared** between objects (`dresser` reuses `image[0..1]`): eight
  textures for eight objects, not sixteen.
- Roughness and metalness are scalar factors; there is **no ORM map**, which is
  what the A4.1 notes state.
- Node names survive: `room-floor`, `table-top`, `table-leg-1`, `object:obj-table`.

## Visual check

Re-parsed with `GLTFLoader.parse` and rendered in headless Chromium:

```
parse=OK scenes=1
reload meshes=67 uniqueMaterials=10 withMap=35 transparent=7
bbox=840x284x508
render=OK gl=WebGL 2.0
pixels uniqueColours=1046 nonBackground=6.3%
```

The screenshot was decoded with the standard library (1280×720 RGB): **1 289
distinct colours**, background `rgb(20,22,28)` at 88.4%, **11.6% non-background**
pixels, wood tone `rgb(87,60,36)` present. The frame is not empty.

`GLTFLoader` belongs to the three.js ecosystem. It is an independent *parse path*
from the exporter, but not an independent implementation, so it is supporting
evidence rather than third-party confirmation.

## What was not verified

| Item | Status | Reason |
| --- | --- | --- |
| Opening the file in Blender (or another DCC) | **NOT VERIFIED** | Not installed; not installed on purpose |
| Official Khronos `gltf-validator` | **NOT VERIFIED** | Not installed; `gltf_validator`, `gltflib`, `pygltflib` all absent |
| Marketplace acceptance of the textures | **NOT VERIFIED** | 128×128 procedural maps are below typical product quality; no marketplace review was done |
| ORM (occlusion/roughness/metalness) map | **NOT PRESENT** | Not produced by the pipeline; roughness/metalness stay scalar |

A correct JSON structure is **not** evidence of external compatibility. Those rows
stay open until a real third-party tool checks the file.

## Reproducing

The GLB is build output and is not committed. To regenerate and check it:

```bash
cd backend
python -m pytest tests/test_glb_validate.py -q      # validator's own tests
python scripts/glb_validate.py path/to/model.glb    # exits 1 on any failure
```

The exporter needs a browser (canvas + `GLTFExporter`), so producing the file is
a manual or harness step; the validator itself needs only Python.
