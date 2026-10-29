import { describe, expect, it } from 'vitest';
import {
  buildAssemblyPlan,
  buildFurnitureAssemblyPlan,
  type AssemblyStep,
} from './assemblyInstructions';
import { buildBom } from './bom';
import { buildHardwareBom, validateHardwareSteps } from './hardware';
import { createFurnitureParams, FURNITURE_TYPES } from '../geometry/furniture/types';
import { ASSEMBLY_DEFAULTS } from '../geometry/assemblies/params';

function tablePlan() {
  const bom = buildBom('table', createFurnitureParams('table'));
  if (!bom.ok) throw new Error(bom.reason);
  return buildFurnitureAssemblyPlan({ bom: bom.bom });
}

function hardwareFor(stepIds: string[]) {
  const outcome = buildHardwareBom([
    { kind: 'screw', name: 'Konfirmat', quantity: 12, unit: 'pcs', size: null, stepIds },
  ]);
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.hardware;
}

describe('C6-R3 — stable assembly step identity', () => {
  it('keeps the same semantic ids across a rebuild', () => {
    const first = tablePlan();
    const second = tablePlan();
    expect(first.steps.map((step) => step.id)).toEqual(second.steps.map((step) => step.id));
    expect(first.steps.map((step) => step.id)).toEqual(['step-leg', 'step-top']);
    expect(first.steps.every((step) => !/^step-\d+$/.test(step.id))).toBe(true);
  });

  it('keeps ids stable for every furniture type', () => {
    for (const type of FURNITURE_TYPES) {
      const bom = buildBom(type, createFurnitureParams(type));
      if (!bom.ok) throw new Error(bom.reason);
      const a = buildFurnitureAssemblyPlan({ bom: bom.bom });
      const b = buildFurnitureAssemblyPlan({ bom: bom.bom });
      expect(a.steps.map((step) => step.id), type).toEqual(b.steps.map((step) => step.id));
      expect(new Set(a.steps.map((step) => step.id)).size, type).toBe(a.steps.length);
      expect(a.steps.every((step) => !/^step-\d+$/.test(step.id)), type).toBe(true);
    }
  });

  it('keeps ids stable for an assembly model', () => {
    const input = {
      kind: 'kitchen-base-run' as const,
      params: ASSEMBLY_DEFAULTS['kitchen-base-run'] as unknown as Record<string, unknown>,
    };
    const a = buildAssemblyPlan(input);
    const b = buildAssemblyPlan(input);
    expect(a.steps.map((step) => step.id)).toEqual(b.steps.map((step) => step.id));
    expect(a.steps.every((step) => !/^step-\d+$/.test(step.id))).toBe(true);
  });

  it('keeps a link valid when steps are reordered or a new step is inserted', () => {
    const plan = tablePlan();
    const hardware = hardwareFor(['step-leg']);
    const reversed = [...plan.steps].reverse();
    expect(validateHardwareSteps(hardware, reversed)).toEqual([]);

    const inserted: AssemblyStep = {
      ...plan.steps[0],
      id: 'step-new-panel',
      order: 0,
      title: 'Yangi panel',
      parts: [],
      dependsOn: [],
    };
    expect(validateHardwareSteps(hardware, [inserted, ...plan.steps])).toEqual([]);
  });

  it('reports a removed step instead of moving the link to a neighbour', () => {
    const plan = tablePlan();
    const hardware = hardwareFor(['step-leg']);
    const withoutLegs = plan.steps.filter((step) => step.id !== 'step-leg');
    expect(validateHardwareSteps(hardware, withoutLegs)).toEqual([
      '"Konfirmat" noma\'lum montaj qadamiga bog\'langan: step-leg.',
    ]);
  });

  it('does not fuzzy-match a similar id', () => {
    const hardware = hardwareFor(['step-leg-9']);
    expect(validateHardwareSteps(hardware, tablePlan().steps)).toHaveLength(1);
  });

  it('treats old numeric ids as legacy links, not as silently remapped ones', () => {
    const hardware = hardwareFor(['step-1']);
    const errors = validateHardwareSteps(hardware, tablePlan().steps);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/eski formatdagi qadam/);
    expect(errors[0]).toMatch(/qayta bog'lang/);
  });

  it('counts one hardware row once when it points at several steps', () => {
    const hardware = hardwareFor(['step-leg', 'step-top']);
    expect(hardware.totalPieces).toBe(12);
    expect(hardware.items).toHaveLength(1);
  });
});
