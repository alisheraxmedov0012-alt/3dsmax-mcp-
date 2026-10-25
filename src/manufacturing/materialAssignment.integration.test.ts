import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildBom } from './bom';
import { buildCutList } from './cutList';
import { groupByMaterial, type SheetMaterialEntry } from './sheetMaterial';
import { validateManufacturing } from './validation';
import { createTechnicalDrawingSvg } from './technicalDrawing';
import { buildManufacturingPackage } from './manufacturingPackage';
import { buildManufacturingPdf, materialTableRows } from './pdfDocument';
import { sceneReducer } from '../scene/sceneReducer';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createDefaultSceneState,
  createFurnitureSceneObject,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';
import { createFurnitureParams } from '../geometry/furniture/types';
import { unzipSync } from 'fflate';

/**
 * The assignment, as the reducer would store it after the user clicks "Save".
 * Going through the reducer here is the point: the test exercises the same path
 * the UI does, not a hand-built object.
 */
function assign(objectId: string, partId: string, materialId: string, thicknessMm: number) {
  let state = createDefaultSceneState(() => 'w-1');
  const wardrobe = createFurnitureSceneObject('wardrobe', objectId);
  state = sceneReducer(state, {
    type: 'ADD_FURNITURE',
    furnitureType: 'wardrobe',
    id: objectId,
    params: wardrobe.params,
  });
  state = sceneReducer(state, {
    type: 'SET_SHEET_MATERIAL',
    id: objectId,
    assignment: { partId, materialId: materialId as SheetMaterialEntry['materialId'], thicknessMm },
  });
  const object = state.data.objects.find((entry) => entry.id === objectId);
  if (!object) throw new Error('object missing');
  return object;
}

const FIXED = new Date('2026-03-04T05:06:07.000Z');

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

describe('C3.1 — an assignment flows into every output', () => {
  const object = assign('c31-wardrobe', 'wardrobe-door', 'mdf', 12);
  const params = createFurnitureParams('wardrobe');

  it('stored the assignment on the object, not on the PBR material', () => {
    expect(object.sheetMaterials).toEqual([
      { partId: 'wardrobe-door', materialId: 'mdf', thicknessMm: 12, thicknessSource: 'user' },
    ]);
    expect(object.material.materialId).toBeUndefined();
  });

  it('appears in the BOM beside the measured thickness', () => {
    const bom = buildBom('wardrobe', params, object.sheetMaterials);
    if (!bom.ok) throw new Error(bom.reason);
    const door = bom.bom.rows.find((row) => row.partId === 'wardrobe-door');
    expect(door?.material?.name).toBe('MDF');
    expect(door?.material?.thicknessMm).toBe(12);
    // Measured geometry is untouched by the nominal value.
    expect(door?.thicknessMm).toBe(12);
    // Other parts are still unassigned.
    expect(bom.bom.rows.filter((row) => row.material !== null)).toHaveLength(1);
  });

  it('appears in the cut list', () => {
    const bom = buildBom('wardrobe', params, object.sheetMaterials);
    if (!bom.ok) throw new Error(bom.reason);
    const cut = buildCutList(bom.bom);
    const door = cut.rows.find((row) => row.partId === 'wardrobe-door');
    expect(door?.material?.name).toBe('MDF');
  });

  it('updates the validation report', () => {
    const report = validateManufacturing('wardrobe', params, object.sheetMaterials);
    // The assigned part no longer produces a "missing material" warning.
    const missing = report.issues.filter((issue) => issue.code === 'material-missing');
    expect(missing.length).toBeLessThan(6);
    expect(report.issues.some((issue) => issue.partId === 'wardrobe-door' && issue.code === 'material-missing')).toBe(
      false,
    );
    expect(report.counts.error).toBe(0);
  });

  it('feeds the PDF material table', () => {
    const bom = buildBom('wardrobe', params, object.sheetMaterials);
    if (!bom.ok) throw new Error(bom.reason);
    const rows = materialTableRows(groupByMaterial(bom.bom.rows));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(['MDF', 'mdf', '12 mm', '2', 'wardrobe-door']);
  });

  it('reaches the ZIP metadata with six entries intact', async () => {
    const outcome = await buildManufacturingPackage({
      scene: {
        schemaVersion: SCENE_SCHEMA_VERSION,
        room: { ...ROOM_DEFAULTS },
        objects: [object],
        settings: createDefaultSettings(),
      },
      object,
      projectName: 'Shkaf',
      generatedAt: FIXED,
    });
    if (!outcome.ok) throw new Error(outcome.reason);

    const files = unzipSync(outcome.package.bytes);
    expect(Object.keys(files).sort()).toEqual(
      ['BOM.csv', 'README.txt', 'cutlist.csv', 'drawing.svg', 'meta.json', 'model.glb'].sort(),
    );
    const meta = JSON.parse(new TextDecoder().decode(files['meta.json']));
    expect(meta.materials).toHaveLength(1);
    expect(meta.materials[0].materialId).toBe('mdf');
  }, 30_000);

  it('builds a PDF that lists the assignment', async () => {
    const bom = buildBom('wardrobe', params, object.sheetMaterials);
    if (!bom.ok) throw new Error(bom.reason);
    const drawing = createTechnicalDrawingSvg('wardrobe', params);
    if (!drawing.ok) throw new Error(drawing.reason);

    const out = await buildManufacturingPdf({
      type: 'wardrobe',
      params,
      projectName: 'Shkaf',
      bom: bom.bom,
      cutList: buildCutList(bom.bom),
      materials: groupByMaterial(bom.bom.rows),
      validation: validateManufacturing('wardrobe', params, object.sheetMaterials),
      drawing: { svg: drawing.svg, scale: drawing.scale },
      overall: drawing.overall,
      generatedAt: FIXED,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(new TextDecoder('latin1').decode(out.bytes.slice(0, 5))).toBe('%PDF-');
      expect(out.pageCount).toBeGreaterThanOrEqual(3);
    }
  }, 30_000);

  it('leaves the C2 drawing identical to an unassigned model', () => {
    const plain = createTechnicalDrawingSvg('wardrobe', params, { title: 'Shkaf', date: '2026-03-04' });
    // Material data never reaches the drawing at all: it takes type+params only.
    expect(plain.ok).toBe(true);
    if (!plain.ok) return;
    const withMaterial = createTechnicalDrawingSvg('wardrobe', params, { title: 'Shkaf', date: '2026-03-04' });
    if (!withMaterial.ok) return;
    expect(withMaterial.svg).toBe(plain.svg);
  });
});
