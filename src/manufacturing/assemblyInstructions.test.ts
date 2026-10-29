import { describe, expect, it } from 'vitest';
import {
  ASSEMBLY_LIMITATIONS,
  assemblyPlanPartCount,
  assemblyPlanPartIds,
  buildAssemblyPlan,
  buildFurnitureAssemblyPlan,
  furniturePlanFingerprint,
  isAssemblyPlanStale,
  validateAssemblyPlan,
  type AssemblyPlan,
  type AssemblyStep,
} from './assemblyInstructions';
import { buildBom, type BomResult, type BomRow } from './bom';
import { buildAssemblyBom } from './assemblyBom';
import { PART_KIND_LABELS, type PartKind } from './parts';
import { ASSEMBLY_DEFAULTS } from '../geometry/assemblies/params';
import { ASSEMBLY_KINDS, type AssemblyKind } from '../scene/types';
import {
  FURNITURE_TYPES,
  createFurnitureParams,
  type FurnitureType,
} from '../geometry/furniture/types';
import { validateManufacturing } from './validation';

function bomFor(type: FurnitureType, params = createFurnitureParams(type)): BomResult {
  const outcome = buildBom(type, params);
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.bom;
}

function furniturePlan(type: FurnitureType): AssemblyPlan {
  return buildFurnitureAssemblyPlan({ bom: bomFor(type) });
}

function assemblyPlan(kind: AssemblyKind, params = ASSEMBLY_DEFAULTS[kind]): AssemblyPlan {
  return buildAssemblyPlan({ kind, params: params as unknown as Record<string, unknown> });
}

/** Vocabulary that would only appear if fastening hardware had been invented. */
const HARDWARE_WORDS = [
  'shurop',
  'shtift',
  'vint',
  'bolt',
  'dübel',
  'dyubel',
  'kronshteyn',
  'yelim',
  'mix ',
  'perforatsiya',
];

function stepText(step: AssemblyStep): string {
  return `${step.title} ${step.instruction}`.toLowerCase();
}

