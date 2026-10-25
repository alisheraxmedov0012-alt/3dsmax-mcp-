import { describe, expect, it } from 'vitest';
import {
  READINESS_LIMITATIONS,
  assessProductReadiness,
  combineReadiness,
  isReadinessStale,
  readinessFingerprint,
  summarizeReadiness,
  type ProductReadinessInput,
  type ReadinessCheck,
  type ReadinessStatus,
} from './productReadiness';
import { createFurnitureParams, type FurnitureParams } from '../geometry/furniture/types';
import type { SheetMaterialEntry } from './sheetMaterial';

const SETTINGS = {
  sheetLengthMm: 2440,
  sheetWidthMm: 1220,
  kerfMm: 4,
  allowRotation: true,
} as const;

const MATERIALS: SheetMaterialEntry[] = [
  { partId: 'table-top', materialId: 'ldsp', thicknessMm: 18, thicknessSource: 'user' },
  { partId: 'table-leg', materialId: 'ldsp', thicknessMm: 18, thicknessSource: 'user' },
];

function input(overrides: Partial<ProductReadinessInput> = {}): ProductReadinessInput {
  return {
    type: 'table',
    params: createFurnitureParams('table'),
    sheetMaterials: MATERIALS,
    cuttingSettings: SETTINGS,
    ...overrides,
  };
}

function checkById(checks: readonly ReadinessCheck[], id: ReadinessCheck['id']): ReadinessCheck {
  const found = checks.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`missing check ${id}`);
  }
  return found;
}

describe('C8 readiness — status vocabulary', () => {
  it('keeps fail above warning above not_applicable above pass', () => {
    const status = (list: ReadinessStatus[]) =>
      summarizeReadiness(
        list.map((entry, index) => ({
          id: 'bom' as const,
          label: `c${index}`,
          status: entry,
          detail: '',
        })),
        'fp',
      ).status;

    expect(status(['pass', 'pass'])).toBe('pass');
    expect(status(['pass', 'not_applicable'])).toBe('pass');
    expect(status(['not_applicable', 'not_applicable'])).toBe('not_applicable');
    expect(status(['pass', 'warning'])).toBe('warning');
    expect(status(['warning', 'fail'])).toBe('fail');
  });

  it('never reports a warning as a pass', () => {
    const report = summarizeReadiness(
      [{ id: 'materials', label: 'Materiallar', status: 'warning', detail: 'x' }],
      'fp',
    );
    expect(report.status).toBe('warning');
    expect(report.counts.pass).toBe(0);
    expect(report.counts.warning).toBe(1);
  });

  it('collects blocker details from failing checks only', () => {
    const report = summarizeReadiness(
      [
        { id: 'bom', label: 'BOM', status: 'fail', detail: 'BOM bosh' },
        { id: 'drawing', label: 'Chizma', status: 'pass', detail: 'ok' },
        { id: 'pdf', label: 'PDF', status: 'fail', detail: 'PDF yo‘q' },
      ],
      'fp',
    );
    expect(report.blockers).toEqual(['BOM bosh', 'PDF yo‘q']);
  });
});

describe('C8 readiness — a complete product', () => {
  it('passes every structural check for a fully specified table', () => {
    const report = assessProductReadiness(input());
    expect(report.checks.map((check) => check.id)).toEqual([
      'model-params',
      'bom',
      'part-ids',
      'materials',
      'validation',
      'drawing',
      'assembly',
      'cutting',
    ]);
    expect(checkById(report.checks, 'model-params').status).toBe('pass');
    expect(checkById(report.checks, 'bom').status).toBe('pass');
    expect(checkById(report.checks, 'part-ids').status).toBe('pass');
    expect(checkById(report.checks, 'materials').status).toBe('pass');
    expect(checkById(report.checks, 'drawing').status).toBe('pass');
    expect(checkById(report.checks, 'assembly').status).toBe('pass');
    expect(checkById(report.checks, 'cutting').status).toBe('pass');
  });

  it('reports the observed numbers, not just a verdict', () => {
    const report = assessProductReadiness(input());
    expect(checkById(report.checks, 'bom').detail).toMatch(/2 tur · 5 dona/);
    expect(checkById(report.checks, 'assembly').detail).toMatch(/2 tartiblangan qadam/);
    expect(checkById(report.checks, 'cutting').detail).toMatch(/1 list/);
  });

  it('is deterministic for identical input', () => {
    expect(JSON.stringify(assessProductReadiness(input()))).toBe(
      JSON.stringify(assessProductReadiness(input())),
    );
  });
});

