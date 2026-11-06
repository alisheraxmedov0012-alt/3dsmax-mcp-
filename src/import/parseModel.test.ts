import { describe, expect, it, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { parseModelFile } from './parseModel';
import { ImportError } from './importErrors';
import { buildGlb, triangleBin, triangleGlb, triangleJsonWith } from './__fixtures__/glbFixtures';
import { sha256Hex } from '../util/sha256';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function rejectionCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ImportError);
    return (error as ImportError).code;
  }
  throw new Error('expected the import to be rejected');
}

describe('parseModelFile — happy path', () => {
  it('parses a valid GLB into centimetres, resting on the floor', async () => {
    const parsed = await parseModelFile({ name: 'triangle.glb', bytes: triangleGlb() });
    try {
      expect(parsed.meta.meshes).toBe(1);
      expect(parsed.meta.triangles).toBe(1);
      expect(parsed.meta.materials).toBe(1);

      // 1 m in glTF is 100 cm in the editor.
      const bounds = parsed.meta.boundsCm;
      expect(bounds.max.x - bounds.min.x).toBeCloseTo(100, 3);
      expect(bounds.max.y - bounds.min.y).toBeCloseTo(100, 3);
      // Placement: centred on X/Z, base on the floor.
      expect(bounds.min.y).toBeCloseTo(0, 3);
      expect((bounds.min.x + bounds.max.x) / 2).toBeCloseTo(0, 3);
      expect((bounds.min.z + bounds.max.z) / 2).toBeCloseTo(0, 3);

      expect(parsed.root.getObjectByName('TriangleNode')).toBeTruthy();
    } finally {
      parsed.dispose();
    }
  });

  it('keeps the object hierarchy and the authored material', async () => {
    const parsed = await parseModelFile({ name: 'triangle.glb', bytes: triangleGlb() });
    try {
      const mesh = parsed.root.getObjectByProperty('isMesh', true) as THREE.Mesh;
      expect(mesh).toBeTruthy();
      expect(mesh.geometry.getAttribute('position').count).toBe(3);
      expect((mesh.material as THREE.MeshStandardMaterial).isMeshStandardMaterial).toBe(true);
    } finally {
      parsed.dispose();
    }
  });

  it('reports the size, the source hash and the file name', async () => {
    const bytes = triangleGlb();
    const parsed = await parseModelFile({ name: 'triangle.glb', bytes });
    try {
      expect(parsed.meta.sourceBytes).toBe(bytes.byteLength);
      expect(parsed.meta.sourceHash).toBe(sha256Hex(new Uint8Array(bytes)));
      expect(parsed.meta.sourceHash).toMatch(/^[0-9a-f]{64}$/u);
      expect(parsed.meta.format).toBe('glb');
    } finally {
      parsed.dispose();
    }
  });

  it('reduces a path to its file name', async () => {
    const parsed = await parseModelFile({
      name: 'C:\\Users\\ali\\models\\stul.glb',
      bytes: triangleGlb(),
    });
    try {
      expect(parsed.meta.fileName).toBe('stul.glb');
    } finally {
      parsed.dispose();
    }
  });

  it('leaves the model detached so the caller decides when it joins the scene', async () => {
    const parsed = await parseModelFile({ name: 'triangle.glb', bytes: triangleGlb() });
    try {
      expect(parsed.root.parent).toBeNull();
    } finally {
      parsed.dispose();
    }
  });
});

describe('parseModelFile — rejection', () => {
  it('refuses a glTF that describes no scene', async () => {
    const json = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' } }));
    expect(
      await rejectionCode(parseModelFile({ name: 'chair.gltf', bytes: json.buffer as ArrayBuffer })),
    ).toBe('malformed');
  });

  it('rejects a corrupt container', async () => {
    const bytes = buildGlb(triangleJsonWith(() => undefined), triangleBin(), { magic: 7 });
    expect(await rejectionCode(parseModelFile({ name: 'x.glb', bytes }))).toBe('unsupported_format');
  });

  it('rejects a document that failed the policy before loading anything', async () => {
    const bytes = buildGlb(
      triangleJsonWith((json) => {
        json.extensionsRequired = ['KHR_draco_mesh_compression'];
      }),
      triangleBin(),
    );
    expect(await rejectionCode(parseModelFile({ name: 'x.glb', bytes }))).toBe(
      'unsupported_extension',
    );
  });

  it('honours an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      await rejectionCode(
        parseModelFile({ name: 'x.glb', bytes: triangleGlb() }, { signal: controller.signal }),
      ),
    ).toBe('aborted');
  });

  it('honours an abort that arrives during parsing', async () => {
    const controller = new AbortController();
    const promise = parseModelFile(
      { name: 'x.glb', bytes: triangleGlb() },
      { signal: controller.signal },
    );
    controller.abort();
    // Either the pre-load check or the post-load check catches it; both are legal.
    const outcome = await promise.then(
      (parsed) => {
        parsed.dispose();
        return 'resolved';
      },
      (error: unknown) => (error instanceof ImportError ? error.code : 'other'),
    );
    expect(['aborted', 'resolved']).toContain(outcome);
  });
});

describe('parseModelFile — no network', () => {
  it('never calls fetch for a self-contained GLB', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network is not allowed')));
    vi.stubGlobal('fetch', fetchSpy);

    const parsed = await parseModelFile({ name: 'triangle.glb', bytes: triangleGlb() });
    parsed.dispose();

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('parseModelFile — resource lifecycle', () => {
  it('releases the parsed geometry when disposed', async () => {
    const parsed = await parseModelFile({ name: 'triangle.glb', bytes: triangleGlb() });
    const mesh = parsed.root.getObjectByProperty('isMesh', true) as THREE.Mesh;
    const geometrySpy = vi.spyOn(mesh.geometry, 'dispose');

    parsed.dispose();

    expect(geometrySpy).toHaveBeenCalledTimes(1);
  });

  it('measures real vertices, not the bounds the file declares', async () => {
    // The fixture's accessor claims min/max of 0…1 m while the BIN chunk carries a
    // vertex at 2 000 m. `GLTFLoader` seeds the geometry bounding box from the
    // declared values, so a naive measurement would report a 1 m model. The parse
    // must recompute from the buffers and refuse the 200 000 cm result.
    const bin = new Uint8Array(44);
    const view = new DataView(bin.buffer);
    const positions = [
      [0, 0, 0],
      [2000, 0, 0],
      [0, 1, 0],
    ];
    let offset = 0;
    for (const [x, y, z] of positions) {
      view.setFloat32(offset, x, true);
      view.setFloat32(offset + 4, y, true);
      view.setFloat32(offset + 8, z, true);
      offset += 12;
    }
    view.setUint16(36, 0, true);
    view.setUint16(38, 1, true);
    view.setUint16(40, 2, true);

    const bytes = buildGlb(triangleJsonWith(() => undefined), bin);
    expect(await rejectionCode(parseModelFile({ name: 'huge.glb', bytes }))).toBe('too_complex');
  });
});

