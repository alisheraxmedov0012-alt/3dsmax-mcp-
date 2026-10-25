/**
 * C6 integration: the instructions and the documents a workshop receives must
 * describe the same parts.
 *
 * The unit tests prove the plan is internally consistent. This one puts the plan
 * next to the artefacts that actually leave the app — the ZIP's `BOM.csv`, the
 * cut list and the C3.1 material assignments — because a manual that names a part
 * the supplied parts list does not contain is unusable at the bench.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildBom } from './bom';
import { buildCutList } from './cutList';
import { buildFurnitureAssemblyPlan, assemblyPlanPartIds } from './assemblyInstructions';
import { groupByMaterial, type SheetMaterialEntry } from './sheetMaterial';
import { buildManufacturingPackage } from './manufacturingPackage';
import { createTechnicalDrawingSvg } from './technicalDrawing';
import { buildManufacturingPdf } from './pdfDocument';
import { validateManufacturing } from './validation';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  type SceneData,
  type SceneObject,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';
import { createFurnitureParams, type FurnitureType } from '../geometry/furniture/types';

/**
 * Node has no FileReader, which GLTFExporter uses for the .glb payload. The same
 * shim the C1 package tests use, so this suite exercises the real export path.
 */
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

/**
 * Split one CSV line, honouring the quoting the exporter uses for free text.
 * A naive `split(',')` would misread a quoted note and shift every later column.
 */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

/** Part ids in the `partId` column, excluding the totals line at the end. */
function csvPartIds(csv: string): string[] {
  const [header, ...rows] = csv.trim().split(/\r?\n/);
  const index = splitCsvLine(header).indexOf('partId');
  expect(index).toBeGreaterThanOrEqual(0);
  return rows
    .map((line) => splitCsvLine(line)[index])
    .filter((value) => value !== '')
    .sort();
}

describe('C6 — instructions agree with the manufacturing documents', () => {
  it('references exactly the part ids the packaged BOM.csv lists', async () => {
    const types = ['table', 'chair', 'wardrobe', 'shelf', 'dresser', 'bed'] as const;
    const built = await Promise.all(
      types.map((type) => {
        const object = objectFor(type);
        return buildManufacturingPackage({
          scene: sceneWith(object),
          object,
          projectName: `Loyiha ${type}`,
          generatedAt: FIXED,
        });
      }),
    );
    for (const [position, type] of types.entries()) {
      const outcome = built[position];
      expect(outcome.ok, `${type}: ${outcome.ok ? '' : outcome.reason}`).toBe(true);
      if (!outcome.ok) continue;

      const files = unzipSync(outcome.package.bytes);
      const bomCsv = strFromU8(files['BOM.csv']);
      const bom = buildBom(type, createFurnitureParams(type));
      if (!bom.ok) throw new Error(bom.reason);
      const plan = buildFurnitureAssemblyPlan({ bom: bom.bom });

      expect(assemblyPlanPartIds(plan), type).toEqual(csvPartIds(bomCsv));
    }
  });

  it('keeps the ZIP at exactly the six expected entries', async () => {
    const object = objectFor('wardrobe');
    const outcome = await buildManufacturingPackage({
      scene: sceneWith(object),
      object,
      projectName: 'Shkaf',
      generatedAt: FIXED,
    });
    expect(outcome.ok, outcome.ok ? '' : outcome.reason).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.package.entries.map((entry) => entry.name).sort()).toEqual([
      'BOM.csv',
      'README.txt',
      'cutlist.csv',
      'drawing.svg',
      'meta.json',
      'model.glb',
    ]);
  });

  it('survives a C3.1 material assignment without dropping or inventing parts', async () => {
    const materials: SheetMaterialEntry[] = [
      { partId: 'wardrobe-door', materialId: 'ldsp', thicknessMm: 18, thicknessSource: 'user' },
      { partId: 'wardrobe-side', materialId: 'mdf', thicknessMm: 16, thicknessSource: 'user' },
    ];
    const object = objectFor('wardrobe', materials);
    const bom = buildBom('wardrobe', object.params, materials);
    if (!bom.ok) throw new Error(bom.reason);

    const plain = buildBom('wardrobe', object.params);
    if (!plain.ok) throw new Error(plain.reason);
    const plan = buildFurnitureAssemblyPlan({ bom: bom.bom });

    // Same parts, same ids, same counts as the unassigned model.
    expect(assemblyPlanPartIds(plan)).toEqual(assemblyPlanPartIds(buildFurnitureAssemblyPlan({ bom: plain.bom })));
    // The assignments themselves are untouched and still grouped.
    const groups = groupByMaterial(bom.bom.rows);
    expect(groups.map((group) => group.materialId).sort()).toEqual(['ldsp', 'mdf']);
    expect(groups.flatMap((group) => group.partIds)).toContain('wardrobe-door');
    // And the plan fingerprint ignores material, so assigning a board does not
    // invalidate instructions that are still correct.
    expect(plan.fingerprint).toBe(buildFurnitureAssemblyPlan({ bom: plain.bom }).fingerprint);
  });

  it('reaches the PDF alongside the C1–C5 sections', async () => {
    const type: FurnitureType = 'wardrobe';
    const params = createFurnitureParams(type);
    const object = objectFor(type);
    const bom = buildBom(type, params, object.sheetMaterials);
    if (!bom.ok) throw new Error(bom.reason);
    const drawing = createTechnicalDrawingSvg(type, params, { title: 'Shkaf', date: '2026-04-05' });
    if (!drawing.ok) throw new Error(drawing.reason);
    const plan = buildFurnitureAssemblyPlan({ bom: bom.bom });

    const outcome = await buildManufacturingPdf({
      type,
      params,
      projectName: 'Shkaf',
      bom: bom.bom,
      cutList: buildCutList(bom.bom),
      materials: groupByMaterial(bom.bom.rows),
      validation: validateManufacturing(type, params, object.sheetMaterials),
      drawing: { svg: drawing.svg, scale: drawing.scale },
      overall: drawing.overall,
      assembly: plan,
      generatedAt: FIXED,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.pageCount).toBeGreaterThanOrEqual(3);
      expect(outcome.filename.endsWith('.pdf')).toBe(true);
    }
  });

  it('does not change the C4 verdict it was given in order to look useful', async () => {
    // An invalid model still gets a plan, but the C4 errors stay exactly as C4
    // reported them and the plan is marked limited.
    const type: FurnitureType = 'wardrobe';
    const params = { ...createFurnitureParams(type), widthCm: -5 };
    const validation = validateManufacturing(type, params);
    expect(validation.counts.error).toBeGreaterThan(0);

    const bom = buildBom(type, createFurnitureParams(type));
    if (!bom.ok) throw new Error(bom.reason);
    const plan = buildFurnitureAssemblyPlan({ bom: bom.bom, validation });

    expect(validation.counts.error).toBeGreaterThan(0);
    expect(plan.status).toBe('limited');
    expect(plan.issues.map((issue) => issue.code)).toContain('validation-errors');
  });
});
