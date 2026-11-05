# Phase 5.7–5.8 — render performance and resource audit

> **Environment:** headless Chromium 155 on Linux, **no GPU** (SwiftShader software
> rasterisation), `maxTextureSize = 8192`, viewport canvas 800×450.
>
> The numbers below prove the code path and expose leaks. They are **not** GPU
> performance figures and must not be quoted as such.

## 1. Browser probe results

Harness: `tools/render-probe/` (open `/tools/render-probe/index.html` through the
Vite dev server). Last run: **pass**, 1 skip.

| Check | Result | Detail |
| --- | --- | --- |
| Viewer smoke | pass | 120 triangles, 11 draw calls, maxTextureSize 8192 |
| FHD 1920×1080 capture | pass | 101 KB, 2.09 s |
| 4K UHD 3840×2160 capture | pass | 0.3 MB, 2.44 s |
| Capture failure recovery | pass | invalid 5000 px rejected; next capture returned 23 KB, 1.13 s |
| Transparent alpha probe | pass | corner alpha `0,0,0,0` (6 ms) |
| Transparent single PNG | pass | encoded PNG corner alpha `0,0,0,0`, 1.85 s |
| 6-angle transparent ZIP | pass | progress `1/6` … `6/6`, 0.3 MB, 10.4 s |
| ZIP contents | pass | six canonical names, valid PNGs, hero alpha `0,0,0,0` |
| Repeated export lifecycle | pass | geometries `10→10`, textures `3→3` over 3 exports |
| Context loss during capture | pass | `CaptureError('context-lost')` in 13 ms |
| Context restore | **skip** | headless build never fires `webglcontextrestored` |

Total probe duration: 38.9 s. All capture timings are software rendering; a real
GPU should be far faster, but that has not been measured here.

### Why context restore is a skip

`WEBGL_lose_context.loseContext()` works in the headless build, and the viewer
correctly refuses to capture. `restoreContext()` does not produce a
`webglcontextrestored` event in this Chromium/SwiftShader configuration within 4 s.
The restore handler is therefore unit-tested at the `EnvironmentManager` level
(PMREM is regenerated after context loss) and the UI offers a manual page reload.
It has **not** been verified end-to-end on a real GPU browser.

## 2. Renderer counters

| Point | Geometries | Textures | Programs |
| --- | --- | --- | --- |
| After first frame | 8 | 3 | 4 |
| After all exports | 10 | 3 | 8 |
| Three repeated opaque/transparent exports | 10 → 10 | 3 → 3 | — |

The one-time `8 → 10` is the lazy `OutputPass` fullscreen quad plus its helper
geometry on the first capture. It does not grow per export. Programs rise after
context loss because shader programs are GPU-only and are rebuilt; that is
expected once, not a per-export leak.

## 3. Resource lifecycle audit

| Resource | Owner | Release path | Finding |
| --- | --- | --- | --- |
| Scene geometries/materials | `SceneViewer.objects` | `disposeObjectEntry` on remove/replace and `dispose()` | OK |
| Room geometry/materials | `SceneViewer.room` | keyed rebuild + `dispose()` | OK |
| PMREM target | `EnvironmentManager` | `releaseTarget`, `dispose`, `resetAfterContextLoss` | OK; reused for intensity changes |
| RoomEnvironment + PMREM generator | `EnvironmentManager` | `dispose`, `resetAfterContextLoss` | OK |
| Shadow map | key light | disposed on quality/shadow change and `dispose()`; nulled after context loss | OK |
| Capture HDR + output targets | `renderCapturePixels` | `temporaryTargets` disposed in `finally` | OK |
| Capture pixel buffer | local | GC after encode | OK for FHD; 33 MB each at 4K |
| OutputPass | `SceneViewer` | reused, disposed in `dispose()` and after context loss | OK |
| Selection BoxHelper | `SceneViewer` | **updated in place**; recreated only when the target object changes; disposed when deselected | Fixed in Phase 5.8 |
| Blob/Object URL | `downloadBlob` | URL revoked on the next tick; single ZIP blob per batch | OK |
| Viewer RAF | `SceneViewer` | cancelled in `dispose()`; skips render while context is lost | OK |

### Selection helper fix

Before: every `setScene()` removed, disposed and recreated the `BoxHelper`
(geometry + material) even when only a parameter value changed.

After: `selectionHelperAction()` decides `none / create / update / recreate /
dispose`. The same target instance is updated with `setFromObject`; a new target
(or a rebuilt object group) recreates it. Unit-tested in
`src/viewer/selectionHelper.test.ts`.

## 4. Memory risks that remain

1. **4K capture**: one frame needs an HDR half-float target (~66 MB), an RGBA
   output target (~33 MB), a readback buffer (~33 MB) and a 2D canvas (~33 MB)
   before PNG compression. Peak is roughly 170 MB for one 4K still.
2. **4K batch ZIP**: six encoded PNGs are held as byte arrays and `zipSync`
   creates a second compressed copy. Peak is roughly twice the total image bytes.
   A streaming ZIP writer would reduce this, but `fflate`'s synchronous API is what
   the existing asset package uses; the trade-off is documented rather than hidden.
3. **SwiftShader**: software rendering makes large captures 2–11 s and is not
   representative of user hardware.

## 5. Bundle size (production build)

| Asset | Raw | Gzip |
| --- | --- | --- |
| `index-*.css` | 30.00 kB | 5.85 kB |
| `index-*.js` (app shell) | 504.79 kB | 155.72 kB |
| `ViewerCanvas-*.js` (three.js viewer) | 409.50 kB | 99.99 kB |
| `three.core-*.js` | 226.06 kB | 61.92 kB |
| `productPreviewViews-*.js` | 220.41 kB | 48.21 kB |
| `ManufacturingPanel-*.js` | 114.59 kB | 35.50 kB |
| `pdfDocument-*.js` (lazy) | 1,229.24 kB | 557.01 kB |

No new runtime dependency was added for Phase 5.7/5.8. The probe uses
`fflate`, already present for the asset package. Probe files are under `tools/`
and are not part of the app bundle.

## 6. How to reproduce

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:glb
npm run dev -- --host 0.0.0.0 --port 12000
# open /tools/render-probe/index.html
```

The probe prints a JSON report and sets `document.body.dataset.probeStatus` to
`pass` or `fail`.

## 7. Final QA (Phase 5.7 + 5.8)

| Command | Result |
| --- | --- |
| `npm test` | 201 files, **2716 tests pass** (baseline 2669) |
| `npm run typecheck` | pass |
| `npm run lint` | 0 errors; only the pre-existing warnings |
| `npm run build` | pass |
| `npm run test:glb` | PASS (`reloadMeshes: 67`, `materials: 10`) |
| Browser probe | pass, 1 skip (headless context restore) |
