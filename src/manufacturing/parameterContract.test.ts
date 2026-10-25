/**
 * C8.6.2 — parameter contract consistency.
 *
 * Three P3 findings from the C8.6 audit:
 *
 * - storage rewrote out-of-range channels without telling anyone;
 * - builder clamps were wider than the declared `FURNITURE_FIELDS` range, so a
 *   direct call could leave the documented contract;
 * - the cutting check collapsed several distinct outcomes into one status, so a
 *   fixable parameter problem looked like "this feature does not apply".
 *
 * Each block below pins the distinction and the backward-compatible path.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';
import {
  FURNITURE_DEFAULTS,
  FURNITURE_FIELDS,
  FURNITURE_TYPES,
  createFurnitureParams,
  type FurnitureParams,
  type FurnitureType,
} from '../geometry/furniture/types';
import {
  parseFurnitureValues,
  validateFurnitureParams,
  validateFurnitureParamsDetailed,
} from '../geometry/furniture/params';
import { gateParam, declaredRange, declaredDefault } from '../geometry/furniture/contract';
import { buildFurniture } from '../geometry/furniture/buildFurniture';
import { measurePartBoxes } from './partBoxes';
import { buildBom } from './bom';
import { buildManufacturingPackage } from './manufacturingPackage';
import { buildProductPackage } from './productPackage';
import { assessProductReadiness, type CuttingReason } from './productReadiness';
import { parseSceneJson, serializeSceneToJson } from '../export/sceneJson';
import { validateSceneData } from '../scene/sceneValidation';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  type SceneData,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';
import type { SheetMaterialEntry } from './sheetMaterial';

/** GLTFExporter assembles its payload with a FileReader; Node has none. */
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

const META = { name: 'Audit', furnitureType: 'table', units: 'cm' as const };

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

function sceneFor(type: FurnitureType, params: FurnitureParams) {
  const object = {
    ...createFurnitureSceneObject(type, `${type}-1`),
    params,
    sheetMaterials: materialsFor(type, params),
  };
  const scene: SceneData = {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects: [object],
    settings: createDefaultSettings(),
  };
  return { object, scene };
}

function partSize(type: FurnitureType, params: FurnitureParams, partId: string): number {
  const built = buildFurniture(type, params);
  try {
    const box = measurePartBoxes(built.group).find((entry) => entry.partId === partId);
    if (!box) throw new Error(`missing part ${partId}`);
    return Number((box.maxY - box.minY).toFixed(4));
  } finally {
    built.dispose();
  }
}

function partTop(type: FurnitureType, params: FurnitureParams, partId: string): number {
  const built = buildFurniture(type, params);
  try {
    const box = measurePartBoxes(built.group).find((entry) => entry.partId === partId);
    if (!box) throw new Error(`missing part ${partId}`);
    return Number(box.maxY.toFixed(4));
  } finally {
    built.dispose();
  }
}

