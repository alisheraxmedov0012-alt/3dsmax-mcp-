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

The GLB is build output and is not committed, but the harness that produces it
is: `tools/glb-harness/` (see its README). Short version:

```bash
python tools/glb-harness/server.py --out /tmp/a4-validation &
npx vite --config tools/glb-harness/vite.config.mjs &
chromium --headless=new --no-sandbox --enable-unsafe-swiftshader --use-gl=swiftshader \
  --virtual-time-budget=180000 --dump-dom http://127.0.0.1:5199/export.html

cd backend
python scripts/glb_validate.py /tmp/a4-validation/model-with-room.glb  # exits 1 on any failure
python -m pytest tests/test_glb_validate.py -q                         # validator's own tests
```

Two independent runs, in different directories, produced a **byte-identical**
file: `sha256 15aabce6e1f9b746224a1625013b737181e60c0690f54ba599b39612842bc6ce`,
272 076 bytes both times. Procedural textures are deterministic, so a digest
change between runs means the pipeline changed — which makes the digest usable as
a regression check.


---

## A2–A4 update (2026-10-30)

The pipeline changed after the measurement above (A1 mesh naming, A2 physical UVs),
so the file was exported and validated again. The numbers in the earlier sections
describe the pre-A1 file and are kept as history; the values below are the current
ones.

### How it was measured

```bash
npm run test:glb        # export -> GLTFLoader reload -> invariants: PASS
# manual export for the independent validator
python tools/glb-harness/server.py --out /tmp/a4v &
npx vite --config tools/glb-harness/vite.config.mjs &
chromium --headless=new --no-sandbox --enable-unsafe-swiftshader --use-gl=swiftshader \
  --virtual-time-budget=180000 --dump-dom http://127.0.0.1:5199/export.html
cd backend && python scripts/glb_validate.py /tmp/a4v/model-with-room.glb
```

### Result

| Item | Value |
| --- | --- |
| `model-with-room.glb` | 279 284 bytes |
| SHA-256 | `ce62d15a774459163cd97a5ff6042394d904eccd56f8029dc4d974b014acb5e4` |
| `model-furniture-only.glb` | 270 216 bytes |
| Validator verdict | **PASS**, 0 errors, 0 warnings |
| Structure | 2 chunks, JSON 71 212 bytes, BIN 208 044 bytes |
| Geometry | 64 meshes, 256 accessors, **768 triangles** |
| Materials / textures | 10 materials, 8 textures, 8 embedded PNGs, all 128×128 RGBA |
| glTF version | 2.0, buffer embedded, 0 external URIs |
| GLTFLoader reload | 67 meshes, 10 unique materials, 35 with map, 7 transparent |

The 71 212-byte JSON chunk (up from 64 004) is A1's stable mesh names; the BIN
chunk is byte-for-byte the same size.

### UV evidence (A2)

All 64 primitives carry `TEXCOORD_0`. Spans read from the BIN chunk:

| Part | UV span (u × v) | Physical face |
| --- | --- | --- |
| table top, top face | 2.4 × 1.2 | 120 cm × 60 cm at 50 cm tile |
| table leg, side face | 0.12 × 1.42 | 6 cm × 71 cm |
| wardrobe panel | 4.0 × 1.0 | 200 cm × 50 cm |
| maximum span in the file | 4.0 | 200 cm |

Room meshes keep their original 1.0 × 1.0 `BoxGeometry` UVs. That is intentional:
room materials are plain colour and carry no map, so remapping them would change
bytes without changing a pixel.

### Still not verified

| Item | Status | Reason |
| --- | --- | --- |
| Blender / other DCC import | **NOT VERIFIED** | Not installed |
| Official Khronos `gltf-validator` | **NOT VERIFIED** | Not installed |
| Marketplace acceptance | **NOT VERIFIED** | No marketplace review; textures remain 128×128 procedural bitmaps |
| ORM map | **NOT PRESENT** | Roughness/metalness stay scalar |

The A4 asset package writes its own metadata from this file (`glbSummary`) and
records the SHA-256 in `checksums.txt`; its unit tests verify the archive but are
not a substitute for third-party GLB validation.
