import { describe, expect, it } from 'vitest';
import { buildBom } from './bom';
import { createFurnitureParams, FURNITURE_TYPES, type FurnitureType } from '../geometry/furniture/types';

/** Expected total part counts, verified against real geometry. */
const EXPECTED_TOTAL: Record<FurnitureType, number> = {
  table: 5,
  chair: 6,
  armchair: 8,
  sofa: 8,
  bed: 7,
  wardrobe: 11,
  shelf: 9,
  dresser: 8,
};

function bom(type: FurnitureType) {
  const outcome = buildBom(type, createFurnitureParams(type));
  if (!outcome.ok) {
    throw new Error(`unexpected BOM failure for ${type}: ${outcome.reason}`);
  }
  return outcome.bom;
}

describe('buildBom', () => {
  it('builds a BOM for every furniture type with measured geometry', () => {
    for (const type of FURNITURE_TYPES) {
      const result = bom(type);
      expect(result.type).toBe(type);
      expect(result.unit).toBe('mm');
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.totalParts).toBe(EXPECTED_TOTAL[type]);
      for (const row of result.rows) {
        expect(row.quantity).toBeGreaterThan(0);
        expect(row.sources.dimensions).toBe('geometry');
        expect(row.sources.quantity).toBe('counted');
        expect(row.sources.material).toBe('unavailable');
        // Material is never invented.
        expect(row.material).toBeNull();
      }
    }
  });

  it('converts measured centimetres to millimetres', () => {
    const result = bom('table');
    const top = result.rows.find((row) => row.kind === 'top');
    expect(top?.sizeMm.x).toBeCloseTo(1200, 1);
    expect(top?.sizeMm.y).toBeCloseTo(40, 1);
    expect(top?.sizeMm.z).toBeCloseTo(600, 1);
    expect(top?.thicknessMm).toBeCloseTo(40, 1);
  });

  it('counts repeated parts (table legs, wardrobe shelves, dresser drawers)', () => {
    expect(bom('table').rows.find((r) => r.kind === 'leg')?.quantity).toBe(4);
    expect(bom('wardrobe').rows.find((r) => r.kind === 'shelf')?.quantity).toBe(4);
    expect(bom('wardrobe').rows.find((r) => r.kind === 'door')?.quantity).toBe(2);
    expect(bom('dresser').rows.find((r) => r.kind === 'drawer')?.quantity).toBe(3);
  });

  it('assigns thickness only to panel parts', () => {
    const result = bom('table');
    expect(result.rows.find((r) => r.kind === 'top')?.thicknessMm).not.toBeNull();
    expect(result.rows.find((r) => r.kind === 'leg')?.thicknessMm).toBeNull();
  });

  it('does not treat a thick slab as a thin panel', () => {
    // The sofa seat is a 34 cm cushion: it is a panel kind but too thick to cut.
    const seat = bom('sofa').rows.find((r) => r.kind === 'seat');
    expect(seat?.thicknessMm).toBeNull();
    expect(seat?.notes.join(' ')).toMatch(/panel emas/i);
  });

  it('states its limitations', () => {
    const result = bom('table');
    expect(result.limitations.join(' ')).toMatch(/material/i);
    expect(result.limitations.join(' ')).toMatch(/kerf/i);
    expect(result.limitations.join(' ')).toMatch(/mustahkamlik/i);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(bom('wardrobe'))).toBe(JSON.stringify(bom('wardrobe')));
  });

  it('rejects invalid or missing parameters safely', () => {
    const bad = buildBom('table', { ...createFurnitureParams('table'), widthCm: Number.NaN });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason.length).toBeGreaterThan(0);

    const negative = buildBom('chair', { ...createFurnitureParams('chair'), widthCm: -10 });
    expect(negative.ok).toBe(false);
  });

  it('reports a panel area estimate', () => {
    const result = bom('table');
    // One 1200x600 mm top = 0.72 m².
    expect(result.panelAreaM2).toBeCloseTo(0.72, 2);
  });
});
