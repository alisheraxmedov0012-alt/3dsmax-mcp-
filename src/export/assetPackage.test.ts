/**
 * A4 — GLB inspection and the marketplace asset package.
 *
 * The package claims are checked against the archive it produced: entry list,
 * byte lengths, SHA-256 digests and the GLB facts in `metadata.json`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import { createDefaultSettings } from '../scene/sceneSettings';
import { createTableSceneObject, SCENE_SCHEMA_VERSION, type SceneData } from '../scene/types';
import { exportSceneToGlb } from './sceneExport';
import { summarizeGlb } from './glbSummary';
import { isPng, pngSize } from './pngSize';
import {
  ASSET_PACKAGE_ENTRIES,
  assetPackageFilename,
  buildAssetPackage,
  verifyAssetPackage,
  type AssetPackage,
} from './assetPackage';

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

function makeScene(): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { widthCm: 400, lengthCm: 500, heightCm: 280 },
    objects: [createTableSceneObject('table-1')],
    settings: createDefaultSettings(),
  };
}

const OVERALL_MM = { widthMm: 1200, heightMm: 750, depthMm: 600 };

/** Assemble a minimal GLB so chunk/image parsing is tested without a canvas. */
function makeGlb(gltf: unknown, bin: Uint8Array | null): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = (4 - (json.length % 4)) % 4;
  const jsonChunk = new Uint8Array(json.length + jsonPad).fill(0x20);
  jsonChunk.set(json);
  const binPad = bin ? (4 - (bin.length % 4)) % 4 : 0;
  const binChunk = bin ? new Uint8Array(bin.length + binPad) : null;
  if (bin && binChunk) binChunk.set(bin);

  const total = 12 + 8 + jsonChunk.length + (binChunk ? 8 + binChunk.length : 0);
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonChunk.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buffer, 20, jsonChunk.length).set(jsonChunk);
  if (binChunk) {
    const offset = 20 + jsonChunk.length;
    view.setUint32(offset, binChunk.length, true);
    view.setUint32(offset + 4, 0x004e4942, true);
    new Uint8Array(buffer, offset + 8, binChunk.length).set(binChunk);
  }
  return buffer;
}

