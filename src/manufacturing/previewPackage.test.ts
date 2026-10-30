/**
 * A2.2 — the product preview shots and their place in the package.
 *
 * Two layers are covered here, and they are worth separating:
 *
 * 1. The *vocabulary* (`productPreviewViews.ts`) — file names, the camera preset
 *    behind each shot, and the PNG test. Pure, no renderer.
 * 2. The *packaging* — that the builder writes those bytes into the ZIP, keeps
 *    the fourteen-entry contract when no shots are supplied, and refuses a file that
 *    is not really a PNG.
 *
 * What these tests do NOT prove is that a browser renders three different-looking
 * pictures: the renderer is not present in Node. That is verified separately in
 * the browser QA run, and the report says so.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import {
  PRODUCT_PREVIEW_FILENAMES,
  PRODUCT_PREVIEW_VIEWS,
  isPngBytes,
  isProductPreviewFilename,
} from '../viewer/productPreviewViews';
import { computeObjectFraming } from '../render/framing';
import {
  PRODUCT_PACKAGE_ENTRIES,
  buildProductPackage,
  productPackageEntries,
} from './productPackage';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  type SceneData,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';
import { createFurnitureParams } from '../geometry/furniture/types';
import type { SheetMaterialEntry } from './sheetMaterial';
import { buildBom } from './bom';

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

/**
 * A minimal but genuinely valid PNG: the 8-byte signature, an IHDR chunk, and an
 * IEND chunk. Built here rather than pasted so the structure is visible.
 */
function makePng(width = 1, height = 1): Uint8Array {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdrData = [
    (width >> 24) & 0xff,
    (width >> 16) & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    (height >> 24) & 0xff,
    (height >> 16) & 0xff,
    (height >> 8) & 0xff,
    height & 0xff,
    8, // bit depth
    6, // colour type RGBA
    0,
    0,
    0,
  ];
  const chunk = (type: string, data: number[]): number[] => [
    0,
    0,
    0,
    data.length,
    ...type.split('').map((char) => char.charCodeAt(0)),
    ...data,
    0,
    0,
    0,
    0, // CRC placeholder: the package does not verify CRCs of image payloads
  ];
  return new Uint8Array([
    ...signature,
    ...chunk('IHDR', ihdrData),
    ...chunk('IDAT', [0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01]),
    ...chunk('IEND', []),
  ]);
}

function previewSet(): Array<{ name: string; bytes: Uint8Array }> {
  return PRODUCT_PREVIEW_FILENAMES.map((name, index) => ({
    name,
    // Distinct payload lengths so the three files are distinguishable.
    bytes: makePng(index + 1, index + 1),
  }));
}

function materialsFor(): SheetMaterialEntry[] {
  const bom = buildBom('table', createFurnitureParams('table'));
  if (!bom.ok) return [];
  return bom.bom.rows.map((row) => ({
    partId: row.partId,
    materialId: 'ldsp' as const,
    thicknessMm: 18,
    thicknessSource: 'user' as const,
  }));
}

function packageInput(previews?: Array<{ name: string; bytes: Uint8Array }> | null) {
  const object = {
    ...createFurnitureSceneObject('table', 'table-1'),
    sheetMaterials: materialsFor(),
  };
  const scene: SceneData = {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects: [object],
    settings: createDefaultSettings(),
  };
  return {
    scene,
    object,
    projectName: 'Preview sinovi',
    cuttingSettings: SHEET,
    previews,
    generatedAt: new Date('2026-07-01T00:00:00.000Z'),
  };
}

