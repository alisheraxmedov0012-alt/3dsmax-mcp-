/**
 * Phase 6.1-A/6.1-B — asset package v2 metadata, integrity, formats and compatibility tests.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { unzipSync, zipSync } from 'fflate';
import { createDefaultSettings } from '../scene/sceneSettings';
import {
  createTableSceneObject,
  SCENE_SCHEMA_VERSION,
  type SceneData,
  type FurnitureSceneObject,
} from '../scene/types';
import { sha256Hex } from '../util/sha256';
import {
  ASSET_PACKAGE_FORMAT,
  buildAssetPackage,
  verifyAssetPackage,
  type AssetPackage,
} from './assetPackage';
import {
  ASSET_PACKAGE_V2_CHECKSUMS,
  ASSET_PACKAGE_V2_LICENSE,
  ASSET_PACKAGE_V2_LIMITS,
  ASSET_PACKAGE_V2_METADATA,
  ASSET_PACKAGE_V2_MODEL,
  ASSET_PACKAGE_V2_MODEL_FORMATS,
  ASSET_PACKAGE_V2_README,
  assetPackageV2Filename,
  buildAssetPackageV2,
  buildAssetPackageV2MultiFormat,
  normalizeAssetPath,
  validateAssetPackageV2Metadata,
  verifyAssetPackageV2,
  type AssetPackageV2,
  type AssetPackageV2Input,
  type AssetPackageV2Limits,
  type AssetPackageV2Metadata,
} from './assetPackageV2';

const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+m9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function pngBytes(): Uint8Array {
  return Uint8Array.from(atob(ONE_PIXEL_PNG_BASE64), (char) => char.charCodeAt(0));
}

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

/** The fixture scene holds one parametric table; `buildAssetPackage` needs it typed as such. */
function makeObject(): FurnitureSceneObject {
  return createTableSceneObject('table-1');
}

function makeScene(): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { widthCm: 400, lengthCm: 500, heightCm: 280 },
    objects: [makeObject()],
    settings: createDefaultSettings(),
  };
}

async function build(
  overrides: Partial<AssetPackageV2Input> = {},
  limits: AssetPackageV2Limits = ASSET_PACKAGE_V2_LIMITS,
): Promise<Awaited<ReturnType<typeof buildAssetPackageV2>>> {
  const scene = makeScene();
  return buildAssetPackageV2(
    {
      scene,
      object: scene.objects[0],
      projectName: 'Eman stol',
      product: { title: 'Eman stol' },
      generatedAt: new Date('2026-01-02T03:04:05Z'),
      ...overrides,
    },
    limits,
  );
}

async function built(
  overrides: Partial<AssetPackageV2Input> = {},
  limits: AssetPackageV2Limits = ASSET_PACKAGE_V2_LIMITS,
): Promise<AssetPackageV2> {
  const outcome = await build(overrides, limits);
  if (!outcome.ok) {
    throw new Error(outcome.reason);
  }
  return outcome.asset;
}

async function builtMulti(
  overrides: Partial<AssetPackageV2Input> = {},
  limits: AssetPackageV2Limits = ASSET_PACKAGE_V2_LIMITS,
): Promise<AssetPackageV2> {
  const scene = makeScene();
  const outcome = await buildAssetPackageV2MultiFormat(
    {
      scene,
      object: scene.objects[0],
      projectName: 'Eman stol',
      product: { title: 'Eman stol' },
      generatedAt: new Date('2026-01-02T03:04:05Z'),
      ...overrides,
    },
    limits,
  );
  if (!outcome.ok) {
    throw new Error(outcome.reason);
  }
  return outcome.asset;
}

function archiveOf(asset: AssetPackageV2): Record<string, Uint8Array> {
  return unzipSync(asset.bytes);
}

function metadataOf(asset: AssetPackageV2): AssetPackageV2Metadata {
  return JSON.parse(new TextDecoder().decode(archiveOf(asset)[ASSET_PACKAGE_V2_METADATA]));
}

function cloneMetadata(metadata: AssetPackageV2Metadata): AssetPackageV2Metadata {
  return JSON.parse(JSON.stringify(metadata)) as AssetPackageV2Metadata;
}

function rezipFiles(files: Record<string, Uint8Array>): Uint8Array<ArrayBuffer> {
  return zipSync(files, { level: 6 }) as Uint8Array<ArrayBuffer>;
}

function rewriteMetadata(asset: AssetPackageV2, metadata: unknown): Uint8Array<ArrayBuffer> {
  const files = archiveOf(asset);
  files[ASSET_PACKAGE_V2_METADATA] = new TextEncoder().encode(JSON.stringify(metadata));
  return rezipFiles(files);
}

function limitsWith(overrides: Partial<AssetPackageV2Limits>): AssetPackageV2Limits {
  return { ...ASSET_PACKAGE_V2_LIMITS, ...overrides };
}

type Bounds = { min: [number, number, number]; max: [number, number, number] };