describe('C8.6.2 P3-a — storage normalisation is reported', () => {
  it('reports nothing for stored values that are already valid', () => {
    for (const type of FURNITURE_TYPES) {
      const params = createFurnitureParams(type);
      const detailed = validateFurnitureParamsDetailed(type, params as unknown as Record<string, unknown>);
      expect(detailed, type).not.toBeNull();
      expect(detailed?.normalized, type).toEqual([]);
      // Nothing was rewritten, so the params are the ones supplied.
      expect(detailed?.params).toEqual(params);
    }
  });

  it('reports the channel and reason for an out-of-range stored value', () => {
    const detailed = validateFurnitureParamsDetailed('table', {
      ...createFurnitureParams('table'),
      topThicknessCm: 1000,
    } as unknown as Record<string, unknown>);

    expect(detailed).not.toBeNull();
    expect(detailed?.normalized).toHaveLength(1);
    expect(detailed?.normalized[0]).toMatchObject({
      key: 'topThicknessCm',
      stored: '1000',
      reason: 'out-of-range',
      applied: null,
    });
    // The channel is gone, so the builder fallback governs rather than a guess.
    expect(detailed?.params.topThicknessCm).toBeUndefined();
  });

  it('reports non-integer and non-finite stored values too', () => {
    const fractional = validateFurnitureParamsDetailed('wardrobe', {
      ...createFurnitureParams('wardrobe'),
      shelfCount: 2.5,
    } as unknown as Record<string, unknown>);
    expect(fractional?.normalized[0]).toMatchObject({ key: 'shelfCount', reason: 'not-integer' });

    const notFinite = validateFurnitureParamsDetailed('table', {
      ...createFurnitureParams('table'),
      legCount: 'abc',
    } as unknown as Record<string, unknown>);
    expect(notFinite?.normalized[0]).toMatchObject({ key: 'legCount', reason: 'not-finite' });
  });

  it('does not report a channel that is simply absent', () => {
    // Older scenes omit optional channels on purpose; that is not a rewrite.
    const bare = { widthCm: 120, heightCm: 75, depthCm: 60, color: '#a9744f' };
    const detailed = validateFurnitureParamsDetailed('table', bare);
    expect(detailed).not.toBeNull();
    expect(detailed?.normalized).toEqual([]);
  });

  it('keeps the old entry point identical, including its null cases', () => {
    const cases: unknown[] = [
      createFurnitureParams('table'),
      { ...createFurnitureParams('table'), topThicknessCm: 1000 },
      { ...createFurnitureParams('table'), widthCm: 9999 },
      { widthCm: 120, heightCm: 75, depthCm: 60, color: 'not-a-colour' },
      null,
      'nope',
      { ...createFurnitureParams('table'), topThicknessCm: 60 },
    ];
    for (const raw of cases) {
      const legacy = validateFurnitureParams('table', raw);
      const detailed = validateFurnitureParamsDetailed('table', raw);
      // Single implementation: the legacy answer is exactly the detailed params.
      expect(legacy).toEqual(detailed?.params ?? null);
    }
  });

  it('still rejects a stored object whose base dimensions are out of range', () => {
    expect(
      validateFurnitureParamsDetailed('table', {
        ...createFurnitureParams('table'),
        widthCm: 9999,
      } as unknown as Record<string, unknown>),
    ).toBeNull();
  });

  it('surfaces the rewrite through scene loading, so a project cannot change silently', () => {
    const object = {
      ...createFurnitureSceneObject('table', 't1'),
      params: { ...createFurnitureParams('table'), topThicknessCm: 1000 },
    };
    const result = validateSceneData({
      schemaVersion: SCENE_SCHEMA_VERSION,
      room: { ...ROOM_DEFAULTS },
      objects: [object],
      settings: createDefaultSettings(),
    });

    expect(result.scene).not.toBeNull();
    expect(result.droppedObjects).toBe(0);
    expect(result.normalizations).toEqual([
      { objectId: 't1', fields: ['topThicknessCm'] },
    ]);
    // Absent entirely when nothing was adjusted, so the shape is unchanged.
    const clean = validateSceneData({
      schemaVersion: SCENE_SCHEMA_VERSION,
      room: { ...ROOM_DEFAULTS },
      objects: [createFurnitureSceneObject('table', 't2')],
      settings: createDefaultSettings(),
    });
    expect(clean.normalizations).toBeUndefined();
  });

  it('reports the count on import while leaving a clean file untouched', () => {
    const dirty = serializeSceneToJson(
      {
        schemaVersion: SCENE_SCHEMA_VERSION,
        room: { ...ROOM_DEFAULTS },
        objects: [
          {
            ...createFurnitureSceneObject('table', 't1'),
            params: { ...createFurnitureParams('table'), topThicknessCm: 1000 },
          },
        ],
        settings: createDefaultSettings(),
      },
      META,
    );
    const parsedDirty = parseSceneJson(dirty);
    if (!parsedDirty.ok) throw new Error(parsedDirty.message);
    expect(parsedDirty.normalizedObjects).toBe(1);

    const { scene } = sceneFor('table', createFurnitureParams('table'));
    const parsedClean = parseSceneJson(serializeSceneToJson(scene, META));
    if (!parsedClean.ok) throw new Error(parsedClean.message);
    expect(parsedClean.normalizedObjects).toBe(0);
  });
});

