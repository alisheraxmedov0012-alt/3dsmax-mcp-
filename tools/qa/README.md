# 3D quality harness

Local-first quality gate for exported 3D models. It answers one question from
evidence: does the GLB this pipeline produces survive independent validation and
a real DCC import?

The harness does not generate geometry itself. It drives the existing
`tools/glb-harness/export.html` page, then validates the resulting bytes with:

1. `backend/scripts/glb_validate.py` — the repository's stdlib-only validator.
2. `gltf-validator` — the official Khronos validator, pinned in `package.json`.
3. The application's export quality budget, measured on the same scene and
   re-checked against the produced GLB's exact size and image payload.
4. Blender in background mode — only when a Blender executable is available.

Results are written as machine-readable JSON and a human-readable Markdown
report. Blender is never assumed: if it is absent, that section is
`NOT VERIFIED`, not `PASS`.

## Commands

```bash
npm run test:quality
```

Options:

```text
--glb <path>    Validate an existing GLB instead of exporting a new one.
--out <dir>     Report directory (default: qa-output).
--no-blender    Skip Blender even when it is installed.
--golden        Compare against the golden baseline (default for harness exports).
--no-golden     Disable golden comparison.
-h, --help      Show usage.
```

Environment:

| Variable | Purpose |
| --- | --- |
| `CHROMIUM` | Chromium/Chrome executable for the export harness. |
| `BLENDER` | Blender executable. If absent, `blender` from `PATH` is used. |
| `QA_PYTHON` | Python executable. If absent, `python3` or `python` is used. |

## Output

```text
qa-output/
  model-with-room.glb       # generated GLB (ignored by git)
  model-furniture-only.glb  # second artifact from the same export
  quality-stats.json        # application budget result for the generated scene
  quality-report.json
  quality-report.md
```

`qa-output/` is in `.gitignore`. The JSON report has `schemaVersion: 1` and
records every validator's status, counts, issue codes and messages. The Markdown
report summarizes the same data.

## Status and exit codes

| Status | Meaning | Exit |
| --- | --- | --- |
| `PASS` | Every mandatory check passed. Blender may still be `NOT VERIFIED`. | 0 |
| `FAIL` | A mandatory check failed, or an installed Blender failed to import. | 1 |
| `NOT VERIFIED` | A mandatory validator could not run. This is not a green result. | 2 |

Mandatory components are the GLB export/input, the repository validator and the
Khronos validator. A quality-budget `BLOCK` fails the run; a budget `WARNING`
passes and records its checks. Blender is optional; its absence does not fail the
run, but it is reported explicitly and listed in the limitations.

Khronos warnings alone do not fail the run. The current baseline has 0 errors and
0 warnings; the remaining 32 `UNUSED_OBJECT` entries are info-level. Budget
results and validator messages are both recorded without being suppressed.

## Requirements

- Node.js and `npm ci` at the repository root.
- Chromium (or Chrome) for the export step. `npm run test:glb` already needs it.
- Python 3 for `backend/scripts/glb_validate.py` (standard library only).
- Blender 4.2 LTS or newer for the external import check (optional).

The harness never downloads anything during a run. The Khronos validator is an
installed devDependency; Blender is only used if it is already present.

## Golden regression

The standard export is compared with
`tools/qa/golden/quality-baseline.json`. Geometry, mesh, material and image
counts are exact; GLB byte size has a 4 KiB / 2% tolerance. The baseline is
versioned and must only be updated deliberately — see
`tools/qa/golden/README.md`.

### Installing Blender

A portable Linux build is enough; no system package is required:

```bash
curl -L -o /tmp/blender.tar.xz \
  https://download.blender.org/release/Blender4.2/blender-4.2.9-linux-x64.tar.xz
tar -xJf /tmp/blender.tar.xz -C /tmp
BLENDER=/tmp/blender-4.2.9-linux-x64/blender npm run test:quality
```

For a system install, put `blender` on `PATH` or set `BLENDER`. The inspection
script is `tools/qa/blender-import.py` and can be run directly:

```bash
blender --background --factory-startup \
  --python tools/qa/blender-import.py -- qa-output/model-with-room.glb
```

It prints one `QA_BLENDER_JSON:` line with objects, meshes, triangle/vertex
counts, materials, images, UV layers, missing normals, zero-area polygons and the
world-space bounding box.

## Interior parity harness (Phase 9A.2.8)

The interior harness reuses the same browser export path, then adds a Blender
parity and visual pass for the opt-in room fixtures.

```bash
npm run test:interior
```

Options:

```text
--out <dir>       Report directory (default: qa-output/interior-parity).
--no-blender      Skip Blender; parity and renders are NOT VERIFIED.
--no-render       Run metric/ray parity without Cycles renders.
--fixtures <ids>  Comma-separated fixture ids (room-only, furniture-room, multi-room, hidden-room).
```

Fixtures and their expected bounds, trim counts, material tiles and opening rays
live in `src/qa/interiorFixtures.ts` and are asserted by
`src/qa/interiorFixtures.test.ts`. The browser page is
`tools/glb-harness/rooms.html`; the Blender script is
`tools/qa/interior-blender.py`.

Output:

```text
qa-output/interior-parity/
  interior/<fixture>.glb          # exported by the real browser pipeline
  interior/<fixture>.blender.json # Blender metrics, checks, ray casts
  interior-report.json
  interior-report.md
  renders/<fixture>/*.png         # overview, front, side, top, opening, trim, furniture
```

The Blender pass measures mesh/vertex/triangle counts, bounds, materials, images,
UV finiteness/mirroring, derived texel density, room transforms, trim counts and
casts wall-only rays through the door and window openings. GLB counts and Blender
counts must agree exactly. A missing Blender binary is recorded as `NOT VERIFIED`
and never as `PASS`.

For this phase the portable Blender 4.5.9 LTS Linux build was verified against
the official SHA-256 before use:

```bash
curl -LO https://download.blender.org/release/Blender4.5/blender-4.5.9-linux-x64.tar.xz
curl -LO https://download.blender.org/release/Blender4.5/blender-4.5.9.sha256
grep 'linux-x64.tar.xz' blender-4.5.9.sha256 | sha256sum -c -
tar -xf blender-4.5.9-linux-x64.tar.xz -C /tmp
BLENDER=/tmp/blender-4.5.9-linux-x64/blender npm run test:interior
```

## Interaction smoke (Phase 9A.2.9)

The viewer interaction path runs in a real headless Chromium with WebGL:

```bash
npm run test:interaction
```

`tools/glb-harness/interaction.html` loads the real `SceneViewer`, selects an
opt-in room, switches to the move gizmo, commits a simulated drag, then checks
the furniture and hidden-room branches. Results are written to
`qa-output/interaction-smoke.json`. This is a smoke test, not a replacement for
the pure unit tests in `src/viewer/selection.test.ts` and
`src/viewer/transformCommit.test.ts`.

## CI

The harness is not wired into the existing CI jobs. It needs Chromium, Python and
(optionally) Blender, and the task that introduced it explicitly prohibited
automatic binary downloads during ordinary CI. Run it locally before a release,
or add a dedicated job once the runner image and Blender provisioning are
decided.