function emptyBounds(): Bounds {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

function addPoint(bounds: Bounds, values: [number, number, number]): void {
  for (let axis = 0; axis < 3; axis += 1) {
    bounds.min[axis] = Math.min(bounds.min[axis], values[axis]);
    bounds.max[axis] = Math.max(bounds.max[axis], values[axis]);
  }
}

function parseObjBounds(text: string): Bounds {
  const bounds = emptyBounds();
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/u);
    if (parts[0] === 'v' && parts.length >= 4) {
      addPoint(bounds, [Number(parts[1]), Number(parts[2]), Number(parts[3])]);
    }
  }
  return bounds;
}

function parseStlBounds(bytes: Uint8Array): Bounds {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  const bounds = emptyBounds();
  let offset = 84;
  for (let triangle = 0; triangle < count; triangle += 1) {
    offset += 12;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      addPoint(bounds, [
        view.getFloat32(offset, true),
        view.getFloat32(offset + 4, true),
        view.getFloat32(offset + 8, true),
      ]);
      offset += 12;
    }
    offset += 2;
  }
  return bounds;
}

function parseThreeMfBounds(bytes: Uint8Array): Bounds {
  const xml = new TextDecoder().decode(unzipSync(bytes)['3D/3dmodel.model']);
  const bounds = emptyBounds();
  for (const match of xml.matchAll(/<vertex\b([^>]*)\/>/gu)) {
    const attrs: Record<string, string> = {};
    for (const attr of match[1].matchAll(/([A-Za-z_:][\w.:-]*)="([^"]*)"/gu)) {
      attrs[attr[1]] = attr[2];
    }
    addPoint(bounds, [Number(attrs.x), Number(attrs.y), Number(attrs.z)]);
  }
  return bounds;
}

describe('normalizeAssetPath', () => {
  it('accepts the v2 package layout', () => {
    expect(normalizeAssetPath('models/model.glb')).toEqual({
      ok: true,
      path: 'models/model.glb',
    });
    expect(normalizeAssetPath('previews/preview-hero.png')).toEqual({
      ok: true,
      path: 'previews/preview-hero.png',
    });
  });

  it.each([
    '/etc/passwd',
    'C:/model.glb',
    '../model.glb',
    'models/../model.glb',
    'models/./model.glb',
    'models//model.glb',
    'models\\model.glb',
    '',
    'models/model.glb/',
    'models/my model.glb',
  ])('rejects unsafe path %s', (value) => {
    expect(normalizeAssetPath(value).ok).toBe(false);
  });
});

