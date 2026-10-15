import { describe, expect, it } from 'vitest';
import { buildBom } from './bom';
import { buildCutList } from './cutList';
import { createFurnitureParams, FURNITURE_TYPES, type FurnitureType } from '../geometry/furniture/types';

function cutListFor(type: FurnitureType) {
  const outcome = buildBom(type, createFurnitureParams(type));
  if (!outcome.ok) {
    throw new Error(`BOM failed for ${type}`);
  }
  return buildCutList(outcome.bom);
}

describe('buildCutList', () => {
  it('derives panel rows from the BOM for every type', () => {
    for (const type of FURNITURE_TYPES) {
      const cutList = cutListFor(type);
      expect(cutList.unit).toBe('mm');
      for (const row of cutList.rows) {
        expect(row.source).toBe('bom');
        expect(row.quantity).toBeGreaterThan(0);
        // length >= width >= thickness.
        expect(row.lengthMm).toBeGreaterThanOrEqual(row.widthMm);
        expect(row.widthMm).toBeGreaterThanOrEqual(row.thicknessMm);
        expect(row.thicknessMm).toBeGreaterThan(0);
      }
    }
  });

  it('orders a table top as 1200 x 600 x 40 mm', () => {
    const top = cutListFor('table').rows.find((row) => row.partId === 'table-top');
    expect(top?.lengthMm).toBeCloseTo(1200, 1);
    expect(top?.widthMm).toBeCloseTo(600, 1);
    expect(top?.thicknessMm).toBeCloseTo(40, 1);
  });

  it('excludes non-panel parts (legs, arms, mattress, body)', () => {
    expect(cutListFor('table').rows.some((row) => row.partId.includes('leg'))).toBe(false);
    expect(cutListFor('bed').rows.some((row) => row.partId.includes('mattress'))).toBe(false);
    expect(cutListFor('dresser').rows.some((row) => row.partId.includes('body'))).toBe(false);
    expect(cutListFor('sofa').rows.some((row) => row.partId.includes('arm'))).toBe(false);
  });

  it('counts the pieces and the panel area', () => {
    const table = cutListFor('table');
    expect(table.totalPieces).toBe(1);
    expect(table.panelAreaM2).toBeCloseTo(0.72, 2);

    const wardrobe = cutListFor('wardrobe');
    // side×2, top, bottom, back, shelf×4, door×2 = 11 panels.
    expect(wardrobe.totalPieces).toBe(11);
  });

  it('states its limitations (kerf, nesting, grain)', () => {
    const text = cutListFor('shelf').limitations.join(' ');
    expect(text).toMatch(/kerf/i);
    expect(text).toMatch(/nesting/i);
    expect(text).toMatch(/tolasi/i);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(cutListFor('wardrobe'))).toBe(JSON.stringify(cutListFor('wardrobe')));
  });
});