describe('A2.2 preview vocabulary', () => {
  it('declares exactly the three documented files', () => {
    expect(PRODUCT_PREVIEW_FILENAMES).toEqual([
      'preview-front.png',
      'preview-side.png',
      'preview-detail.png',
    ]);
    // Distinct, stable, no paths.
    expect(new Set(PRODUCT_PREVIEW_FILENAMES).size).toBe(3);
    for (const name of PRODUCT_PREVIEW_FILENAMES) {
      expect(name).not.toContain('/');
      expect(name).toMatch(/^preview-[a-z]+\.png$/);
    }
  });

  it('frames each shot with a different camera preset', () => {
    const presets = PRODUCT_PREVIEW_VIEWS.map((view) => view.cameraPreset);
    expect(new Set(presets).size).toBe(3);
  });

  it('places the camera somewhere different for each shot', () => {
    // Run the real framing function rather than reading a constant: if two shots
    // resolved to the same camera position the "gallery" would be duplicates.
    const bounds = { min: { x: -60, y: 0, z: -30 }, max: { x: 60, y: 75, z: 30 } };
    const positions = PRODUCT_PREVIEW_VIEWS.map((view) =>
      computeObjectFraming(bounds, view.cameraPreset, 16 / 9),
    );
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        const a = positions[i].position;
        const b = positions[j].position;
        const distance = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
        // A whole centimetre apart at the very least; in practice far more.
        expect(distance, `${i}/${j}`).toBeGreaterThan(1);
      }
      // Every shot must aim at the same object centre.
      expect(positions[i].target).toEqual(positions[0].target);
    }
  });

  it('accepts only the declared names', () => {
    expect(isProductPreviewFilename('preview-front.png')).toBe(true);
    expect(isProductPreviewFilename('preview-back.png')).toBe(false);
    expect(isProductPreviewFilename('../escape.png')).toBe(false);
    expect(isProductPreviewFilename('model.glb')).toBe(false);
  });

  it('distinguishes a real PNG from other bytes', () => {
    expect(isPngBytes(makePng())).toBe(true);
    expect(isPngBytes(new Uint8Array())).toBe(false);
    expect(isPngBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    // A JPEG header must not pass.
    expect(isPngBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]))).toBe(false);
    // PNG signature but not an IHDR chunk first.
    const corrupt = makePng();
    corrupt[12] = 0x58;
    expect(isPngBytes(corrupt)).toBe(false);
  });
});

describe('A2.2 package entries', () => {
  it('is unchanged without previews', () => {
    expect(productPackageEntries()).toEqual([...PRODUCT_PACKAGE_ENTRIES]);
    expect(productPackageEntries().length).toBe(14);
  });

  it('appends previews in canonical order regardless of input order', () => {
    const shuffled = [
      { name: 'preview-detail.png', bytes: makePng() },
      { name: 'preview-front.png', bytes: makePng() },
      { name: 'preview-side.png', bytes: makePng() },
    ];
    expect(productPackageEntries(shuffled)).toEqual([
      ...PRODUCT_PACKAGE_ENTRIES,
      'preview-front.png',
      'preview-side.png',
      'preview-detail.png',
    ]);
  });

  it('supports a single shot without inventing the others', () => {
    expect(productPackageEntries([{ name: 'preview-side.png', bytes: makePng() }])).toEqual([
      ...PRODUCT_PACKAGE_ENTRIES,
      'preview-side.png',
    ]);
  });
});