describe('C6 furniture instructions — generation', () => {
  it('is deterministic for identical input', () => {
    for (const type of FURNITURE_TYPES) {
      const first = furniturePlan(type);
      const second = furniturePlan(type);
      expect(second, type).toEqual(first);
      expect(second.fingerprint, type).toBe(first.fingerprint);
    }
  });

  it('produces ordered steps with stable ids for every furniture type', () => {
    for (const type of FURNITURE_TYPES) {
      const plan = furniturePlan(type);
      expect(plan.steps.length, type).toBeGreaterThan(0);
      expect(plan.status, type).toBe('ok');
      plan.steps.forEach((step, index) => {
        expect(step.order, `${type} ${step.id}`).toBe(index + 1);
        expect(step.id, type).toMatch(/^step-[a-z0-9-]+$/);
      });
      // Every step but the first waits for the one before it.
      plan.steps.slice(1).forEach((step, index) => {
        expect(step.dependsOn, `${type} ${step.id}`).toEqual([plan.steps[index].id]);
      });
      expect(plan.issues, type).toEqual([]);
    }
  });

  it('references only part ids the BOM actually produced', () => {
    for (const type of FURNITURE_TYPES) {
      const bom = bomFor(type);
      const plan = buildFurnitureAssemblyPlan({ bom });
      const known = new Set(bom.rows.map((row) => row.partId));
      for (const partId of assemblyPlanPartIds(plan)) {
        expect(known.has(partId), `${type} -> ${partId}`).toBe(true);
      }
      expect(plan.issues.filter((entry) => entry.code === 'part-unresolved')).toEqual([]);
    }
  });

  it('keeps BOM quantities grouped instead of implying one physical piece', () => {
    const table = furniturePlan('table');
    const legs = table.steps[0].parts[0];
    expect(legs.partId).toBe('table-leg');
    expect(legs.quantity).toBe(4);

    const wardrobe = furniturePlan('wardrobe');
    const doors = wardrobe.steps.find((step) => step.title === 'Eshiklar');
    expect(doors?.parts).toEqual([
      { partId: 'wardrobe-door', name: PART_KIND_LABELS.door, quantity: 2, sizeMm: expect.any(Object) },
    ]);

    const shelf = furniturePlan('shelf');
    const boards = shelf.steps.find((step) => step.title === 'Tokchalar');
    expect(boards?.parts[0].quantity).toBe(4);
  });

  it('reports dimensions in millimetres from the measured geometry', () => {
    const table = furniturePlan('table');
    const top = table.steps.find((step) => step.parts.some((part) => part.partId === 'table-top'));
    const part = top?.parts[0];
    // The default table is 120 x 75 x 60 cm.
    expect(part?.sizeMm).toEqual({ x: 1200, y: 40, z: 600 });
  });

  it('counts every BOM row exactly once across the steps', () => {
    for (const type of FURNITURE_TYPES) {
      const bom = bomFor(type);
      const plan = buildFurnitureAssemblyPlan({ bom });
      expect(assemblyPlanPartIds(plan), type).toEqual(
        [...new Set(bom.rows.map((row) => row.partId))].sort(),
      );
      expect(assemblyPlanPartCount(plan), type).toBe(bom.totalParts);
    }
  });

  it('never invents fastening hardware in a step', () => {
    for (const type of FURNITURE_TYPES) {
      const plan = furniturePlan(type);
      for (const step of plan.steps) {
        const text = stepText(step);
        for (const word of HARDWARE_WORDS) {
          expect(text.includes(word), `${type} ${step.id} mentions ${word}`).toBe(false);
        }
      }
    }
  });

  it('states that fastening and strength are absent, rather than leaving it implied', () => {
    const plan = furniturePlan('table');
    expect(plan.limitations).toEqual(expect.arrayContaining([...ASSEMBLY_LIMITATIONS]));
    expect(plan.limitations.join(' ')).toMatch(/Mahkamlash vositalari/);
    expect(plan.limitations.join(' ')).toMatch(/sertifikati emas/);
  });

  it('marks furniture relationships as derived from part roles, not as modelled joints', () => {
    const plan = furniturePlan('wardrobe');
    expect(plan.source).toBe('furniture');
    expect(plan.steps.every((step) => step.relation === 'derived')).toBe(true);
  });

  it('serialises to plain JSON without losing anything', () => {
    const plan = furniturePlan('bed');
    const roundTripped = JSON.parse(JSON.stringify(plan)) as AssemblyPlan;
    expect(roundTripped).toEqual(plan);
  });

  it('returns an unsupported plan for an empty BOM', () => {
    const empty: BomResult = { ...bomFor('table'), rows: [], totalParts: 0 };
    const plan = buildFurnitureAssemblyPlan({ bom: empty });
    expect(plan.status).toBe('unsupported');
    expect(plan.steps).toEqual([]);
    expect(plan.issues.map((entry) => entry.code)).toContain('plan-empty');
  });

  it('falls back to explicit generic guidance for a part with no known role', () => {
    const base = bomFor('table');
    const stranger: BomRow = {
      ...base.rows[0],
      partId: 'table-gizmo',
      kind: 'unknown' as PartKind,
      name: PART_KIND_LABELS.unknown,
      quantity: 1,
    };
    const plan = buildFurnitureAssemblyPlan({ bom: { ...base, rows: [...base.rows, stranger] } });
    const fallback = plan.steps.find((step) => step.relation === 'inferred');
    expect(fallback).toBeDefined();
    expect(fallback?.title).toBe("Qo'shimcha detallar");
    expect(fallback?.parts.map((part) => part.partId)).toEqual(['table-gizmo']);
    expect(plan.issues.some((entry) => entry.code === 'part-unclassified')).toBe(true);
    expect(plan.status).toBe('limited');
    // Even the fallback does not claim a joint.
    expect(stepText(fallback as AssemblyStep)).not.toMatch(/mahkamla|biriktir/);
  });

  it('surfaces C4 errors without turning them into assembly failures', () => {
    const type: FurnitureType = 'wardrobe';
    const params = { ...createFurnitureParams(type), widthCm: -10 };
    const bom = bomFor(type);
    const validation = validateManufacturing(type, params);
    expect(validation.counts.error).toBeGreaterThan(0);
    const plan = buildFurnitureAssemblyPlan({ bom, validation });
    expect(plan.issues.some((entry) => entry.code === 'validation-errors')).toBe(true);
    expect(plan.status).toBe('limited');
    // The steps that could still be planned are kept.
    expect(plan.steps.length).toBeGreaterThan(0);
  });
});

