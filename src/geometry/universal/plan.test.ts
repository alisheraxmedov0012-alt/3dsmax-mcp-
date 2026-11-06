import { describe, expect, it } from 'vitest';
import { createConnection } from '../components';
import { DEFAULT_DESK_SPEC } from '../furniture/desk';
import {
  createFurniturePlan,
  createPlanFromDefinition,
  defineFurniture,
  tryCreateFurniturePlan,
  validatePlanDraft,
  type FurnitureDefinition,
  type PlanLimits,
  type PlanPart,
  type RegisteredFurnitureDefinition,
} from './index';

interface TestSpec {
  readonly width: number;
}

function makeDefinition(limits: Partial<PlanLimits> = {}): RegisteredFurnitureDefinition {
  const definition: FurnitureDefinition<TestSpec> = {
    id: 'test.basic',
    version: 1,
    family: 'table',
    label: 'Test furniture',
    fields: [{ key: 'width', label: 'Kenglik', kind: 'number' }],
    defaults: { width: 10 },
    slots: [
      {
        id: 'main',
        label: 'Asosiy',
        color: '#a9744f',
        materialId: 'wood-oak',
        groupName: 'test-main-group',
      },
    ],
    limits: {
      maxParts: 4,
      maxPartVertices: 1000,
      maxPartTriangles: 2000,
      maxTotalVertices: 4000,
      ...limits,
    },
    parseSpec: () => ({ ok: true, spec: { width: 10 } }),
    solve: () => ({ parts: [], connections: [], warnings: [] }),
  };
  return defineFurniture(definition);
}

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

describe('desk.computer plan', () => {
  it('creates a frozen, structurally complete plan', () => {
    const plan = createFurniturePlan('desk.computer', DEFAULT_DESK_SPEC);
    expect(plan.definitionId).toBe('desk.computer');
    expect(plan.parts).toHaveLength(24);
    expect(plan.connections).toHaveLength(16);
    expect(new Set(plan.parts.map((entry) => entry.materialSlot))).toEqual(
      new Set(['tabletop', 'structure', 'drawer', 'hardware']),
    );
    expect(plan.warnings).toEqual([]);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.parts)).toBe(true);
  });

  it('is deterministic for the same spec', () => {
    const first = createFurniturePlan('desk.computer', DEFAULT_DESK_SPEC);
    const second = createFurniturePlan('desk.computer', { ...DEFAULT_DESK_SPEC });
    expect(second.parts).toEqual(first.parts);
    expect(second.connections).toEqual(first.connections);
    expect(second.warnings).toEqual(first.warnings);
  });

  it('rejects an invalid spec without correcting it', () => {
    const invalid = { ...DEFAULT_DESK_SPEC, width: 0 };
    const result = tryCreateFurniturePlan('desk.computer', invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe('invalid_spec');
    }
    expect(() => createFurniturePlan('desk.computer', invalid)).toThrowError(
      expect.objectContaining({ code: 'invalid_spec' }),
    );
  });

  it('rejects unknown spec channels', () => {
    const result = tryCreateFurniturePlan('desk.computer', {
      ...DEFAULT_DESK_SPEC,
      mystery: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((entry) => entry.message.includes('noma'))).toBe(true);
    }
  });

  it('reports an unknown definition', () => {
    const result = tryCreateFurniturePlan('desk.missing', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe('unknown_definition');
    }
    expect(() => createFurniturePlan('desk.missing', {})).toThrowError(
      expect.objectContaining({ code: 'unknown_definition' }),
    );
  });

  it('creates a plan through a registered definition object', () => {
    const plan = createPlanFromDefinition(makeDefinition(), { width: 12 });
    expect(plan.definitionId).toBe('test.basic');
    expect(plan.parts).toEqual([]);
  });
});

