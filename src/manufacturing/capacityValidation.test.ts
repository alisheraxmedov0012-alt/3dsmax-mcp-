/**
 * C8.6.1 — capacity fit checks and board-rule visibility.
 *
 * The C8.6 audit found three ways a model could reach a full manufacturing
 * package while being unbuildable or undocumentable:
 *
 * - P1-a: more shelf boards than the opening can hold → overlapping boards.
 * - P1-b: more drawer fronts than the body height can hold → overlapping fronts.
 * - P2:   a table top thicker than the board rule → no cut list, so C1/C8 refuse,
 *         but C4 said "fine" and readiness called the cut list "not applicable".
 *
 * These tests pin the rejection at every layer (editor, storage, C4, BOM, C1, C8)
 * and pin that every previously valid configuration still passes.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';
import {
  FURNITURE_FIELDS,
  createFurnitureParams,
  type FurnitureParams,
  type FurnitureType,
} from '../geometry/furniture/types';
import {
  parseFurnitureValues,
  validateFurnitureParams,
  relationErrors,
} from '../geometry/furniture/params';
import { drawerLayout, drawerFitProblem, shelfFitProblem, shelfLayout } from '../geometry/furniture/capacity';
import { buildBom, PANEL_MAX_THICKNESS_CM } from './bom';
import { buildCutList } from './cutList';
import { validateManufacturing } from './validation';
import { buildManufacturingPackage } from './manufacturingPackage';
import { buildProductPackage } from './productPackage';
import { assessProductReadiness } from './productReadiness';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  type SceneData,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';
import type { SheetMaterialEntry } from './sheetMaterial';

/** GLTFExporter needs a FileReader; Node has none. */
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

const SHEET = {
  sheetLengthMm: 2440,
  sheetWidthMm: 1220,
  kerfMm: 4,
  allowRotation: true,
} as const;

/** The exact shelf combination the C8.6 audit flagged. */
const AUDIT_SHELF = {
  heightCm: 40,
  wallThicknessCm: 5,
  shelfCount: 8,
  depthCm: 20,
} as const;

/** The exact dresser combination the C8.6 audit flagged. */
const AUDIT_DRESSER = {
  heightCm: 40,
  legHeightCm: 30,
  drawerCount: 6,
  doorCount: 0,
} as const;

function paramsFor(type: FurnitureType, patch: Partial<FurnitureParams> = {}): FurnitureParams {
  return { ...createFurnitureParams(type), ...patch } as FurnitureParams;
}

function materialsFor(type: FurnitureType, params: FurnitureParams): SheetMaterialEntry[] {
  const bom = buildBom(type, params);
  if (!bom.ok) return [];
  return bom.bom.rows.map((row) => ({
    partId: row.partId,
    materialId: 'ldsp',
    thicknessMm: 18,
    thicknessSource: 'user',
  }));
}

/** Field values exactly as the editor would supply them. */
function fieldValues(type: FurnitureType, params: FurnitureParams): Record<string, string> {
  const values: Record<string, string> = { color: params.color };
  for (const spec of FURNITURE_FIELDS[type]) {
    values[spec.key] = String(params[spec.key]);
  }
  return values;
}

function sceneFor(type: FurnitureType, params: FurnitureParams): { object: SceneData['objects'][number]; scene: SceneData } {
  const object = {
    ...createFurnitureSceneObject(type, `${type}-1`),
    params,
    sheetMaterials: materialsFor(type, params),
  };
  return {
    object,
    scene: {
      schemaVersion: SCENE_SCHEMA_VERSION,
      room: { ...ROOM_DEFAULTS },
      objects: [object],
      settings: createDefaultSettings(),
    },
  };
}

describe('C8.6.1 capacity — the arithmetic matches the builder', () => {
  it('derives the shelf pitch the builder uses', () => {
    const layout = shelfLayout(paramsFor('shelf', AUDIT_SHELF));
    // 40 cm tall, 5 cm walls -> 30 cm opening, 8 boards -> 9 gaps.
    expect(layout.wallCm).toBe(5);
    expect(layout.innerHeightCm).toBe(30);
    expect(layout.shelfCount).toBe(8);
    expect(layout.pitchCm).toBeCloseTo(30 / 9, 10);
    // The boards are 5 cm thick but only 3.33 cm apart: they must overlap.
    expect(layout.pitchCm).toBeLessThan(layout.wallCm);
  });

  it('derives the drawer pitch the builder uses', () => {
    const layout = drawerLayout(paramsFor('dresser', AUDIT_DRESSER));
    expect(layout.legHeightCm).toBe(30);
    expect(layout.bodyHeightCm).toBe(10);
    expect(layout.frontHeightCm).toBe(8);
    expect(layout.drawerCount).toBe(6);
    expect(layout.pitchCm).toBeCloseTo(8 / 6, 10);
    // Fronts are clamped to the 2 cm minimum but only 1.33 cm apart.
    expect(layout.pitchCm).toBeLessThan(layout.drawerHeightCm);
  });

  it('reports no problem for the default configurations', () => {
    expect(shelfFitProblem(createFurnitureParams('shelf'))).toBeNull();
    expect(drawerFitProblem(createFurnitureParams('dresser'))).toBeNull();
  });
});

