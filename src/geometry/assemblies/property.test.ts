import { describe, expect, it } from 'vitest';
import { ASSEMBLY_KINDS, type AssemblyKind } from '../../scene/types';
import { buildAssembly } from './index';
import { checkContainment, checkFloorContact, checkNonOverlap, checkWallMount } from './constraints';
import { MAX_PARTS_PER_ASSEMBLY } from './limits';
import {
  assemblyDefaults,
  validateAssemblyParams,
  type AssemblyParams,
} from './params';
import { buildPartGraph } from './graph';
import { partAabb } from './partGraph';

/**
 * W14 property sweep.
 *
 * Deterministic by design: instead of a random property-test generator (which
 * would add a dependency and produce unreproducible failures), this walks a
 * fixed matrix of in-range values per kind. Every combination must produce
 * finite geometry and satisfy the constraints. The matrix is sized so the sweep
 * covers hundreds of combinations yet still runs in milliseconds.
 */
const MATRIX: Record<AssemblyKind, Record<string, number[]>> = {
  'kitchen-base-run': {
    moduleCount: [2, 3, 4],
    moduleWidthCm: [40, 60, 90],
    heightCm: [70, 85, 95],
    depthCm: [45, 65],
    plinthHeightCm: [0, 10, 20],
  },
  'wall-cabinet': {
    widthCm: [40, 80, 120],
    heightCm: [40, 70, 100],
    depthCm: [25, 32, 40],
    doorCount: [1, 2, 3],
    mountHeightCm: [120, 150, 180],
  },
  'wardrobe-section': {
    widthCm: [60, 180, 240],
    heightCm: [150, 220, 260],
    depthCm: [40, 60, 70],
    sectionCount: [1, 2, 4],
    shelfCountPerSection: [0, 3, 6],
    doorCount: [0, 2, 4],
  },
  'stair-straight': {
    stepCount: [6, 12, 16],
    stepWidthCm: [70, 100, 120],
    stepDepthCm: [22, 28, 32],
    riseCm: [15, 17.5, 20],
    stringerThicknessCm: [3, 5, 8],
  },
};

/** Expand the matrix into concrete parameter objects, capped per kind. */
function combinations(kind: AssemblyKind, limit = 400): Array<Partial<AssemblyParams>> {
  const channels = Object.entries(MATRIX[kind]);
  let result: Array<Record<string, number>> = [{}];
  for (const [key, values] of channels) {
    const next: Array<Record<string, number>> = [];
    for (const base of result) {
      for (const value of values) {
        next.push({ ...base, [key]: value });
        if (next.length >= limit) break;
      }
      if (next.length >= limit) break;
    }
    result = next;
  }
  return result;
}

describe('W14 property sweep', () => {
  for (const kind of ASSEMBLY_KINDS) {
    it(`${kind}: every in-range combination builds finite, consistent geometry`, () => {
      const combos = combinations(kind);
      expect(combos.length).toBeGreaterThan(10);

      for (const combo of combos) {
        const params = validateAssemblyParams(kind, combo);
        // Every value in the matrix is inside its declared range.
        expect(params, `${kind} ${JSON.stringify(combo)}`).not.toBeNull();
        if (!params) continue;

        const nodes = buildPartGraph(kind, params as never);
        expect(nodes.length).toBeLessThanOrEqual(MAX_PARTS_PER_ASSEMBLY);
        expect(new Set(nodes.map((node) => node.id)).size).toBe(nodes.length);

        for (const node of nodes) {
          expect(Number.isFinite(node.offset[0]), node.id).toBe(true);
          expect(Number.isFinite(node.offset[1]), node.id).toBe(true);
          expect(Number.isFinite(node.offset[2]), node.id).toBe(true);
          expect(node.size[0], node.id).toBeGreaterThan(0);
          expect(node.size[1], node.id).toBeGreaterThan(0);
          expect(node.size[2], node.id).toBeGreaterThan(0);

          const box = partAabb(nodes, node);
          for (let axis = 0; axis < 3; axis += 1) {
            expect(Number.isFinite(box.min[axis]), node.id).toBe(true);
            expect(Number.isFinite(box.max[axis]), node.id).toBe(true);
          }
        }

        expect(checkContainment(nodes), `${kind} containment ${JSON.stringify(combo)}`).toEqual([]);
        expect(checkNonOverlap(nodes), `${kind} overlap ${JSON.stringify(combo)}`).toEqual([]);

        if (kind !== 'wall-cabinet') {
          expect(checkFloorContact(nodes), `${kind} floor ${JSON.stringify(combo)}`).toEqual([]);
        } else {
          expect(
            checkWallMount(nodes, (params as { mountHeightCm: number }).mountHeightCm),
          ).toEqual([]);
        }
      }
    });
  }

  it('covers hundreds of combinations in total', () => {
    const total = ASSEMBLY_KINDS.reduce((sum, kind) => sum + combinations(kind).length, 0);
    expect(total).toBeGreaterThan(200);
  });

  it('builds the largest valid parameters without exceeding the part budget', () => {
    const largest = {
      'kitchen-base-run': { moduleCount: 4, moduleWidthCm: 90 },
      'wall-cabinet': { doorCount: 3, widthCm: 120 },
      'wardrobe-section': { sectionCount: 4, shelfCountPerSection: 6, doorCount: 4 },
      'stair-straight': { stepCount: 16 },
    } as const;

    for (const kind of ASSEMBLY_KINDS) {
      const params = validateAssemblyParams(kind, {
        ...assemblyDefaults(kind),
        ...largest[kind],
      });
      expect(params, kind).not.toBeNull();
      if (!params) continue;
      const nodes = buildPartGraph(kind, params as never);
      expect(nodes.length, kind).toBeLessThanOrEqual(MAX_PARTS_PER_ASSEMBLY);
      // And the builder agrees it is buildable.
      expect(() => buildAssembly(kind, params as never).dispose(), kind).not.toThrow();
    }
  });
});

describe('W14 performance smoke (Node timing, NOT a 60 FPS measurement)', () => {
  it('builds and disposes 500+ parts within the CI budget', () => {
    // The largest wardrobe is 32 parts; 16 of them is 512 parts. This proves the
    // code path does not degrade pathologically in Node. It says nothing about
    // rendering frame rate — that requires a real browser (plan D11, AC-12).
    const params = validateAssemblyParams('wardrobe-section', {
      sectionCount: 4,
      shelfCountPerSection: 6,
      doorCount: 4,
    });
    expect(params).not.toBeNull();
    if (!params) return;

    const started = performance.now();
    let parts = 0;
    for (let index = 0; index < 16; index += 1) {
      const built = buildAssembly('wardrobe-section', params);
      built.group.traverse((object) => {
        const mesh = object as { isMesh?: boolean };
        if (mesh.isMesh) {
          parts += 1;
        }
      });
      built.dispose();
    }
    const elapsed = performance.now() - started;

    expect(parts).toBeGreaterThanOrEqual(500);
    expect(elapsed).toBeLessThan(8000);
  });
});
