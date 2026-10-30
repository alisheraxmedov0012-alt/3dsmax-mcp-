import { describe, expect, it } from 'vitest';
import { buildCuttingPlan, type CuttingPlan } from './cuttingPlan';
import { validateCuttingPlan } from './cuttingPlanValidation';
import type { CutListResult, CutListRow } from './cutList';
import type { BomMaterialInfo } from './sheetMaterial';

const material: BomMaterialInfo = {
  materialId: 'ldsp',
  name: 'LDSP',
  thicknessMm: 18,
  unit: 'mm',
  source: 'user',
  geometryThicknessMm: 18,
  thicknessMismatch: false,
  issues: [],
};

function row(partId: string, lengthMm: number, widthMm: number, quantity: number): CutListRow {
  return {
    partId,
    name: partId,
    quantity,
    lengthMm,
    widthMm,
    thicknessMm: 18,
    source: 'bom',
    material,
    notes: [],
  };
}

function cutList(rows: CutListRow[]): CutListResult {
  return {
    unit: 'mm',
    rows,
    totalPieces: rows.reduce((sum, entry) => sum + entry.quantity, 0),
    panelAreaM2: 0,
    limitations: [],
  };
}

function makePlan(rows = [row('a', 400, 300, 2)]): { plan: CuttingPlan; source: CutListResult } {
  const source = cutList(rows);
  const outcome = buildCuttingPlan({
    cutList: source,
    settings: { sheetLengthMm: 1000, sheetWidthMm: 1000, kerfMm: 5, allowRotation: false },
  });
  if (!outcome.ok) throw new Error(outcome.reason);
  return { plan: outcome.plan, source };
}

function clone(plan: CuttingPlan): CuttingPlan {
  return JSON.parse(JSON.stringify(plan)) as CuttingPlan;
}

function codes(plan: CuttingPlan, source?: CutListResult): string[] {
  return validateCuttingPlan(plan, { cutList: source }).issues.map((issue) => issue.code);
}

describe('C7 — independent cutting plan validator', () => {
  it('accepts a validator-clean plan', () => {
    const { plan, source } = makePlan();
    expect(validateCuttingPlan(plan, { cutList: source }).ok).toBe(true);
    expect(plan.summary.placedCount).toBe(2);
  });

  it('allows a piece that exactly fills the usable board', () => {
    const source = cutList([row('full', 1000, 1000, 1)]);
    const outcome = buildCuttingPlan({
      cutList: source,
      settings: { sheetLengthMm: 1000, sheetWidthMm: 1000, kerfMm: 5, allowRotation: false },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(validateCuttingPlan(outcome.plan, { cutList: source }).ok).toBe(true);
  });

  it('finds overlap, outside bounds and negative coordinates', () => {
    const { plan, source } = makePlan();
    const overlap = clone(plan);
    const sheet = overlap.groups[0].sheets[0];
    sheet.placements[1].xMm = sheet.placements[0].xMm;
    sheet.placements[1].yMm = sheet.placements[0].yMm;
    expect(codes(overlap, source)).toContain('piece-overlap');

    const outside = clone(plan);
    outside.groups[0].sheets[0].placements[0].xMm = 999;
    expect(codes(outside, source)).toContain('piece-outside-sheet');

    const negative = clone(plan);
    negative.groups[0].sheets[0].placements[0].xMm = -1;
    expect(codes(negative, source)).toContain('negative-coordinate');
  });

  it('finds a kerf gap that is too small', () => {
    const { plan, source } = makePlan();
    const bad = clone(plan);
    const sheet = bad.groups[0].sheets[0];
    sheet.placements[1].xMm = sheet.placements[0].xMm;
    sheet.placements[1].yMm = sheet.placements[0].yMm + sheet.placements[0].heightMm;
    expect(codes(bad, source)).toContain('kerf-violation');
  });

  it('finds count, area and status mismatches', () => {
    const { plan, source } = makePlan();
    const missing = clone(plan);
    missing.groups[0].sheets[0].placements.pop();
    expect(codes(missing, source)).toContain('count-mismatch');

    const area = clone(plan);
    area.groups[0].sheets[0].usedAreaM2 = 0.001;
    expect(codes(area, source)).toContain('area-mismatch');

    const status = clone(plan);
    status.status = 'unavailable';
    expect(codes(status, source)).toContain('status-inconsistent');
  });

  it('finds a group thickness mismatch', () => {
    const { plan, source } = makePlan();
    const bad = clone(plan);
    bad.groups[0].thicknessMm = 20;
    bad.groups[0].sheets[0].thicknessMm = 20;
    expect(codes(bad, source)).toContain('thickness-mismatch');
  });

  it('finds a source cut-list count that the plan did not account for', () => {
    const { plan } = makePlan();
    const source = cutList([row('a', 400, 300, 3)]);
    expect(codes(plan, source)).toContain('count-mismatch');
  });
});