describe('C8.6.1 P1-a — shelf boards that cannot fit are rejected everywhere', () => {
  it('rejects the audit combination in the editor', () => {
    const params = paramsFor('shelf', AUDIT_SHELF);
    const parsed = parseFurnitureValues('shelf', fieldValues('shelf', params));
    expect(parsed.valid).toBe(false);
    expect(parsed.params).toBeNull();
    expect(parsed.errors.shelfCount).toMatch(/tokchalar bir-biriga kirib ketadi/i);
  });

  it('rejects the audit combination in the storage validator', () => {
    const params = paramsFor('shelf', AUDIT_SHELF);
    expect(validateFurnitureParams('shelf', params as unknown as Record<string, unknown>)).toBeNull();
  });

  it('reports it as a C4 error', () => {
    const report = validateManufacturing('shelf', paramsFor('shelf', AUDIT_SHELF));
    expect(report.ok).toBe(false);
    const relation = report.issues.find((issue) => issue.code === 'dimension-relation-invalid');
    expect(relation?.level).toBe('error');
    expect(relation?.message).toMatch(/tokchalar/i);
  });

  it('stops the BOM, so no manufacturing package can be produced', async () => {
    const params = paramsFor('shelf', AUDIT_SHELF);
    expect(buildBom('shelf', params).ok).toBe(false);

    const { object, scene } = sceneFor('shelf', params);
    const c1 = await buildManufacturingPackage({ scene, object, projectName: 'A' });
    expect(c1.ok).toBe(false);

    const c8 = await buildProductPackage({
      scene,
      object,
      projectName: 'A',
      cuttingSettings: SHEET,
    });
    expect(c8.ok).toBe(false);
  });

  it('is never reported as a presentable product', async () => {
    const params = paramsFor('shelf', AUDIT_SHELF);
    const { object, scene } = sceneFor('shelf', params);
    void object;
    const readiness = assessProductReadiness({
      type: 'shelf',
      params,
      cuttingSettings: SHEET,
    });
    expect(readiness.status).toBe('fail');
    expect(readiness.blockers.length).toBeGreaterThan(0);
    void scene;
  });

  it('keeps the default shelf working', async () => {
    const params = createFurnitureParams('shelf');
    const parsed = parseFurnitureValues('shelf', fieldValues('shelf', params));
    expect(parsed.valid).toBe(true);

    const { object, scene } = sceneFor('shelf', params);
    const c1 = await buildManufacturingPackage({ scene, object, projectName: 'A' });
    expect(c1.ok, c1.ok ? '' : c1.reason).toBe(true);
  });

  it('accepts the largest shelf count that still fits, and rejects one more', () => {
    // The tightest legal shelf: 40 cm tall with 5 cm walls -> 30 cm opening.
    // A board needs 30 / (n + 1) >= 5, i.e. n <= 5.
    const atLimit = paramsFor('shelf', { heightCm: 40, wallThicknessCm: 5, shelfCount: 5 });
    expect(shelfFitProblem(atLimit)).toBeNull();
    expect(parseFurnitureValues('shelf', fieldValues('shelf', atLimit)).valid).toBe(true);

    const oneTooMany = paramsFor('shelf', { heightCm: 40, wallThicknessCm: 5, shelfCount: 6 });
    expect(shelfFitProblem(oneTooMany)).not.toBeNull();
    expect(parseFurnitureValues('shelf', fieldValues('shelf', oneTooMany)).valid).toBe(false);

    // The default opening is generous: the declared maximum of 8 boards fits.
    const roomy = paramsFor('shelf', { shelfCount: 8 });
    expect(shelfFitProblem(roomy)).toBeNull();
  });

  it('reports the maximum count that does fit, so the message is actionable', () => {
    const problem = shelfFitProblem(paramsFor('shelf', AUDIT_SHELF)) ?? '';
    expect(problem).toMatch(/ko'pi bilan \d+ ta tokcha sig'adi/);
  });
});

