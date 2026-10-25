/**
 * C8.5 — the three 3D exporters are loaded on demand, not with the app.
 *
 * These tests exercise the lazy boundary behaviourally rather than checking that
 * an import statement exists: the exporter module factories record when they are
 * first evaluated, which only happens inside a dynamic `import()`.
 *
 * Everything else here is a real export. The exporter modules are the only
 * stubs, and only in the tests that need to simulate a failed chunk request.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ExportError } from './exportTypes';
import {
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  createTableSceneObject,
  type SceneData,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';

const META = { name: 'Yotoqxona', furnitureType: 'table', units: 'cm' as const };

const GLTF_SPEC = 'three/examples/jsm/exporters/GLTFExporter.js';
const OBJ_SPEC = 'three/examples/jsm/exporters/OBJExporter.js';
const STL_SPEC = 'three/examples/jsm/exporters/STLExporter.js';

/** GLTFExporter assembles its binary payload with a FileReader; Node has none. */
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

afterEach(() => {
  vi.resetModules();
  vi.doUnmock(GLTF_SPEC);
  vi.doUnmock(OBJ_SPEC);
  vi.doUnmock(STL_SPEC);
});

function makeScene(): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { widthCm: 400, lengthCm: 500, heightCm: 280 },
    objects: [createTableSceneObject('t1'), createFurnitureSceneObject('wardrobe', 'w1')],
    settings: createDefaultSettings(),
  };
}

describe('C8.5 lazy exporters — modules are fetched on demand', () => {
  it('does not evaluate the OBJ exporter until an OBJ export runs', async () => {
    const evaluated = vi.fn();
    vi.doMock(OBJ_SPEC, () => {
      evaluated();
      return {
        OBJExporter: class {
          parse() {
            return 'v 0 0 0\nf 1 1 1\n';
          }
        },
      };
    });
    vi.resetModules();

    // Importing the dispatcher must not touch the exporter.
    const { exportSceneToFormat } = await import('./sceneFileExport');
    expect(evaluated).not.toHaveBeenCalled();

    await exportSceneToFormat('obj', makeScene(), META);
    expect(evaluated).toHaveBeenCalledTimes(1);
  });

  it('does not evaluate the STL exporter until an STL export runs', async () => {
    const evaluated = vi.fn();
    vi.doMock(STL_SPEC, () => {
      evaluated();
      return {
        STLExporter: class {
          parse() {
            return new ArrayBuffer(134); // 84-byte header + 50-byte triangle
          }
        },
      };
    });
    vi.resetModules();

    const { exportSceneToFormat } = await import('./sceneFileExport');
    expect(evaluated).not.toHaveBeenCalled();

    await exportSceneToFormat('stl', makeScene(), META);
    expect(evaluated).toHaveBeenCalledTimes(1);
  });

  it('does not evaluate the GLTF exporter until a GLB export runs', async () => {
    const evaluated = vi.fn();
    vi.doMock(GLTF_SPEC, () => {
      evaluated();
      return {
        GLTFExporter: class {
          async parseAsync() {
            return new ArrayBuffer(12);
          }
        },
      };
    });
    vi.resetModules();

    const { exportSceneToFormat } = await import('./sceneFileExport');
    expect(evaluated).not.toHaveBeenCalled();

    await exportSceneToFormat('glb', makeScene(), META);
    expect(evaluated).toHaveBeenCalledTimes(1);
  });

  it('does not load an exporter for a format that needs none', async () => {
    const anyEvaluated = vi.fn();
    for (const spec of [GLTF_SPEC, OBJ_SPEC, STL_SPEC]) {
      vi.doMock(spec, () => {
        anyEvaluated();
        return {};
      });
    }
    vi.resetModules();

    const { exportSceneToFormat } = await import('./sceneFileExport');
    await exportSceneToFormat('json', makeScene(), META);
    expect(anyEvaluated).not.toHaveBeenCalled();
  });
});

describe('C8.5 lazy exporters — real exports, per format', () => {
  it('GLB: loads, produces a glTF binary with the documented name and MIME', async () => {
    const { exportSceneToFormat } = await import('./sceneFileExport');
    const artifact = await exportSceneToFormat('glb', makeScene(), META);

    expect(artifact.filename).toBe('yotoqxona-table.glb');
    expect(artifact.mimeType).toBe('model/gltf-binary');
    const bytes = await artifact.blob.arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(0);
    // glTF binary magic "glTF".
    expect(new DataView(bytes).getUint32(0, true)).toBe(0x46546c67);
  });

  it('OBJ: loads, produces non-empty geometry with the documented name and MIME', async () => {
    const { exportSceneToFormat } = await import('./sceneFileExport');
    const artifact = await exportSceneToFormat('obj', makeScene(), META);

    expect(artifact.filename).toBe('yotoqxona-table.obj');
    expect(artifact.mimeType).toBe('model/obj');
    const text = await artifact.blob.text();
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/^v /m);
    expect(text).toMatch(/^f /m);
    // Contract preserved: no material references, no dangling .mtl.
    expect(text).not.toMatch(/^usemtl /m);
    expect(text).not.toMatch(/^mtllib /m);
  });

  it('STL: loads, produces a binary STL with the documented name and MIME', async () => {
    const { exportSceneToFormat } = await import('./sceneFileExport');
    const artifact = await exportSceneToFormat('stl', makeScene(), META);

    expect(artifact.filename).toBe('yotoqxona-table.stl');
    expect(artifact.mimeType).toBe('model/stl');
    const bytes = await artifact.blob.arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(84);
    // Binary STL: 84-byte header + 50 bytes per triangle.
    expect((bytes.byteLength - 84) % 50).toBe(0);
  });
});