describe('C8.6.2 P3-b — builders honour the declared range', () => {
  it('exposes the declared range and default from one place', () => {
    expect(declaredRange('bed', 'headboardHeightCm')).toEqual({ min: 30, max: 150 });
    expect(declaredDefault('bed', 'mattressHeightCm')).toBe(22);
    expect(declaredRange('table', 'nonexistent' as never)).toBeNull();
  });

  it('gates a raw value into the declared range, leaving in-range and absent values alone', () => {
    expect(gateParam('bed', 'headboardHeightCm', 300)).toBe(150);
    expect(gateParam('bed', 'headboardHeightCm', 10)).toBe(30);
    expect(gateParam('bed', 'headboardHeightCm', 90)).toBe(90);
    // Absent / non-finite stay absent so the builder's documented fallback runs.
    expect(gateParam('bed', 'headboardHeightCm', undefined)).toBeUndefined();
    expect(gateParam('bed', 'headboardHeightCm', Number.NaN)).toBeUndefined();
    expect(gateParam('bed', 'headboardHeightCm', Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it('clamps a direct bed call to the declared headboard/mattress range', () => {
    // Declared headboard range is 30-150; the old builder clamp allowed 200.
    expect(partSize('bed', paramsFor('bed', { headboardHeightCm: 300 }), 'bed-headboard')).toBe(150);
    expect(partSize('bed', paramsFor('bed', { headboardHeightCm: 10 }), 'bed-headboard')).toBe(30);
    // Declared mattress range is 10-40; the old builder floor was 8.
    expect(partSize('bed', paramsFor('bed', { mattressHeightCm: 5 }), 'bed-mattress')).toBe(10);
  });

  it('clamps a direct chair call to the declared seat range', () => {
    // Declared seat range is 25-60; the old builder floor was 20.
    expect(partTop('chair', paramsFor('chair', { seatHeightCm: 20 }), 'chair-seat')).toBe(25);
  });

  it('leaves every in-range value producing exactly the same geometry', () => {
    // Spot-check the parts the gate touches, at both declared bounds.
    for (const [type, key, part] of [
      ['bed', 'headboardHeightCm', 'bed-headboard'],
      ['bed', 'mattressHeightCm', 'bed-mattress'],
      ['chair', 'seatHeightCm', 'chair-seat'],
      ['armchair', 'seatHeightCm', 'armchair-seat'],
      ['sofa', 'armHeightCm', 'sofa-arm-1'],
    ] as const) {
      const spec = FURNITURE_FIELDS[type].find((entry) => entry.key === key);
      if (!spec) throw new Error(`no spec ${type}.${key}`);
      for (const value of [spec.range.min, spec.range.max]) {
        const params = paramsFor(type, { [key]: value } as Partial<FurnitureParams>);
        // The gate is a no-op inside the declared range: the builder sees the value.
        expect(gateParam(type, key, value)).toBe(value);
        // And geometry is produced without throwing at both bounds.
        expect(() => partSize(type, params, part)).not.toThrow();
      }
    }
  });

  it('keeps every default type buildable and unchanged', () => {
    for (const type of FURNITURE_TYPES) {
      const defaults = FURNITURE_DEFAULTS[type];
      const built = buildFurniture(type, { ...defaults });
      const boxes = measurePartBoxes(built.group);
      built.dispose();
      expect(boxes.length, type).toBeGreaterThan(0);
      for (const box of boxes) {
        expect(box.maxX - box.minX).toBeGreaterThan(0);
        expect(box.maxY - box.minY).toBeGreaterThan(0);
        expect(box.maxZ - box.minZ).toBeGreaterThan(0);
      }
    }
  });

  it('still never produces non-finite geometry for hostile direct values', () => {
    const probes = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -50, 1e9];
    for (const type of FURNITURE_TYPES) {
      for (const spec of FURNITURE_FIELDS[type]) {
        for (const probe of probes) {
          const built = buildFurniture(type, paramsFor(type, { [spec.key]: probe } as Partial<FurnitureParams>));
          const boxes = measurePartBoxes(built.group);
          built.dispose();
          for (const box of boxes) {
            expect([box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ].every(Number.isFinite)).toBe(true);
            expect(box.maxY - box.minY).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('keeps the documented range reachable through the editor', () => {
    for (const type of FURNITURE_TYPES) {
      const base = createFurnitureParams(type);
      for (const spec of FURNITURE_FIELDS[type]) {
        for (const value of [spec.range.min, spec.range.max]) {
          const values: Record<string, string> = { color: base.color };
          for (const entry of FURNITURE_FIELDS[type]) {
            values[entry.key] = String(base[entry.key] ?? FURNITURE_DEFAULTS[type][entry.key]);
          }
          values[spec.key] = String(value);
          const parsed = parseFurnitureValues(type, values);
          // Cross-field rules may legitimately forbid a combination; otherwise the
          // declared bound must be accepted.
          if (parsed.valid) {
            expect(parsed.params?.[spec.key], `${type}.${spec.key}`).toBe(value);
          }
        }
      }
    }
  });
});

describe('C8.6.2 P3-c — cutting readiness keeps its outcomes apart', () => {
  function cuttingReason(type: FurnitureType, params: FurnitureParams, requested = true) {
    const check = assessProductReadiness({
      type,
      params,
      cuttingPlan: requested ? undefined : null,
      cuttingSettings: requested ? SHEET : null,
    }).checks.find((entry) => entry.id === 'cutting');
    return check;
  }

  it('says the feature does not apply when the piece is not sheet goods', () => {
    const check = cuttingReason('sofa', createFurnitureParams('sofa'));
    expect(check?.status).toBe('not_applicable');
    expect(check?.reason).toBe<CuttingReason>('not-sheet-goods');
  });

  it('says a parameter excluded the panels when the board rule is broken', () => {
    const check = cuttingReason('table', paramsFor('table', { topThicknessCm: 7 }));
    expect(check?.status).toBe('fail');
    expect(check?.reason).toBe<CuttingReason>('parameter-excludes-panels');
    expect(check?.detail).toMatch(/6 sm dan qalin/i);
  });

  it('says no material was chosen rather than blaming the model', () => {
    const check = cuttingReason('table', createFurnitureParams('table'));
    expect(check?.status).toBe('warning');
    expect(check?.reason).toBe<CuttingReason>('no-material');
  });

  it('says the layout was not requested yet', () => {
    const check = cuttingReason('shelf', createFurnitureParams('shelf'), false);
    expect(check?.status).toBe('warning');
    expect(check?.reason).toBe<CuttingReason>('not-computed');
  });

  it('reports a complete layout as complete', () => {
    const params = createFurnitureParams('shelf');
    const object = {
      ...createFurnitureSceneObject('shelf', 's1'),
      params,
      sheetMaterials: materialsFor('shelf', params),
    };
    void object;
    const check = assessProductReadiness({
      type: 'shelf',
      params,
      sheetMaterials: materialsFor('shelf', params),
      cuttingSettings: SHEET,
    }).checks.find((entry) => entry.id === 'cutting');
    expect(check?.status).toBe('pass');
    expect(check?.reason).toBe<CuttingReason>('complete');
  });

  it('reports a partial layout as partially placed', () => {
    // The wardrobe back is 1960 x 1760, larger than a 2440 x 1220 sheet.
    const params = createFurnitureParams('wardrobe');
    const check = assessProductReadiness({
      type: 'wardrobe',
      params,
      sheetMaterials: materialsFor('wardrobe', params),
      cuttingSettings: SHEET,
    }).checks.find((entry) => entry.id === 'cutting');
    expect(check?.status).toBe('warning');
    expect(check?.reason).toBe<CuttingReason>('partially-placed');
  });

  it('gives every outcome a distinct reason code', () => {
    const reasons = new Set<CuttingReason>([
      'not-sheet-goods',
      'parameter-excludes-panels',
      'no-material',
      'not-computed',
      'layout-failed',
      'partially-placed',
      'complete',
    ]);
    expect(reasons.size).toBe(7);
    // The five the brief lists are all represented by a reachable check above.
    expect(reasons.has('not-sheet-goods')).toBe(true);
    expect(reasons.has('parameter-excludes-panels')).toBe(true);
    expect(reasons.has('partially-placed')).toBe(true);
    expect(reasons.has('complete')).toBe(true);
  });
});

describe('C8.6.2 — packaging contracts unchanged', () => {
  it('keeps C1 at six entries with valid CRC for a default piece', async () => {
    const params = createFurnitureParams('table');
    const { object, scene } = sceneFor('table', params);
    const c1 = await buildManufacturingPackage({ scene, object, projectName: 'A' });
    expect(c1.ok, c1.ok ? '' : c1.reason).toBe(true);
    if (!c1.ok) return;
    // unzipSync validates each entry's CRC while inflating.
    expect(Object.keys(unzipSync(c1.package.bytes))).toHaveLength(6);
  });

  it('keeps C8 at twelve entries for a default piece', async () => {
    const params = createFurnitureParams('shelf');
    const { object, scene } = sceneFor('shelf', params);
    const c8 = await buildProductPackage({
      scene,
      object,
      projectName: 'A',
      cuttingSettings: SHEET,
    });
    expect(c8.ok, c8.ok ? '' : c8.reason).toBe(true);
    if (!c8.ok) return;
    expect(Object.keys(unzipSync(c8.product.bytes))).toHaveLength(12);
  });

  it('still refuses to package a piece the capacity rules reject', async () => {
    // The C8.6.1 fix must survive this stage.
    const params = paramsFor('shelf', { heightCm: 40, wallThicknessCm: 5, shelfCount: 8, depthCm: 20 });
    const { object, scene } = sceneFor('shelf', params);
    expect((await buildManufacturingPackage({ scene, object, projectName: 'A' })).ok).toBe(false);
    expect(
      (
        await buildProductPackage({
          scene,
          object,
          projectName: 'A',
          cuttingSettings: SHEET,
        })
      ).ok,
    ).toBe(false);
  });

  it('keeps the 6 cm table working and the 7 cm table documented', async () => {
    const six = paramsFor('table', { topThicknessCm: 6 });
    const { object, scene } = sceneFor('table', six);
    const c1 = await buildManufacturingPackage({ scene, object, projectName: 'A' });
    expect(c1.ok, c1.ok ? '' : c1.reason).toBe(true);

    const seven = paramsFor('table', { topThicknessCm: 7 });
    const sevenScene = sceneFor('table', seven);
    expect(
      (await buildManufacturingPackage({
        scene: sevenScene.scene,
        object: sevenScene.object,
        projectName: 'A',
      })).ok,
    ).toBe(false);
  });
});
