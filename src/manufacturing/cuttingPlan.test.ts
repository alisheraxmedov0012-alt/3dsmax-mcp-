import { describe, expect, it } from 'vitest';
import { buildBom } from './bom';
import { buildCutList, type CutListResult, type CutListRow } from './cutList';
import {
  CUTTING_LIMITS,
  CUTTING_PLAN_LIMITATIONS,
  buildCuttingPlan,
  usableSheetAreaM2,
  validateSheetSettings,
  type CuttingPlan,
  type PlacedPiece,
  type SheetSettingsInput,
} from './cuttingPlan';
import type { BomMaterialInfo, SheetMaterialId } from './sheetMaterial';
import { createFurnitureParams, type FurnitureType } from '../geometry/furniture/types';

function material(
  materialId: SheetMaterialId = 'ldsp',
  thicknessMm = 18,
  overrides: Partial<BomMaterialInfo> = {},
): BomMaterialInfo {
  return {
    materialId,
    name: materialId.toUpperCase(),
    thicknessMm,
    unit: 'mm',
    source: 'user',
    geometryThicknessMm: thicknessMm,
    thicknessMismatch: false,
    issues: [],
    ...overrides,
  };
}

function row(
  partId: string,
  lengthMm: number,
  widthMm: number,
  quantity: number,
  options: { thicknessMm?: number; material?: BomMaterialInfo | null } = {},
): CutListRow {
  return {
    partId,
    name: `Nomi ${partId}`,
    quantity,
    lengthMm,
    widthMm,
    thicknessMm: options.thicknessMm ?? 18,
    source: 'bom',
    material: options.material === undefined ? material() : options.material,
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

const SETTINGS: SheetSettingsInput = {
  sheetLengthMm: 1000,
  sheetWidthMm: 1000,
  kerfMm: 0,
  allowRotation: false,
};

function planFor(rows: CutListRow[], settings: Partial<SheetSettingsInput> = {}): CuttingPlan {
  const outcome = buildCuttingPlan({
    cutList: cutList(rows),
    settings: { ...SETTINGS, ...settings },
  });
  if (!outcome.ok) {
    throw new Error(`plan failed: ${outcome.reason}`);
  }
  return outcome.plan;
}

function allPlacements(plan: CuttingPlan): PlacedPiece[] {
  return plan.groups.flatMap((group) => group.sheets.flatMap((sheet) => sheet.placements));
}

function overlaps(a: PlacedPiece, b: PlacedPiece): boolean {
  return (
    a.xMm < b.xMm + b.widthMm &&
    b.xMm < a.xMm + a.widthMm &&
    a.yMm < b.yMm + b.heightMm &&
    b.yMm < a.yMm + a.heightMm
  );
}

describe('C7 sheet settings — validation', () => {
  it('accepts a complete set of settings', () => {
    const outcome = validateSheetSettings({
      sheetLengthMm: 2440,
      sheetWidthMm: 1220,
      kerfMm: 4,
      edgeMarginMm: 10,
      allowRotation: true,
      maxSheets: 8,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.settings.sheetLengthMm).toBe(2440);
    expect(outcome.settings.edgeMarginProvided).toBe(true);
    expect(outcome.settings.maxSheets).toBe(8);
  });

  it('records an omitted edge margin as 0 and marks it as not provided', () => {
    const outcome = validateSheetSettings(SETTINGS);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.settings.edgeMarginMm).toBe(0);
    expect(outcome.settings.edgeMarginProvided).toBe(false);
    expect(outcome.settings.maxSheets).toBeNull();
  });

  it.each([
    ['zero length', { sheetLengthMm: 0 }, /uzunligi.*noldan katta/i],
    ['negative length', { sheetLengthMm: -10 }, /uzunligi.*noldan katta/i],
    ['zero width', { sheetWidthMm: 0 }, /kengligi.*noldan katta/i],
    ['negative width', { sheetWidthMm: -5 }, /kengligi.*noldan katta/i],
    ['NaN length', { sheetLengthMm: Number.NaN }, /uzunligi.*son/i],
    ['infinite width', { sheetWidthMm: Number.POSITIVE_INFINITY }, /kengligi.*son/i],
    ['negative kerf', { kerfMm: -1 }, /kerf.*manfiy/i],
    ['NaN kerf', { kerfMm: Number.NaN }, /kerf.*son/i],
    ['negative margin', { edgeMarginMm: -2 }, /chegarasi.*manfiy/i],
    ['infinite margin', { edgeMarginMm: Number.POSITIVE_INFINITY }, /chegarasi.*son/i],
  ])('rejects %s with a clear reason', (_label, patch, expected) => {
    const outcome = validateSheetSettings({ ...SETTINGS, ...patch } as SheetSettingsInput);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(expected);
  });

  it('rejects an oversized sheet instead of computing on a typo', () => {
    const outcome = validateSheetSettings({
      ...SETTINGS,
      sheetLengthMm: CUTTING_LIMITS.maxSheetDimensionMm + 1,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/juda katta/i);
  });

  it('rejects a margin that leaves no board to cut from', () => {
    const outcome = validateSheetSettings({ ...SETTINGS, edgeMarginMm: 500 });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/joy qolmadi/i);
  });

  it('requires an explicit rotation choice', () => {
    const outcome = validateSheetSettings({
      ...SETTINGS,
      allowRotation: undefined as unknown as boolean,
    });
    expect(outcome.ok).toBe(false);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects a sheet count of %s', (maxSheets) => {
    const outcome = validateSheetSettings({ ...SETTINGS, maxSheets });
    expect(outcome.ok).toBe(false);
  });

  it('allows a zero kerf but reports it, rather than silently assuming one', () => {
    const plan = planFor([row('a', 500, 500, 1)], { kerfMm: 0 });
    expect(plan.issues.some((issue) => issue.code === 'kerf-zero')).toBe(true);
    expect(plan.settings.kerfMm).toBe(0);
  });

  it('says when no edge margin was supplied instead of implying a shop standard', () => {
    const plan = planFor([row('a', 500, 500, 1)]);
    expect(plan.issues.some((issue) => issue.code === 'edge-margin-defaulted')).toBe(true);
  });
});

describe('C7 cutting plan — placement', () => {
  it('places a single piece at the sheet origin', () => {
    const plan = planFor([row('a', 500, 400, 1)]);
    expect(plan.status).toBe('ok');
    expect(plan.groups).toHaveLength(1);
    const [placement] = allPlacements(plan);
    expect(placement).toMatchObject({ partId: 'a', xMm: 0, yMm: 0, widthMm: 500, heightMm: 400 });
  });

  it('expands a quantity into separate physical pieces with stable instances', () => {
    const plan = planFor([row('leg', 400, 400, 4)]);
    const placements = allPlacements(plan);
    expect(placements).toHaveLength(4);
    expect(placements.map((piece) => piece.instance).sort()).toEqual([1, 2, 3, 4]);
    expect(new Set(placements.map((piece) => piece.partId))).toEqual(new Set(['leg']));
    expect(plan.summary.placedCount).toBe(4);
  });

  it('reports a part larger than the sheet instead of dropping it', () => {
    const plan = planFor([row('huge', 2000, 100, 1), row('ok', 300, 300, 1)]);
    expect(plan.status).toBe('partial');
    const unplaced = plan.unplaced.find((piece) => piece.partId === 'huge');
    expect(unplaced?.reason).toBe('piece-too-large');
    expect(plan.issues.some((issue) => issue.code === 'piece-too-large')).toBe(true);
    // The piece that does fit is still placed.
    expect(allPlacements(plan).map((piece) => piece.partId)).toEqual(['ok']);
  });

  it('turns a piece only when rotation is allowed', () => {
    // 400 x 900 only fits a 1000 x 400 sheet after a quarter turn.
    const rows = [row('tall', 400, 900, 1)];
    const rotated = planFor(rows, { allowRotation: true, sheetWidthMm: 400 });
    expect(rotated.status).toBe('ok');
    expect(allPlacements(rotated)[0]).toMatchObject({ widthMm: 900, heightMm: 400, rotated: true });

    const fixed = planFor(rows, { allowRotation: false, sheetWidthMm: 400 });
    expect(fixed.status).toBe('unavailable');
    expect(fixed.unplaced[0].reason).toBe('piece-too-large');
  });

  it('keeps the entered sheet orientation when rotation is forbidden', () => {
    // 900 x 400 fits an upright 1000 x 1000 sheet without any turn.
    const plan = planFor([row('a', 900, 400, 1)], { allowRotation: false });
    expect(allPlacements(plan)[0].rotated).toBe(false);
  });

  it('opens a second sheet when the first is full', () => {
    const plan = planFor([row('a', 1000, 1000, 2)]);
    expect(plan.summary.sheetCount).toBe(2);
    expect(plan.groups[0].sheets).toHaveLength(2);
    expect(allPlacements(plan)).toHaveLength(2);
  });

  it('respects the kerf so two pieces do not share a sheet they cannot fit on', () => {
    const rows = [row('a', 500, 1000, 2)];
    expect(planFor(rows, { kerfMm: 0 }).summary.sheetCount).toBe(1);
    // 500 + 4 kerf + 500 = 1004 > 1000, so a second board is needed.
    expect(planFor(rows, { kerfMm: 4 }).summary.sheetCount).toBe(2);
  });

  it('shrinks the usable area by the edge margin on all four sides', () => {
    const plan = planFor([row('a', 990, 100, 1)], { edgeMarginMm: 10 });
    expect(plan.status).toBe('unavailable');
    expect(plan.unplaced[0].reason).toBe('piece-too-large');

    const withoutMargin = planFor([row('a', 990, 100, 1)]);
    expect(withoutMargin.status).toBe('ok');
    expect(allPlacements(withoutMargin)[0].xMm).toBe(0);

    const withMargin = planFor([row('a', 900, 100, 1)], { edgeMarginMm: 10 });
    expect(allPlacements(withMargin)[0].xMm).toBe(10);
    expect(allPlacements(withMargin)[0].yMm).toBe(10);
  });

  it('stops at the sheet limit and names the pieces it could not place', () => {
    const plan = planFor([row('a', 1000, 1000, 3)], { maxSheets: 2 });
    expect(plan.status).toBe('partial');
    expect(plan.summary.sheetCount).toBe(2);
    expect(plan.unplaced).toHaveLength(1);
    expect(plan.unplaced[0].reason).toBe('sheet-limit');
  });

  it('never overlaps pieces and never lets one leave the sheet', () => {
    const rows = [
      row('a', 700, 300, 5),
      row('b', 450, 450, 4),
      row('c', 1200, 200, 3),
      row('d', 333, 777, 4),
      row('e', 250, 190, 6),
    ];
    for (const allowRotation of [true, false]) {
      for (const kerfMm of [0, 4]) {
        for (const edgeMarginMm of [0, 10]) {
          const plan = planFor(rows, {
            sheetLengthMm: 2440,
            sheetWidthMm: 1220,
            kerfMm,
            edgeMarginMm,
            allowRotation,
          });
          const { settings } = plan;
          const rightLimit = settings.sheetLengthMm - settings.edgeMarginMm;
          const topLimit = settings.sheetWidthMm - settings.edgeMarginMm;
          for (const group of plan.groups) {
            for (const sheet of group.sheets) {
              for (const piece of sheet.placements) {
                expect(piece.xMm).toBeGreaterThanOrEqual(settings.edgeMarginMm - 1e-9);
                expect(piece.yMm).toBeGreaterThanOrEqual(settings.edgeMarginMm - 1e-9);
                expect(piece.xMm + piece.widthMm).toBeLessThanOrEqual(rightLimit + 1e-9);
                expect(piece.yMm + piece.heightMm).toBeLessThanOrEqual(topLimit + 1e-9);
              }
              for (let i = 0; i < sheet.placements.length; i += 1) {
                for (let j = i + 1; j < sheet.placements.length; j += 1) {
                  expect(overlaps(sheet.placements[i], sheet.placements[j])).toBe(false);
                }
              }
            }
          }
          // Nothing silently disappears: placed + unplaced equals the pieces asked for.
          const placed = allPlacements(plan).length;
          const unplaced = plan.unplaced.reduce((sum, piece) => sum + piece.quantity, 0);
          expect(placed + unplaced).toBe(22);
        }
      }
    }
  });

  it('leaves at least one kerf between neighbouring pieces', () => {
    const plan = planFor([row('a', 400, 400, 9)], { kerfMm: 5, sheetLengthMm: 2000 });
    for (const sheet of plan.groups[0].sheets) {
      const pieces = [...sheet.placements].sort((a, b) => a.xMm - b.xMm);
      for (let i = 1; i < pieces.length; i += 1) {
        const previous = pieces[i - 1];
        const current = pieces[i];
        const sameRow = Math.abs(previous.yMm - current.yMm) < 1e-9;
        if (sameRow) {
          expect(current.xMm - (previous.xMm + previous.widthMm)).toBeGreaterThanOrEqual(5 - 1e-9);
        }
      }
    }
  });

  it('is deterministic for identical input', () => {
    const rows = [row('a', 700, 300, 7), row('b', 450, 450, 5), row('c', 250, 190, 9)];
    const settings = { sheetLengthMm: 2440, sheetWidthMm: 1220, kerfMm: 4, allowRotation: true };
    const first = planFor(rows, settings);
    const second = planFor(rows, settings);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('C7 cutting plan — material separation', () => {
  it('never mixes different materials on one sheet', () => {
    const plan = planFor([
      row('a', 500, 500, 1, { material: material('ldsp', 18) }),
      row('b', 500, 500, 1, { material: material('mdf', 18) }),
    ]);
    expect(plan.groups).toHaveLength(2);
    for (const group of plan.groups) {
      const partIds = group.sheets.flatMap((sheet) => sheet.placements.map((piece) => piece.partId));
      expect(new Set(partIds).size).toBe(1);
    }
    expect(plan.summary.materialCount).toBe(2);
  });

  it('never mixes different nominal thicknesses of one material', () => {
    const plan = planFor([
      row('a', 500, 500, 1, { material: material('ldsp', 18) }),
      row('b', 500, 500, 1, { material: material('ldsp', 12) }),
    ]);
    expect(plan.groups).toHaveLength(2);
    expect(plan.groups.map((group) => group.thicknessMm).sort()).toEqual([12, 18]);
  });

  it('lists parts with no material instead of guessing one', () => {
    const plan = planFor([
      row('a', 500, 500, 2, { material: material('ldsp', 18) }),
      row('b', 300, 300, 3, { material: null }),
    ]);
    expect(plan.status).toBe('partial');
    const unplaced = plan.unplaced.filter((piece) => piece.reason === 'no-material');
    expect(unplaced).toHaveLength(1);
    expect(unplaced[0]).toMatchObject({ partId: 'b', quantity: 3 });
    expect(plan.groups).toHaveLength(1);
  });

  it('reports unavailable when no part carries a material', () => {
    const plan = planFor([row('a', 500, 500, 2, { material: null })]);
    expect(plan.status).toBe('unavailable');
    expect(plan.summary.sheetCount).toBe(0);
    expect(plan.unplaced[0].reason).toBe('no-material');
    expect(plan.issues.some((issue) => issue.code === 'no-material')).toBe(true);
  });

  it('flags a nominal thickness that disagrees with the measured geometry', () => {
    const plan = planFor([
      row('a', 500, 500, 1, {
        material: material('ldsp', 18, { geometryThicknessMm: 16, thicknessMismatch: true }),
      }),
    ]);
    const issue = plan.issues.find((entry) => entry.code === 'thickness-mismatch');
    expect(issue?.level).toBe('info');
    expect(issue?.message).toContain('18');
    expect(issue?.message).toContain('16');
  });
});

describe('C7 cutting plan — area and waste accounting', () => {
  it('computes used, waste and percentage for a clean single sheet', () => {
    const plan = planFor([row('a', 500, 500, 1)]);
    expect(plan.summary.usedAreaM2).toBeCloseTo(0.25, 3);
    expect(plan.summary.availableAreaM2).toBeCloseTo(1, 3);
    expect(plan.summary.kerfAreaM2).toBe(0);
    expect(plan.summary.wasteAreaM2).toBeCloseTo(0.75, 3);
    expect(plan.summary.wastePercent).toBeCloseTo(75, 1);
  });

  it('reports kerf area separately from offcut waste', () => {
    const plan = planFor([row('a', 500, 500, 1)], { kerfMm: 10 });
    // Reserved band 510 x 510 minus the 500 x 500 piece = 0.0101 m², reported at
    // the project's three-decimal m² precision.
    expect(plan.summary.kerfAreaM2).toBeCloseTo(0.01, 3);
    expect(plan.summary.wasteAreaM2).toBeCloseTo(0.74, 2);
    // They are distinct quantities, not the same number counted twice.
    expect(plan.summary.kerfAreaM2).toBeLessThan(plan.summary.wasteAreaM2);
  });

  it('keeps the three areas adding up to the board area', () => {
    const plan = planFor(
      [row('a', 700, 300, 5), row('b', 450, 450, 3)],
      { sheetLengthMm: 2440, sheetWidthMm: 1220, kerfMm: 4, edgeMarginMm: 8, allowRotation: true },
    );
    const { summary } = plan;
    expect(summary.usedAreaM2 + summary.kerfAreaM2 + summary.wasteAreaM2).toBeCloseTo(
      summary.availableAreaM2,
      2,
    );
    expect(summary.wastePercent).toBeGreaterThan(0);
    expect(summary.wastePercent).toBeLessThan(100);
  });

  it('aggregates per material and overall', () => {
    const plan = planFor([
      row('a', 500, 500, 1, { material: material('ldsp', 18) }),
      row('b', 500, 500, 1, { material: material('mdf', 18) }),
    ]);
    for (const group of plan.groups) {
      expect(group.availableAreaM2).toBeCloseTo(group.sheets.length, 3);
      expect(group.usedAreaM2).toBeCloseTo(0.25, 3);
      expect(group.wastePercent).toBeCloseTo(75, 1);
    }
    expect(plan.summary.availableAreaM2).toBeCloseTo(2, 3);
    expect(plan.summary.usedAreaM2).toBeCloseTo(0.5, 3);
  });

  it('exposes the usable sheet area for a margin', () => {
    const outcome = validateSheetSettings({ ...SETTINGS, edgeMarginMm: 10 });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(usableSheetAreaM2(outcome.settings)).toBeCloseTo(0.96, 3);
  });
});

describe('C7 cutting plan — empty and invalid input', () => {
  it('refuses a cut list with no panels', () => {
    const outcome = buildCuttingPlan({ cutList: cutList([]), settings: SETTINGS });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/panel detallari yo/i);
  });

  it('refuses to compute with invalid settings', () => {
    const outcome = buildCuttingPlan({
      cutList: cutList([row('a', 100, 100, 1)]),
      settings: { ...SETTINGS, sheetLengthMm: 0 },
    });
    expect(outcome.ok).toBe(false);
  });

  it('reports a piece with an unusable size', () => {
    const plan = planFor([row('zero', 0, 100, 1), row('ok', 100, 100, 1)]);
    expect(plan.unplaced.some((piece) => piece.reason === 'piece-invalid-size')).toBe(true);
    expect(plan.issues.some((issue) => issue.code === 'piece-invalid-size')).toBe(true);
  });

  it('names solid parts the cut list excludes instead of ignoring them', () => {
    const bom = buildBom('table', createFurnitureParams('table'));
    if (!bom.ok) throw new Error(bom.reason);
    const cut = buildCutList(bom.bom);
    const outcome = buildCuttingPlan({
      cutList: cut,
      bom: bom.bom,
      settings: { sheetLengthMm: 2440, sheetWidthMm: 1220, kerfMm: 4, allowRotation: true },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // The table's legs are posts, not sheet goods.
    expect(outcome.plan.excluded.some((piece) => piece.partId === 'table-leg')).toBe(true);
    expect(outcome.plan.excluded.every((piece) => piece.reason === 'not-a-panel')).toBe(true);
  });

  it('states the heuristic and its limits on every plan', () => {
    const plan = planFor([row('a', 500, 500, 1)]);
    expect(plan.limitations).toEqual([...CUTTING_PLAN_LIMITATIONS]);
    const text = plan.limitations.join(' ');
    expect(text).toMatch(/optimal/i);
    expect(text).toMatch(/kerf/i);
  });
});

describe('C7 cutting plan — real furniture data', () => {
  function materialsFor(type: FurnitureType) {
    const bom = buildBom(type, createFurnitureParams(type));
    if (!bom.ok) throw new Error(bom.reason);
    return bom.bom.rows
      .filter((entry) => entry.thicknessMm !== null)
      .map((entry) => ({
        partId: entry.partId,
        materialId: 'ldsp' as const,
        thicknessMm: 18,
        thicknessSource: 'user' as const,
      }));
  }

  it.each(['table', 'chair', 'wardrobe', 'shelf', 'dresser', 'bed'] as const)(
    'lays out every panel of a %s without overlap',
    (type) => {
      const bom = buildBom(type, createFurnitureParams(type), materialsFor(type));
      if (!bom.ok) throw new Error(bom.reason);
      const cut = buildCutList(bom.bom);
      const outcome = buildCuttingPlan({
        cutList: cut,
        bom: bom.bom,
        settings: { sheetLengthMm: 2440, sheetWidthMm: 1220, kerfMm: 4, allowRotation: true },
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      const placed = allPlacements(outcome.plan);
      const accounted =
        placed.length + outcome.plan.unplaced.reduce((sum, piece) => sum + piece.quantity, 0);
      expect(accounted).toBe(cut.totalPieces);
      for (const sheet of outcome.plan.groups.flatMap((group) => group.sheets)) {
        for (let i = 0; i < sheet.placements.length; i += 1) {
          for (let j = i + 1; j < sheet.placements.length; j += 1) {
            expect(overlaps(sheet.placements[i], sheet.placements[j])).toBe(false);
          }
        }
      }
    },
  );

  it('reports the oversized wardrobe back rather than shrinking it to fit', () => {
    const materials = materialsFor('wardrobe');
    const bom = buildBom('wardrobe', createFurnitureParams('wardrobe'), materials);
    if (!bom.ok) throw new Error(bom.reason);
    const cut = buildCutList(bom.bom);
    const outcome = buildCuttingPlan({
      cutList: cut,
      settings: { sheetLengthMm: 2440, sheetWidthMm: 1220, kerfMm: 4, allowRotation: true },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const back = outcome.plan.unplaced.find((piece) => piece.partId === 'wardrobe-back');
    expect(back?.reason).toBe('piece-too-large');
  });
});