describe('buildAssetPackageV2', () => {
  it('writes a verified v2 package with GLB and manifest', async () => {
    const asset = await built();

    expect(asset.filename).toBe(assetPackageV2Filename('Eman stol'));
    expect(asset.metadata.format).toBe(ASSET_PACKAGE_FORMAT);
    expect(asset.metadata.formatVersion).toBe(2);
    expect(asset.metadata.product.title).toBe('Eman stol');
    expect(asset.metadata.product).not.toHaveProperty('sku');
    expect(asset.metadata.product).not.toHaveProperty('description');
    expect(asset.metadata.product).not.toHaveProperty('author');
    expect(asset.metadata.product).not.toHaveProperty('license');
    expect(asset.metadata.units).toEqual({
      length: 'mm',
      coordinates: 'Y_UP_RIGHT_HANDED',
    });
    expect(asset.metadata.models).toHaveLength(1);
    expect(asset.metadata.models[0]).toMatchObject({
      format: 'glb',
      file: ASSET_PACKAGE_V2_MODEL,
      unit: 'm',
    });
    expect(asset.metadata.models[0].bytes).toBeGreaterThan(0);
    expect(asset.metadata.models[0].sha256).toHaveLength(64);
    expect(asset.metadata.models[0].stats.triangles).toBeGreaterThan(0);
    expect(asset.metadata.models[0].stats.externalUris).toBe(0);
    expect(asset.metadata.textures).toEqual([]);
    expect(asset.metadata.previews).toEqual([]);
    expect(asset.metadata.files.map((file) => file.path)).toEqual([
      ASSET_PACKAGE_V2_README,
      ASSET_PACKAGE_V2_MODEL,
    ]);

    const files = archiveOf(asset);
    expect(Object.keys(files)).toEqual([
      ASSET_PACKAGE_V2_README,
      ASSET_PACKAGE_V2_METADATA,
      ASSET_PACKAGE_V2_MODEL,
      ASSET_PACKAGE_V2_CHECKSUMS,
    ]);
    const readme = new TextDecoder().decode(files[ASSET_PACKAGE_V2_README]);
    expect(readme).toContain('3D aktiv paketi (v2)');
    expect(readme).toContain('Nomi: Eman stol');
    expect(readme).toContain(asset.metadata.models[0].sha256);
    expect(readme).toContain('Boshqa fayllar:');
    expect(readme).toContain('metadata.json');
    expect(readme).toContain('checksums.txt');
    expect(readme).toContain('Format cheklovlari:');
    expect(readme).toContain('Tavsiya:');
    expect(readme).toContain('OBJ/MTL');

    const checksums = new TextDecoder()
      .decode(files[ASSET_PACKAGE_V2_CHECKSUMS])
      .trim()
      .split('\n');
    expect(checksums).toHaveLength(3);
    expect(checksums.some((line) => line.endsWith(`  ${ASSET_PACKAGE_V2_METADATA}`))).toBe(true);

    expect(verifyAssetPackageV2(asset)).toEqual({ ok: true, problems: [] });
  });

  it('puts previews under previews/ with real dimensions and digests', async () => {
    const asset = await built({
      previews: [{ name: 'preview-front.png', bytes: pngBytes() }],
    });
    expect(asset.metadata.previews).toEqual([
      {
        file: 'previews/preview-front.png',
        width: 1,
        height: 1,
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        bytes: pngBytes().byteLength,
      },
    ]);
    expect(asset.metadata.files.map((file) => file.path)).toContain(
      'previews/preview-front.png',
    );
    expect(archiveOf(asset)['previews/preview-front.png']).toEqual(pngBytes());
    expect(verifyAssetPackageV2(asset).ok).toBe(true);
  });

  it('omits LICENSE.txt when no license text is supplied', async () => {
    const noLicense = await built();
    expect(noLicense.metadata.product).not.toHaveProperty('license');
    expect(archiveOf(noLicense)).not.toHaveProperty(ASSET_PACKAGE_V2_LICENSE);

    const namedOnly = await built({
      product: {
        title: 'Eman stol',
        license: { name: 'CC BY 4.0', spdx: 'CC-BY-4.0' },
      },
    });
    expect(namedOnly.metadata.product.license).toEqual({
      name: 'CC BY 4.0',
      spdx: 'CC-BY-4.0',
    });
    expect(namedOnly.metadata.product.license).not.toHaveProperty('textFile');
    expect(archiveOf(namedOnly)).not.toHaveProperty(ASSET_PACKAGE_V2_LICENSE);
  });

  it('writes LICENSE.txt only when text is provided and links it in metadata', async () => {
    const licenseText = 'Custom license text.\nNo redistribution without permission.\n';
    const asset = await built({
      product: {
        title: 'Eman stol',
        sku: 'OAK-001',
        description: 'Solid oak table',
        author: 'Studio',
        license: { name: 'Custom', spdx: 'LicenseRef-Custom', text: licenseText },
      },
    });

    expect(asset.metadata.product).toMatchObject({
      title: 'Eman stol',
      sku: 'OAK-001',
      description: 'Solid oak table',
      author: 'Studio',
      license: {
        name: 'Custom',
        spdx: 'LicenseRef-Custom',
        textFile: ASSET_PACKAGE_V2_LICENSE,
      },
    });
    const files = archiveOf(asset);
    expect(new TextDecoder().decode(files[ASSET_PACKAGE_V2_LICENSE])).toBe(licenseText);
    expect(asset.metadata.files.map((file) => file.path)).toContain(
      ASSET_PACKAGE_V2_LICENSE,
    );
    expect(verifyAssetPackageV2(asset).ok).toBe(true);
  });

  it('rejects invalid product metadata before exporting', async () => {
    await expect(build({ product: { title: '' } })).resolves.toMatchObject({
      ok: false,
      reason: expect.stringMatching(/title/),
    });
    await expect(
      build({ product: { title: 'X', sku: 'bad sku/../x' } }),
    ).resolves.toMatchObject({ ok: false, reason: expect.stringMatching(/sku/) });
    await expect(
      build({ product: { title: 'X', license: { name: 'L', text: '   ' } } }),
    ).resolves.toMatchObject({ ok: false, reason: expect.stringMatching(/license\.text/) });
  });

  it('rejects an unknown or malformed preview', async () => {
    await expect(
      build({ previews: [{ name: 'shot.png', bytes: pngBytes() }] }),
    ).resolves.toMatchObject({ ok: false, reason: expect.stringMatching(/Noma'lum preview/) });
    await expect(
      build({ previews: [{ name: 'preview-front.png', bytes: new Uint8Array([1, 2, 3]) }] }),
    ).resolves.toMatchObject({ ok: false, reason: expect.stringMatching(/haqiqiy PNG/) });
  });
});

describe('validateAssetPackageV2Metadata', () => {
  it('accepts the builder metadata', async () => {
    const metadata = metadataOf(await built());
    expect(validateAssetPackageV2Metadata(metadata)).toEqual({
      ok: true,
      problems: [],
      metadata,
    });
  });

  it('rejects missing required top-level fields', () => {
    const result = validateAssetPackageV2Metadata({});
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/format/);
    expect(result.problems.join(' ')).toMatch(/formatVersion/);
    expect(result.problems.join(' ')).toMatch(/product/);
    expect(result.problems.join(' ')).toMatch(/models/);
  });

  it('rejects a v1-versioned manifest explicitly', async () => {
    const metadata = cloneMetadata(metadataOf(await built()));
    (metadata as { formatVersion: number }).formatVersion = 1;
    const result = validateAssetPackageV2Metadata(metadata);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/formatVersion 2/);
  });

  it('rejects invalid SKU, units and duplicate paths', async () => {
    const metadata = cloneMetadata(metadataOf(await built()));
    metadata.product.sku = 'bad sku';
    metadata.units.length = 'inch' as never;
    metadata.files.push({ ...metadata.files[0] });

    const result = validateAssetPackageV2Metadata(metadata);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/sku/);
    expect(result.problems.join(' ')).toMatch(/units\.length/);
    expect(result.problems.join(' ')).toMatch(/takrorlangan/);
  });

  it('rejects traversal and absolute references', async () => {
    const traversal = cloneMetadata(metadataOf(await built()));
    traversal.models[0].file = 'models/../evil.glb';
    expect(validateAssetPackageV2Metadata(traversal).problems.join(' ')).toMatch(
      /traversal/,
    );

    const absolute = cloneMetadata(metadataOf(await built()));
    absolute.models[0].file = '/models/model.glb';
    expect(validateAssetPackageV2Metadata(absolute).problems.join(' ')).toMatch(
      /Absolyut/,
    );
  });

  it('rejects unsupported MIME types and model/file mismatches', async () => {
    const mime = cloneMetadata(metadataOf(await built()));
    mime.files[0].mimeType = 'image/jpeg';
    expect(validateAssetPackageV2Metadata(mime).problems.join(' ')).toMatch(/mimeType/);

    const size = cloneMetadata(metadataOf(await built()));
    size.models[0].bytes += 1;
    expect(validateAssetPackageV2Metadata(size).problems.join(' ')).toMatch(
      /hajmi files/,
    );

    const hash = cloneMetadata(metadataOf(await built()));
    hash.models[0].sha256 = '0'.repeat(64);
    expect(validateAssetPackageV2Metadata(hash).problems.join(' ')).toMatch(
      /SHA-256.*files/,
    );
  });

  it('requires LICENSE.txt to be declared and referenced', async () => {
    const metadata = cloneMetadata(metadataOf(await built()));
    metadata.product.license = { name: 'Custom', textFile: ASSET_PACKAGE_V2_LICENSE };
    const result = validateAssetPackageV2Metadata(metadata);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/LICENSE\.txt/);
  });

  it('rejects unreferenced payload files', async () => {
    const metadata = cloneMetadata(metadataOf(await built()));
    metadata.files.push({
      path: 'textures/unused.png',
      bytes: 1,
      sha256: '0'.repeat(64),
      mimeType: 'image/png',
    });
    const result = validateAssetPackageV2Metadata(metadata);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/kutilmagan path/);
  });
});

