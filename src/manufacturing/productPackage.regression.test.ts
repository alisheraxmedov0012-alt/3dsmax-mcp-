/**
 * C8 regression: adding the product package must not move anything C1–C7
 * promised.
 *
 * These assertions are deliberately about *contracts*, not internals: the C1
 * archive entry list, C4 issue codes and severities, C2 drawing dimensions vs
 * model geometry, C3.1 assignment flow, C5 PDF backward compatibility, C6 steps
 * vs BOM, C7 layout vs cut list, and the sofa export refusal.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { PACKAGE_ENTRIES, buildManufacturingPackage, packageFilename } from './manufacturingPackage';
import { buildBom } from './bom';
import { buildCutList } from './cutList';
import { buildCuttingPlan } from './cuttingPlan';
import { buildFurnitureAssemblyPlan, assemblyPlanPartIds } from './assemblyInstructions';
import { buildManufacturingPdf } from './pdfDocument';
import { validateManufacturing, type ValidationCode, type ValidationLevel } from './validation';
import { createTechnicalDrawingSvg } from './technicalDrawing';
import { groupByMaterial, type SheetMaterialEntry } from './sheetMaterial';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  type SceneData,
  type SceneObject,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';
import { createFurnitureParams, type FurnitureType } from '../geometry/furniture/types';

class TestFileReader {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  readAsArrayBuffer(blob: Blob): void {
    blob
      .arrayBuffer()
      .then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      })
      .catch((error) => this.onerror?.(error));
  }
}

beforeAll(() => {
  vi.stubGlobal('FileReader', TestFileReader);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const FIXED = new Date('2026-05-06T07:08:09.000Z');
const SETTINGS = {
  sheetLengthMm: 2440,
  sheetWidthMm: 1220,
  kerfMm: 4,
  allowRotation: true,
} as const;

function materialsFor(type: FurnitureType): SheetMaterialEntry[] {
  const bom = buildBom(type, createFurnitureParams(type));
  if (!bom.ok) throw new Error(bom.reason);
  return bom.bom.rows.map((row) => ({
    partId: row.partId,
    materialId: 'ldsp',
    thicknessMm: 18,
    thicknessSource: 'user',
  }));
}

function objectFor(type: FurnitureType, withMaterials = true): SceneObject {
  return createFurnitureSceneObject(type, `${type}-1`, {
    sheetMaterials: withMaterials ? materialsFor(type) : [],
  });
}

function sceneWith(object: SceneObject): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects: [object],
    settings: createDefaultSettings(),
  };
}

async function c1Package(object: SceneObject) {
  const outcome = await buildManufacturingPackage({
    scene: sceneWith(object),
    object,
    projectName: 'Loyiha',
    generatedAt: FIXED,
  });
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.package;
}

describe('C8 regression — C1 archive contract', () => {
  it('still holds exactly the six documented entries', async () => {
    const pkg = await c1Package(objectFor('wardrobe'));
    expect(Object.keys(unzipSync(pkg.bytes)).sort()).toEqual(
      ['BOM.csv', 'README.txt', 'cutlist.csv', 'drawing.svg', 'meta.json', 'model.glb'].sort(),
    );
    expect(PACKAGE_ENTRIES).toHaveLength(6);
  });

  it('is still deterministic and CRC-clean', async () => {
    const a = await c1Package(objectFor('table'));
    const b = await c1Package(objectFor('table'));
    expect(Array.from(b.bytes)).toEqual(Array.from(a.bytes));
    // Re-inflating validates every CRC.
    expect(Object.keys(unzipSync(a.bytes))).toHaveLength(6);
  });

  it('keeps the filename shape and collision protection', async () => {
    const first = packageFilename('Ошхона шкаф');
    const second = packageFilename('Кухня');
    // Both slug the same way; the digest is what keeps them apart.
    expect(first).not.toBe(second);
    expect(first).toMatch(/-package\.zip$/);
    expect(second).toMatch(/-package\.zip$/);
  });

  it('still refuses a sofa export', async () => {
    const outcome = await buildManufacturingPackage({
      scene: sceneWith(objectFor('sofa')),
      object: objectFor('sofa'),
      projectName: 'Divan',
      generatedAt: FIXED,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/Kesish royxati bosh/);
  });
});

describe('C8 regression — C2 drawing', () => {
  it('reports the same overall size the geometry has', () => {
    const params = createFurnitureParams('table');
    const drawing = createTechnicalDrawingSvg('table', params, { title: 'T', date: '2026-01-01' });
    if (!drawing.ok) throw new Error(drawing.reason);
    expect(drawing.overall.widthMm).toBeCloseTo(params.widthCm * 10, 0);
    expect(drawing.overall.heightMm).toBeCloseTo(params.heightCm * 10, 0);
    expect(drawing.overall.depthMm).toBeCloseTo(params.depthCm * 10, 0);
  });
});

describe('C8 regression — C3/C3.1 materials', () => {
  it('reflects an assignment in the BOM without touching geometry', () => {
    const params = createFurnitureParams('wardrobe');
    const bare = buildBom('wardrobe', params);
    const assigned = buildBom('wardrobe', params, materialsFor('wardrobe'));
    if (!bare.ok || !assigned.ok) throw new Error('BOM failed');

    expect(assigned.bom.rows.map((row) => row.sizeMm)).toEqual(
      bare.bom.rows.map((row) => row.sizeMm),
    );
    expect(bare.bom.rows.every((row) => row.material === null)).toBe(true);
    expect(assigned.bom.rows.every((row) => row.material !== null)).toBe(true);
  });

  it('keeps the nominal thickness separate from the measured one', () => {
    const bom = buildBom('wardrobe', createFurnitureParams('wardrobe'), [
      { partId: 'wardrobe-door', materialId: 'ldsp', thicknessMm: 18, thicknessSource: 'user' },
    ]);
    if (!bom.ok) throw new Error(bom.reason);
    const door = bom.bom.rows.find((row) => row.partId === 'wardrobe-door');
    expect(door?.material?.thicknessMm).toBe(18);
    expect(door?.thicknessMm).not.toBe(18);
  });
});

describe('C8 regression — C4 validation vocabulary', () => {
  const CODES = new Set<ValidationCode>([
    'dimension-non-finite',
    'dimension-non-positive',
    'dimension-limit-exceeded',
    'dimension-relation-invalid',
    'geometry-bounds-invalid',
    'geometry-overlap-suspected',
    // C8.6.1: an in-range parameter pushed a panel past the board rule, so it
    // cannot appear in the cut list. Intentional addition, tested in
    // `capacityValidation.test.ts`.
    'panel-too-thick-for-cutlist',
    'material-assignment-stale',
  ]);
  const LEVELS = new Set<ValidationLevel>(['error', 'warning', 'info']);

  it('still emits only the documented codes and severities', () => {
    for (const type of ['table', 'chair', 'wardrobe', 'sofa', 'bed'] as const) {
      const report = validateManufacturing(type, createFurnitureParams(type), materialsFor(type));
      for (const issue of report.issues) {
        expect(LEVELS.has(issue.level)).toBe(true);
        // C3 sheet codes are reused verbatim, so allow those too.
        expect(
          CODES.has(issue.code) || issue.code.startsWith('material-') || issue.code.startsWith('bad-') ||
            issue.code.startsWith('unknown-') || issue.code.startsWith('duplicate-') ||
            issue.code.startsWith('missing-') || issue.code.startsWith('thickness-'),
        ).toBe(true);
      }
    }
  });

  it('does not turn warnings into errors', () => {
    const report = validateManufacturing('table', createFurnitureParams('table'), materialsFor('table'));
    expect(report.counts.error).toBe(0);
    expect(report.ok).toBe(true);
  });
});

describe('C8 regression — C5 PDF backward compatibility', () => {
  async function pdfFor(type: FurnitureType, extras: Record<string, unknown> = {}) {
    const object = objectFor(type);
    const bom = buildBom(type, object.params, object.sheetMaterials);
    if (!bom.ok) throw new Error(bom.reason);
    const cutList = buildCutList(bom.bom);
    const validation = validateManufacturing(type, object.params, object.sheetMaterials);
    const drawing = createTechnicalDrawingSvg(type, object.params, {
      title: 'Loyiha',
      date: '2026-05-06',
    });
    if (!drawing.ok) throw new Error(drawing.reason);
    const outcome = await buildManufacturingPdf({
      type,
      params: object.params,
      projectName: 'Loyiha',
      bom: bom.bom,
      cutList,
      materials: groupByMaterial(bom.bom.rows),
      validation,
      drawing: { svg: drawing.svg, scale: drawing.scale },
      overall: drawing.overall,
      generatedAt: FIXED,
      ...extras,
    });
    if (!outcome.ok) throw new Error(outcome.reason);
    return { outcome, bom: bom.bom, cutList, validation };
  }

  it('produces the same bytes as before when no optional data is supplied', async () => {
    const bare = await pdfFor('wardrobe');
    const explicitNulls = await pdfFor('wardrobe', { assembly: null, cuttingPlan: null });
    expect(Array.from(explicitNulls.outcome.bytes)).toEqual(Array.from(bare.outcome.bytes));
  });

  it('accepts C6 and C7 together', async () => {
    const object = objectFor('wardrobe');
    const bom = buildBom('wardrobe', object.params, object.sheetMaterials);
    if (!bom.ok) throw new Error(bom.reason);
    const cutList = buildCutList(bom.bom);
    const assembly = buildFurnitureAssemblyPlan({ bom: bom.bom });
    const cutting = buildCuttingPlan({ cutList, bom: bom.bom, settings: SETTINGS });
    if (!cutting.ok) throw new Error(cutting.reason);

    const { outcome } = await pdfFor('wardrobe', {
      assembly,
      cuttingPlan: cutting.plan,
    });
    expect(outcome.pageCount).toBeGreaterThanOrEqual(4);
  });
});

describe('C8 regression — C6 assembly vs BOM', () => {
  it('references only parts the BOM contains', () => {
    const bom = buildBom('wardrobe', createFurnitureParams('wardrobe'), materialsFor('wardrobe'));
    if (!bom.ok) throw new Error(bom.reason);
    const plan = buildFurnitureAssemblyPlan({ bom: bom.bom });
    const bomIds = new Set(bom.bom.rows.map((row) => row.partId));
    for (const partId of assemblyPlanPartIds(plan)) {
      expect(bomIds.has(partId)).toBe(true);
    }
  });
});

describe('C8 regression — C7 layout vs cut list', () => {
  it('accounts for every cut-list piece', () => {
    const bom = buildBom('wardrobe', createFurnitureParams('wardrobe'), materialsFor('wardrobe'));
    if (!bom.ok) throw new Error(bom.reason);
    const cutList = buildCutList(bom.bom);
    const outcome = buildCuttingPlan({ cutList, bom: bom.bom, settings: SETTINGS });
    if (!outcome.ok) throw new Error(outcome.reason);

    const placed = outcome.plan.summary.placedCount;
    const unplaced = outcome.plan.summary.unplacedCount;
    expect(placed + unplaced).toBe(cutList.totalPieces);
  });

  it('keeps kerf and waste as separate quantities', () => {
    const bom = buildBom('table', createFurnitureParams('table'), materialsFor('table'));
    if (!bom.ok) throw new Error(bom.reason);
    const cutList = buildCutList(bom.bom);
    const outcome = buildCuttingPlan({ cutList, bom: bom.bom, settings: SETTINGS });
    if (!outcome.ok) throw new Error(outcome.reason);
    const { summary } = outcome.plan;
    expect(summary.usedAreaM2 + summary.kerfAreaM2 + summary.wasteAreaM2).toBeCloseTo(
      summary.availableAreaM2,
      2,
    );
  });
});

describe('C8 regression — export formats are unchanged', () => {
  it('keeps the BOM and cut list CSV headers', async () => {
    const pkg = await c1Package(objectFor('table'));
    const files = unzipSync(pkg.bytes);
    expect(strFromU8(files['BOM.csv']).split('\n')[0]).toContain('partId');
    expect(strFromU8(files['cutlist.csv']).split('\n')[0]).toContain('partId');
    expect(strFromU8(files['meta.json'])).toContain('3d-studio-ai-production-package');
  });
});
