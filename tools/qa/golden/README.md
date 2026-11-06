# Golden quality baseline

`quality-baseline.json` records the expected output of the standard harness
scene in `tools/glb-harness/export.html`.

The harness compares:

- actual GLB bytes and mesh/accessor counts parsed from the produced file;
- the application quality-budget metrics from `quality-stats.json`;
- Khronos error/warning counts;
- Blender object/mesh/vertex/triangle/material/image/UV metrics when Blender is
  available.

Geometry, mesh, material and image counts are exact. GLB byte size has a small
tolerance (4 KiB or 2%) so harmless metadata changes do not fail the gate, while
a meaningful geometry or quality regression still does.

`budget.sceneNodes` is measured before the export writer adds the synthetic
metre-scale root; `glb.sceneNodes` therefore includes one additional node. Both
values are recorded so that difference cannot hide a real node-count change.

Update the file deliberately when the fixture or the expected delivery changes:

```bash
BLENDER=/path/to/blender npm run test:quality
# inspect qa-output/quality-report.json and qa-output/model-with-room.glb
# update tools/qa/golden/quality-baseline.json
```

Do not update the baseline just to make a failing run green.