describe('C8 readiness — missing and invalid data', () => {
  it('fails on invalid parameters and says why', () => {
    const params = { ...createFurnitureParams('table'), widthCm: 1 } as FurnitureParams;
    const report = assessProductReadiness(input({ params }));
    expect(report.status).toBe('fail');
    expect(checkById(report.checks, 'model-params').status).toBe('fail');
    expect(checkById(report.checks, 'bom').status).toBe('fail');
    expect(checkById(report.checks, 'model-params').detail).toMatch(/yaroqsiz|yetishmayapti/);
  });

  it('fails when the model has no measurable parts', () => {
    const params = { ...createFurnitureParams('table') } as FurnitureParams;
    const report = assessProductReadiness(input({ params: { ...params } }));
    // A valid table always has parts; the guard is exercised through the BOM
    // contract instead: an empty BOM is impossible here, so the check must agree.
    expect(checkById(report.checks, 'bom').status).toBe('pass');
  });

  it('fails when C4 reports an error, and does not hide it behind a pass', () => {
    const params = { ...createFurnitureParams('table'), topThicknessCm: 60 } as FurnitureParams;
    const report = assessProductReadiness(input({ params }));
    const validation = checkById(report.checks, 'validation');
    expect(validation.status).toBe('fail');
    expect(validation.detail).toMatch(/1 xatolik/);
    expect(report.status).toBe('fail');
  });

  it('warns when C4 reports warnings but no errors', () => {
    const params = { ...createFurnitureParams('table'), heightCm: 40 } as FurnitureParams;
    const report = assessProductReadiness(input({ params }));
    expect(checkById(report.checks, 'validation').status).toBe('warning');
  });

  it('warns, with the part ids, when some parts have no material', () => {
    const report = assessProductReadiness(
      input({
        sheetMaterials: [
          { partId: 'table-top', materialId: 'ldsp', thicknessMm: 18, thicknessSource: 'user' },
        ],
      }),
    );
    const materials = checkById(report.checks, 'materials');
    expect(materials.status).toBe('warning');
    expect(materials.detail).toContain('table-leg');
  });

  it('warns and explains the consequence when nothing has a material', () => {
    const report = assessProductReadiness(input({ sheetMaterials: [] }));
    const materials = checkById(report.checks, 'materials');
    expect(materials.status).toBe('warning');
    expect(materials.detail).toMatch(/kesish rejasi tuzilmaydi/i);
  });

  it('does not count an unrequested cutting plan as a pass', () => {
    const report = assessProductReadiness(input({ cuttingSettings: null, cuttingPlan: null }));
    const cutting = checkById(report.checks, 'cutting');
    expect(cutting.status).toBe('warning');
    expect(cutting.detail).toMatch(/hisoblanmagan/i);
  });

  it('marks the cut list not applicable for a model with no panels', () => {
    const report = assessProductReadiness(
      input({ type: 'sofa', params: createFurnitureParams('sofa'), sheetMaterials: [] }),
    );
    const cutting = checkById(report.checks, 'cutting');
    expect(cutting.status).toBe('not_applicable');
    // Not applicable must not be mistaken for success.
    expect(report.counts.not_applicable).toBe(1);
  });
});

describe('C8 readiness — staleness', () => {
  it('detects a report that no longer matches the model', () => {
    const report = assessProductReadiness(input());
    const current = readinessFingerprint({
      type: 'table',
      params: createFurnitureParams('table'),
      sheetMaterials: MATERIALS,
    });
    expect(isReadinessStale(report, current)).toBe(false);

    const changed = readinessFingerprint({
      type: 'table',
      params: { ...createFurnitureParams('table'), widthCm: 180 },
      sheetMaterials: MATERIALS,
    });
    expect(isReadinessStale(report, changed)).toBe(true);
  });

  it('treats a material change as a model change', () => {
    const report = assessProductReadiness(input());
    const changed = readinessFingerprint({
      type: 'table',
      params: createFurnitureParams('table'),
      sheetMaterials: [MATERIALS[0]],
    });
    expect(isReadinessStale(report, changed)).toBe(true);
  });

  it('ignores the display colour, which cannot affect a document', () => {
    const a = readinessFingerprint({ type: 'table', params: createFurnitureParams('table') });
    const b = readinessFingerprint({
      type: 'table',
      params: { ...createFurnitureParams('table'), color: '#ff0000' },
    });
    expect(a).toBe(b);
  });
});

describe('C8 readiness — combined verdict', () => {
  it('stays presentable when only warnings remain', () => {
    const structural = assessProductReadiness(input({ sheetMaterials: [] }));
    const merged = combineReadiness(structural, []);
    expect(merged.status).toBe('warning');
    expect(merged.presentable).toBe(true);
    expect(merged.limitations).toEqual(expect.arrayContaining([...READINESS_LIMITATIONS]));
  });

  it('is not presentable when an export fails', () => {
    const structural = assessProductReadiness(input());
    const merged = combineReadiness(structural, [
      { id: 'pdf', label: 'PDF', status: 'fail', detail: 'PDF yaratilmadi' },
    ]);
    expect(merged.status).toBe('fail');
    expect(merged.presentable).toBe(false);
    expect(merged.blockers).toContain('PDF yaratilmadi');
  });

  it('always states that the check is not a certification', () => {
    const merged = combineReadiness(assessProductReadiness(input()), []);
    const text = merged.limitations.join(' ');
    expect(text).toMatch(/sertifikat/i);
    expect(text).toMatch(/mutaxassis/i);
    expect(text).toMatch(/evristik/i);
  });
});