describe('pngSize', () => {
  it('reads the IHDR size of a real PNG', () => {
    const bytes = pngBytes();
    expect(isPng(bytes)).toBe(true);
    expect(pngSize(bytes)).toEqual({ widthPx: 1, heightPx: 1 });
  });

  it('rejects a non-PNG or a truncated header', () => {
    expect(isPng(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(pngSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
});

describe('summarizeGlb', () => {
  it('reads geometry, materials and embedded image sizes', () => {
    const png = pngBytes();
    const glb = makeGlb(
      {
        asset: { version: '2.0', generator: 'test-exporter' },
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
        accessors: [{ count: 3 }, { count: 3 }],
        materials: [{ name: 'oak' }, {}],
        textures: [{}],
        images: [{ bufferView: 0, mimeType: 'image/png' }],
        bufferViews: [{ byteOffset: 0, byteLength: png.length }],
      },
      png,
    );

    const result = summarizeGlb(glb);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toMatchObject({
      version: 2,
      meshes: 1,
      primitives: 1,
      triangles: 1,
      materials: ['oak', 'material-1'],
      textures: 1,
      externalUris: 0,
      generator: 'test-exporter',
    });
    expect(result.summary.images[0].size).toEqual({ widthPx: 1, heightPx: 1 });
  });

  it('counts external URI references honestly', () => {
    const glb = makeGlb(
      {
        asset: { version: '2.0' },
        buffers: [{ uri: 'model.bin' }],
        images: [{ uri: 'texture.png' }],
      },
      null,
    );
    const result = summarizeGlb(glb);
    expect(result.ok && result.summary.externalUris).toBe(2);
  });

  it('summarises a real exported scene', async () => {
    const glb = await exportSceneToGlb(makeScene(), { includeRoom: false });
    const result = summarizeGlb(glb);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.bytes).toBe(glb.byteLength);
    expect(result.summary.meshes).toBeGreaterThan(0);
    expect(result.summary.triangles).toBeGreaterThan(0);
    expect(result.summary.materials).toContain('table-material');
    expect(result.summary.externalUris).toBe(0);
  });

  it('fails a non-GLB buffer with a reason', () => {
    const result = summarizeGlb(new TextEncoder().encode('this is definitely not a glb file').buffer);
    expect(result).toEqual({ ok: false, reason: "GLB sarlavhasi noto'g'ri (magic raqami mos emas)." });
  });

  it('fails when the declared length does not match the file', async () => {
    const glb = await exportSceneToGlb(makeScene(), { includeRoom: false });
    const view = new DataView(glb);
    view.setUint32(8, glb.byteLength + 4, true);
    const result = summarizeGlb(glb);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/uzunligi/);
  });
});

describe('buildAssetPackage', () => {
  async function build(overrides: Partial<Parameters<typeof buildAssetPackage>[0]> = {}) {
    return buildAssetPackage({
      scene: makeScene(),
      object: makeScene().objects[0],
      projectName: 'Eman stol',
      overallMm: OVERALL_MM,
      generatedAt: new Date('2026-01-02T03:04:05Z'),
      ...overrides,
    });
  }

  it('writes a verified archive with model, metadata and checksums', async () => {
    const outcome = await build();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { asset } = outcome;

    expect(asset.expectedEntries).toEqual([...ASSET_PACKAGE_ENTRIES]);
    expect(asset.entries.map((entry) => entry.name)).toEqual([...ASSET_PACKAGE_ENTRIES]);
    expect(asset.filename).toBe(assetPackageFilename('Eman stol'));

    expect(asset.metadata.asset.title).toBe('Eman stol');
    expect(asset.metadata.asset.dimensionsMm).toEqual(OVERALL_MM);
    expect(asset.metadata.asset.units).toEqual({ scene: 'cm', metadata: 'mm' });
    expect(asset.metadata.asset.model.triangles).toBeGreaterThan(0);
    expect(asset.metadata.asset.model.triangles).toBe(asset.glb.triangles);
    expect(asset.metadata.asset.model.materials).toContain('table-material');
    expect(asset.metadata.asset.model.sha256).toHaveLength(64);
    expect(asset.metadata.asset.uv).toMatchObject({ layout: 'physical-box', tileCm: 50 });
    expect(asset.metadata.listing.formats).toEqual(
      expect.arrayContaining(['glb', 'json', 'txt']),
    );

    const files = unzipSync(asset.bytes);
    const readme = new TextDecoder().decode(files['README.txt']);
    expect(readme).toContain('3D aktiv paketi');
    expect(readme).toContain("Litsenziya: ko'rsatilmagan");
    expect(readme).toContain(asset.metadata.asset.model.sha256);
    expect(readme).toContain("Preview rasmlari bu paketga qo'shilmagan.");

    const checksums = new TextDecoder().decode(files['checksums.txt']).trim().split('\n');
    expect(checksums).toHaveLength(3); // README, model, metadata
    expect(checksums.some((line) => line.endsWith('  model.glb'))).toBe(true);

    expect(verifyAssetPackage(asset)).toEqual({ ok: true, problems: [] });
  });

  it('includes preview shots, their real size and digests', async () => {
    const outcome = await build({
      previews: [{ name: 'preview-front.png', bytes: pngBytes() }],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { asset } = outcome;

    expect(asset.expectedEntries).toEqual([
      'README.txt',
      'metadata.json',
      'model.glb',
      'preview-front.png',
      'checksums.txt',
    ]);
    expect(asset.metadata.previews).toHaveLength(1);
    expect(asset.metadata.previews[0]).toMatchObject({
      name: 'preview-front.png',
      size: { widthPx: 1, heightPx: 1 },
    });
    expect(asset.metadata.listing.formats).toContain('png');

    const files = unzipSync(asset.bytes);
    expect(files['preview-front.png']).toEqual(pngBytes());
    expect(verifyAssetPackage(asset).ok).toBe(true);
  });

  it('keeps seller-supplied listing fields and ignores none of them', async () => {
    const outcome = await build({
      listing: {
        sku: 'STL-001',
        version: '1.0.0',
        author: 'Studio',
        license: 'CC-BY-4.0',
        tags: ['oak', '  ', 'oak', 'table'],
      },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { listing } = outcome.asset.metadata;
    expect(listing).toMatchObject({
      sku: 'STL-001',
      version: '1.0.0',
      author: 'Studio',
      license: 'CC-BY-4.0',
      tags: ['oak', 'table'],
    });
    const readme = new TextDecoder().decode(unzipSync(outcome.asset.bytes)['README.txt']);
    expect(readme).toContain('Litsenziya: CC-BY-4.0');
  });

  it('refuses an unknown preview filename', async () => {
    const outcome = await build({ previews: [{ name: 'shot.png', bytes: pngBytes() }] });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/Noma'lum preview fayli/);
  });

  it('refuses a duplicate preview', async () => {
    const preview = { name: 'preview-front.png', bytes: pngBytes() };
    const outcome = await build({ previews: [preview, preview] });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/takrorlangan/);
  });

  it('refuses a buffer that is not a real PNG', async () => {
    const outcome = await build({
      previews: [{ name: 'preview-front.png', bytes: new Uint8Array([1, 2, 3, 4]) }],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/haqiqiy PNG emas/);
  });

  it('refuses unmeasured dimensions instead of writing 0 mm', async () => {
    const outcome = await build({ overallMm: { widthMm: 0, heightMm: 750, depthMm: 600 } });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/o'lchanmagan/);
  });

  it('detects a tampered archive', async () => {
    const outcome = await build();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const files = unzipSync(outcome.asset.bytes);
    const tampered: AssetPackage = {
      ...outcome.asset,
      bytes: zipSync(
        { ...files, 'checksums.txt': new TextEncoder().encode('deadbeef  model.glb\n') },
        { level: 6 },
      ) as Uint8Array<ArrayBuffer>,
    };
    const verification = verifyAssetPackage(tampered);
    expect(verification.ok).toBe(false);
    expect(verification.problems.join(' ')).toMatch(/SHA-256 mos emas/);
  });
});
