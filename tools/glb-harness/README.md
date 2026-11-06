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
| `import.html` | Phase 6.2: imports a model through the real `prepareImport` and `ImportedModelStore`, renders it in the real `SceneViewer`, clicks it, moves it, hides it, deletes it and exports all four formats |
| `import.mjs` | Runner for `import.html` |
| `vite.config.mjs` | Serves the pages and exposes the repo root as `@repo`, so the real pipeline is imported, not a copy |

## Running it

The repeatable smoke test (export → GLTFLoader reload → invariants) is:

```bash
npm run test:glb
# or: node tools/glb-harness/roundtrip.mjs
```

It uses Chromium from `PATH` (override with `CHROMIUM=/path/to/chromium`), keeps
all artefacts under `/tmp`, and removes them on success. It is not part of
`npm test` because the software-WebGL export takes about a minute.

The import integration test is separate:

```bash
npm run test:import
# or: node tools/glb-harness/import.mjs
```

It drives a real WebGL context: the model must reach the framebuffer (measured as
a pixel difference against the same scene with the object hidden), a synthetic
click must select it, moving and hiding must change the frame, deleting must empty
the runtime store, three add/delete cycles must not grow the geometry count, and
GLB/OBJ/STL/3MF must all produce bytes. It takes a few seconds.

Two environment notes are baked into the page: `--virtual-time-budget` does not run
`requestAnimationFrame` callbacks, and it virtualises `performance.now()`, so the
page waits with `setTimeout` and does not report timings. Import cost is measured
in `src/import/importPerformance.test.ts`, where the clock is real.

The manual steps below are useful when debugging a failure.

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