describe('C6 furniture instructions — model updates and staleness', () => {
  it('detects a stale plan after a parameter change', () => {
    const params = createFurnitureParams('wardrobe');
    const before = buildFurnitureAssemblyPlan({ bom: bomFor('wardrobe', params) });
    const after = bomFor('wardrobe', { ...params, shelfCount: 2 });

    expect(isAssemblyPlanStale(before, furniturePlanFingerprint(after))).toBe(true);
    const stale = validateAssemblyPlan(before, {
      expectedPartIds: after.rows.map((row) => row.partId),
    });
    expect(stale.filter((entry) => entry.level === 'error')).toEqual([]);
  });

  it('does not treat a plan of the current model as stale', () => {
    const bom = bomFor('shelf');
    const plan = buildFurnitureAssemblyPlan({ bom });
    expect(isAssemblyPlanStale(plan, furniturePlanFingerprint(bom))).toBe(false);
  });

  it('does not invalidate a plan when only the material assignment changes', () => {
    const params = createFurnitureParams('wardrobe');
    const plain = buildBom('wardrobe', params);
    const assigned = buildBom('wardrobe', params, [{ partId: 'wardrobe-door', materialId: 'ldsp', thicknessMm: 18, thicknessSource: 'user' }]);
    if (!plain.ok || !assigned.ok) throw new Error('bom');
    expect(furniturePlanFingerprint(assigned.bom)).toBe(furniturePlanFingerprint(plain.bom));
    // The C3.1 assignment survives: the plan's part ids still resolve to it.
    expect(assemblyPlanPartIds(buildFurnitureAssemblyPlan({ bom: assigned.bom }))).toContain(
      'wardrobe-door',
    );
    expect(assigned.bom.rows.find((row) => row.partId === 'wardrobe-door')?.material?.materialId).toBe(
      'ldsp',
    );
  });

  it('reports a reference to a removed part as an error, not as a silent gap', () => {
    const plan = furniturePlan('wardrobe');
    expect(assemblyPlanPartIds(plan)).toContain('wardrobe-shelf');
    // Removing the shelves drops the row entirely; the old step now points at
    // a part the model no longer has.
    const reduced = bomFor('wardrobe', { ...createFurnitureParams('wardrobe'), shelfCount: 0 });
    expect(reduced.rows.map((row) => row.partId)).not.toContain('wardrobe-shelf');
    const issues = validateAssemblyPlan(plan, { expectedPartIds: reduced.rows.map((row) => row.partId) });
    expect(issues.some((entry) => entry.code === 'part-unresolved' && entry.level === 'error')).toBe(true);
  });

  it('keeps stable references for the parts that still exist', () => {
    const before = furniturePlan('wardrobe');
    const after = buildFurnitureAssemblyPlan({
      bom: bomFor('wardrobe', { ...createFurnitureParams('wardrobe'), shelfCount: 1 }),
    });
    const kept = new Set(assemblyPlanPartIds(after));
    expect(kept.has('wardrobe-side')).toBe(true);
    expect(kept.has('wardrobe-shelf')).toBe(true);
    // The shared part keeps its id, only the plan fingerprint moves.
    expect(before.steps[0].parts.map((part) => part.partId)).toEqual(
      after.steps[0].parts.map((part) => part.partId),
    );
  });
});

