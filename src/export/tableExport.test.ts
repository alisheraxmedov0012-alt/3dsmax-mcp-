import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { buildTable } from '../geometry/buildTable';
import type { TableParams } from '../geometry/tableParams';
import { buildExportScene, exportTableToGlb, TABLE_EXPORT_FILENAME } from './tableExport';

/**
 * Node has no FileReader, which GLTFExporter uses to assemble the binary (.glb)
 * payload. This shim reads real Blob contents so the production export path is
 * exercised end-to-end rather than mocked. The browser download step itself is
 * still verified manually (see README).
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

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_TYPE_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_TYPE_BIN = 0x004e4942; // 'BIN\0'

interface GlbChunk {
  type: number;
  bytes: Uint8Array;
}

interface ParsedGlb {
  version: number;
  totalLength: number;
  chunks: GlbChunk[];
  json: {
    meshes?: Array<{ primitives: Array<{ attributes: Record<string, number> }> }>;
    materials?: Array<{ pbrMetallicRoughness?: { baseColorFactor?: number[] } }>;
    buffers?: Array<{ byteLength: number }>;
    accessors?: unknown[];
  };
}

function parseGlb(buffer: ArrayBuffer): ParsedGlb {
  const view = new DataView(buffer);
  expect(view.getUint32(0, true)).toBe(GLB_MAGIC);

  const version = view.getUint32(4, true);
  const totalLength = view.getUint32(8, true);

  const chunks: GlbChunk[] = [];
  let offset = 12;
  while (offset + 8 <= totalLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    chunks.push({ type, bytes: new Uint8Array(buffer, offset + 8, length) });
    offset += 8 + length;
  }

  const jsonChunk = chunks.find((chunk) => chunk.type === CHUNK_TYPE_JSON);
  if (!jsonChunk) {
    throw new Error('GLB JSON chunk topilmadi.');
  }

  return {
    version,
    totalLength,
    chunks,
    json: JSON.parse(new TextDecoder().decode(jsonChunk.bytes)),
  };
}

function measure(group: THREE.Object3D): THREE.Vector3 {
  group.updateMatrixWorld(true);
  const size = new THREE.Vector3();
  new THREE.Box3().setFromObject(group).getSize(size);
  return size;
}

function binChunk(buffer: ArrayBuffer): Uint8Array {
  const bin = parseGlb(buffer).chunks.find((chunk) => chunk.type === CHUNK_TYPE_BIN);
  if (!bin) {
    throw new Error('GLB BIN chunk topilmadi.');
  }
  return bin.bytes;
}

function bytesDiffer(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return true;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return true;
    }
  }
  return false;
}

function baseColorFactor(buffer: ArrayBuffer): number[] | undefined {
  return parseGlb(buffer).json.materials?.[0]?.pbrMetallicRoughness?.baseColorFactor;
}

const PARAMS: TableParams = {
  widthCm: 150,
  heightCm: 90,
  depthCm: 65,
  color: '#ff0000',
};

beforeAll(() => {
  vi.stubGlobal('FileReader', TestFileReader);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('buildExportScene', () => {
  it('contains one table top and four legs', () => {
    const { scene, dispose } = buildExportScene(PARAMS);
    const group = scene.getObjectByName('table');
    expect(group).toBeDefined();

    const names = (group as THREE.Group).children.map((child) => child.name);
    expect(names).toContain('table-top');
    expect(names.filter((name) => name.startsWith('table-leg-'))).toHaveLength(4);

    dispose();
  });

  it('uses the provided parameters, not the defaults', () => {
    const { scene, dispose } = buildExportScene(PARAMS);
    const group = scene.getObjectByName('table') as THREE.Group;

    const size = measure(group);
    expect(size.x).toBeCloseTo(150, 5);
    expect(size.y).toBeCloseTo(90, 5);
    expect(size.z).toBeCloseTo(65, 5);

    dispose();
  });

  it('does not mutate the parameters or touch an existing model', () => {
    const params: TableParams = { ...PARAMS };
    const reference = buildTable(params);
    const sizeBefore = measure(reference.group);

    const exported = buildExportScene(params);
    const exportedSize = measure(exported.scene);

    // Parameters are unchanged.
    expect(params).toEqual(PARAMS);
    // The independent (visible-model) geometry is untouched.
    const sizeAfter = measure(reference.group);
    expect(sizeAfter.x).toBeCloseTo(sizeBefore.x, 5);
    expect(sizeAfter.y).toBeCloseTo(sizeBefore.y, 5);
    expect(sizeAfter.z).toBeCloseTo(sizeBefore.z, 5);
    // And the exported scene matches the requested dimensions.
    expect(exportedSize.x).toBeCloseTo(sizeBefore.x, 5);

    exported.dispose();
    reference.dispose();
  });
});

describe('exportTableToGlb', () => {
  it('produces a valid binary glTF container', async () => {
    const buffer = await exportTableToGlb(PARAMS);
    const parsed = parseGlb(buffer);

    expect(buffer.byteLength).toBeGreaterThan(0);
    expect(parsed.version).toBe(2);
    expect(parsed.totalLength).toBe(buffer.byteLength);
    expect(parsed.chunks.some((chunk) => chunk.type === CHUNK_TYPE_BIN)).toBe(true);
  });

  it('includes the table geometry and a single material', async () => {
    const buffer = await exportTableToGlb(PARAMS);
    const { json } = parseGlb(buffer);

    expect(json.meshes && json.meshes.length).toBeGreaterThan(0);
    json.meshes?.forEach((mesh) => {
      mesh.primitives.forEach((primitive) => {
        expect(primitive.attributes.POSITION).toBeTypeOf('number');
      });
    });

    expect(json.materials).toHaveLength(1);
    expect(json.buffers?.[0]?.byteLength ?? 0).toBeGreaterThan(0);

    const color = baseColorFactor(buffer);
    expect(color).toBeDefined();
    expect(color).toHaveLength(4);
    // Pure red (0 and 1 channels are invariant across colour spaces).
    expect(color?.[0]).toBeCloseTo(1, 5);
    expect(color?.[1]).toBeCloseTo(0, 5);
    expect(color?.[2]).toBeCloseTo(0, 5);
    expect(color?.[3]).toBeCloseTo(1, 5);
  });

  it('encodes the selected colour into the material', async () => {
    const red = baseColorFactor(await exportTableToGlb({ ...PARAMS, color: '#ff0000' }));
    const brown = baseColorFactor(await exportTableToGlb({ ...PARAMS, color: '#a9744f' }));
    const white = baseColorFactor(await exportTableToGlb({ ...PARAMS, color: '#ffffff' }));

    expect(red?.[0]).toBeCloseTo(1, 5);
    expect(red?.[1]).toBeCloseTo(0, 5);
    expect(red?.[2]).toBeCloseTo(0, 5);

    // A different colour yields a clearly different factor.
    expect(brown).toBeDefined();
    expect(brown?.[0]).toBeGreaterThan(0);
    expect(brown?.[0]).toBeLessThan(1);
    expect(brown?.[1]).toBeGreaterThan(0);
    expect(brown?.[1]).toBeLessThan(1);

    // White is represented by the glTF default (factor omitted => 1,1,1,1).
    if (white !== undefined) {
      expect(white[0]).toBeCloseTo(1, 5);
      expect(white[1]).toBeCloseTo(1, 5);
      expect(white[2]).toBeCloseTo(1, 5);
    }
  });

  it('can be called repeatedly without leaking state', async () => {
    const first = await exportTableToGlb(PARAMS);
    const second = await exportTableToGlb({ ...PARAMS, widthCm: 90 });
    const third = await exportTableToGlb(PARAMS);

    // Each export is a valid, non-empty GLB.
    [first, second, third].forEach((buffer) => {
      expect(parseGlb(buffer).version).toBe(2);
      expect(binChunk(buffer).length).toBeGreaterThan(0);
    });

    // Different dimensions produce different geometry binary data.
    expect(bytesDiffer(binChunk(first), binChunk(second))).toBe(true);
    // Re-exporting the same parameters reproduces identical geometry data
    // (no leaked state between calls).
    expect(bytesDiffer(binChunk(first), binChunk(third))).toBe(false);
  });

  it('exposes a meaningful default filename', () => {
    expect(TABLE_EXPORT_FILENAME).toBe('3d-studio-ai-table.glb');
  });
});
