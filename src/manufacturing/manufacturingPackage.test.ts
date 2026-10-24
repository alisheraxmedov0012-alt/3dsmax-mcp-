import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import {
  PACKAGE_ENTRIES,
  PACKAGE_META_FORMAT,
  PACKAGE_MIME_TYPE,
  buildManufacturingPackage,
  packageFilename,
  sceneForObject,
  type PackageOutcome,
} from './manufacturingPackage';
import { buildBom } from './bom';
import { buildCutList } from './cutList';
import { createDefaultSettings } from '../scene/sceneSettings';
import type { FurnitureType } from '../geometry/furniture/types';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  type SceneData,
  type SceneObject,
} from '../scene/types';

/**
 * Node has no FileReader, which GLTFExporter uses to assemble the binary (.glb)
 * payload. This shim reads real Blob contents, so the production export path runs
 * end-to-end here rather than being mocked.
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

const FIXED_DATE = new Date('2026-03-04T05:06:07.000Z');

function objectOf(type: FurnitureType = 'table', id = `${type}-1`): SceneObject {
  return createFurnitureSceneObject(type, id);
}

function sceneWith(...objects: SceneObject[]): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects,
    settings: createDefaultSettings(),
  };
}

async function build(
  object: SceneObject = objectOf(),
  projectName = 'Stol loyihasi',
  extraObjects: SceneObject[] = [],
): Promise<Extract<PackageOutcome, { ok: true }>> {
  const result = await buildManufacturingPackage({
    scene: sceneWith(object, ...extraObjects),
    object,
    projectName,
    generatedAt: FIXED_DATE,
  });
  if (!result.ok) {
    throw new Error(`package build failed: ${result.reason}`);
  }
  return result;
}

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  // A real inflate, not a name check: if the archive were malformed this throws.
  return unzipSync(bytes);
}

function text(files: Record<string, Uint8Array>, name: string): string {
  const entry = files[name];
  if (!entry) {
    throw new Error(`missing entry ${name}`);
  }
  return strFromU8(entry);
}

describe('buildManufacturingPackage — archive contents', () => {
  it('produces a ZIP that really opens and holds all six files', async () => {
    const { package: built } = await build();

    const files = unzip(built.bytes);

    expect(Object.keys(files).sort()).toEqual([...PACKAGE_ENTRIES].sort());
    expect(files['model.glb'].length).toBeGreaterThan(0);
    expect(files['BOM.csv'].length).toBeGreaterThan(0);
    expect(files['cutlist.csv'].length).toBeGreaterThan(0);
    expect(files['drawing.svg'].length).toBeGreaterThan(0);
    expect(files['meta.json'].length).toBeGreaterThan(0);
    expect(files['README.txt'].length).toBeGreaterThan(0);
  });

  it('names the archive after the project', async () => {
    const { package: built } = await build(objectOf(), 'Stol loyihasi');

    expect(built.filename).toBe('stol-loyihasi-package.zip');
    expect(built.mimeType).toBe(PACKAGE_MIME_TYPE);
    expect(built.mimeType).toBe('application/zip');
  });

  it('falls back to a safe name when the project name is blank', () => {
    expect(packageFilename('')).toBe('model-package.zip');
    expect(packageFilename('   ')).toBe('model-package.zip');
    expect(packageFilename('Шкаф 2026')).toBe('2026-package.zip');
  });

  it('reports the byte size of every entry', async () => {
    const { package: built } = await build();
    const files = unzip(built.bytes);

    expect(built.entries.map((entry) => entry.name)).toEqual([...PACKAGE_ENTRIES]);
    for (const entry of built.entries) {
      expect(entry.bytes).toBe(files[entry.name].length);
    }
  });
});

describe('buildManufacturingPackage — file contents', () => {
  it('writes a real GLB container for the piece', async () => {
    const { package: built } = await build();
    const glb = unzip(built.bytes)['model.glb'];

    // glTF binary magic is 'glTF' = 0x46546C67, little-endian.
    const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    expect(view.getUint32(4, true)).toBe(2); // version
    expect(view.getUint32(8, true)).toBe(glb.byteLength); // declared length
  });

  it('writes the BOM from the same parameters the model uses', async () => {
    const table = objectOf('table');
    const expected = buildBom(table.type, table.params);
    if (!expected.ok) {
      throw new Error(expected.reason);
    }

    const csv = text(unzip((await build(table)).package.bytes), 'BOM.csv');
    const lines = csv.trim().split('\n');

    expect(lines[0]).toContain('Nomi');
    expect(lines[0]).toContain('Qalinlik_mm');
    // One header + one row per part group + a total row.
    expect(lines).toHaveLength(expected.bom.rows.length + 2);
    expect(csv).toContain('Ust paneli');
    expect(csv).toContain('1200');
    expect(csv.trim().endsWith('Jami,,,,,,,,,')).toBe(false);
    expect(csv).toContain('Jami');
  });

  it('writes a cut list derived from that same BOM', async () => {
    const table = objectOf('table');
    const bom = buildBom(table.type, table.params);
    if (!bom.ok) {
      throw new Error(bom.reason);
    }
    const expected = buildCutList(bom.bom);

    const csv = text(unzip((await build(table)).package.bytes), 'cutlist.csv');

    expect(csv).toContain('Uzunlik_mm');
    expect(csv).toContain('Kenglik_mm');
    expect(csv).toContain('1200'); // table top length
    expect(csv).toContain('600'); // table top width
    // Legs are not panels, so they must not appear in the cut list.
    expect(csv).not.toContain('Oyoq');
    expect(csv.trim().split('\n')).toHaveLength(expected.rows.length + 2);
  });

  it('writes a non-empty technical drawing', async () => {
    const svg = text(unzip((await build()).package.bytes), 'drawing.svg');

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('Old korinish');
    expect(svg).toContain('Yon korinish');
    expect(svg).toContain('Yuqoridan korinish');
    // Overall dimensions are measured from geometry, in millimetres.
    expect(svg).toContain('1200');
  });

  it('writes valid meta.json describing the export', async () => {
    const table = objectOf('table');
    const meta = JSON.parse(text(unzip((await build(table)).package.bytes), 'meta.json'));

    expect(meta.format).toBe(PACKAGE_META_FORMAT);
    expect(meta.version).toBe(1);
    expect(meta.project).toBe('Stol loyihasi');
    expect(meta.exportedAt).toBe(FIXED_DATE.toISOString());
    expect(meta.furniture).toEqual({ type: 'table', label: 'Stol' });
    expect(meta.units).toEqual({ scene: 'cm', manufacturing: 'mm' });
    expect(meta.parameters.widthCm).toBe(table.params.widthCm);
    expect(meta.parameters.heightCm).toBe(table.params.heightCm);
    expect(meta.parameters.depthCm).toBe(table.params.depthCm);
    expect(meta.totals.parts).toBeGreaterThan(0);
    expect(meta.files).toEqual([...PACKAGE_ENTRIES]);
    expect(meta.limitations.length).toBeGreaterThan(0);
  });

  it('never puts secrets or credentials in meta.json', async () => {
    const meta = text(unzip((await build()).package.bytes), 'meta.json').toLowerCase();

    for (const leak of ['api_key', 'apikey', 'secret', 'token', 'password', 'authorization']) {
      expect(meta).not.toContain(leak);
    }
  });

  it('writes a README that lists the files and states the limits', async () => {
    const readme = text(unzip((await build()).package.bytes), 'README.txt');

    for (const name of PACKAGE_ENTRIES) {
      expect(readme).toContain(name);
    }
    expect(readme).toContain('santimetr');
    expect(readme).toContain('millimetr');
    // Honesty: the pack is not presented as production-ready.
    expect(readme).toContain('ishlab chiqarishga tayyor');
    expect(readme).toContain('sertifikatlangan deb hisoblanmaydi');
    expect(readme).toContain('toleranslar');
  });

  it('describes each supported furniture type', async () => {
    const types = ['chair', 'wardrobe', 'bed'] as const;
    const packed = await Promise.all(
      types.map(async (type) => ({ type, bytes: (await build(objectOf(type), type)).package.bytes })),
    );

    for (const { type, bytes } of packed) {
      const files = unzip(bytes);
      expect(text(files, 'meta.json')).toContain(`"type": "${type}"`);
      expect(files['model.glb'].length).toBeGreaterThan(0);
    }
  });
});

describe('buildManufacturingPackage — GLB scope', () => {
  it('exports only the chosen piece, not the rest of the scene', async () => {
    const table = objectOf('table', 't1');
    const wardrobe = objectOf('wardrobe', 'w1');

    const built = await build(table, 'Stol', [wardrobe]);
    const glb = text(unzip(built.package.bytes), 'model.glb');

    // GLB stores node names as plain UTF-8 in the JSON chunk.
    expect(glb).toContain('table-top');
    expect(glb).not.toContain('wardrobe-side');
    expect(glb).not.toContain('room');
  });

  it('drops assemblies from the exported scene', () => {
    const table = objectOf();
    const scene = sceneWith(table);
    scene.assemblies = [{ id: 'asm-1', kind: 'wall-cabinet', params: {} }];

    const narrowed = sceneForObject(scene, table);

    expect(narrowed.objects).toHaveLength(1);
    expect(narrowed.assemblies).toBeUndefined();
  });
});

describe('buildManufacturingPackage — failure is total', () => {
  it('fails when the object is not in the scene', async () => {
    const object = objectOf();
    const result = await buildManufacturingPackage({
      scene: sceneWith(),
      object,
      projectName: 'X',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('topilmadi');
    }
  });

  it('fails on invalid parameters instead of shipping a broken pack', async () => {
    const object: SceneObject = {
      ...objectOf(),
      params: { ...objectOf().params, widthCm: Number.NaN },
    };

    const result = await buildManufacturingPackage({
      scene: sceneWith(object),
      object,
      projectName: 'X',
    });

    expect(result.ok).toBe(false);
  });

  it('returns no bytes at all when the build fails', async () => {
    const object: SceneObject = {
      ...objectOf(),
      params: { ...objectOf().params, heightCm: 10_000 },
    };

    const result = await buildManufacturingPackage({
      scene: sceneWith(object),
      object,
      projectName: 'X',
    });

    expect(result.ok).toBe(false);
    expect('package' in result).toBe(false);
  });
});

describe('buildManufacturingPackage — isolation between projects', () => {
  it('keeps two consecutive exports separate', async () => {
    const table = objectOf('table', 't1');
    const wardrobe = objectOf('wardrobe', 'w1');

    const first = await build(table, 'Birinchi loyiha');
    const second = await build(wardrobe, 'Ikkinchi loyiha');

    const firstMeta = JSON.parse(text(unzip(first.package.bytes), 'meta.json'));
    const secondMeta = JSON.parse(text(unzip(second.package.bytes), 'meta.json'));

    expect(first.package.filename).toBe('birinchi-loyiha-package.zip');
    expect(second.package.filename).toBe('ikkinchi-loyiha-package.zip');
    expect(firstMeta.project).toBe('Birinchi loyiha');
    expect(secondMeta.project).toBe('Ikkinchi loyiha');
    expect(firstMeta.furniture.type).toBe('table');
    expect(secondMeta.furniture.type).toBe('wardrobe');
    // Part ids carry the type prefix, so the wardrobe pack must not contain a
    // single table part — and vice versa.
    const firstBom = text(unzip(first.package.bytes), 'BOM.csv');
    const secondBom = text(unzip(second.package.bytes), 'BOM.csv');
    expect(firstBom).toContain('table-');
    expect(firstBom).not.toContain('wardrobe-');
    expect(secondBom).toContain('wardrobe-');
    expect(secondBom).not.toContain('table-');
  });

  it('is deterministic for the same input and timestamp', async () => {
    const object = objectOf();
    const a = await build(object);
    const b = await build(object);

    expect(a.package.bytes).toEqual(b.package.bytes);
    expect(a.package.filename).toBe(b.package.filename);
  });
});
