# Premium Desk product harness

Produces the first marketplace artifact from the shipped pipeline:

```bash
CHROMIUM=/path/to/chromium npm run product:desk
```

Output (`product-output/`, git-ignored):

| File | Meaning |
| --- | --- |
| `premium-office-desk.glb` | Desk only, room excluded, metre-scale GLB |
| `preview-hero.png` … `preview-detail.png` | Six canonical 1920×1080 shots |
| `product-metrics.json` | Per-part triangles/vertices/bounds, GLB summary, SHA-256, preview stats |

The page (`desk-product.html`) imports `PREMIUM_DESK_PRODUCT` and drives the
real `buildSceneObject`, `SceneViewer.captureProductPreviews()` and
`exportSceneToGlb()`. It does not build a private copy of the desk.

## What this proves and what it does not

Proves: the product object builds deterministically, exports through the shipped
GLB path, and the real viewer can capture six different angles at 1920×1080.

Does not prove: professional visual quality, 2K PBR textures, Blender import,
FBX/`.blend` delivery or marketplace readiness. Those are Phase 8B.2–8B.4.
Textures are still the 128/512 px procedural maps.

If Chromium or WebGL is unavailable the runner exits with code 2 and prints
`NOT VERIFIED`; it never writes a placeholder image.

## Ports

The harness uses 5401 for the Python artifact sink and 5299 for Vite, so it can
run beside `npm run test:glb` (5300/5199).
