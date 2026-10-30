import { describe, expect, it } from 'vitest';
import { buildCuttingPlan } from './cuttingPlan';
import { createCuttingPlanSvg } from './cuttingPlanSvg';
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

function source(): CutListResult {
  const rows: CutListRow[] = [
    {
      partId: 'table-top',
      name: 'Ust paneli',
      quantity: 2,
      lengthMm: 400,
      widthMm: 300,
      thicknessMm: 18,
      source: 'bom',
      material,
      notes: [],
    },
  ];
  return { unit: 'mm', rows, totalPieces: 2, panelAreaM2: 0, limitations: [] };
}

describe('C7 — cutting layout SVG', () => {
  it('renders every validated placement with millimetre coordinates', () => {
    const outcome = buildCuttingPlan({
      cutList: source(),
      settings: { sheetLengthMm: 1000, sheetWidthMm: 1000, kerfMm: 5, allowRotation: true },
    });
    if (!outcome.ok) throw new Error(outcome.reason);
    const svg = createCuttingPlanSvg(outcome.plan);
    expect(svg).toContain('<svg');
    expect(svg).toMatch(/width="[\d.]+mm"/);
    expect(svg).toContain('viewBox=');
    expect(svg).toContain('Masshtab: 1:');
    expect(svg).toContain('table-top #1');
    expect(svg).toContain('table-top #2');
    expect(svg).toContain('List 1');
    expect(svg).toContain('mm');
  });

  it('refuses to draw fake coordinates when no plan exists', () => {
    const svg = createCuttingPlanSvg(null);
    expect(svg).toContain('Kesish rejasi hisoblanmagan');
    expect(svg).not.toContain('<rect x="0"');
  });

  it('states an unavailable plan without inventing sheets', () => {
    const noMaterial = source();
    noMaterial.rows[0].material = null;
    const outcome = buildCuttingPlan({
      cutList: noMaterial,
      settings: { sheetLengthMm: 1000, sheetWidthMm: 1000, kerfMm: 5, allowRotation: false },
    });
    if (!outcome.ok) throw new Error(outcome.reason);
    const svg = createCuttingPlanSvg(outcome.plan);
    expect(svg).toContain('Hech bir detal listga joylashmadi');
  });
});