describe('C8.5 lazy exporters — failure isolation', () => {
  it('reports a failed GLB chunk load as a typed, readable export error', async () => {
    vi.doMock(GLTF_SPEC, () => {
      throw new Error('chunk request failed');
    });
    vi.resetModules();

    const { exportSceneToFormat } = await import('./sceneFileExport');
    const error = await exportSceneToFormat('glb', makeScene(), META).catch((e: unknown) => e);

    // `vi.resetModules()` gives the fresh module its own ExportError class, so
    // `instanceof` cannot match across registries; assert the contract instead.
    expect((error as ExportError).name).toBe('ExportError');
    expect((error as ExportError).code).toBe('failed');
    expect((error as ExportError).message).toMatch(/GLB/);
    expect((error as ExportError).message).toMatch(/moduli yuklanmadi/);
  });

  it('reports a failed OBJ chunk load as a typed, readable export error', async () => {
    vi.doMock(OBJ_SPEC, () => {
      throw new Error('chunk request failed');
    });
    vi.resetModules();

    const { exportSceneToFormat } = await import('./sceneFileExport');
    const error = await exportSceneToFormat('obj', makeScene(), META).catch((e: unknown) => e);

    expect((error as ExportError).name).toBe('ExportError');
    expect((error as ExportError).code).toBe('failed');
    expect((error as ExportError).message).toMatch(/OBJ/);
  });

  it('reports a failed STL chunk load as a typed, readable export error', async () => {
    vi.doMock(STL_SPEC, () => {
      throw new Error('chunk request failed');
    });
    vi.resetModules();

    const { exportSceneToFormat } = await import('./sceneFileExport');
    const error = await exportSceneToFormat('stl', makeScene(), META).catch((e: unknown) => e);

    expect((error as ExportError).name).toBe('ExportError');
    expect((error as ExportError).code).toBe('failed');
    expect((error as ExportError).message).toMatch(/STL/);
  });

  it('a broken exporter does not break the others', async () => {
    // Only OBJ is broken; GLB and STL must still succeed.
    vi.doMock(OBJ_SPEC, () => {
      throw new Error('chunk request failed');
    });
    vi.resetModules();

    const { exportSceneToFormat } = await import('./sceneFileExport');

    await expect(exportSceneToFormat('obj', makeScene(), META)).rejects.toMatchObject({
      name: 'ExportError',
      code: 'failed',
    });

    const glb = await exportSceneToFormat('glb', makeScene(), META);
    expect(glb.blob.size).toBeGreaterThan(0);

    const stl = await exportSceneToFormat('stl', makeScene(), META);
    expect(stl.blob.size).toBeGreaterThan(0);

    const json = await exportSceneToFormat('json', makeScene(), META);
    expect(json.blob.size).toBeGreaterThan(0);
  });

  it('still rejects invalid geometry before touching the exporter', async () => {
    const evaluated = vi.fn();
    vi.doMock(OBJ_SPEC, () => {
      evaluated();
      return { OBJExporter: class { parse() { return ''; } } };
    });
    vi.resetModules();

    const { exportSceneToFormat } = await import('./sceneFileExport');
    const scene = makeScene();
    scene.objects[0] = createTableSceneObject('bad', { position: { x: Number.NaN, y: 0, z: 0 } });

    await expect(exportSceneToFormat('obj', scene, META)).rejects.toMatchObject({
      code: 'invalid_geometry',
    });
    // The geometry guard runs first, so a corrupt scene never loads the chunk.
    expect(evaluated).not.toHaveBeenCalled();
  });
});

describe('C8.5 lazy exporters — repeated exports and scene integrity', () => {
  it('produces identical output on repeated exports of the same scene', async () => {
    const { exportSceneToFormat } = await import('./sceneFileExport');
    const scene = makeScene();

    const first = await exportSceneToFormat('obj', scene, META);
    const second = await exportSceneToFormat('obj', scene, META);
    expect(await second.blob.text()).toBe(await first.blob.text());

    const stlA = await exportSceneToFormat('stl', scene, META);
    const stlB = await exportSceneToFormat('stl', scene, META);
    expect(stlB.blob.size).toBe(stlA.blob.size);
  });

  it('leaves the scene model untouched', async () => {
    const { exportSceneToFormat } = await import('./sceneFileExport');
    const scene = makeScene();
    const before = JSON.stringify(scene);

    await exportSceneToFormat('glb', scene, META);
    await exportSceneToFormat('obj', scene, META);
    await exportSceneToFormat('stl', scene, META);

    expect(JSON.stringify(scene)).toBe(before);
  });
});
