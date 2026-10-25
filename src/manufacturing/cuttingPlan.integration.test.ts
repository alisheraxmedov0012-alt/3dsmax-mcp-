/**
 * C7 integration: a cutting plan must describe the same boards the rest of the
 * manufacturing pipeline does, and must not disturb anything C1–C6 already
 * promised.
 *
 * The unit tests cover the nesting maths. This suite puts the plan next to the
 * artefacts that leave the app — the ZIP package, the cut list CSV, the C3.1
 * assignments and the C6 instructions — because a plan that names a part the
 * workshop was not given is useless, and a C7 change that renumbered or reshaped
 * the C1 package would be a silent regression.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildBom } from './bom';
import { buildCutList } from './cutList';
import { buildCuttingPlan } from './cuttingPlan';
import { buildFurnitureAssemblyPlan, assemblyPlanPartIds } from './assemblyInstructions';
import { buildManufacturingPackage } from './manufacturingPackage';
import { validateManufacturing } from './validation';
import type { SheetMaterialEntry } from './sheetMaterial';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  type SceneData,
  type SceneObject,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';
import { createFurnitureParams, type FurnitureType } from '../geometry/furniture/types';

/** Node has no FileReader, which GLTFExporter uses for the .glb payload. */
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

const FIXED = new Date('2026-04-05T06:07:08.000Z');

const SETTINGS = {
  sheetLengthMm: 2440,
  sheetWidthMm: 1220,
  kerfMm: 4,
  allowRotation: true,
} as const;

const MATERIALS: SheetMaterialEntry[] = [
  { partId: 'wardrobe-side', materialId: 'ldsp', thicknessMm: 18, thicknessSource: 'user' },
  { partId: 'wardrobe-top', materialId: 'ldsp', thicknessMm: 18, thicknessSource: 'user' },
  { partId: 'wardrobe-bottom', materialId: 'ldsp', thicknessMm: 18, thicknessSource: 'user' },
  { partId: 'wardrobe-back', materialId: 'mdf', thicknessMm: 18, thicknessSource: 'user' },
  { partId: 'wardrobe-shelf', materialId: 'ldsp', thicknessMm: 18, thicknessSource: 'user' },
  { partId: 'wardrobe-door', materialId: 'mdf', thicknessMm: 12, thicknessSource: 'user' },
];

function objectFor(type: FurnitureType, materials?: SheetMaterialEntry[]): SceneObject {
  return createFurnitureSceneObject(type, `${type}-1`, { sheetMaterials: materials });
}

function sceneWith(object: SceneObject): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects: [object],
    settings: createDefaultSettings(),
  };
}

/** `partId` column of an emitted CSV, skipping the totals row. */
function csvPartIds(csv: string): string[] {
  const [header, ...rows] = csv.trim().split(/\r?\n/);
  const columns = header.split(',');
  const index = columns.indexOf('partId');
  expect(index).toBeGreaterThanOrEqual(0);
  return rows
    .map((line) => line.split(',')[index])
    .filter((value) => value !== '')
    .sort();
}

