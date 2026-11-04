import { describe, expect, it } from 'vitest';
import { registerFurnitureDefinition } from '../../geometry/universal';
import {
  canonicalizeFurnitureSpec,
  getFurnitureParameters,
  updateFurnitureSpec,
  type SpecPatch,
  type SpecUpdateResult,
} from './index';

const DEFINITION_IDS = [
  'desk.computer',
  'desk.gaming',
  'table.dining',
  'desk.writing',
  'chair.office',
  'chair.dining',
  'chair.armchair',
  'chair.ergonomic',
  'sofa.standard',
  'cabinet.standard',
  'bed.standard',
  'kitchen.baseCabinet',
  'stand.tv',
] as const;

function defaultsOf(definitionId: string): SpecPatch {
  const parameters = getFurnitureParameters(definitionId);
  if (!parameters) throw new Error(`no parameters for ${definitionId}`);
  return parameters.defaults;
}

function codes(result: SpecUpdateResult): string[] {
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

function keys(result: SpecUpdateResult): string[] {
  return result.ok ? [] : result.issues.flatMap((issue) => issue.keys ?? []);
}

/** Finds one parameter whose change the definition accepts. */
function findValidChange(definitionId: string): SpecPatch | null {
  const parameters = getFurnitureParameters(definitionId);
  if (!parameters) return null;
  const spec = parameters.defaults;

  for (const parameter of parameters.parameters) {
    if (parameter.kind === 'boolean' && typeof parameter.defaultValue === 'boolean') {
      const patch: SpecPatch = { [parameter.key]: !parameter.defaultValue };
      if (updateFurnitureSpec(definitionId, spec, patch).ok) return patch;
    }
  }

  for (const parameter of parameters.parameters) {
    if (parameter.kind !== 'number' || typeof parameter.defaultValue !== 'number') continue;
    const base = parameter.defaultValue;
    for (const candidate of [base + 1, base - 1, base * 1.05, base * 0.95]) {
      if (!Number.isFinite(candidate)) continue;
      const patch: SpecPatch = { [parameter.key]: Number(candidate.toFixed(3)) };
      if (updateFurnitureSpec(definitionId, spec, patch).ok) return patch;
    }
  }

  return null;
}

const BROKEN_PLAN_DEFINITION_ID = 'test.duplicateParts';

/**
 * Plan-invalid fixture: the spec parses fine, but the solver emits duplicate part
 * ids, so only `validatePlanDraft` rejects it. Used to prove where the full
 * validation happens.
 */
function registerBrokenPlanFixture(): void {
  registerFurnitureDefinition({
    id: BROKEN_PLAN_DEFINITION_ID,
    version: 1,
    family: 'table',
    label: 'Test (buzuq plan)',
    fields: [{ key: 'width', label: 'Kenglik (sm)', kind: 'number' }],
    defaults: { width: 100 },
    slots: [
      {
        id: 'body',
        label: 'Korpus',
        color: '#a9744f',
        materialId: 'wood-oak',
        groupName: 'test-body',
      },
    ],
    limits: { maxParts: 8, maxPartVertices: 4096, maxPartTriangles: 4096, maxTotalVertices: 16384 },
    parseSpec: (input) => {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return { ok: false, errors: ['Spec obyekt bo‘lishi kerak.'] };
      }
      const width = (input as Record<string, unknown>).width;
      if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
        return { ok: false, errors: ['width: musbat son bo‘lishi kerak.'] };
      }
      return { ok: true, spec: { width } };
    },
    solve: (spec) => ({
      parts: [
        {
          id: 'duplicate',
          type: 'panel',
          role: 'panel',
          dimensions: { width: spec.width, height: 2, depth: 60 },
          geometry: { kind: 'box', width: spec.width, height: 2, depth: 60 },
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          materialSlot: 'body',
        },
        {
          id: 'duplicate',
          type: 'panel',
          role: 'panel',
          dimensions: { width: spec.width, height: 2, depth: 60 },
          geometry: { kind: 'box', width: spec.width, height: 2, depth: 60 },
          position: [0, 10, 0],
          rotation: [0, 0, 0],
          materialSlot: 'body',
        },
      ],
      connections: [],
    }),
  });
}

registerBrokenPlanFixture();

