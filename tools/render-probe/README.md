# Phase 5.8 render probe

Repeatable browser harness for the render/export path. It drives the real
`SceneViewer` and the real capture code — no mocked WebGL.

## Run

```bash
npm run dev -- --host 0.0.0.0 --port 12000
```

Open `/tools/render-probe/index.html` (for example
`http://localhost:12000/tools/render-probe/index.html`). The page runs the checks
on load and writes a JSON report below the canvas. Automation can read
`window.__probeResult` or `document.body.dataset.probeStatus`.

## Checks

| Check | What it proves |
| --- | --- |
| viewer smoke | the viewer produced draw calls and triangles |
| FHD capture | 1920×1080 PNG with a valid signature and size |
| 4K capture | 3840×2160 PNG, or a clear size error on a smaller GPU |
| alpha probe | corner pixels are transparent on a real transparent capture |
| transparent PNG | the encoded PNG keeps alpha 0 at its corners |
| 6-angle ZIP | progress is 1/6…6/6 and one ZIP is produced |
| ZIP contents | exactly the six canonical PNG names, each valid |
| repeated export | geometry/texture counters do not grow after repeated captures |
| context loss | capture throws `CaptureError('context-lost')` |
| context restore | the viewer captures again after `webglcontextrestored` |

## Honesty note

Headless Chromium normally falls back to **SwiftShader** (software rasterisation).
The durations and memory counters show whether the code path works and leaks; they
are **not** a GPU performance benchmark and must not be reported as one.