describe('verifyAssetPackageV2 integrity', () => {
  it('rejects a missing referenced model', async () => {
    const asset = await built();
    const files = archiveOf(asset);
    delete files[ASSET_PACKAGE_V2_MODEL];
    const verification = verifyAssetPackageV2({ bytes: rezipFiles(files) });
    expect(verification.ok).toBe(false);
    expect(verification.problems.join(' ')).toMatch(/model\.glb.*yo'q/);
  });

  it('rejects a metadata byte size that disagrees with the archive', async () => {
    const asset = await built();
    const metadata = cloneMetadata(metadataOf(asset));
    metadata.models[0].bytes += 1;
    const file = metadata.files.find((entry) => entry.path === ASSET_PACKAGE_V2_MODEL);
    if (file) file.bytes += 1;
    const verification = verifyAssetPackageV2({ bytes: rewriteMetadata(asset, metadata) });
    expect(verification.ok).toBe(false);
    expect(verification.problems.join(' ')).toMatch(/hajmi metadata/);
  });

  it('rejects a metadata SHA-256 that disagrees with the archive', async () => {
    const asset = await built();
    const metadata = cloneMetadata(metadataOf(asset));
    metadata.models[0].sha256 = 'f'.repeat(64);
    const file = metadata.files.find((entry) => entry.path === ASSET_PACKAGE_V2_MODEL);
    if (file) file.sha256 = 'f'.repeat(64);
    const verification = verifyAssetPackageV2({ bytes: rewriteMetadata(asset, metadata) });
    expect(verification.ok).toBe(false);
    expect(verification.problems.join(' ')).toMatch(/SHA-256 metadata/);
  });

  it('rejects malformed metadata', async () => {
    const asset = await built();
    const files = archiveOf(asset);
    files[ASSET_PACKAGE_V2_METADATA] = new TextEncoder().encode('{');
    const verification = verifyAssetPackageV2({ bytes: rezipFiles(files) });
    expect(verification.ok).toBe(false);
    expect(verification.problems.join(' ')).toMatch(/o‘qilmadi/);
  });

  it('rejects a traversal entry inside the archive', async () => {
    const asset = await built();
    const files = archiveOf(asset);
    files['../evil.txt'] = new TextEncoder().encode('nope');
    const verification = verifyAssetPackageV2({ bytes: rezipFiles(files) });
    expect(verification.ok).toBe(false);
    expect(verification.problems.join(' ')).toMatch(/traversal|path/i);
  });

  it('rejects an archive whose checksums do not cover every file', async () => {
    const asset = await built();
    const files = archiveOf(asset);
    files[ASSET_PACKAGE_V2_CHECKSUMS] = new TextEncoder().encode(
      `${'0'.repeat(64)}  ${ASSET_PACKAGE_V2_README}\n`,
    );
    const verification = verifyAssetPackageV2({ bytes: rezipFiles(files) });
    expect(verification.ok).toBe(false);
    expect(verification.problems.join(' ')).toMatch(/qamramagan|SHA-256/);
  });
});

describe('v1 / v2 compatibility', () => {
  async function buildV1(): Promise<AssetPackage> {
    const object = makeObject();
    const scene = { ...makeScene(), objects: [object] };
    const outcome = await buildAssetPackage({
      scene,
      object,
      projectName: 'Eman stol',
      overallMm: { widthMm: 1200, heightMm: 750, depthMm: 600 },
      generatedAt: new Date('2026-01-02T03:04:05Z'),
    });
    if (!outcome.ok) {
      throw new Error(outcome.reason);
    }
    return outcome.asset;
  }

  it('keeps the v1 package verifiable with the v1 verifier', async () => {
    const asset = await buildV1();
    expect(verifyAssetPackage(asset)).toEqual({ ok: true, problems: [] });
  });

  it('does not let the v1 verifier silently accept a v2 version marker', async () => {
    const asset = await buildV1();
    const files = unzipSync(asset.bytes);
    const metadata = JSON.parse(new TextDecoder().decode(files['metadata.json']));
    metadata.formatVersion = 2;
    files['metadata.json'] = new TextEncoder().encode(JSON.stringify(metadata));
    const tampered: AssetPackage = { ...asset, bytes: rezipFiles(files) };
    const verification = verifyAssetPackage(tampered);
    expect(verification.ok).toBe(false);
    expect(verification.problems.join(' ')).toMatch(/v1 emas/);
  });

  it('does not let the v2 verifier accept a v1 archive', async () => {
    const asset = await buildV1();
    const verification = verifyAssetPackageV2({ bytes: asset.bytes });
    expect(verification.ok).toBe(false);
    expect(verification.problems.join(' ')).toMatch(/formatVersion|models|model\.glb/i);
  });
});

describe('archive resource limits', () => {
  it('accepts a normal package exactly at the allowed boundary', async () => {
    const asset = await built();
    const files = archiveOf(asset);
    const total = Object.values(files).reduce((sum, bytes) => sum + bytes.byteLength, 0);
    const boundary = limitsWith({
      archiveBytes: asset.bytes.byteLength,
      totalDecompressedBytes: total,
      entries: Object.keys(files).length,
      metadataBytes: files[ASSET_PACKAGE_V2_METADATA].byteLength,
      readmeBytes: files[ASSET_PACKAGE_V2_README].byteLength,
      checksumsBytes: files[ASSET_PACKAGE_V2_CHECKSUMS].byteLength,
      modelBytes: files[ASSET_PACKAGE_V2_MODEL].byteLength,
    });
    expect(verifyAssetPackageV2(asset, boundary)).toEqual({ ok: true, problems: [] });
  });

  it('rejects a compressed archive over the byte limit before unzip', async () => {
    const asset = await built();
    const verification = verifyAssetPackageV2(
      asset,
      limitsWith({ archiveBytes: asset.bytes.byteLength - 1 }),
    );
    expect(verification.ok).toBe(false);
    expect(verification.problems.join(' ')).toMatch(/Arxiv hajmi/);
  });

  it('rejects too many ZIP entries', async () => {
    const asset = await built();
    const verification = verifyAssetPackageV2(asset, limitsWith({ entries: 3 }));
    expect(verification.ok).toBe(false);
    expect(verification.problems.join(' ')).toMatch(/entry|maksimum/);
  });

  it('rejects a single decompressed entry over its limit', async () => {
    const asset = await built();
    const verification = verifyAssetPackageV2(
      asset,
      limitsWith({ modelBytes: 10 }),
    );
    expect(verification.ok).toBe(false);
    expect(verification.problems.join(' ')).toMatch(/model\.glb.*hajmi|limit/);
  });

  it('rejects a total decompressed size over the limit', async () => {
    const asset = await built();
    const verification = verifyAssetPackageV2(
      asset,
      limitsWith({ totalDecompressedBytes: 100 }),
    );
    expect(verification.ok).toBe(false);
    expect(verification.problems.join(' ')).toMatch(/ochilgan hajmi/);
  });

  it('rejects oversized metadata and README', async () => {
    const asset = await built();
    const files = archiveOf(asset);

    const metadata = verifyAssetPackageV2(
      asset,
      limitsWith({ metadataBytes: files[ASSET_PACKAGE_V2_METADATA].byteLength - 1 }),
    );
    expect(metadata.ok).toBe(false);
    expect(metadata.problems.join(' ')).toMatch(/metadata\.json.*hajmi/);

    const readme = verifyAssetPackageV2(
      asset,
      limitsWith({ readmeBytes: files[ASSET_PACKAGE_V2_README].byteLength - 1 }),
    );
    expect(readme.ok).toBe(false);
    expect(readme.problems.join(' ')).toMatch(/README\.txt.*hajmi/);
  });

  it('rejects an oversized LICENSE.txt', async () => {
    const asset = await built({
      product: {
        title: 'Eman stol',
        license: { name: 'Custom', text: 'license text' },
      },
    });
    const licenseBytes = archiveOf(asset)[ASSET_PACKAGE_V2_LICENSE].byteLength;
    const verification = verifyAssetPackageV2(
      asset,
      limitsWith({ licenseBytes: licenseBytes - 1 }),
    );
    expect(verification.ok).toBe(false);
    expect(verification.problems.join(' ')).toMatch(/LICENSE\.txt.*hajmi/);
  });

  it('rejects empty and malformed archives', () => {
    const empty = verifyAssetPackageV2({ bytes: new Uint8Array(0) });
    expect(empty.ok).toBe(false);
    expect(empty.problems.join(' ')).toMatch(/bo‘sh/);

    const malformed = verifyAssetPackageV2({ bytes: new Uint8Array([1, 2, 3]) });
    expect(malformed.ok).toBe(false);
    expect(malformed.problems.join(' ')).toMatch(/juda kichik|ochilmadi/);
  });

  it('builder rejects an oversized preview before export', async () => {
    const outcome = await build(
      { previews: [{ name: 'preview-front.png', bytes: pngBytes() }] },
      limitsWith({ previewBytes: 1 }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/limit/);
  });

  it('builder rejects an oversized metadata or model plan', async () => {
    const metadataOutcome = await build({}, limitsWith({ metadataBytes: 10 }));
    expect(metadataOutcome.ok).toBe(false);
    if (!metadataOutcome.ok) {
      expect(metadataOutcome.reason).toMatch(/metadata\.json|limit/);
    }

    const modelOutcome = await build({}, limitsWith({ modelBytes: 10 }));
    expect(modelOutcome.ok).toBe(false);
    if (!modelOutcome.ok) {
      expect(modelOutcome.reason).toMatch(/model\.glb|limit/);
    }
  });

  it('builder rejects an archive that would exceed the compressed byte limit', async () => {
    const outcome = await build({}, limitsWith({ archiveBytes: 10 }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/Arxiv hajmi/);
  });
});

describe('multi-format model export', () => {
  it('writes GLB, OBJ+MTL, STL and 3MF from one selection', async () => {
    const asset = await builtMulti();
    const files = archiveOf(asset);
    const formats = asset.metadata.models.map((model) => model.format);
    expect(formats).toEqual([...ASSET_PACKAGE_V2_MODEL_FORMATS]);

    const byFormat = new Map(asset.metadata.models.map((model) => [model.format, model]));
    expect(byFormat.get('glb')?.file).toBe('models/model.glb');
    expect(byFormat.get('obj')?.file).toBe('models/model.obj');
    expect(byFormat.get('stl')?.file).toBe('models/model.stl');
    expect(byFormat.get('3mf')?.file).toBe('models/model.3mf');
    expect(byFormat.get('glb')?.unit).toBe('m');
    expect(byFormat.get('obj')?.unit).toBe('mm');
    expect(byFormat.get('stl')?.unit).toBe('mm');
    expect(byFormat.get('3mf')?.unit).toBe('mm');

    expect(files['models/model.mtl']).toBeDefined();
    expect(asset.metadata.files.map((entry) => entry.path)).toEqual(
      expect.arrayContaining([
        'models/model.glb',
        'models/model.obj',
        'models/model.mtl',
        'models/model.stl',
        'models/model.3mf',
      ]),
    );

    for (const model of asset.metadata.models) {
      const bytes = files[model.file];
      expect(bytes, model.file).toBeDefined();
      expect(bytes.byteLength).toBe(model.bytes);
      expect(sha256Hex(bytes)).toBe(model.sha256);
    }
    expect(verifyAssetPackageV2(asset)).toEqual({ ok: true, problems: [] });
  });

  it('keeps the OBJ contract: mtllib, object names, MTL declarations', async () => {
    const asset = await builtMulti();
    const files = archiveOf(asset);
    const obj = new TextDecoder().decode(files['models/model.obj']);
    const mtl = new TextDecoder().decode(files['models/model.mtl']);

    expect(obj.startsWith('mtllib model.mtl\n')).toBe(true);
    expect(obj).toMatch(/^o .+/m);
    expect(obj).toMatch(/^usemtl .+/m);
    expect(mtl).toMatch(/^newmtl .+/m);
    expect(mtl).toMatch(/^Kd /m);
    expect(mtl).toMatch(/^Ns /m);

    const objModel = asset.metadata.models.find((model) => model.format === 'obj');
    expect(objModel?.stats.objects).toBeGreaterThan(0);
    expect(objModel?.stats.vertices).toBeGreaterThan(0);
    expect(objModel?.stats.faces).toBeGreaterThan(0);
  });

  it('keeps OBJ, STL and 3MF bounds consistent in millimetres', async () => {
    const asset = await builtMulti();
    const files = archiveOf(asset);
    const parsed: Record<string, Bounds> = {
      obj: parseObjBounds(new TextDecoder().decode(files['models/model.obj'])),
      stl: parseStlBounds(files['models/model.stl']),
      '3mf': parseThreeMfBounds(files['models/model.3mf']),
    };
    for (const model of asset.metadata.models) {
      if (model.format === 'glb') continue;
      const bounds = model.stats.boundsMm;
      expect(bounds, model.format).toBeDefined();
      if (!bounds) continue;
      const independent = parsed[model.format];
      for (let axis = 0; axis < 3; axis += 1) {
        expect(bounds.min[axis]).toBeCloseTo(independent.min[axis], 6);
        expect(bounds.max[axis]).toBeCloseTo(independent.max[axis], 6);
      }
    }

    const first = parsed.obj;
    for (const current of [parsed.stl, parsed['3mf']]) {
      for (let axis = 0; axis < 3; axis += 1) {
        expect(current.min[axis]).toBeCloseTo(first.min[axis], 3);
        expect(current.max[axis]).toBeCloseTo(first.max[axis], 3);
      }
    }
    expect(first.max[0] - first.min[0]).toBeCloseTo(1200, 0);
    expect(first.max[1] - first.min[1]).toBeCloseTo(750, 0);
    expect(first.max[2] - first.min[2]).toBeCloseTo(600, 0);
  });

  it('writes binary STL with a real triangle count and length', async () => {
    const asset = await builtMulti();
    const bytes = archiveOf(asset)['models/model.stl'];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const triangles = view.getUint32(80, true);
    expect(bytes.byteLength).toBe(84 + triangles * 50);
    const stlModel = asset.metadata.models.find((model) => model.format === 'stl');
    expect(stlModel?.stats.triangles).toBe(triangles);
    expect(triangles).toBeGreaterThan(0);
  });

  it('writes a 3MF OPC package with millimetre units', async () => {
    const asset = await builtMulti();
    const bytes = archiveOf(asset)['models/model.3mf'];
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(
      ['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels'].sort(),
    );
    const model = new TextDecoder().decode(files['3D/3dmodel.model']);
    expect(model).toContain('unit="millimeter"');
    const triangles = [...model.matchAll(/<triangle\b/gu)].length;
    const threeMf = asset.metadata.models.find((entry) => entry.format === '3mf');
    expect(threeMf?.stats.triangles).toBe(triangles);
    expect(triangles).toBeGreaterThan(0);
  });
});

describe('OBJ/MTL texture sidecars in the package', () => {
  function sceneWithTextureRefs(): SceneData {
    const scene = makeScene();
    const object = scene.objects[0];
    object.material = {
      ...object.material,
      maps: {
        baseColor: {
          id: 'texture-oak',
          version: 1,
          role: 'baseColor',
          colorSpace: 'srgb',
          wrap: 'repeat',
        },
        normal: {
          id: 'texture-oak-normal',
          version: 1,
          role: 'normal',
          colorSpace: 'linear',
          wrap: 'repeat',
        },
      },
    };
    return scene;
  }

  it('writes referenced PNG sidecars and resolves every MTL map path', async () => {
    const scene = sceneWithTextureRefs();
    const texture = new THREE.Texture();
    const acquire = vi.fn(async () => texture);
    const release = vi.fn();
    const outcome = await buildAssetPackageV2(
      {
        scene,
        object: scene.objects[0],
        projectName: 'Eman stol',
        product: { title: 'Eman stol' },
        generatedAt: new Date('2026-01-02T03:04:05Z'),
      },
      ASSET_PACKAGE_V2_LIMITS,
      {
        formats: ['obj'],
        textureProvider: { acquire, release },
        textureEncoder: async () => pngBytes(),
      },
    );
    if (!outcome.ok) {
      throw new Error(outcome.reason);
    }
    const asset = outcome.asset;
    const files = archiveOf(asset);
    const mtl = new TextDecoder().decode(files['models/model.mtl']);
    expect(asset.metadata.textures).toHaveLength(1);
    expect(asset.metadata.textures[0].role).toBe('baseColor+normal');
    for (const textureEntry of asset.metadata.textures) {
      expect(files[textureEntry.file]).toBeDefined();
      expect(files[textureEntry.file]).toEqual(pngBytes());
      expect(asset.metadata.files.map((entry) => entry.path)).toContain(textureEntry.file);
    }
    const refs = [...mtl.matchAll(/^(?:map_Kd|map_Bump(?:\s+-bm\s+\S+)?)\s+(.+)$/gmu)].map(
      (match) => match[1],
    );
    expect(refs.length).toBe(2);
    for (const ref of refs) {
      expect(ref.startsWith('../textures/')).toBe(true);
      const packagePath = ref.replace(/^\.\.\//u, '');
      expect(files[packagePath], ref).toBeDefined();
    }
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);
    expect(verifyAssetPackageV2(asset)).toEqual({ ok: true, problems: [] });

    const tamperedFiles = archiveOf(asset);
    tamperedFiles['models/model.mtl'] = new TextEncoder().encode(
      mtl.replace(/map_Kd \.\.\/textures\/[^\n]+/u, 'map_Kd ../textures/missing.png'),
    );
    const tampered = verifyAssetPackageV2({ bytes: rezipFiles(tamperedFiles) });
    expect(tampered.ok).toBe(false);
    expect(tampered.problems.join(' ')).toMatch(/MTL .*missing\.png|fayl yo'q/);
  });

  it('fails the package when a required texture cannot be loaded', async () => {
    const scene = sceneWithTextureRefs();
    const outcome = await buildAssetPackageV2(
      {
        scene,
        object: scene.objects[0],
        projectName: 'Eman stol',
        product: { title: 'Eman stol' },
      },
      ASSET_PACKAGE_V2_LIMITS,
      {
        formats: ['obj'],
        textureProvider: {
          acquire: async () => {
            throw new Error('texture missing');
          },
          release: vi.fn(),
        },
        textureEncoder: async () => pngBytes(),
      },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/texture missing/);
  });

  it('aborts the whole package when texture encoding fails', async () => {
    const scene = sceneWithTextureRefs();
    const outcome = await buildAssetPackageV2(
      {
        scene,
        object: scene.objects[0],
        projectName: 'Eman stol',
        product: { title: 'Eman stol' },
      },
      ASSET_PACKAGE_V2_LIMITS,
      {
        formats: ['obj'],
        textureProvider: {
          acquire: async () => new THREE.Texture(),
          release: vi.fn(),
        },
        textureEncoder: async () => {
          throw new Error('encode failed');
        },
      },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/encode failed/);
  });
});

describe('multi-format manifest integrity', () => {
  it('requires the OBJ companion MTL in the file manifest and archive', async () => {
    const asset = await builtMulti();
    const metadata = cloneMetadata(metadataOf(asset));
    metadata.files = metadata.files.filter((entry) => entry.path !== 'models/model.mtl');
    const validation = validateAssetPackageV2Metadata(metadata);
    expect(validation.ok).toBe(false);
    expect(validation.problems.join(' ')).toMatch(/model\.mtl/);

    const files = archiveOf(asset);
    delete files['models/model.mtl'];
    const verification = verifyAssetPackageV2({ bytes: rezipFiles(files) });
    expect(verification.ok).toBe(false);
    expect(verification.problems.join(' ')).toMatch(/model\.mtl/);
  });

  it('rejects a model whose format does not match its file extension', async () => {
    const metadata = cloneMetadata(metadataOf(await builtMulti()));
    const obj = metadata.models.find((model) => model.format === 'obj');
    if (obj) obj.file = 'models/model.glb';
    const result = validateAssetPackageV2Metadata(metadata);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/models\/\*\.obj/);
  });
});

describe('multi-format build options', () => {
  it('honours an explicit format subset without adding GLB implicitly', async () => {
    const scene = makeScene();
    const outcome = await buildAssetPackageV2(
      {
        scene,
        object: scene.objects[0],
        projectName: 'Eman stol',
        product: { title: 'Eman stol' },
        generatedAt: new Date('2026-01-02T03:04:05Z'),
      },
      ASSET_PACKAGE_V2_LIMITS,
      { formats: ['obj', '3mf'] },
    );
    if (!outcome.ok) {
      throw new Error(outcome.reason);
    }
    expect(outcome.asset.metadata.models.map((model) => model.format)).toEqual([
      'obj',
      '3mf',
    ]);
    const files = archiveOf(outcome.asset);
    expect(files['models/model.glb']).toBeUndefined();
    expect(files['models/model.mtl']).toBeDefined();
    expect(verifyAssetPackageV2(outcome.asset).ok).toBe(true);
  });
});

describe('multi-format failure policy', () => {
  it('aborts the package when a required format exporter fails', async () => {
    const scene = makeScene();
    scene.objects[0].scale = { x: Number.POSITIVE_INFINITY, y: 1, z: 1 };
    const outcome = await buildAssetPackageV2(
      {
        scene,
        object: scene.objects[0],
        projectName: 'Eman stol',
        product: { title: 'Eman stol' },
      },
      ASSET_PACKAGE_V2_LIMITS,
      { formats: ['stl'] },
    );
    expect(outcome.ok).toBe(false);
  });
});

describe('archive root folder', () => {
  it('wraps every payload under Product_SKU while keeping manifest paths relative', async () => {
    const scene = makeScene();
    const outcome = await buildAssetPackageV2(
      {
        scene,
        object: scene.objects[0],
        projectName: 'Eman stol',
        product: { title: 'Eman stol', sku: 'OAK-001' },
        generatedAt: new Date('2026-01-02T03:04:05Z'),
      },
      ASSET_PACKAGE_V2_LIMITS,
      { formats: ['glb', 'obj'], archiveRoot: 'OAK-001' },
    );
    if (!outcome.ok) {
      throw new Error(outcome.reason);
    }
    const asset = outcome.asset;
    expect(asset.metadata.archiveRoot).toBe('OAK-001');
    const files = archiveOf(asset);
    expect(Object.keys(files).sort()).toEqual(
      [
        'OAK-001/README.txt',
        'OAK-001/checksums.txt',
        'OAK-001/metadata.json',
        'OAK-001/models/model.glb',
        'OAK-001/models/model.mtl',
        'OAK-001/models/model.obj',
      ].sort(),
    );
    expect(asset.metadata.files.map((entry) => entry.path)).toContain('models/model.obj');
    expect(asset.metadata.files.map((entry) => entry.path)).not.toContain(
      'OAK-001/models/model.obj',
    );
    expect(verifyAssetPackageV2(asset)).toEqual({ ok: true, problems: [] });
  });

  it('rejects an empty archive root', async () => {
    const scene = makeScene();
    const outcome = await buildAssetPackageV2(
      {
        scene,
        object: scene.objects[0],
        projectName: 'Eman stol',
        product: { title: 'Eman stol' },
      },
      ASSET_PACKAGE_V2_LIMITS,
      { archiveRoot: '   ' },
    );
    expect(outcome.ok).toBe(false);
  });
});