describe('A2.2 previews in the ZIP', () => {
  it('keeps exactly fourteen entries when no previews are supplied', async () => {
    const outcome = await buildProductPackage(packageInput(undefined));
    expect(outcome.ok, outcome.ok ? '' : outcome.reason).toBe(true);
    if (!outcome.ok) return;

    const names = Object.keys(unzipSync(outcome.product.bytes));
    expect(names).toHaveLength(14);
    expect(names.sort()).toEqual([...PRODUCT_PACKAGE_ENTRIES].sort());
  });

  it('treats null previews as none', async () => {
    const outcome = await buildProductPackage(packageInput(null));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(Object.keys(unzipSync(outcome.product.bytes))).toHaveLength(14);
  });

  it('writes all three images as real PNGs, alongside the fourteen documents', async () => {
    const outcome = await buildProductPackage(packageInput(previewSet()));
    expect(outcome.ok, outcome.ok ? '' : outcome.reason).toBe(true);
    if (!outcome.ok) return;

    // unzipSync verifies each entry's CRC while inflating.
    const files = unzipSync(outcome.product.bytes);
    const names = Object.keys(files);
    expect(names).toHaveLength(17);

    for (const name of PRODUCT_PREVIEW_FILENAMES) {
      expect(files[name], name).toBeDefined();
      const bytes = files[name];
      expect(bytes.length, name).toBeGreaterThan(30);
      // Read the bytes back out of the archive, not from the input.
      expect(isPngBytes(bytes), `${name} is a PNG`).toBe(true);
    }

    // Nothing was displaced: all fourteen base entries are still present.
    for (const base of PRODUCT_PACKAGE_ENTRIES) {
      expect(files[base], base).toBeDefined();
    }
  });

  it('never writes the same entry twice', async () => {
    const outcome = await buildProductPackage(packageInput(previewSet()));
    if (!outcome.ok) throw new Error(outcome.reason);
    const names = Object.keys(unzipSync(outcome.product.bytes));
    expect(new Set(names).size).toBe(names.length);
  });

  it('records the previews in meta.json and README.txt', async () => {
    const outcome = await buildProductPackage(packageInput(previewSet()));
    if (!outcome.ok) throw new Error(outcome.reason);
    const files = unzipSync(outcome.product.bytes);

    const meta = JSON.parse(strFromU8(files['meta.json']));
    expect(meta.previews).toEqual([...PRODUCT_PREVIEW_FILENAMES]);
    expect(meta.entries).toEqual([
      ...PRODUCT_PACKAGE_ENTRIES,
      ...PRODUCT_PREVIEW_FILENAMES,
    ]);

    const readme = strFromU8(files['README.txt']);
    for (const name of PRODUCT_PREVIEW_FILENAMES) {
      expect(readme).toContain(name);
    }
  });

  it('reports previews as an empty list when none were taken', async () => {
    const outcome = await buildProductPackage(packageInput(undefined));
    if (!outcome.ok) throw new Error(outcome.reason);
    const meta = JSON.parse(strFromU8(unzipSync(outcome.product.bytes)['meta.json']));
    expect(meta.previews).toEqual([]);
    expect(meta.entries).toEqual([...PRODUCT_PACKAGE_ENTRIES]);
  });

  it('stays deterministic with previews', async () => {
    const a = await buildProductPackage(packageInput(previewSet()));
    const b = await buildProductPackage(packageInput(previewSet()));
    if (!a.ok || !b.ok) throw new Error('package failed');
    expect(Array.from(b.product.bytes)).toEqual(Array.from(a.product.bytes));
  });

  it('lists exactly what it wrote', async () => {
    const outcome = await buildProductPackage(packageInput(previewSet()));
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.product.entries.map((entry) => entry.name)).toEqual(
      outcome.product.expectedEntries,
    );
    expect(outcome.product.expectedEntries).toHaveLength(17);
  });
});

describe('A2.2 a bad preview is refused, not swallowed', () => {
  it('rejects bytes that are not a PNG', async () => {
    const bad = [{ name: 'preview-front.png', bytes: new TextEncoder().encode('not an image') }];
    const outcome = await buildProductPackage(packageInput(bad));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/PNG emas/i);
  });

  it('rejects an empty buffer', async () => {
    const outcome = await buildProductPackage(
      packageInput([{ name: 'preview-side.png', bytes: new Uint8Array() }]),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/PNG emas/i);
  });

  it('rejects an unknown filename instead of writing it', async () => {
    const outcome = await buildProductPackage(
      packageInput([{ name: 'screenshot.png', bytes: makePng() }]),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/Noma'lum preview fayli/i);
  });

  it('rejects a duplicated filename', async () => {
    const duplicated = [
      { name: 'preview-front.png', bytes: makePng() },
      { name: 'preview-front.png', bytes: makePng() },
    ];
    const outcome = await buildProductPackage(packageInput(duplicated));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/takrorlangan/i);
  });
});
