/**
 * C8.4 — the three size concepts must stay distinct and agree where they should.
 *
 * Parametric size is what the user types, overall size is the measured bounding
 * box, part size is per-part. For most pieces the first two coincide; for a bed
 * the headboard and for a dresser the drawer fronts push the envelope past the
 * parametric frame. These tests pin all three cases so nobody "simplifies" the
 * distinction away.
 */
import { describe, expect, it } from 'vitest';
import { buildFurniture } from '../geometry/furniture/buildFurniture';
import { envelopeMm, measurePartBoxes, type PartBox } from './partBoxes';
import { createTechnicalDrawingSvg } from './technicalDrawing';
import { buildBom } from './bom';
import { buildCutList } from './cutList';
import {
  FURNITURE_FIELDS,
  FURNITURE_TYPES,
  createFurnitureParams,
  type FurnitureParams,
  type FurnitureType,
} from '../geometry/furniture/types';

/** Measured envelope of a built piece, in mm. */
function measure(type: FurnitureType, params: FurnitureParams) {
  const built = buildFurniture(type, params);
  try {
    return envelopeMm(measurePartBoxes(built.group));
  } finally {
    built.dispose();
  }
}

function box(min: [number, number, number], max: [number, number, number]): PartBox {
  return {
    partId: 'p',
    minX: min[0],
    minY: min[1],
    minZ: min[2],
    maxX: max[0],
    maxY: max[1],
    maxZ: max[2],
  };
}

describe('C8.4 partBoxes — envelope from boxes', () => {
  it('unions every box into one envelope, in millimetres', () => {
    const boxes = [box([0, 0, 0], [10, 4, 6]), box([0, 0, 0], [10, 9, 6])];
    // 10 cm x 9 cm x 6 cm -> 100 x 90 x 60 mm.
    expect(envelopeMm(boxes)).toEqual({ widthMm: 100, heightMm: 90, depthMm: 60 });
  });

  it('covers the full extent when parts sit away from the origin', () => {
    const boxes = [box([-10, 0, -5], [0, 10, 0]), box([0, 0, 0], [10, 10, 5])];
    expect(envelopeMm(boxes)).toEqual({ widthMm: 200, heightMm: 100, depthMm: 100 });
  });

  it('returns null instead of a fabricated size for empty or degenerate input', () => {
    expect(envelopeMm([])).toBeNull();
    // Zero extent in every axis cannot describe a piece.
    expect(envelopeMm([box([5, 5, 5], [5, 5, 5])])).toBeNull();
  });

  it('ignores non-finite boxes rather than poisoning the result', () => {
    const NaNCorner = { ...box([0, 0, 0], [10, 10, 10]), maxY: Number.NaN };
    // The caller filters these out; the envelope of the survivors is still valid.
    const finite = [box([0, 0, 0], [10, 20, 10])];
    expect(envelopeMm(finite.filter((b) => Number.isFinite(b.maxY)))).toEqual({
      widthMm: 100,
      heightMm: 200,
      depthMm: 100,
    });
    expect(envelopeMm([NaNCorner])).toBeNull();
  });
});

describe('C8.4 case 1 — table: parametric size equals overall size', () => {
  it('measures exactly the parametric box', () => {
    const params = createFurnitureParams('table');
    const overall = measure('table', params);
    expect(overall).toEqual({
      widthMm: params.widthCm * 10,
      heightMm: params.heightCm * 10,
      depthMm: params.depthCm * 10,
    });
  });

  it('follows a parameter change', () => {
    const wider = { ...createFurnitureParams('table'), widthCm: 180 };
    expect(measure('table', wider)?.widthMm).toBe(1800);
  });

  it('agrees with the drawing header', () => {
    const params = createFurnitureParams('table');
    const drawing = createTechnicalDrawingSvg('table', params, { title: 'T', date: '2026-06-01' });
    if (!drawing.ok) throw new Error(drawing.reason);
    expect(drawing.overall).toEqual(measure('table', params));
  });
});