describe('C8.6.1 P1-b — overlapping drawer fronts are rejected everywhere', () => {
  it('rejects the audit combination in the editor', () => {
    const params = paramsFor('dresser', AUDIT_DRESSER);
    const parsed = parseFurnitureValues('dresser', fieldValues('dresser', params));
    expect(parsed.valid).toBe(false);
    expect(parsed.errors.drawerCount).toMatch(/oldlar bir-biriga kirib ketadi/i);
  });

  it('rejects the audit combination in the storage validator', () => {
    const params = paramsFor('dresser', AUDIT_DRESSER);
    expect(
      validateFurnitureParams('dresser', params as unknown as Record<string, unknown>),
    ).toBeNull();
  });

  it('reports it as a C4 error', () => {
    const report = validateManufacturing('dresser', paramsFor('dresser', AUDIT_DRESSER));
    expect(report.ok).toBe(false);
    expect(
      report.issues.some(
        (issue) => issue.code === 'dimension-relation-invalid' && /tortma/i.test(issue.message),
      ),
    ).toBe(true);
  });

  it('stops the BOM, so no manufacturing package can be produced', async () => {
    const params = paramsFor('dresser', AUDIT_DRESSER);
    expect(buildBom('dresser', params).ok).toBe(false);

    const { object, scene } = sceneFor('dresser', params);
    const c1 = await buildManufacturingPackage({ scene, object, projectName: 'A' });
    expect(c1.ok).toBe(false);

    const c8 = await buildProductPackage({
      scene,
      object,
      projectName: 'A',
      cuttingSettings: SHEET,
    });
    expect(c8.ok).toBe(false);
  });

  it('is never reported as a presentable product', () => {
    const readiness = assessProductReadiness({
      type: 'dresser',
      params: paramsFor('dresser', AUDIT_DRESSER),
      cuttingSettings: SHEET,
    });
    expect(readiness.status).toBe('fail');
    expect(readiness.blockers.length).toBeGreaterThan(0);
  });

  it('keeps the default three-drawer dresser working', async () => {
    const params = createFurnitureParams('dresser');
    expect(params.drawerCount).toBe(3);
    expect(parseFurnitureValues('dresser', fieldValues('dresser', params)).valid).toBe(true);

    const { object, scene } = sceneFor('dresser', params);
    const c1 = await buildManufacturingPackage({ scene, object, projectName: 'A' });
    expect(c1.ok, c1.ok ? '' : c1.reason).toBe(true);
  });

  it('keeps the dresser with doors working, and still rejects an over-full stack', () => {
    const withDoors = paramsFor('dresser', { doorCount: 2, drawerCount: 3 });
    expect(drawerFitProblem(withDoors)).toBeNull();
    expect(parseFurnitureValues('dresser', fieldValues('dresser', withDoors)).valid).toBe(true);

    const tooMany = paramsFor('dresser', { heightCm: 40, legHeightCm: 30, drawerCount: 6, doorCount: 2 });
    expect(drawerFitProblem(tooMany)).not.toBeNull();
    expect(parseFurnitureValues('dresser', fieldValues('dresser', tooMany)).valid).toBe(false);
  });

  it('accepts a tall body with the maximum drawer count', () => {
    // 140 cm tall, 0 cm legs -> 138 cm front area; 6 fronts need >= 2 cm pitch.
    const tall = paramsFor('dresser', { heightCm: 140, legHeightCm: 0, drawerCount: 6 });
    expect(drawerFitProblem(tall)).toBeNull();
    expect(parseFurnitureValues('dresser', fieldValues('dresser', tall)).valid).toBe(true);
  });
});

