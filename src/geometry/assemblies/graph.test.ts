import { describe, expect, it } from 'vitest';
import { ASSEMBLY_KINDS } from '../../scene/types';
import {
  checkAdjacency,
  checkContainment,
  checkDerivedSum,
  checkFloorContact,
  checkNonOverlap,
  checkWallMount,
} from './constraints';
import { buildPartGraph, buildDefaultPartGraph, PANEL_THICKNESS_CM } from './graph';
import { AssemblyError } from './limits';
import {
  assemblyDefaults,
  kitchenRunWidthCm,
  requireAssemblyParams,
  stairTotalRunCm,
  stairTotalRiseCm,
  validateAssemblyParams,
} from './params';
import { groupAabb, partAabb } from './partGraph';

describe('W14 part graphs', () => {
  it('builds a graph for every kind from its defaults', () => {
    for (const kind of ASSEMBLY_KINDS) {
      const nodes = buildDefaultPartGraph(kind);
      expect(nodes.length, kind).toBeGreaterThan(0);
      expect(new Set(nodes.map((node) => node.id)).size, kind).toBe(nodes.length);
    }
  });

  it('is deterministic: the same parameters produce identical ids and sizes', () => {
    for (const kind of ASSEMBLY_KINDS) {
      const first = buildDefaultPartGraph(kind);
      const second = buildDefaultPartGraph(kind);
      expect(second).toEqual(first);
    }
  });

  it('rejects an unknown kind exhaustively', () => {
    expect(() => buildPartGraph('spaceship' as never, {} as never)).toThrow();
  });

  describe('kitchen-base-run', () => {
    it('places modules edge to edge with no gaps', () => {
      const params = requireAssemblyParams('kitchen-base-run', { moduleCount: 3, moduleWidthCm: 60 });
      const nodes = buildPartGraph('kitchen-base-run', params);

      const modules = nodes.filter((node) => node.role === 'corpus');
      expect(modules).toHaveLength(3);
      for (let index = 1; index < modules.length; index += 1) {
        expect(checkAdjacency(nodes, modules[index - 1].id, modules[index].id, 0)).toEqual([]);
      }
    });

    it('has a total width equal to modules × module width', () => {
      const params = requireAssemblyParams('kitchen-base-run', {
        moduleCount: 4,
        moduleWidthCm: 55,
      });
      const nodes = buildPartGraph('kitchen-base-run', params);
      const modules = nodes.filter((node) => node.role === 'corpus');
      const first = partAabb(nodes, modules[0]);
      const last = partAabb(nodes, modules[modules.length - 1]);
      expect(
        checkDerivedSum(last.max[0] - first.min[0], kitchenRunWidthCm(params), 'Umumiy kenglik'),
      ).toEqual([]);
    });

    it('rests on the floor and never sinks below it', () => {
      const nodes = buildDefaultPartGraph('kitchen-base-run');
      expect(checkFloorContact(nodes)).toEqual([]);
    });

    it('keeps the top slab above the corpora and the plinth below', () => {
      const nodes = buildDefaultPartGraph('kitchen-base-run');
      const top = nodes.find((node) => node.role === 'top');
      const plinth = nodes.find((node) => node.role === 'plinth');
      expect(top).toBeDefined();
      expect(plinth).toBeDefined();
      if (!top || !plinth) return;
      expect(partAabb(nodes, plinth).max[1]).toBeLessThanOrEqual(
        partAabb(nodes, nodes.find((node) => node.role === 'corpus')!).min[1] + 0.1,
      );
      expect(partAabb(nodes, top).min[1]).toBeGreaterThanOrEqual(
        partAabb(nodes, nodes.find((node) => node.role === 'corpus')!).max[1] - 0.1,
      );
    });

    it('omits the plinth when its height is zero', () => {
      const params = requireAssemblyParams('kitchen-base-run', { plinthHeightCm: 0 });
      const nodes = buildPartGraph('kitchen-base-run', params);
      expect(nodes.some((node) => node.role === 'plinth')).toBe(false);
    });

    it('produces no overlapping parts and no parts outside their parent', () => {
      const nodes = buildDefaultPartGraph('kitchen-base-run');
      expect(checkNonOverlap(nodes)).toEqual([]);
      expect(checkContainment(nodes)).toEqual([]);
    });
  });

  describe('wall-cabinet', () => {
    it('hangs every part at or above the mount height', () => {
      const params = requireAssemblyParams('wall-cabinet', { mountHeightCm: 150 });
      const nodes = buildPartGraph('wall-cabinet', params);
      expect(checkWallMount(nodes, params.mountHeightCm)).toEqual([]);
    });

    it('never touches the floor', () => {
      const nodes = buildDefaultPartGraph('wall-cabinet');
      const box = groupAabb(nodes);
      expect(box.min[1]).toBeGreaterThan(100);
    });

    it('places exactly doorCount door fronts', () => {
      const params = requireAssemblyParams('wall-cabinet', { doorCount: 3 });
      const nodes = buildPartGraph('wall-cabinet', params);
      expect(nodes.filter((node) => node.role === 'door')).toHaveLength(3);
    });

    it('has no overlapping parts', () => {
      expect(checkNonOverlap(buildDefaultPartGraph('wall-cabinet'))).toEqual([]);
    });
  });

  describe('wardrobe-section', () => {
    it('uses sectionCount − 1 dividers', () => {
      const params = requireAssemblyParams('wardrobe-section', { sectionCount: 4 });
      const nodes = buildPartGraph('wardrobe-section', params);
      expect(nodes.filter((node) => node.role === 'divider')).toHaveLength(3);
    });

    it('creates sectionCount × shelfCountPerSection shelves', () => {
      const params = requireAssemblyParams('wardrobe-section', {
        sectionCount: 3,
        shelfCountPerSection: 2,
      });
      const nodes = buildPartGraph('wardrobe-section', params);
      expect(nodes.filter((node) => node.role === 'shelf')).toHaveLength(6);
    });

    it('keeps dividers and shelves inside the corpus', () => {
      const nodes = buildDefaultPartGraph('wardrobe-section');
      expect(checkContainment(nodes)).toEqual([]);
    });

    it('produces no overlapping parts', () => {
      for (const params of [
        requireAssemblyParams('wardrobe-section', { sectionCount: 1, doorCount: 0 }),
        requireAssemblyParams('wardrobe-section', { sectionCount: 2, doorCount: 2 }),
        requireAssemblyParams('wardrobe-section', { sectionCount: 4, doorCount: 4 }),
      ]) {
        expect(checkNonOverlap(buildPartGraph('wardrobe-section', params))).toEqual([]);
      }
    });

    it('rests on the floor', () => {
      expect(checkFloorContact(buildDefaultPartGraph('wardrobe-section'))).toEqual([]);
    });
  });

  describe('stair-straight', () => {
    it('creates one part per step plus two stringers', () => {
      const params = requireAssemblyParams('stair-straight', { stepCount: 8 });
      const nodes = buildPartGraph('stair-straight', params);
      expect(nodes.filter((node) => node.role === 'step')).toHaveLength(8);
      expect(nodes.filter((node) => node.role === 'stringer')).toHaveLength(2);
    });

    it('raises each step by exactly riseCm', () => {
      const params = requireAssemblyParams('stair-straight', { stepCount: 6, riseCm: 18 });
      const nodes = buildPartGraph('stair-straight', params);
      const steps = nodes.filter((node) => node.role === 'step');
      for (let index = 1; index < steps.length; index += 1) {
        const previous = partAabb(nodes, steps[index - 1]);
        const current = partAabb(nodes, steps[index]);
        expect(current.min[1] - previous.min[1]).toBeCloseTo(18, 5);
      }
    });

    it('has a total rise and run that match the derived values', () => {
      const params = requireAssemblyParams('stair-straight', { stepCount: 12 });
      const nodes = buildPartGraph('stair-straight', params);
      const steps = nodes.filter((node) => node.role === 'step');
      const first = partAabb(nodes, steps[0]);
      const last = partAabb(nodes, steps[steps.length - 1]);
      expect(checkDerivedSum(last.max[1], stairTotalRiseCm(params), 'Umumiy balandlik')).toEqual(
        [],
      );
      expect(
        checkDerivedSum(last.max[2] - first.min[2], stairTotalRunCm(params), 'Umumiy uzunlik'),
      ).toEqual([]);
    });

    it('starts on the floor and produces no overlapping parts', () => {
      const nodes = buildDefaultPartGraph('stair-straight');
      expect(partAabb(nodes, nodes.find((node) => node.role === 'step')!).min[1]).toBeCloseTo(0, 5);
      expect(checkNonOverlap(nodes)).toEqual([]);
    });

    it('reports a rejected parameter set rather than building a partial flight', () => {
      expect(validateAssemblyParams('stair-straight', { stepCount: 2 })).toBeNull();
    });
  });

  describe('budgets', () => {
    it('stays well under the part budget for the largest valid parameters', () => {
      const wardrobe = requireAssemblyParams('wardrobe-section', {
        sectionCount: 4,
        shelfCountPerSection: 6,
        doorCount: 4,
      });
      expect(buildPartGraph('wardrobe-section', wardrobe).length).toBeLessThanOrEqual(500);

      const stair = requireAssemblyParams('stair-straight', { stepCount: 16 });
      expect(buildPartGraph('stair-straight', stair).length).toBeLessThanOrEqual(500);
    });

    it('uses the documented panel thickness', () => {
      expect(PANEL_THICKNESS_CM).toBe(2);
    });
  });

  describe('defaults', () => {
    it('uses the same defaults as assemblyDefaults', () => {
      for (const kind of ASSEMBLY_KINDS) {
        const params = assemblyDefaults(kind);
        expect(buildPartGraph(kind, params as never)).toEqual(buildDefaultPartGraph(kind));
      }
    });

    it('never throws for a validated parameter set', () => {
      for (const kind of ASSEMBLY_KINDS) {
        expect(() => buildDefaultPartGraph(kind)).not.toThrow(AssemblyError);
      }
    });
  });
});
