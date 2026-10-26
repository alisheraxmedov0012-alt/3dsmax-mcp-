# GLB harness

Produces a real `.glb` from the shipped export pipeline and checks it, without
adding a dependency to the project. Needed because the exporter requires a
browser (canvas, WebGL, `GLTFExporter`); a Node test can only reach it through a
`jsdom` canvas stub, whose PNG is 1×1 and therefore not evidence of a texture.

## What is here

| File | Role |
| --- | --- |
| `export.html` | Builds a scene of all eight furniture types with real PBR presets and calls `exportSceneToGlb` |
| `viewer.html` | Re-parses the result with `GLTFLoader`, renders it, reads the framebuffer back |
| `server.py` | Stdlib HTTP sink that receives the artefacts (and serves them back to the viewer) |
| `vite.config.mjs` | Serves the pages and exposes the repo root as `@repo`, so the real pipeline is imported, not a copy |

## Running it

Requires Chromium on the machine and `npm ci` already done at the repo root.

```bash
# 1. collect artefacts into a scratch directory
python tools/glb-harness/server.py --out /tmp/a4-validation &

# 2. serve the harness (from the repository root)
npx vite --config tools/glb-harness/vite.config.mjs &

# 3. export
chromium --headless=new --no-sandbox --enable-unsafe-swiftshader --use-gl=swiftshader \
  --virtual-time-budget=180000 --dump-dom http://127.0.0.1:5199/export.html

# 4. optional: reopen and render the result
chromium --headless=new --no-sandbox --enable-unsafe-swiftshader --use-gl=swiftshader \
  --window-size=1280,720 --virtual-time-budget=60000 \
  --screenshot=/tmp/a4-validation/render.png --dump-dom http://127.0.0.1:5199/viewer.html

# 5. validate the bytes
cd backend && python scripts/glb_validate.py /tmp/a4-validation/model-with-room.glb
```

Stop the two background processes when done.

## Reproducibility

Two independent runs, in different directories, produced a byte-identical file:
`sha256 15aabce6e1f9b746224a1625013b737181e60c0690f54ba599b39612842bc6ce`,
272 076 bytes. Procedural texture generation is deterministic, so a digest change
between runs means the pipeline changed.

## Limits

- `viewer.html` uses `GLTFLoader`, which belongs to the three.js ecosystem. It is
  an independent parse path from the exporter, not an independent implementation.
- Neither page constitutes third-party compatibility testing. Blender and the
  official Khronos `gltf-validator` are still **NOT VERIFIED** — see
  `docs/A4_2_GLB_VALIDATION_REPORT.md`.