describe('C8.6.1 P2 — the board rule is visible before an export fails', () => {
  it('keeps a 6 cm table top working exactly as before', async () => {
    const params = paramsFor('table', { topThicknessCm: PANEL_MAX_THICKNESS_CM });

    expect(validateFurnitureParams('table', params as unknown as Record<string, unknown>)).not.toBeNull();
    const bom = buildBom('table', params);
    if (!bom.ok) throw new Error(bom.reason);
    expect(buildCutList(bom.bom).rows.length).toBeGreaterThan(0);

    const report = validateManufacturing('table', params);
    expect(report.ok).toBe(true);
    expect(report.issues.some((issue) => issue.code === 'panel-too-thick-for-cutlist')).toBe(false);

    const { object, scene } = sceneFor('table', params);
    const c1 = await buildManufacturingPackage({ scene, object, projectName: 'A' });
    expect(c1.ok, c1.ok ? '' : c1.reason).toBe(true);
    if (!c1.ok) return;
    expect(Object.keys(unzipSync(c1.package.bytes))).toHaveLength(6);
  });

  it('flags a 7 cm table top in C4 before anyone tries to export', () => {
    const report = validateManufacturing('table', paramsFor('table', { topThicknessCm: 7 }));
    const issue = report.issues.find((entry) => entry.code === 'panel-too-thick-for-cutlist');
    expect(issue).toBeDefined();
    expect(issue?.level).toBe('warning');
    expect(issue?.partId).toBe('table-top');
    expect(issue?.message).toMatch(/kesish ro'yxatiga kirmaydi/i);
  });

  it('names the reason instead of "not applicable" in readiness', () => {
    const readiness = assessProductReadiness({
      type: 'table',
      params: paramsFor('table', { topThicknessCm: 7 }),
      cuttingSettings: SHEET,
    });
    const cutting = readiness.checks.find((check) => check.id === 'cutting');
    // The user asked for a thickness the board rule rejects; this is actionable,
    // so it is a failure with an explanation, not "this feature does not apply".
    expect(cutting?.status).toBe('fail');
    expect(cutting?.detail).toMatch(/6 sm dan qalin/i);
    expect(cutting?.detail).toMatch(/kesish rejasi tuzilmadi/i);
  });

  it('keeps "not applicable" for a piece that is not sheet goods at all', () => {
    const readiness = assessProductReadiness({
      type: 'sofa',
      params: createFurnitureParams('sofa'),
      cuttingSettings: SHEET,
    });
    const cutting = readiness.checks.find((check) => check.id === 'cutting');
    expect(cutting?.status).toBe('not_applicable');
    expect(cutting?.detail).toMatch(/qo‘llanmaydi/i);
  });

  it('agrees across BOM, cut list, C4 and readiness for both sides of the rule', () => {
    for (const [topThicknessCm, expectCut] of [
      [PANEL_MAX_THICKNESS_CM, true],
      [PANEL_MAX_THICKNESS_CM + 1, false],
    ] as const) {
      const params = paramsFor('table', { topThicknessCm });
      const bom = buildBom('table', params);
      if (!bom.ok) throw new Error(bom.reason);
      const cut = buildCutList(bom.bom);
      const report = validateManufacturing('table', params);
      const flag = report.issues.some((issue) => issue.code === 'panel-too-thick-for-cutlist');

      // The cut list and the C4 flag describe the same fact, from opposite sides.
      expect(cut.rows.length > 0).toBe(expectCut);
      expect(flag).toBe(!expectCut);
    }
  });

  it('does not silently drop the top from the BOM', () => {
    const bom = buildBom('table', paramsFor('table', { topThicknessCm: 7 }));
    if (!bom.ok) throw new Error(bom.reason);
    // The part is still listed; only its role as a board changes.
    expect(bom.bom.rows.map((row) => row.partId)).toContain('table-top');
  });
});

describe('C8.6.1 — regression: valid configurations still build', () => {
  it('keeps every declared min/max of every type accepted', () => {
    for (const type of ['table', 'chair', 'armchair', 'sofa', 'bed', 'wardrobe', 'shelf', 'dresser'] as const) {
      const base = createFurnitureParams(type);
      for (const spec of FURNITURE_FIELDS[type]) {
        for (const value of [spec.range.min, spec.range.max]) {
          const params = { ...base, [spec.key]: value } as FurnitureParams;
          // A single field at its declared extreme must stay acceptable, unless a
          // pre-existing cross-field rule (seat below height, etc.) forbids it.
          const relations = Object.keys(relationErrors(type, params));
          const values = fieldValues(type, params);
          const parsed = parseFurnitureValues(type, values);
          if (relations.length === 0) {
            expect(parsed.valid, `${type}.${spec.key}=${value}`).toBe(true);
          }
        }
      }
    }
  });

  it('keeps C1 at six entries and C8 at thirteen for the default pieces', async () => {
    const types = ['table', 'shelf', 'dresser'] as const;
    const built = await Promise.all(
      types.map((type) => {
        const { object, scene } = sceneFor(type, createFurnitureParams(type));
        return Promise.all([
          buildManufacturingPackage({ scene, object, projectName: 'A' }),
          buildProductPackage({ scene, object, projectName: 'A', cuttingSettings: SHEET }),
        ]);
      }),
    );

    for (const [index, type] of types.entries()) {
      const [c1, c8] = built[index];
      expect(c1.ok, `${type}: ${c1.ok ? '' : c1.reason}`).toBe(true);
      if (!c1.ok) continue;
      expect(Object.keys(unzipSync(c1.package.bytes))).toHaveLength(6);

      expect(c8.ok, `${type}: ${c8.ok ? '' : c8.reason}`).toBe(true);
      if (!c8.ok) continue;
      // CRC is verified by unzipSync while inflating.
      expect(Object.keys(unzipSync(c8.product.bytes))).toHaveLength(13);
    }
  });
});
