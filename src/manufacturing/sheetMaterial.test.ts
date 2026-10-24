import { describe, expect, it } from 'vitest';
import {
  SHEET_MATERIALS,
  SHEET_MAX_THICKNESS_MM,
  SHEET_THICKNESS_LIMITS,
  THICKNESS_MISMATCH_TOLERANCE_MM,
  groupByMaterial,
  collapseMissingMaterialIssues,
  indexSheetMaterials,
  inspectSheetAssignment,
  isKnownSheetMaterial,
  validateSheetMaterialList,
  validateSheetThickness,
  type SheetMaterialEntry,
} from './sheetMaterial';
import { PANEL_MAX_THICKNESS_CM, buildBom } from './bom';
import { buildCutList } from './cutList';
import { bomToCsv, cutListToCsv, bomToJson } from './manufacturingExport';
import { createFurnitureParams } from '../geometry/furniture/types';

function entry(overrides: Partial<SheetMaterialEntry> = {}): SheetMaterialEntry {
  return {
    partId: 'table-top',
    materialId: 'ldsp',
    thicknessMm: 40,
    thicknessSource: 'user',
    ...overrides,
  };
}

describe('C3 — sheet material catalogue', () => {
  it('offers unique ids with display names and no invented standards', () => {
    const ids = SHEET_MATERIALS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('ldsp');
    for (const material of SHEET_MATERIALS) {
      expect(material.name.trim().length).toBeGreaterThan(0);
      // A definition carries a label only: no thickness or property is bundled in.
      expect(Object.keys(material).sort()).toEqual(['id', 'name']);
    }
  });

  it('recognises only catalogue ids', () => {
    expect(isKnownSheetMaterial('ldsp')).toBe(true);
    expect(isKnownSheetMaterial('unobtainium')).toBe(false);
    expect(isKnownSheetMaterial(null)).toBe(false);
    expect(isKnownSheetMaterial(42)).toBe(false);
  });

  it('derives the BOM board rule from the single thickness ceiling', () => {
    // Guard against the two constants drifting apart.
    expect(PANEL_MAX_THICKNESS_CM * 10).toBe(SHEET_MAX_THICKNESS_MM);
    expect(SHEET_THICKNESS_LIMITS.maxInclusiveMm).toBe(SHEET_MAX_THICKNESS_MM);
  });
});

describe('C3 — thickness validation', () => {
  it('accepts a normal board thickness', () => {
    expect(validateSheetThickness(18)).toEqual({ ok: true, thicknessMm: 18 });
    expect(validateSheetThickness(18.34)).toEqual({ ok: true, thicknessMm: 18.3 });
  });

  it('rejects zero, negative and non-numeric values', () => {
    for (const bad of [0, -1, -18]) {
      const result = validateSheetThickness(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/katta|musbat|noldan/i);
    }
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(validateSheetThickness(bad).ok).toBe(false);
    }
    for (const bad of ['18', null, undefined, {}, []]) {
      expect(validateSheetThickness(bad).ok).toBe(false);
    }
  });

  it('rejects a thickness beyond the board rule and says why', () => {
    const result = validateSheetThickness(SHEET_MAX_THICKNESS_MM + 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain(`${SHEET_MAX_THICKNESS_MM} mm`);
      expect(result.reason).toMatch(/panel hisoblanmaydi/i);
    }
    // The boundary itself is a valid board.
    expect(validateSheetThickness(SHEET_MAX_THICKNESS_MM).ok).toBe(true);
  });
});