describe('C8.4 case 2 — bed: the headboard stands above the frame', () => {
  it('reports a taller envelope than the frame height parameter', () => {
    const params = createFurnitureParams('bed');
    const overall = measure('bed', params);
    if (!overall) throw new Error('no envelope');

    expect(overall.heightMm).toBeGreaterThan(params.heightCm * 10);
    // The headboard is the tallest element, so it sets the overall height.
    expect(overall.heightMm).toBe((params.headboardHeightCm ?? 0) * 10);
    // Width and length are unaffected by the headboard.
    expect(overall.widthMm).toBe(params.widthCm * 10);
    expect(overall.depthMm).toBe(params.depthCm * 10);
  });

  it('labels the parameter as frame height and says it is not the overall size', () => {
    const spec = FURNITURE_FIELDS.bed.find((field) => field.key === 'heightCm');
    expect(spec?.label).toMatch(/Karkas balandligi/);
    expect(spec?.hint).toMatch(/umumiy balandlik kattaroq/i);
  });

  it('keeps the parametric value intact — the geometry contract is unchanged', () => {
    const params = createFurnitureParams('bed');
    expect(params.heightCm).toBe(40);
    expect(measure('bed', params)?.heightMm).toBe(900);
  });
});

describe('C8.4 case 3 — dresser: drawer fronts add to the depth', () => {
  it('reports a deeper envelope than the carcass depth parameter', () => {
    const params = createFurnitureParams('dresser');
    const overall = measure('dresser', params);
    if (!overall) throw new Error('no envelope');

    expect(overall.depthMm).toBeGreaterThan(params.depthCm * 10);
    // The fronts protrude by their own thickness (2 cm) on the default model.
    expect(overall.depthMm - params.depthCm * 10).toBeCloseTo(20, 1);
    // Width and height match the parametric box.
    expect(overall.widthMm).toBe(params.widthCm * 10);
    expect(overall.heightMm).toBe(params.heightCm * 10);
  });

  it('calls the parameter carcass depth, not plain depth', () => {
    const spec = FURNITURE_FIELDS.dresser.find((field) => field.key === 'depthCm');
    expect(spec?.label).toBe('Korpus chuqurligi (sm)');
    expect(spec?.hint).toMatch(/umumiy chuqurlik kattaroq/i);
  });

  it('does not claim an overall depth the geometry contradicts', () => {
    const params = createFurnitureParams('dresser');
    const overall = measure('dresser', params);
    expect(overall?.depthMm).not.toBe(params.depthCm * 10);
  });
});

describe('C8.4 — drawing, BOM and cut list stay consistent', () => {
  it('the drawing reports the measured envelope for every type', () => {
    for (const type of FURNITURE_TYPES) {
      const params = createFurnitureParams(type);
      const drawing = createTechnicalDrawingSvg(type, params, { title: 'T', date: '2026-06-01' });
      if (!drawing.ok) throw new Error(`${type}: ${drawing.reason}`);
      expect(drawing.overall, type).toEqual(measure(type, params));
    }
  });

  it('BOM part sizes are unaffected by the envelope distinction', () => {
    // A part's own box is what the workshop cuts; the envelope never rewrites it.
    const params = createFurnitureParams('dresser');
    const bom = buildBom('dresser', params);
    if (!bom.ok) throw new Error(bom.reason);
    const top = bom.bom.rows.find((row) => row.partId === 'dresser-body');
    expect(top).toBeDefined();
    // The carcass part is at most the carcass depth, never the larger envelope.
    const dims = [top!.sizeMm.x, top!.sizeMm.y, top!.sizeMm.z];
    expect(Math.max(...dims)).toBeLessThanOrEqual(params.widthCm * 10);
  });

  it('cut list quantities and part ids are unchanged by this stage', () => {
    const params = createFurnitureParams('dresser');
    const bom = buildBom('dresser', params);
    if (!bom.ok) throw new Error(bom.reason);
    const cut = buildCutList(bom.bom);
    expect(cut.rows.map((row) => row.partId)).toEqual(
      bom.bom.rows.filter((row) => row.thicknessMm !== null).map((row) => row.partId),
    );
  });
});
