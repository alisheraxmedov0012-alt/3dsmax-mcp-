# W14 — Browser performance report

> **Status: NOT MEASURED.**
>
> No 60 FPS figure has been produced for W14. The acceptance criterion AC-12
> (500 parts at ≥ 60 FPS) is therefore **NOT VERIFIED**, and the assembly feature
> must not be described as meeting it.

## Why it has not been measured

`W14_IMPLEMENTATION_PLAN.md` §11 (decision D11) requires a **real browser on a
real GPU** for this number. The implementation environment used for W14 has:

- no GPU and no display device;
- a headless Chromium, which falls back to **SwiftShader** (software rasterisation).

A SwiftShader frame rate is not a GPU frame rate. Reporting it as "60 FPS" would
be a false claim, so this report records no number at all rather than a
misleading one.

The Node timing in `src/geometry/assemblies/property.test.ts` ("builds and
disposes 500+ parts within the CI budget") is a **pathology check**, not a frame
rate. It proves the code path completes; it says nothing about rendering.

## What must be measured, and how

Run this once on a real workstation, then fill in the table below.

### Environment to record

| Field | Value |
|---|---|
| Browser + version | Chrome stable, version: ______ |
| Operating system | ______ |
| CPU | ______ |
| GPU | ______ |
| RAM | ______ |
| Display | 1920 × 1080 |
| Backend | hardware WebGL (`chrome://gpu` reports "Hardware accelerated") |
| Build | `VITE_ASSEMBLY_ENABLED=true npm run build` |
| Commit | ______ |

### Scene to load

500 parts, built from the largest valid assembly parameters:

- 16 × `wardrobe-section` with `sectionCount = 4`, `shelfCountPerSection = 6`,
  `doorCount = 4` → 32 parts each → 512 parts total.

### Procedure

1. Build and serve the production bundle (`npm run preview`).
2. Open the app with the assembly flag enabled.
3. Add the 16 assemblies (or load a scene that contains them).
4. Wait for the scene to settle (no loading indicators, camera still).
5. Record frame times for **10 seconds** while slowly orbiting the scene once.
6. Repeat three times; report the mean and the 5th-percentile FPS.
7. Record `chrome://gpu` showing hardware acceleration is active.

### Thresholds (from plan AC-12)

| Metric | Threshold | Result |
|---|---|---|
| Mean FPS over 10 s | ≥ 60 | ______ |
| 5th-percentile FPS | ≥ 50 | ______ |
| Hardware acceleration active | yes | ______ |
| Repetitions | 3 | ______ |

### Verdict

- [ ] PASS — mean ≥ 60 and p5 ≥ 50 across three runs
- [ ] FAIL — measured, below threshold (state the numbers)
- [ ] NOT MEASURED

**Current verdict: NOT MEASURED.**

## What this means for W14 acceptance

W14 is accepted on every criterion that can be checked automatically (AC-1…AC-11,
AC-13, AC-14). AC-12 remains open and must be closed manually before the feature
is switched on for real users.

If the measured result is below 60 FPS, the plan's rollback path applies: keep
`VITE_ASSEMBLY_ENABLED` unset (the default is off) and re-work the heavy path
(instancing or level-of-detail) before enabling it.

## Related

- `W14_IMPLEMENTATION_PLAN.md` §11 (measurement method), §14 (acceptance criteria)
- `RISK_REGISTER.md` R-04 (500+ part frame rate), W14-R3 (this criterion cannot be
  proven by Node tests)