describe('C3 — assignment inspection', () => {
  it('reports an unassigned part as a warning, never a material', () => {
    const { material, issues } = inspectSheetAssignment(undefined, 40);
    expect(material).toBeNull();
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe('warning');
    expect(issues[0].message).toMatch(/tanlanmagan/i);
  });

  it('builds the material info with the nominal and measured thicknesses apart', () => {
    const { material, issues } = inspectSheetAssignment(entry(), 40);
    expect(issues).toHaveLength(0);
    expect(material).not.toBeNull();
    expect(material?.materialId).toBe('ldsp');
    expect(material?.name).toBe('LDSP');
    expect(material?.unit).toBe('mm');
    expect(material?.thicknessMm).toBe(40);
    // The measured geometry is reported separately and never overwritten.
    expect(material?.geometryThicknessMm).toBe(40);
    expect(material?.thicknessMismatch).toBe(false);
    expect(material?.source).toBe('user');
  });

  it('flags a nominal thickness that disagrees with the geometry', () => {
    const { material, issues } = inspectSheetAssignment(entry({ thicknessMm: 18 }), 40);
    expect(material?.thicknessMismatch).toBe(true);
    expect(material?.thicknessMm).toBe(18);
    expect(material?.geometryThicknessMm).toBe(40);
    const mismatch = issues.find((i) => i.level === 'warning');
    expect(mismatch?.message).toMatch(/mos kelmaydi/i);
  });

  it('ignores a difference inside the measurement tolerance', () => {
    const { material } = inspectSheetAssignment(
      entry({ thicknessMm: 40 + THICKNESS_MISMATCH_TOLERANCE_MM }),
      40,
    );
    expect(material?.thicknessMismatch).toBe(false);
  });

  it('treats a bad material id or thickness as an error and yields no material', () => {
    const badId = inspectSheetAssignment(entry({ materialId: 'unobtainium' as never }), 40);
    expect(badId.material).toBeNull();
    expect(badId.issues.some((i) => i.level === 'error')).toBe(true);

    const badThickness = inspectSheetAssignment(entry({ thicknessMm: 0 }), 40);
    expect(badThickness.material).toBeNull();
    expect(badThickness.issues.some((i) => i.level === 'error')).toBe(true);
  });

  it('does not invent a geometry thickness for a non-panel part', () => {
    const { material } = inspectSheetAssignment(entry({ partId: 'table-leg' }), null);
    expect(material?.geometryThicknessMm).toBeNull();
    // Nothing measured to compare against, so no mismatch is claimed.
    expect(material?.thicknessMismatch).toBe(false);
  });
});

describe('C3 — assignment list validation', () => {
  it('reports duplicate assignments for one part', () => {
    const issues = validateSheetMaterialList([entry(), entry({ thicknessMm: 18 })]);
    expect(issues.some((i) => i.level === 'error' && /bir nechta/.test(i.message))).toBe(true);
  });

  it('reports a missing part id', () => {
    const issues = validateSheetMaterialList([entry({ partId: '' })]);
    expect(issues.some((i) => i.level === 'error' && /detal id/i.test(i.message))).toBe(true);
  });

  it('accepts a clean list and tolerates null', () => {
    expect(validateSheetMaterialList([entry()])).toHaveLength(0);
    expect(validateSheetMaterialList(null)).toHaveLength(0);
    expect(validateSheetMaterialList(undefined)).toHaveLength(0);
  });

  it('indexes by part id and ignores junk entries', () => {
    const map = indexSheetMaterials([entry(), entry({ partId: 'table-leg', materialId: 'mdf' })]);
    expect(map.size).toBe(2);
    expect(map.get('table-leg')?.materialId).toBe('mdf');
    expect(indexSheetMaterials(null).size).toBe(0);
  });
});

