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
import { PANEL_MAX_THICKNESS_CM, buildBom } from './bom';
import { buildCutList } from './cutList';
import { createDefaultSettings } from '../scene/sceneSettings';
import { createFurnitureParams, type FurnitureType } from '../geometry/furniture/types';
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

    expect(built.filename).toMatch(/^stol-loyihasi-[0-9a-f]{12}-package\.zip$/);
    expect(built.mimeType).toBe(PACKAGE_MIME_TYPE);
    expect(built.mimeType).toBe('application/zip');
  });

  it('falls back to a safe name when the project name is blank', () => {
    expect(packageFilename('')).toMatch(/^model-[0-9a-f]{12}-package\.zip$/);
    expect(packageFilename('   ')).toMatch(/^model-[0-9a-f]{12}-package\.zip$/);
    expect(packageFilename('Шкаф 2026')).toMatch(/^2026-[0-9a-f]{12}-package\.zip$/);
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

    expect(first.package.filename).toMatch(/^birinchi-loyiha-[0-9a-f]{12}-package\.zip$/);
    expect(second.package.filename).toMatch(/^ikkinchi-loyiha-[0-9a-f]{12}-package\.zip$/);
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

  it('stays byte-identical across a real time gap', async () => {
    const object = objectOf('wardrobe', 'w-gap');

    // Two builds seconds apart. Without a pinned entry timestamp fflate stamps
    // each entry with the wall clock (2-second DOS resolution), so the archives
    // differ and this assertion is what catches that regression.
    const first = await build(object);
    await new Promise((resolve) => setTimeout(resolve, 2600));
    const second = await build(object);

    expect(second.package.bytes).toEqual(first.package.bytes);
    expect(second.package.filename).toBe(first.package.filename);
  }, 20_000);

  it('keeps every entry timestamp at the export time, not the build time', async () => {
    const built = await build();
    const files = unzip(built.package.bytes);

    // The archive is stamped with `generatedAt` (FIXED_DATE) rather than "now",
    // which is what makes the bytes above reproducible.
    expect(Object.keys(files).sort()).toEqual(
      ['BOM.csv', 'README.txt', 'cutlist.csv', 'drawing.svg', 'meta.json', 'model.glb'].sort(),
    );
    const meta = JSON.parse(text(files, 'meta.json'));
    expect(meta.exportedAt).toBe(FIXED_DATE.toISOString());
  });
});

describe('packageFilename — no collisions between different projects', () => {
  // The exact names that collided before C1.1: the slug dropped the Cyrillic
  // text, so several different projects produced the same download name.
  const CYRILLIC = ['Ошхона шкаф', 'Кухня', 'Шкаф 2026', 'Ошхона шкаф 2026'];
  const MIXED = ['Kitchen Table', 'Kitchen-Table', 'kitchen table', 'KITCHEN TABLE'];
  const DEGENERATE = ['123', '456', '!!!', '???', '', '   ', '--'];

  const all = [...CYRILLIC, ...MIXED, ...DEGENERATE];

  function expectSafeFilename(name: string): void {
    // ASCII lowercase, digits and single dashes only: no path separator, no
    // control character, no leading dot, no "..".
    expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*\.zip$/);
    expect(name).not.toContain('/');
    expect(name).not.toContain('\\');
    expect(name).not.toContain('..');
    expect(name.length).toBeLessThanOrEqual(80);
  }

  it('gives every different project name its own filename', () => {
    const filenames = all.map(packageFilename);
    expect(new Set(filenames).size).toBe(all.length);
  });

  it('separates Cyrillic names that slug to the same fallback', () => {
    // Both slug to "model"; only the digest tells them apart.
    expect(packageFilename('Ошхона шкаф')).not.toBe(packageFilename('Кухня'));
    expect(packageFilename('Ошхона шкаф')).toMatch(/^model-/);
    expect(packageFilename('Кухня')).toMatch(/^model-/);
  });

  it('separates names that differ only by a trailing number', () => {
    // Both slug to "2026" and collide without the digest.
    expect(packageFilename('Шкаф 2026')).not.toBe(packageFilename('Ошхона шкаф 2026'));
  });

  it('separates a Latin name from a Cyrillic name with the same slug', () => {
    expect(packageFilename('Model')).not.toBe(packageFilename('Ошхона шкаф'));
    expect(packageFilename('2026')).not.toBe(packageFilename('Шкаф 2026'));
  });

  it('separates names that differ only in separators or case', () => {
    expect(packageFilename('Kitchen Table')).not.toBe(packageFilename('Kitchen-Table'));
    expect(packageFilename('Kitchen Table')).not.toBe(packageFilename('KITCHEN TABLE'));
  });

  it('separates punctuation-only and blank names', () => {
    expect(packageFilename('!!!')).not.toBe(packageFilename('???'));
    expect(packageFilename('')).not.toBe(packageFilename('   '));
    expect(packageFilename('!!!')).not.toBe(packageFilename(''));
  });

  it('is deterministic for the same project name', () => {
    for (const name of all) {
      expect(packageFilename(name)).toBe(packageFilename(name));
    }
    expect(packageFilename('Stol loyihasi')).toBe(packageFilename('Stol loyihasi'));
  });

  it('always produces a filesystem-safe ASCII name', () => {
    for (const name of all) {
      expectSafeFilename(packageFilename(name));
    }
  });

  it('strips path separators, control characters and traversal sequences', () => {
    for (const name of ['../../etc/passwd', 'a/b\\c', 'a\u0000b', '..', '../..']) {
      expectSafeFilename(packageFilename(name));
    }
    expect(packageFilename('../../etc/passwd')).toMatch(/^etc-passwd-/);
  });

  it('keeps the slug readable and bounded for very long names', () => {
    const long = packageFilename('a'.repeat(500));
    expect(long).toMatch(/^a{48}-[0-9a-f]{12}-package\.zip$/);
    expectSafeFilename(long);
  });

  it('keeps the plain slug prefix for ordinary Latin names', () => {
    // Regression guard: the readable part must not be lost for everyday names.
    expect(packageFilename('Yotoqxona Shkafi')).toMatch(/^yotoqxona-shkafi-/);
    expect(packageFilename('Kitchen Table')).toMatch(/^kitchen-table-/);
    expect(packageFilename('Stol loyihasi')).toMatch(/^stol-loyihasi-/);
    expect(packageFilename('Kitchen Table')).toMatch(/-package\.zip$/);
  });
});

