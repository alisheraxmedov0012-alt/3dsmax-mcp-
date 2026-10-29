import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import {
  buildProductPackage,
  PRODUCT_PACKAGE_ENTRIES,
  type ProductPackage,
} from './productPackage';
import { buildBom } from './bom';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  type SceneData,
  type SceneObject,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';
import { createFurnitureParams } from '../geometry/furniture/types';

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

function objectWithWidth(widthCm: number): SceneObject {
  const object = createFurnitureSceneObject('table', 'table-1', {
    params: { ...createFurnitureParams('table'), widthCm },
  });
  const bom = buildBom(object.type, object.params);
  if (!bom.ok) throw new Error(bom.reason);
  object.sheetMaterials = bom.bom.rows.map((row) => ({
    partId: row.partId,
    materialId: 'ldsp',
    thicknessMm: 18,
    thicknessSource: 'user',
  }));
  return object;
}

function sceneWith(object: SceneObject): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects: [object],
    settings: createDefaultSettings(),
  };
}

async function packageFor(widthCm: number): Promise<ProductPackage> {
  const object = objectWithWidth(widthCm);
  const outcome = await buildProductPackage({
    scene: sceneWith(object),
    object,
    projectName: `Width ${widthCm}`,
    cuttingSettings: SETTINGS,
    generatedAt: FIXED,
  });
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.product;
}

function filesOf(product: ProductPackage): Record<string, Uint8Array> {
  return unzipSync(product.bytes);
}

describe('C1/C8 — a width change reaches every document', () => {
  it('keeps BOM, cut list, drawing, metadata and GLB on the same geometry', async () => {
    const narrow = await packageFor(120);
    const wide = await packageFor(180);
    const narrowFiles = filesOf(narrow);
    const wideFiles = filesOf(wide);

    const narrowMeta = JSON.parse(strFromU8(narrowFiles['meta.json']));
    const wideMeta = JSON.parse(strFromU8(wideFiles['meta.json']));
    expect(narrowMeta.listing.dimensionsMm.widthMm).toBe(1200);
    expect(wideMeta.listing.dimensionsMm.widthMm).toBe(1800);
    expect(narrowMeta.entries).toEqual([...PRODUCT_PACKAGE_ENTRIES]);
    expect(wideMeta.entries).toEqual([...PRODUCT_PACKAGE_ENTRIES]);

    const tableTopLine = (files: Record<string, Uint8Array>, file: string) =>
      strFromU8(files[file])
        .split('\n')
        .find((line) => line.includes('table-top')) ?? '';

    expect(tableTopLine(narrowFiles, 'BOM.csv')).toContain('1200');
    expect(tableTopLine(wideFiles, 'BOM.csv')).toContain('1800');
    expect(tableTopLine(narrowFiles, 'cutlist.csv')).toContain('1200');
    expect(tableTopLine(wideFiles, 'cutlist.csv')).toContain('1800');

    expect(strFromU8(narrowFiles['drawing.svg'])).toContain('1200 mm');
    expect(strFromU8(wideFiles['drawing.svg'])).toContain('1800 mm');

    expect(String.fromCharCode(...narrowFiles['document.pdf'].slice(0, 4))).toBe('%PDF');
    expect(String.fromCharCode(...wideFiles['document.pdf'].slice(0, 4))).toBe('%PDF');

    // Both models export, and the wider scene produces a different GLB payload.
    expect(narrowFiles['model.glb'].length).toBeGreaterThan(0);
    expect(wideFiles['model.glb'].length).toBeGreaterThan(0);
    expect(Array.from(wideFiles['model.glb'])).not.toEqual(
      Array.from(narrowFiles['model.glb']),
    );

    // The package carries an explicit hardware row, not an empty table.
    expect(strFromU8(wideFiles['hardware.csv'])).toContain('not-specified');
  });
});