describe('C3 — BOM integration', () => {
  it('stays backwards compatible when nothing is assigned', () => {
    const outcome = buildBom('table', createFurnitureParams('table'));
    if (!outcome.ok) throw new Error(outcome.reason);
    for (const row of outcome.bom.rows) {
      expect(row.material).toBeNull();
      expect(row.sources.material).toBe('unavailable');
    }
    expect(outcome.bom.issues.length).toBeGreaterThan(0);
    expect(outcome.bom.issues.every((i) => i.level === 'warning')).toBe(true);
    // The pre-C3 limitation wording is still accurate in this case.
    expect(outcome.bom.limitations.join(' ')).toMatch(/material ustuni bo'sh/i);
  });

  it('puts the assigned material on the right row only', () => {
    const outcome = buildBom('table', createFurnitureParams('table'), [
      entry({ partId: 'table-top', materialId: 'mdf', thicknessMm: 40 }),
    ]);
    if (!outcome.ok) throw new Error(outcome.reason);

    const top = outcome.bom.rows.find((r) => r.partId === 'table-top');
    const leg = outcome.bom.rows.find((r) => r.partId === 'table-leg');
    expect(top?.material?.name).toBe('MDF');
    expect(top?.sources.material).toBe('user');
    expect(leg?.material).toBeNull();
    expect(leg?.sources.material).toBe('unavailable');
  });

  it('never overwrites the measured thickness with the nominal one', () => {
    const outcome = buildBom('table', createFurnitureParams('table'), [
      entry({ partId: 'table-top', thicknessMm: 18 }),
    ]);
    if (!outcome.ok) throw new Error(outcome.reason);
    const top = outcome.bom.rows.find((r) => r.partId === 'table-top');
    // Geometry still measures 40 mm; the 18 mm is the board the user buys.
    expect(top?.thicknessMm).toBe(40);
    expect(top?.material?.thicknessMm).toBe(18);
    expect(top?.material?.geometryThicknessMm).toBe(40);
  });

  it('surfaces a mismatch warning for a stale assignment', () => {
    // The user assigned 18 mm, then thickened the top to 40 mm.
    const outcome = buildBom('table', createFurnitureParams('table'), [
      entry({ partId: 'table-top', thicknessMm: 18 }),
    ]);
    if (!outcome.ok) throw new Error(outcome.reason);
    const warnings = outcome.bom.issues.filter((i) => i.level === 'warning');
    expect(warnings.some((w) => w.partId === 'table-top' && /mos kelmaydi/.test(w.message))).toBe(
      true,
    );
  });

  it('drops an invalid assignment to null and reports the error', () => {
    const outcome = buildBom('table', createFurnitureParams('table'), [
      entry({ partId: 'table-top', thicknessMm: Number.NaN }),
    ]);
    if (!outcome.ok) throw new Error(outcome.reason);
    const top = outcome.bom.rows.find((r) => r.partId === 'table-top');
    expect(top?.material).toBeNull();
    expect(top?.sources.material).toBe('unavailable');
    expect(outcome.bom.issues.some((i) => i.level === 'error')).toBe(true);
  });

  it('updates the limitation wording once a material exists', () => {
    const outcome = buildBom('table', createFurnitureParams('table'), [entry()]);
    if (!outcome.ok) throw new Error(outcome.reason);
    const text = outcome.bom.limitations.join(' ');
    expect(text).toMatch(/foydalanuvchi tomonidan kiritildi/i);
    expect(text).toMatch(/standart yoki sertifikat emas/i);
    expect(text).not.toMatch(/material ustuni bo'sh/i);
  });
});

describe('C3 — cut list integration', () => {
  it('carries the material through without changing measured sizes', () => {
    const bom = buildBom('wardrobe', createFurnitureParams('wardrobe'), [
      entry({ partId: 'wardrobe-door', materialId: 'mdf', thicknessMm: 12 }),
    ]);
    if (!bom.ok) throw new Error(bom.reason);
    const cut = buildCutList(bom.bom);
    const door = cut.rows.find((r) => r.partId === 'wardrobe-door');
    expect(door?.material?.name).toBe('MDF');
    expect(door?.material?.thicknessMm).toBe(12);
    // The cut thickness is still the measured board (12 mm geometry for a door).
    expect(door?.thicknessMm).toBe(12);
  });

  it('leaves the material null on the cut list when unassigned', () => {
    const bom = buildBom('wardrobe', createFurnitureParams('wardrobe'));
    if (!bom.ok) throw new Error(bom.reason);
    for (const row of buildCutList(bom.bom).rows) {
      expect(row.material).toBeNull();
    }
  });
});

describe('C3 — exports', () => {
  it('fills the BOM Material column only where a material exists', () => {
    const bom = buildBom('table', createFurnitureParams('table'), [
      entry({ partId: 'table-top', materialId: 'fanera', thicknessMm: 40 }),
    ]);
    if (!bom.ok) throw new Error(bom.reason);
    const lines = bomToCsv(bom.bom).split('\n');
    const header = lines[0].split(',');
    expect(header).toHaveLength(11);
    expect(header[9]).toBe('Material');

    const topLine = lines.find((l) => l.startsWith('Ust paneli'));
    const legLine = lines.find((l) => l.startsWith('Oyoq'));
    expect(topLine?.split(',')[9]).toBe('Fanera');
    // No material on the legs, and nothing invented in the column.
    expect(legLine?.split(',')[9]).toBe('');
  });

  it('appends Material to the cut list without moving existing columns', () => {
    const bom = buildBom('wardrobe', createFurnitureParams('wardrobe'), [
      entry({ partId: 'wardrobe-door', materialId: 'massiv', thicknessMm: 12 }),
    ]);
    if (!bom.ok) throw new Error(bom.reason);
    const lines = cutListToCsv(buildCutList(bom.bom)).split('\n');
    const header = lines[0].split(',');
    expect(header.slice(0, 7)).toEqual([
      'Nomi',
      'partId',
      'Soni',
      'Uzunlik_mm',
      'Kenglik_mm',
      'Qalinlik_mm',
      'Izohlar',
    ]);
    expect(header[7]).toBe('Material');

    const doorLine = lines.find((l) => l.startsWith('Eshik'));
    expect(doorLine?.split(',')[7]).toBe("Massiv (yog'och)");
    // The total row stays aligned with the new column count.
    expect(lines[lines.length - 1].split(',')).toHaveLength(8);
  });

  it('includes a material summary in the versioned JSON', () => {
    const bom = buildBom('wardrobe', createFurnitureParams('wardrobe'), [
      entry({ partId: 'wardrobe-door', materialId: 'mdf', thicknessMm: 12 }),
      entry({ partId: 'wardrobe-side', materialId: 'ldsp', thicknessMm: 20 }),
    ]);
    if (!bom.ok) throw new Error(bom.reason);
    const doc = JSON.parse(bomToJson(bom.bom));
    expect(doc.version).toBe(1);
    expect(doc.materials).toHaveLength(2);
    const ldsp = doc.materials.find((m: { materialId: string }) => m.materialId === 'ldsp');
    expect(ldsp.thicknessMm).toBe(20);
    expect(ldsp.totalPieces).toBe(2);
    expect(Array.isArray(doc.issues)).toBe(true);
  });
});

describe('C3 — material grouping', () => {
  it('groups rows that share material and thickness, ignoring unassigned ones', () => {
    const bom = buildBom('wardrobe', createFurnitureParams('wardrobe'), [
      entry({ partId: 'wardrobe-side', materialId: 'ldsp', thicknessMm: 20 }),
      entry({ partId: 'wardrobe-shelf', materialId: 'ldsp', thicknessMm: 20 }),
      entry({ partId: 'wardrobe-door', materialId: 'mdf', thicknessMm: 12 }),
    ]);
    if (!bom.ok) throw new Error(bom.reason);
    const groups = groupByMaterial(bom.bom.rows);
    expect(groups).toHaveLength(2);

    const ldsp = groups.find((g) => g.materialId === 'ldsp');
    expect(ldsp?.partIds.sort()).toEqual(['wardrobe-shelf', 'wardrobe-side']);
    // 2 sides + 4 shelves.
    expect(ldsp?.totalPieces).toBe(6);
    expect(ldsp?.unit).toBe('mm');

    const mdf = groups.find((g) => g.materialId === 'mdf');
    expect(mdf?.totalPieces).toBe(2);
  });

  it('separates the same material used at two thicknesses', () => {
    const bom = buildBom('wardrobe', createFurnitureParams('wardrobe'), [
      entry({ partId: 'wardrobe-side', materialId: 'ldsp', thicknessMm: 18 }),
      entry({ partId: 'wardrobe-top', materialId: 'ldsp', thicknessMm: 25 }),
    ]);
    if (!bom.ok) throw new Error(bom.reason);
    const groups = groupByMaterial(bom.bom.rows);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.thicknessMm).sort()).toEqual([18, 25]);
  });

  it('returns nothing when no material is assigned', () => {
    const bom = buildBom('table', createFurnitureParams('table'));
    if (!bom.ok) throw new Error(bom.reason);
    expect(groupByMaterial(bom.bom.rows)).toHaveLength(0);
  });
});

