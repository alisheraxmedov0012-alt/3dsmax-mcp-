import { describe, expect, it } from 'vitest';
import {
  findAxisAlignedOverlaps,
  planPartAabb,
  type PlanPart,
} from './index';

function part(overrides: Partial<PlanPart> = {}): PlanPart {
  return {
    id: 'p1',
    type: 'support',
    role: 'support',
    dimensions: { width: 10, height: 10, depth: 10 },
    geometry: { kind: 'box', width: 10, height: 10, depth: 10 },
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    materialSlot: 'main',
    ...overrides,
  };
}

describe('axis-aligned collision helper', () => {
  it('computes an AABB for an unrotated part', () => {
    expect(planPartAabb(part())).toEqual({
      min: [-5, -5, -5],
      max: [5, 5, 5],
    });
  });

  it('returns null for a rotated part instead of a false verdict', () => {
    expect(planPartAabb(part({ rotation: [90, 0, 0] }))).toBeNull();
  });

  it('detects overlapping unrotated parts', () => {
    const overlaps = findAxisAlignedOverlaps([
      part({ id: 'a' }),
      part({ id: 'b', position: [4, 0, 0] }),
    ]);
    expect(overlaps).toEqual([{ aId: 'a', bId: 'b' }]);
  });

  it('allows parts that only touch and excludes rotated parts', () => {
    expect(
      findAxisAlignedOverlaps([
        part({ id: 'a' }),
        part({ id: 'b', position: [10, 0, 0] }),
      ]),
    ).toEqual([]);
    expect(
      findAxisAlignedOverlaps([
        part({ id: 'a' }),
        part({ id: 'b', position: [4, 0, 0], rotation: [0, 45, 0] }),
      ]),
    ).toEqual([]);
  });
});