describe('C7 — cutting plan agrees with the manufacturing documents', () => {
  it('only names part ids that the packaged BOM.csv contains', async () => {
    const object = objectFor('wardrobe', MATERIALS);
    const outcome = await buildManufacturingPackage({
      scene: sceneWith(object),
      object,
      projectName: 'Loyiha',
      generatedAt: FIXED,
    });
    expect(outcome.ok, outcome.ok ? '' : outcome.reason).toBe(true);
    if (!outcome.ok) return;

    const files = unzipSync(outcome.package.bytes);
    const bomIds = csvPartIds(strFromU8(files['BOM.csv']));

    const bom = buildBom('wardrobe', object.params, object.sheetMaterials);
    if (!bom.ok) throw new Error(bom.reason);
    const plan = buildCuttingPlan({ cutList: buildCutList(bom.bom), bom: bom.bom, settings: SETTINGS });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const plannedIds = new Set(
      plan.plan.groups.flatMap((group) =>
        group.sheets.flatMap((sheet) => sheet.placements.map((piece) => piece.partId)),
      ),
    );
    for (const partId of plannedIds) {
      expect(bomIds).toContain(partId);
    }
  });

  it('accounts for every piece the cut list asked for', async () => {
    const bom = buildBom('wardrobe', createFurnitureParams('wardrobe'), MATERIALS);
    if (!bom.ok) throw new Error(bom.reason);
    const cutList = buildCutList(bom.bom);
    const outcome = buildCuttingPlan({ cutList, bom: bom.bom, settings: SETTINGS });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const placed = outcome.plan.summary.placedCount;
    const unplaced = outcome.plan.summary.unplacedCount;
    expect(placed + unplaced).toBe(cutList.totalPieces);
    expect(outcome.plan.summary.pieceCount).toBe(cutList.totalPieces);
  });

  it('leaves the six-entry ZIP contract untouched', async () => {
    const object = objectFor('wardrobe', MATERIALS);
    const outcome = await buildManufacturingPackage({
      scene: sceneWith(object),
      object,
      projectName: 'Loyiha',
      generatedAt: FIXED,
    });
    expect(outcome.ok, outcome.ok ? '' : outcome.reason).toBe(true);
    if (!outcome.ok) return;

    const names = Object.keys(unzipSync(outcome.package.bytes)).sort();
    expect(names).toEqual(
      ['BOM.csv', 'README.txt', 'cutlist.csv', 'drawing.svg', 'meta.json', 'model.glb'].sort(),
    );
  });

  it('is unaffected by a C3.1 material assignment being present or absent', () => {
    const withMaterials = buildBom('wardrobe', createFurnitureParams('wardrobe'), MATERIALS);
    const without = buildBom('wardrobe', createFurnitureParams('wardrobe'));
    if (!withMaterials.ok || !without.ok) throw new Error('BOM failed');

    const assigned = buildCuttingPlan({
      cutList: buildCutList(withMaterials.bom),
      settings: SETTINGS,
    });
    const bare = buildCuttingPlan({
      cutList: buildCutList(without.bom),
      settings: SETTINGS,
    });
    expect(assigned.ok).toBe(true);
    expect(bare.ok).toBe(true);
    if (!assigned.ok || !bare.ok) return;

    // Without assignments there is no board to cut from, and the plan says so
    // rather than assuming a material.
    expect(bare.plan.summary.sheetCount).toBe(0);
    expect(bare.plan.status).toBe('unavailable');
    expect(bare.plan.unplaced.every((piece) => piece.reason === 'no-material')).toBe(true);

    // With assignments the same code produces real sheets.
    expect(assigned.plan.summary.sheetCount).toBeGreaterThan(0);
    expect(assigned.plan.status).not.toBe('unavailable');
  });

  it('keeps the C4 report unchanged while a cutting plan is computed', () => {
    const params = createFurnitureParams('wardrobe');
    const before = validateManufacturing('wardrobe', params, MATERIALS);

    const bom = buildBom('wardrobe', params, MATERIALS);
    if (!bom.ok) throw new Error(bom.reason);
    buildCuttingPlan({ cutList: buildCutList(bom.bom), bom: bom.bom, settings: SETTINGS });

    const after = validateManufacturing('wardrobe', params, MATERIALS);
    // C7 reads the manufacturing data; it must not add issues to, or reclassify
    // issues in, the C4 report that the rest of the pipeline trusts.
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it('does not change the C6 instructions it sits next to', () => {
    const bom = buildBom('wardrobe', createFurnitureParams('wardrobe'), MATERIALS);
    if (!bom.ok) throw new Error(bom.reason);
    const before = buildFurnitureAssemblyPlan({ bom: bom.bom });
    const plan = buildCuttingPlan({ cutList: buildCutList(bom.bom), bom: bom.bom, settings: SETTINGS });
    expect(plan.ok).toBe(true);
    const after = buildFurnitureAssemblyPlan({ bom: bom.bom });

    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(assemblyPlanPartIds(after)).toEqual(assemblyPlanPartIds(before));
  });

  it('agrees with the cut list CSV about which panels exist', async () => {
    const object = objectFor('wardrobe', MATERIALS);
    const outcome = await buildManufacturingPackage({
      scene: sceneWith(object),
      object,
      projectName: 'Loyiha',
      generatedAt: FIXED,
    });
    expect(outcome.ok, outcome.ok ? '' : outcome.reason).toBe(true);
    if (!outcome.ok) return;

    const files = unzipSync(outcome.package.bytes);
    const cutIds = csvPartIds(strFromU8(files['cutlist.csv']));

    const bom = buildBom('wardrobe', object.params, object.sheetMaterials);
    if (!bom.ok) throw new Error(bom.reason);
    const cutList = buildCutList(bom.bom);
    const plan = buildCuttingPlan({ cutList, bom: bom.bom, settings: SETTINGS });
    if (!plan.ok) throw new Error(plan.reason);

    // Every cut-list panel is either placed or listed as unplaced — never lost.
    const recorded = new Set(
      [
        ...plan.plan.groups.flatMap((group) =>
          group.sheets.flatMap((sheet) => sheet.placements.map((piece) => piece.partId)),
        ),
        ...plan.plan.unplaced.map((piece) => piece.partId),
      ],
    );
    expect([...recorded].sort()).toEqual(cutIds);
  });
});