describe('C3 — issue reporting shape', () => {
  it('collapses the unassigned warnings into one line for a whole piece', () => {
    const outcome = buildBom('wardrobe', createFurnitureParams('wardrobe'));
    if (!outcome.ok) throw new Error(outcome.reason);

    const missing = outcome.bom.issues.filter((i) => i.code === 'material-missing');
    // Six part rows, one warning.
    expect(outcome.bom.rows).toHaveLength(6);
    expect(missing).toHaveLength(1);
    expect(missing[0].level).toBe('warning');
    expect(missing[0].message).toContain('6 detal');
  });

  it('leaves the issue list untouched when nothing is missing', () => {
    expect(collapseMissingMaterialIssues([], 6)).toEqual([]);
    const other = [
      { level: 'warning' as const, code: 'thickness-mismatch' as const, partId: 'p', message: 'x' },
    ];
    expect(collapseMissingMaterialIssues(other, 6)).toEqual(other);
  });

  it('keeps per-part warnings once any part has a material', () => {
    const outcome = buildBom('wardrobe', createFurnitureParams('wardrobe'), [
      entry({ partId: 'wardrobe-door', materialId: 'mdf', thicknessMm: 12 }),
    ]);
    if (!outcome.ok) throw new Error(outcome.reason);
    const missing = outcome.bom.issues.filter((i) => i.code === 'material-missing');
    // Five rows are still unassigned, and each is reported individually.
    expect(missing).toHaveLength(5);
  });

  it('tags every issue with a machine-readable code', () => {
    const outcome = buildBom('table', createFurnitureParams('table'), [
      entry({ partId: 'table-top', materialId: 'nope' as never, thicknessMm: 40 }),
      entry({ partId: 'table-leg', materialId: 'ldsp', thicknessMm: -3 }),
    ]);
    if (!outcome.ok) throw new Error(outcome.reason);
    const codes = new Set(outcome.bom.issues.map((i) => i.code));
    expect(codes.has('unknown-material')).toBe(true);
    expect(codes.has('bad-thickness')).toBe(true);
    // Errors and warnings stay distinguishable without reading the prose.
    for (const issue of outcome.bom.issues) {
      expect(['error', 'warning']).toContain(issue.level);
    }
  });

  it('separates an error from a warning in the same piece', () => {
    const outcome = buildBom('table', createFurnitureParams('table'), [
      // Valid material, wrong thickness -> warning only.
      entry({ partId: 'table-top', materialId: 'ldsp', thicknessMm: 18 }),
      // Zero thickness -> error.
      entry({ partId: 'table-leg', materialId: 'ldsp', thicknessMm: 0 }),
    ]);
    if (!outcome.ok) throw new Error(outcome.reason);

    const top = outcome.bom.rows.find((r) => r.partId === 'table-top');
    const leg = outcome.bom.rows.find((r) => r.partId === 'table-leg');
    // A warning does not throw the material away.
    expect(top?.material).not.toBeNull();
    // An error does: the row keeps no material claim.
    expect(leg?.material).toBeNull();
    expect(outcome.bom.issues.some((i) => i.level === 'error' && i.code === 'bad-thickness')).toBe(
      true,
    );
  });
});