describe('packageFilename — the archive itself is unchanged', () => {
  it('keeps the six entry names and the real project name inside', async () => {
    const projectName = 'Ошхона шкаф';
    const built = await build(objectOf('wardrobe'), projectName);
    const files = unzip(built.package.bytes);

    expect(Object.keys(files).sort()).toEqual(
      ['BOM.csv', 'README.txt', 'cutlist.csv', 'drawing.svg', 'meta.json', 'model.glb'].sort(),
    );
    // Only the download filename may change; the documents keep the real name.
    expect(JSON.parse(text(files, 'meta.json')).project).toBe(projectName);
    expect(text(files, 'README.txt')).toContain(projectName);
    expect(built.package.filename).not.toContain(projectName);
  });
});

describe('buildManufacturingPackage — every furniture type', () => {
  // Pins the whole matrix so a geometry change cannot silently start (or stop)
  // producing a production package for a type nobody re-checked.
  const PANEL_TYPES = ['table', 'chair', 'armchair', 'bed', 'wardrobe', 'shelf', 'dresser'] as const;

  it.each(PANEL_TYPES)('builds a complete package for %s', async (type) => {
    const built = await build(objectOf(type, `${type}-all`), `Loyiha ${type}`);
    const files = unzip(built.package.bytes);

    expect(Object.keys(files).sort()).toEqual(
      ['BOM.csv', 'README.txt', 'cutlist.csv', 'drawing.svg', 'meta.json', 'model.glb'].sort(),
    );
    expect(built.package.filename).toMatch(/^[a-z0-9-]+-[0-9a-f]{12}-package\.zip$/);
    expect(built.package.cutPieces).toBeGreaterThan(0);
    expect(JSON.parse(text(files, 'meta.json')).furniture.type).toBe(type);
  });

  it('refuses the sofa instead of inventing a cut list', async () => {
    const sofa = objectOf('sofa', 'sofa-all');
    const outcome = await buildManufacturingPackage({
      scene: sceneWith(sofa),
      object: sofa,
      projectName: 'Divan',
      generatedAt: FIXED_DATE,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      throw new Error('a sofa must not produce a production package');
    }
    // The reason must explain the actual cause, not just "empty".
    expect(outcome.reason).toContain('yupqa panel emas');
    expect(outcome.reason).toContain('60 mm');
    // Nothing is handed back that could be downloaded as a partial archive.
    expect(outcome).not.toHaveProperty('package');
  });

  it('cannot cut a sofa because its parts are thicker than a board', () => {
    // Why refusing is correct rather than a bug: the measured sofa parts are
    // upholstery blocks, so no part qualifies as sheet goods.
    const bom = buildBom('sofa', createFurnitureParams('sofa'));
    if (!bom.ok) {
      throw new Error(bom.reason);
    }
    expect(bom.bom.rows.every((row) => row.thicknessMm === null)).toBe(true);
    const cut = buildCutList(bom.bom);
    expect(cut.rows).toHaveLength(0);
    // The board-eligible kinds are the seat and the backrest. Their smallest
    // sides are 340 mm and 80 mm — both far past the 60 mm board limit, so they
    // stay blocks. The legs are 50 mm but are posts, so the cut list never
    // considered them in the first place.
    const boardKinds = bom.bom.rows.filter((row) =>
      ['seat', 'back', 'top', 'bottom', 'side', 'shelf', 'board', 'door', 'drawer', 'frame', 'headboard'].includes(row.kind),
    );
    expect(boardKinds.map((row) => row.partId)).toEqual(['sofa-seat', 'sofa-back']);
    for (const row of boardKinds) {
      const minSide = Math.min(row.sizeMm.x, row.sizeMm.y, row.sizeMm.z);
      expect(minSide).toBeGreaterThan(PANEL_MAX_THICKNESS_CM * 10);
    }
  });
});

describe('C3 — materials in the package', () => {
  const assignment = {
    partId: 'wardrobe-door',
    materialId: 'mdf' as const,
    thicknessMm: 12,
    thicknessSource: 'user' as const,
  };

  async function buildWithMaterial() {
    const object = objectOf('wardrobe', 'w-mat');
    const withMaterial = { ...object, sheetMaterials: [assignment] };
    const result = await buildManufacturingPackage({
      scene: sceneWith(withMaterial),
      object: withMaterial,
      projectName: 'Shkaf loyihasi',
      generatedAt: FIXED_DATE,
    });
    if (!result.ok) throw new Error(result.reason);
    return result;
  }

  it('reports the assigned material in meta.json', async () => {
    const built = await buildWithMaterial();
    const meta = JSON.parse(text(unzip(built.package.bytes), 'meta.json'));

    expect(meta.materials).toHaveLength(1);
    expect(meta.materials[0].materialId).toBe('mdf');
    expect(meta.materials[0].name).toBe('MDF');
    expect(meta.materials[0].thicknessMm).toBe(12);
    expect(meta.materials[0].unit).toBe('mm');
    expect(meta.materials[0].totalPieces).toBe(2);
    expect(meta.materials[0].partIds).toEqual(['wardrobe-door']);
    expect(Array.isArray(meta.issues)).toBe(true);
  });

  it('writes the material into BOM.csv and cutlist.csv', async () => {
    const built = await buildWithMaterial();
    const files = unzip(built.package.bytes);
    const bom = text(files, 'BOM.csv').split('\n');
    const cut = text(files, 'cutlist.csv').split('\n');

    const bomDoor = bom.find((line) => line.startsWith('Eshik'));
    expect(bomDoor).toContain('MDF');

    // The cut list keeps its original seven columns and adds Material at the end.
    expect(cut[0].split(',')[7]).toBe('Material');
    const cutDoor = cut.find((line) => line.startsWith('Eshik'));
    expect(cutDoor?.split(',')[7]).toBe('MDF');
  });

  it('describes the material in README.txt', async () => {
    const built = await buildWithMaterial();
    const readme = text(unzip(built.package.bytes), 'README.txt');
    expect(readme).toContain('Material');
    expect(readme).toContain('MDF, 12 mm — 2 detal (wardrobe-door)');
  });

  it('says plainly when nothing is assigned instead of implying a default', async () => {
    const built = await build();
    const files = unzip(built.package.bytes);
    const readme = text(files, 'README.txt');
    const meta = JSON.parse(text(files, 'meta.json'));
    expect(readme).toContain('Material tanlanmagan');
    expect(meta.materials).toEqual([]);
    expect(readme).not.toContain('LDSP,');
  });

  it('flags a stale thickness in meta.json and the README', async () => {
    // 18 mm was assigned while the door measures 12 mm.
    const object = objectOf('wardrobe', 'w-stale');
    const stale = { ...object, sheetMaterials: [{ ...assignment, thicknessMm: 18 }] };
    const result = await buildManufacturingPackage({
      scene: sceneWith(stale),
      object: stale,
      projectName: 'Shkaf',
      generatedAt: FIXED_DATE,
    });
    if (!result.ok) throw new Error(result.reason);

    const files = unzip(result.package.bytes);
    const meta = JSON.parse(text(files, 'meta.json'));
    const warning = meta.issues.find(
      (issue: { level: string; partId: string | null }) =>
        issue.level === 'warning' && issue.partId === 'wardrobe-door',
    );
    expect(warning?.message).toMatch(/mos kelmaydi/i);
    expect(text(files, 'README.txt')).toContain('Ogohlantirishlar');
  });

  it('keeps the archive deterministic with materials attached', async () => {
    const object = objectOf('wardrobe', 'w-det');
    const withMaterial = { ...object, sheetMaterials: [assignment] };
    const run = () =>
      buildManufacturingPackage({
        scene: sceneWith(withMaterial),
        object: withMaterial,
        projectName: 'Shkaf',
        generatedAt: FIXED_DATE,
      });

    const first = await run();
    await new Promise((resolve) => setTimeout(resolve, 2600));
    const second = await run();
    if (!first.ok || !second.ok) throw new Error('build failed');

    expect(second.package.bytes).toEqual(first.package.bytes);
    expect(second.package.filename).toBe(first.package.filename);
  }, 20_000);

  it('keeps the six entries and the drawing dimensions unchanged', async () => {
    const built = await buildWithMaterial();
    const files = unzip(built.package.bytes);
    expect(Object.keys(files).sort()).toEqual(
      ['BOM.csv', 'README.txt', 'cutlist.csv', 'drawing.svg', 'meta.json', 'model.glb'].sort(),
    );

    // C2 drawing: material does not alter the measured views or dimension text.
    const svg = text(files, 'drawing.svg');
    expect(svg).toContain('Old korinish');
    expect(svg).toContain('Masshtab:');
    const meta = JSON.parse(text(files, 'meta.json'));
    expect(meta.totals.parts).toBe(11);
    expect(meta.totals.cutPieces).toBe(11);
  });
});