describe('updateFurnitureSpec', () => {
  it('updates only the patched channel and keeps every other value', () => {
    const current = defaultsOf('desk.computer');
    const result = updateFurnitureSpec('desk.computer', current, { width: 180 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definitionId).toBe('desk.computer');
    expect(result.spec.width).toBe(180);
    expect(Object.keys(result.spec).sort()).toEqual(Object.keys(current).sort());
    for (const [key, value] of Object.entries(current)) {
      if (key === 'width') continue;
      expect(result.spec[key]).toBe(value);
    }
  });

  it('returns the canonical spec for a partial current spec', () => {
    const expected = updateFurnitureSpec(
      'desk.computer',
      defaultsOf('desk.computer'),
      { drawerEnabled: false },
    );
    const fromPartial = updateFurnitureSpec(
      'desk.computer',
      { width: 160 },
      { drawerEnabled: false },
    );

    expect(fromPartial.ok).toBe(true);
    expect(expected.ok).toBe(true);
    if (!fromPartial.ok || !expected.ok) return;
    expect(fromPartial.spec).toEqual(expected.spec);
    expect(fromPartial.spec.drawerWidth).toBe(45);
  });

  it('does not mutate the spec it is given', () => {
    const current = defaultsOf('desk.computer');
    const before = JSON.parse(JSON.stringify(current));

    const result = updateFurnitureSpec('desk.computer', current, { width: 180 });

    expect(result.ok).toBe(true);
    expect(current).toEqual(before);
    if (result.ok) expect(result.spec).not.toBe(current);
  });

  it('rejects an unknown parameter instead of ignoring it', () => {
    const result = updateFurnitureSpec('desk.computer', defaultsOf('desk.computer'), {
      nope: 1,
    });

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(['unknown_parameter']);
    expect(keys(result)).toEqual(['nope']);
  });

  it('rejects a value of the wrong kind', () => {
    const result = updateFurnitureSpec('desk.computer', defaultsOf('desk.computer'), {
      drawerEnabled: 1,
    });

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(['invalid_spec']);
    expect(keys(result)).toContain('drawerEnabled');
  });

  it('rejects a string where a number is required', () => {
    const result = updateFurnitureSpec('desk.computer', defaultsOf('desk.computer'), {
      width: '180',
    });

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(['invalid_spec']);
    expect(keys(result)).toContain('width');
  });

  it('rejects a non-scalar patch value', () => {
    const result = updateFurnitureSpec('desk.computer', defaultsOf('desk.computer'), {
      width: [180],
    });

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(['invalid_patch']);
  });

  it('rejects a currently invalid spec', () => {
    const result = updateFurnitureSpec('desk.computer', { nope: 1 }, { width: 180 });

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(['invalid_current_spec']);
  });

  it('rejects an unknown definition', () => {
    const result = updateFurnitureSpec('desk.missing', {}, { width: 180 });

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(['unknown_definition']);
  });

  it('rejects a patch whose parameters conflict with each other', () => {
    // width must stay wider than the legs (2 * legInset + legWidth = 15 cm).
    const result = updateFurnitureSpec('desk.computer', defaultsOf('desk.computer'), {
      width: 10,
    });

    expect(result.ok).toBe(false);
    expect(codes(result).every((code) => code === 'invalid_spec')).toBe(true);
    expect(keys(result)).toContain('width');
  });

  it('is deterministic for the same definition, spec and patch', () => {
    const current = defaultsOf('desk.computer');
    const first = updateFurnitureSpec('desk.computer', current, { width: 170, depth: 75 });
    const second = updateFurnitureSpec('desk.computer', current, { width: 170, depth: 75 });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.spec).toEqual(second.spec);
    expect(JSON.stringify(first.spec)).toBe(JSON.stringify(second.spec));
    // Frozen so a caller cannot poison the shared buildability cache.
    expect(Object.isFrozen(first.spec)).toBe(true);
  });

  it('rejects a spec whose plan the Universal Core validator refuses', () => {
    const result = updateFurnitureSpec(BROKEN_PLAN_DEFINITION_ID, { width: 100 }, { width: 120 });

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(['invalid_plan']);
  });
});

describe('canonicalizeFurnitureSpec', () => {
  it('fills defaults without requiring a complete spec', () => {
    const result = canonicalizeFurnitureSpec('desk.computer', { width: 160 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definitionId).toBe('desk.computer');
    expect(result.spec).toEqual(defaultsOf('desk.computer'));
  });

  it('rejects unknown channels, non-object payloads and unknown definitions', () => {
    expect(canonicalizeFurnitureSpec('desk.computer', { nope: 1 }).ok).toBe(false);
    expect(canonicalizeFurnitureSpec('desk.computer', ['width']).ok).toBe(false);
    expect(canonicalizeFurnitureSpec('desk.missing', {}).ok).toBe(false);
  });

  it('does not run the plan pipeline, so a plan-invalid spec still canonicalises', () => {
    const result = canonicalizeFurnitureSpec(BROKEN_PLAN_DEFINITION_ID, { width: 120 });

    expect(result.ok).toBe(true);
  });
});

describe('getFurnitureParameters', () => {
  it.each(DEFINITION_IDS)('describes every declared parameter of %s', (definitionId) => {
    const parameters = getFurnitureParameters(definitionId);
    expect(parameters).not.toBeNull();
    if (!parameters) return;

    const defaultKeys = Object.keys(defaultsOf(definitionId)).sort();
    expect(parameters.parameters.map((parameter) => parameter.key).sort()).toEqual(defaultKeys);
    expect(parameters.undeclaredDefaults).toEqual([]);
    for (const parameter of parameters.parameters) {
      expect(parameter.label).not.toBe('');
      expect(parameter.defaultValue).toBeDefined();
    }
  });

  it('reports the definitions without declared ranges instead of inventing one', () => {
    // The 13 built-in definitions declare key/label/kind only, so numeric limits
    // come from their parser, not from this metadata.
    for (const definitionId of DEFINITION_IDS) {
      const parameters = getFurnitureParameters(definitionId);
      if (!parameters) throw new Error(`no parameters for ${definitionId}`);
      const numeric = parameters.parameters.filter((parameter) => parameter.kind === 'number');
      expect(parameters.withoutRange).toEqual(numeric.map((parameter) => parameter.key));
      expect(numeric.every((parameter) => parameter.range === undefined)).toBe(true);
    }
  });

  it('returns null for an unknown definition', () => {
    expect(getFurnitureParameters('desk.missing')).toBeNull();
  });
});

describe('default specs across the thirteen definitions', () => {
  it.each(DEFINITION_IDS)('keeps the default spec of %s valid', (definitionId) => {
    const defaults = defaultsOf(definitionId);
    const result = updateFurnitureSpec(definitionId, defaults, {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec).toEqual(defaults);
  });

  it.each(DEFINITION_IDS)('can change at least one parameter of %s', (definitionId) => {
    const patch = findValidChange(definitionId);
    expect(patch).not.toBeNull();
    if (!patch) return;

    const result = updateFurnitureSpec(definitionId, defaultsOf(definitionId), patch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const [key, value] of Object.entries(patch)) {
      expect(result.spec[key]).toBe(value);
    }
  });
});