describe('plan validation', () => {
  it('rejects duplicate part ids', () => {
    const result = validatePlanDraft(
      { parts: [part(), part()], connections: [] },
      makeDefinition(),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.map((entry) => entry.code)).toContain('duplicate_part_id');
  });

  it('rejects a dangling connection component', () => {
    const result = validatePlanDraft(
      {
        parts: [part()],
        connections: [
          createConnection({
            id: 'c1',
            type: 'fixed',
            componentIds: ['p1', 'missing'],
            position: [0, 0, 0],
            direction: [0, 1, 0],
          }),
        ],
      },
      makeDefinition(),
    );
    expect(result.errors.map((entry) => entry.code)).toContain(
      'missing_connection_component',
    );
  });

  it('rejects duplicate connection ids', () => {
    const connection = createConnection({
      id: 'c1',
      type: 'fixed',
      componentIds: ['p1', 'p2'],
      position: [0, 0, 0],
      direction: [0, 1, 0],
    });
    const result = validatePlanDraft(
      {
        parts: [part(), part({ id: 'p2' })],
        connections: [connection, connection],
      },
      makeDefinition(),
    );
    expect(result.errors.map((entry) => entry.code)).toContain('duplicate_connection_id');
  });

  it('rejects a missing hardware reference', () => {
    const result = validatePlanDraft(
      {
        parts: [part(), part({ id: 'p2' })],
        connections: [
          createConnection({
            id: 'c1',
            type: 'screw',
            componentIds: ['p1', 'p2'],
            position: [0, 0, 0],
            direction: [0, 1, 0],
            hardwareId: 'missing-hardware',
          }),
        ],
      },
      makeDefinition(),
    );
    expect(result.errors.map((entry) => entry.code)).toContain(
      'missing_connection_hardware',
    );
  });

  it('rejects non-finite transforms', () => {
    const result = validatePlanDraft(
      { parts: [part({ position: [Number.NaN, 0, 0] })], connections: [] },
      makeDefinition(),
    );
    expect(result.errors.map((entry) => entry.code)).toContain('non_finite_transform');
  });

  it('rejects invalid dimensions', () => {
    const result = validatePlanDraft(
      { parts: [part({ dimensions: { width: 0, height: 10, depth: 10 } })], connections: [] },
      makeDefinition(),
    );
    expect(result.errors.map((entry) => entry.code)).toContain('invalid_dimensions');
  });

  it('rejects a material slot outside the definition', () => {
    const result = validatePlanDraft(
      { parts: [part({ materialSlot: 'missing' })], connections: [] },
      makeDefinition(),
    );
    expect(result.errors.map((entry) => entry.code)).toContain('invalid_material_slot');
  });

  it('rejects an invalid geometry recipe', () => {
    const result = validatePlanDraft(
      {
        parts: [part({ geometry: { kind: 'box', width: -1, height: 10, depth: 10 } })],
        connections: [],
      },
      makeDefinition(),
    );
    expect(result.errors.map((entry) => entry.code)).toContain('invalid_geometry_recipe');
  });

  it('enforces the part budget', () => {
    const result = validatePlanDraft(
      {
        parts: [part({ id: 'p1' }), part({ id: 'p2' }), part({ id: 'p3' })],
        connections: [],
      },
      makeDefinition({ maxParts: 2 }),
    );
    expect(result.errors.map((entry) => entry.code)).toContain('part_budget_exceeded');
  });

  it('enforces the per-part geometry budget', () => {
    const result = validatePlanDraft(
      { parts: [part()], connections: [] },
      makeDefinition({ maxPartVertices: 10, maxTotalVertices: 10 }),
    );
    expect(result.errors.map((entry) => entry.code)).toContain('geometry_budget_exceeded');
  });

  it('enforces the total vertex budget', () => {
    const parts = Array.from({ length: 5 }, (_, index) => part({ id: `p${index + 1}` }));
    const result = validatePlanDraft(
      { parts, connections: [] },
      makeDefinition({
        maxParts: 10,
        maxPartVertices: 100,
        maxTotalVertices: 100,
      }),
    );
    expect(result.errors.map((entry) => entry.code)).toContain('geometry_budget_exceeded');
  });

  it('rejects a missing parent reference', () => {
    const result = validatePlanDraft(
      { parts: [part({ parentId: 'missing' })], connections: [] },
      makeDefinition(),
    );
    expect(result.errors.map((entry) => entry.code)).toContain('missing_parent');
  });

  it('accepts valid rectangular manufacturing metadata', () => {
    const result = validatePlanDraft(
      {
        parts: [
          part({
            manufacturing: { boxCm: [10, 10, 10], cutFromSheet: true },
          }),
        ],
        connections: [],
      },
      makeDefinition(),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects manufacturing boxCm that does not match the box', () => {
    const result = validatePlanDraft(
      {
        parts: [
          part({
            manufacturing: { boxCm: [10, 9, 10], cutFromSheet: false },
          }),
        ],
        connections: [],
      },
      makeDefinition(),
    );
    expect(result.errors.map((entry) => entry.code)).toContain('invalid_manufacturing');
  });

  it('rejects manufacturing boxCm on a non-box geometry', () => {
    const result = validatePlanDraft(
      {
        parts: [
          part({
            geometry: {
              kind: 'roundedBox',
              width: 10,
              height: 10,
              depth: 10,
              radius: 1,
              segments: 4,
            },
            manufacturing: { boxCm: [10, 10, 10], cutFromSheet: false },
          }),
        ],
        connections: [],
      },
      makeDefinition(),
    );
    expect(result.errors.map((entry) => entry.code)).toContain('invalid_manufacturing');
  });

  it('rejects manufacturing metadata without boxCm', () => {
    const result = validatePlanDraft(
      {
        parts: [part({ manufacturing: { cutFromSheet: true } })],
        connections: [],
      },
      makeDefinition(),
    );
    expect(result.errors.map((entry) => entry.code)).toContain('invalid_manufacturing');
  });
});
