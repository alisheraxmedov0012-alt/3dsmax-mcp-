import { describe, expect, it } from 'vitest';
import { DEFAULT_DESK_SPEC } from '../furniture/desk';
import { buildPlan, createFurniturePlan, type FurniturePlan, type PlanPart } from './index';

function slotCounts(plan: FurniturePlan): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const part of plan.parts) {
    counts[part.materialSlot] = (counts[part.materialSlot] ?? 0) + 1;
  }
  return counts;
}

describe('buildPlan', () => {
  it('groups parts by slot in definition order', () => {
    const plan = createFurniturePlan('desk.computer', DEFAULT_DESK_SPEC);
    const built = buildPlan(plan);
    try {
      expect(built.group.name).toBe('desk-assembly');
      expect(built.materialSlots).toEqual(['tabletop', 'structure', 'drawer', 'hardware']);
      expect(built.materialNames).toEqual([
        'desk-tabletop-group-material',
        'desk-structure-group-material',
        'desk-drawer-group-material',
        'desk-hardware-group-material',
      ]);

      const expected = slotCounts(plan);
      const actual = Object.fromEntries(
        built.group.children.map((child) => [child.name, child.children.length]),
      );
      expect(actual).toEqual({
        'desk-tabletop-group': expected.tabletop,
        'desk-structure-group': expected.structure,
        'desk-drawer-group': expected.drawer,
        'desk-hardware-group': expected.hardware,
      });
      expect(actual['desk-tabletop-group']).toBe(1);
      expect(actual['desk-structure-group']).toBe(7);
      expect(actual['desk-drawer-group']).toBe(1);
      expect(actual['desk-hardware-group']).toBe(7);
    } finally {
      built.dispose();
    }
  });

  it('disposes the group without mutating the plan', () => {
    const plan = createFurniturePlan('desk.computer', DEFAULT_DESK_SPEC);
    const built = buildPlan(plan);
    built.dispose();
    expect(built.group.children).toHaveLength(0);
    expect(plan.parts).toHaveLength(16);
  });

  it('rejects an unknown definition', () => {
    const plan: FurniturePlan = {
      definitionId: 'desk.missing',
      spec: {},
      parts: [],
      connections: [],
      warnings: [],
    };
    expect(() => buildPlan(plan)).toThrowError(
      expect.objectContaining({ code: 'unknown_definition' }),
    );
  });

  it('rejects a plan whose slot is not in the definition', () => {
    const part: PlanPart = {
      id: 'p1',
      type: 'support',
      role: 'support',
      dimensions: { width: 10, height: 10, depth: 10 },
      geometry: { kind: 'box', width: 10, height: 10, depth: 10 },
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      materialSlot: 'missing',
    };
    const plan: FurniturePlan = {
      definitionId: 'desk.computer',
      spec: {},
      parts: [part],
      connections: [],
      warnings: [],
    };
    expect(() => buildPlan(plan)).toThrowError(
      expect.objectContaining({ code: 'invalid_plan' }),
    );
  });
});