describe('C6 assembly instructions — W14 part graph adapter', () => {
  it('supports all four assembly kinds with modelled dependencies', () => {
    for (const kind of ASSEMBLY_KINDS) {
      const plan = assemblyPlan(kind);
      expect(plan.status, kind).toBe('ok');
      expect(plan.source, kind).toBe('assembly');
      expect(plan.steps.length, kind).toBeGreaterThan(0);
      expect(plan.issues, kind).toEqual([]);
    }
  });

  it('maps assembly graph ids to the manufacturing part ids the BOM uses', () => {
    for (const kind of ASSEMBLY_KINDS) {
      const plan = assemblyPlan(kind);
      const bom = buildAssemblyBom(kind, ASSEMBLY_DEFAULTS[kind]);
      if (!bom.ok) throw new Error(bom.reason);
      const known = new Set(bom.bom.rows.map((row) => row.partId));
      for (const partId of assemblyPlanPartIds(plan)) {
        expect(known.has(partId), `${kind} -> ${partId}`).toBe(true);
      }
      // The graph vocabulary and the BOM vocabulary really are different strings,
      // so the mapping is doing work rather than passing ids through unchanged.
      if (kind === 'wall-cabinet') {
        expect(assemblyPlanPartIds(plan)).toContain('wall-cabinet-door');
        expect(assemblyPlanPartIds(plan)).not.toContain('wall-cabinet-door-1');
      }
    }
  });

  it('makes a door step depend on the corpus step that carries it', () => {
    const plan = assemblyPlan('wall-cabinet');
    const corpus = plan.steps.find((step) => step.title === 'Korpus');
    const doors = plan.steps.find((step) => step.title === 'Eshiklar');
    expect(corpus).toBeDefined();
    expect(doors?.relation).toBe('modeled');
    expect(doors?.dependsOn).toEqual([corpus?.id]);
  });

  it('keeps every shelf and divider dependent on the corpus, not on each other', () => {
    const plan = assemblyPlan('wardrobe-section');
    const corpus = plan.steps[0];
    for (const title of ["Bo'luvchi panellar", 'Tokchalar', 'Eshiklar']) {
      const step = plan.steps.find((entry) => entry.title === title);
      expect(step?.dependsOn, title).toEqual([corpus.id]);
      expect(step?.relation, title).toBe('modeled');
    }
  });

  it('falls back to role order for a kind with no parent links, and says so', () => {
    const plan = assemblyPlan('stair-straight');
    expect(plan.steps.every((step) => step.relation === 'derived')).toBe(true);
    expect(plan.steps[1].dependsOn).toEqual([plan.steps[0].id]);
    expect(plan.steps.map((step) => step.title)).toEqual(['Kosourlar', "Pog'onalar"]);
  });

  it('groups repeated assembly parts into one quantity line', () => {
    const plan = assemblyPlan('kitchen-base-run');
    const modules = plan.steps.find((step) => step.title === 'Modullar');
    expect(modules?.parts).toHaveLength(1);
    expect(modules?.parts[0].quantity).toBe(ASSEMBLY_DEFAULTS['kitchen-base-run'].moduleCount);
    const doors = plan.steps.find((step) => step.title === 'Eshiklar');
    // One door per module in this builder.
    expect(doors?.parts[0].quantity).toBe(ASSEMBLY_DEFAULTS['kitchen-base-run'].moduleCount);
  });

  it('is deterministic', () => {
    for (const kind of ASSEMBLY_KINDS) {
      expect(assemblyPlan(kind)).toEqual(assemblyPlan(kind));
    }
  });

  it('rejects invalid parameters with an unsupported plan instead of guessing', () => {
    const plan = buildAssemblyPlan({
      kind: 'wall-cabinet',
      params: { ...ASSEMBLY_DEFAULTS['wall-cabinet'], widthCm: -5 } as unknown as Record<string, unknown>,
    });
    expect(plan.status).toBe('unsupported');
    expect(plan.steps).toEqual([]);
    expect(plan.issues.map((entry) => entry.code)).toContain('params-invalid');
  });

  it('rejects an unsupported assembly kind', () => {
    const plan = buildAssemblyPlan({ kind: 'not-a-kind' as AssemblyKind, params: {} });
    expect(plan.status).toBe('unsupported');
    expect(plan.issues.map((entry) => entry.code)).toContain('plan-unsupported');
  });

  it('does not invent hardware in assembly steps either', () => {
    for (const kind of ASSEMBLY_KINDS) {
      for (const step of assemblyPlan(kind).steps) {
        const text = stepText(step);
        for (const word of HARDWARE_WORDS) {
          expect(text.includes(word), `${kind} ${step.id} mentions ${word}`).toBe(false);
        }
      }
    }
  });

  it('keeps the assembly BOM contract untouched', () => {
    const outcome = buildAssemblyBom('wall-cabinet', ASSEMBLY_DEFAULTS['wall-cabinet']);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.bom.rows.every((row) => row.material === null)).toBe(true);
      expect(outcome.bom.limitations.join(' ')).toMatch(/Furnitura/);
    }
  });
});

