import { describe, expect, it } from 'vitest';
import type { PartNode } from './partGraph';
import {
  TOLERANCE_CM,
  checkAdjacency,
  checkAxisRange,
  checkContainment,
  checkDerivedSum,
  checkFloorContact,
  checkNonOverlap,
  checkWallMount,
  validateGraph,
} from './constraints';

function node(overrides: Partial<PartNode> & Pick<PartNode, 'id' | 'size'>): PartNode {
  return {
    role: 'shelf',
    parentId: null,
    offset: [0, 0, 0],
    ...overrides,
  };
}

describe('W14 constraints', () => {
  describe('containment', () => {
    it('accepts a shelf inside its corpus', () => {
      const nodes = [
        node({ id: 'corpus', role: 'corpus', size: [100, 200, 50] }),
        node({ id: 'shelf', parentId: 'corpus', size: [96, 2, 46] }),
      ];
      expect(checkContainment(nodes)).toEqual([]);
    });

    it('rejects a shelf that sticks out of the corpus', () => {
      const nodes = [
        node({ id: 'corpus', role: 'corpus', size: [100, 200, 50] }),
        node({ id: 'shelf', parentId: 'corpus', size: [120, 2, 46] }),
      ];
      const violations = checkContainment(nodes);
      expect(violations).toHaveLength(1);
      expect(violations[0].code).toBe('containment');
      expect(violations[0].partIds).toEqual(['shelf', 'corpus']);
    });

    it('excludes door and drawer fronts from strict containment', () => {
      const nodes = [
        node({ id: 'corpus', role: 'corpus', size: [100, 200, 50] }),
        node({
          id: 'door',
          role: 'door',
          parentId: 'corpus',
          size: [48, 190, 2],
          offset: [0, 0, 26],
        }),
      ];
      expect(checkContainment(nodes)).toEqual([]);
    });

    it('reports an orphan part', () => {
      const nodes = [node({ id: 'x', parentId: 'missing', size: [10, 10, 10] })];
      const violations = checkContainment(nodes);
      expect(violations).toHaveLength(1);
      expect(violations[0].code).toBe('containment');
    });
  });

  describe('non-overlap', () => {
    it('accepts a shelf inside its corpus (ancestor, not an overlap)', () => {
      const nodes = [
        node({ id: 'corpus', role: 'corpus', size: [100, 200, 50] }),
        node({ id: 'shelf', parentId: 'corpus', size: [96, 2, 46] }),
      ];
      expect(checkNonOverlap(nodes)).toEqual([]);
    });

    it('rejects two siblings sharing the same space', () => {
      const nodes = [
        node({ id: 'a', size: [50, 50, 50], offset: [0, 0, 0] }),
        node({ id: 'b', size: [50, 50, 50], offset: [0, 0, 0] }),
      ];
      const violations = checkNonOverlap(nodes);
      expect(violations).toHaveLength(1);
      expect(violations[0].code).toBe('non_overlap');
      expect(violations[0].partIds).toEqual(['a', 'b']);
    });

    it('allows parts that merely touch', () => {
      const nodes = [
        node({ id: 'a', size: [50, 50, 50], offset: [-25, 0, 0] }),
        node({ id: 'b', size: [50, 50, 50], offset: [25, 0, 0] }),
      ];
      expect(checkNonOverlap(nodes)).toEqual([]);
    });

    it('ignores door fronts touching the corpus face', () => {
      const nodes = [
        node({ id: 'corpus', role: 'corpus', size: [100, 200, 50] }),
        node({ id: 'door', role: 'door', size: [98, 198, 2], offset: [0, 0, 26] }),
      ];
      expect(checkNonOverlap(nodes)).toEqual([]);
    });
  });

  describe('adjacency', () => {
    it('accepts modules placed edge to edge', () => {
      const nodes = [
        node({ id: 'm1', size: [60, 85, 60], offset: [-30, 0, 0] }),
        node({ id: 'm2', size: [60, 85, 60], offset: [30, 0, 0] }),
      ];
      expect(checkAdjacency(nodes, 'm1', 'm2', 0)).toEqual([]);
    });

    it('reports a gap between modules', () => {
      const nodes = [
        node({ id: 'm1', size: [60, 85, 60], offset: [-40, 0, 0] }),
        node({ id: 'm2', size: [60, 85, 60], offset: [40, 0, 0] }),
      ];
      const violations = checkAdjacency(nodes, 'm1', 'm2', 0);
      expect(violations).toHaveLength(1);
      expect(violations[0].code).toBe('adjacency');
      expect(violations[0].message).toContain('20.00');
    });

    it('reports a missing part', () => {
      const nodes = [node({ id: 'm1', size: [60, 85, 60] })];
      expect(checkAdjacency(nodes, 'm1', 'nope', 0)[0].code).toBe('adjacency');
    });
  });

  describe('axis-range', () => {
    it('accepts a value inside the range', () => {
      expect(checkAxisRange(17, 15, 20, 'Rise')).toEqual([]);
    });

    it('rejects a value outside the range and a non-finite value', () => {
      expect(checkAxisRange(21, 15, 20, 'Rise')[0].code).toBe('axis_range');
      expect(checkAxisRange(Number.NaN, 15, 20, 'Rise')[0].code).toBe('axis_range');
      expect(checkAxisRange(Infinity, 15, 20, 'Rise')[0].code).toBe('axis_range');
    });
  });

  describe('derived-sum', () => {
    it('accepts an exact total', () => {
      expect(checkDerivedSum(240, 240, 'Kenglik')).toEqual([]);
    });

    it('rejects a mismatch beyond tolerance', () => {
      const violations = checkDerivedSum(240, 230, 'Kenglik');
      expect(violations[0].code).toBe('derived_sum');
      expect(violations[0].message).toContain('230');
    });

    it('accepts a difference within tolerance', () => {
      expect(checkDerivedSum(240.05, 240, 'Kenglik')).toEqual([]);
      expect(TOLERANCE_CM).toBe(0.1);
    });
  });

  describe('floor contact', () => {
    it('accepts parts resting on the floor', () => {
      const nodes = [
        node({ id: 'corpus', role: 'corpus', size: [100, 200, 50], offset: [0, 100, 0] }),
      ];
      expect(checkFloorContact(nodes)).toEqual([]);
    });

    it('rejects a part that sinks below the floor', () => {
      const nodes = [
        node({ id: 'corpus', role: 'corpus', size: [100, 200, 50], offset: [0, 50, 0] }),
      ];
      expect(checkFloorContact(nodes)[0].code).toBe('floor_contact');
    });
  });

  describe('wall mount', () => {
    it('accepts a cabinet hanging at the mount height', () => {
      const nodes = [
        node({ id: 'corpus', role: 'corpus', size: [80, 70, 32], offset: [0, 145 + 35, 0] }),
      ];
      expect(checkWallMount(nodes, 145)).toEqual([]);
    });

    it('rejects a cabinet that hangs below the mount height', () => {
      const nodes = [
        node({ id: 'corpus', role: 'corpus', size: [80, 70, 32], offset: [0, 100 + 35, 0] }),
      ];
      expect(checkWallMount(nodes, 145)[0].code).toBe('wall_mount');
    });
  });

  describe('validateGraph', () => {
    it('runs containment before non-overlap and returns both kinds', () => {
      const nodes = [
        node({ id: 'corpus', role: 'corpus', size: [100, 200, 50] }),
        node({ id: 'wide', parentId: 'corpus', size: [300, 2, 46] }),
        node({ id: 'a', size: [50, 50, 50], offset: [0, 300, 0] }),
        node({ id: 'b', size: [50, 50, 50], offset: [0, 300, 0] }),
      ];
      const codes = validateGraph(nodes).map((violation) => violation.code);
      expect(codes).toContain('containment');
      expect(codes).toContain('non_overlap');
      expect(codes.indexOf('containment')).toBeLessThan(codes.lastIndexOf('non_overlap'));
    });

    it('returns no violations for a clean graph', () => {
      const nodes = [
        node({ id: 'corpus', role: 'corpus', size: [100, 200, 50] }),
        node({ id: 'shelf', parentId: 'corpus', size: [96, 2, 46] }),
      ];
      expect(validateGraph(nodes)).toEqual([]);
    });
  });
});