describe('C6 assembly instructions — plan validation', () => {
  const step = (id: string, order: number, overrides: Partial<AssemblyStep> = {}): AssemblyStep => ({
    id,
    order,
    title: id,
    instruction: 'x',
    relation: 'derived',
    parts: [{ partId: 'table-leg', name: 'Oyoq', quantity: 4, sizeMm: null }],
    dependsOn: [],
    ...overrides,
  });

  it('rejects an empty plan', () => {
    expect(validateAssemblyPlan({ steps: [] }).map((entry) => entry.code)).toEqual(['plan-empty']);
  });

  it('rejects duplicate step ids', () => {
    const issues = validateAssemblyPlan({ steps: [step('a', 1), step('a', 2)] });
    expect(issues.map((entry) => entry.code)).toContain('step-duplicate-id');
  });

  it('rejects an order that does not match the array position', () => {
    const issues = validateAssemblyPlan({ steps: [step('a', 2), step('b', 1)] });
    expect(issues.filter((entry) => entry.code === 'step-order-invalid')).toHaveLength(2);
  });

  it('rejects a dependency on a step that does not exist', () => {
    const issues = validateAssemblyPlan({ steps: [step('a', 1, { dependsOn: ['ghost'] })] });
    expect(issues.map((entry) => entry.code)).toContain('step-dependency-unknown');
  });

  it('rejects a dependency on a later step', () => {
    const issues = validateAssemblyPlan({
      steps: [step('a', 1, { dependsOn: ['b'] }), step('b', 2)],
    });
    expect(issues.map((entry) => entry.code)).toContain('step-dependency-late');
  });

  it('rejects invalid quantities and duplicate parts inside a step', () => {
    const issues = validateAssemblyPlan({
      steps: [
        step('a', 1, {
          parts: [
            { partId: 'table-leg', name: 'Oyoq', quantity: 0, sizeMm: null },
            { partId: 'table-leg', name: 'Oyoq', quantity: 4, sizeMm: null },
          ],
        }),
      ],
    });
    const codes = issues.map((entry) => entry.code);
    expect(codes).toContain('quantity-invalid');
    expect(codes).toContain('step-part-duplicate');
  });

  it('rejects a step without parts', () => {
    const issues = validateAssemblyPlan({ steps: [step('a', 1, { parts: [] })] });
    expect(issues.map((entry) => entry.code)).toContain('step-without-parts');
  });

  it('rejects an unknown part id when the caller supplies the current part set', () => {
    const issues = validateAssemblyPlan(
      { steps: [step('a', 1, { parts: [{ partId: 'table-ghost', name: '?', quantity: 1, sizeMm: null }] })] },
      { expectedPartIds: ['table-leg'] },
    );
    expect(issues.map((entry) => entry.code)).toContain('part-unresolved');
  });
});
