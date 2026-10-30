import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { exportSceneToFormat } from './sceneFileExport';
import { ExportError } from './exportTypes';
import {
  createFurnitureSceneObject,
  createTableSceneObject,
  SCENE_SCHEMA_VERSION,
  type SceneData,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';
import { FURNITURE_TYPES } from '../geometry/furniture/types';

const META = { name: 'Yotoqxona', furnitureType: 'wardrobe', units: 'cm' as const };

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

function makeScene(): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { widthCm: 400, lengthCm: 500, heightCm: 280 },
    objects: [
      createTableSceneObject('t1'),
      createFurnitureSceneObject('wardrobe', 'w1'),
    ],
    settings: createDefaultSettings(),
  };
}

beforeAll(() => {
  vi.stubGlobal('FileReader', TestFileReader);
});
afterAll(() => {
  vi.unstubAllGlobals();
});

function stlBounds(buffer: ArrayBuffer): { min: [number, number, number]; max: [number, number, number] } {
  const view = new DataView(buffer);
  const count = view.getUint32(80, true);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let offset = 84;
  for (let triangle = 0; triangle < count; triangle += 1) {
    offset += 12; // facet normal
    for (let vertex = 0; vertex < 3; vertex += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = view.getFloat32(offset, true);
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
        offset += 4;
      }
    }
    offset += 2; // attribute byte count
  }
  return { min, max };
}

function objBounds(text: string): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const line of text.split('\n')) {
    if (!line.startsWith('v ')) continue;
    const [, x, y, z] = line.trim().split(/\s+/).map(Number);
    for (const [index, value] of [x, y, z].entries()) {
      min[index] = Math.min(min[index], value);
      max[index] = Math.max(max[index], value);
    }
  }
  return { min, max };
}

describe('exportSceneToFormat', () => {
  it('produces a GLB with the expected name and MIME', async () => {
    const artifact = await exportSceneToFormat('glb', makeScene(), META);
    expect(artifact.filename).toBe('yotoqxona-wardrobe.glb');
    expect(artifact.mimeType).toBe('model/gltf-binary');
    const bytes = await artifact.blob.arrayBuffer();
    // glTF binary magic "glTF".
    expect(new DataView(bytes).getUint32(0, true)).toBe(0x46546c67);
  });

  it('produces JSON carrying the scene parameters', async () => {
    const artifact = await exportSceneToFormat('json', makeScene(), META);
    expect(artifact.filename).toBe('yotoqxona-wardrobe.json');
    const text = await artifact.blob.text();
    const doc = JSON.parse(text);
    expect(doc.format).toBe('3d-studio-ai-scene');
    expect(doc.scene.objects).toHaveLength(2);
  });

  it('produces OBJ geometry (vertices and faces) without materials', async () => {
    const artifact = await exportSceneToFormat('obj', makeScene(), META);
    expect(artifact.filename).toBe('yotoqxona-wardrobe.obj');
    expect(artifact.mimeType).toBe('model/obj');
    const text = await artifact.blob.text();
    expect(text).toMatch(/^v /m);
    expect(text).toMatch(/^f /m);
    // Three.js' OBJExporter emits no material references.
    expect(text).not.toMatch(/^usemtl /m);
    expect(text).not.toMatch(/^mtllib /m);
  });

  it('produces a binary STL with the expected record length', async () => {
    const artifact = await exportSceneToFormat('stl', makeScene(), META);
    expect(artifact.filename).toBe('yotoqxona-wardrobe.stl');
    expect(artifact.mimeType).toBe('model/stl');
    const bytes = await artifact.blob.arrayBuffer();
    // Binary STL: 84-byte header + 50 bytes per triangle.
    expect((bytes.byteLength - 84) % 50).toBe(0);
    expect(bytes.byteLength).toBeGreaterThan(84);
  });
  it('writes STL in millimetres, not scene centimetres', async () => {
    const scene = makeScene();
    scene.objects = [createTableSceneObject('t1')];
    const artifact = await exportSceneToFormat('stl', scene, META, { includeRoom: false });
    const bounds = stlBounds(await artifact.blob.arrayBuffer());
    expect(bounds.max[0] - bounds.min[0]).toBeCloseTo(1200, 0);
    expect(bounds.max[1] - bounds.min[1]).toBeCloseTo(750, 0);
    expect(bounds.max[2] - bounds.min[2]).toBeCloseTo(600, 0);
  });


  it('exports every furniture type without throwing', async () => {
    for (const type of FURNITURE_TYPES) {
      const scene = makeScene();
      scene.objects = [createFurnitureSceneObject(type, `x-${type}`)];
      // Sequential on purpose: exporters are not run concurrently here.
      // eslint-disable-next-line no-await-in-loop
      const glb = await exportSceneToFormat('glb', scene, META);
      // eslint-disable-next-line no-await-in-loop
      const obj = await exportSceneToFormat('obj', scene, META);
      // eslint-disable-next-line no-await-in-loop
      const stl = await exportSceneToFormat('stl', scene, META);
      expect(glb.blob.size).toBeGreaterThan(0);
      expect(obj.blob.size).toBeGreaterThan(0);
      expect(stl.blob.size).toBeGreaterThan(0);
    }
  });

  it('can export furniture only (room excluded)', async () => {
    const withRoom = await exportSceneToFormat('obj', makeScene(), META);
    const withoutRoom = await exportSceneToFormat('obj', makeScene(), META, { includeRoom: false });
    const withRoomText = await withRoom.blob.text();
    const withoutRoomText = await withoutRoom.blob.text();
    // The room adds geometry, so dropping it must produce a smaller OBJ.
    expect(withoutRoomText.length).toBeLessThan(withRoomText.length);
    expect(withoutRoomText).not.toMatch(/room-/);
  });

  it('rejects non-finite geometry with a typed error (and never writes a file)', async () => {
    const scene = makeScene();
    scene.objects[0] = createTableSceneObject('bad', {
      position: { x: Number.NaN, y: 0, z: 0 },
    });
    await expect(exportSceneToFormat('glb', scene, META)).rejects.toBeInstanceOf(ExportError);
    await expect(exportSceneToFormat('obj', scene, META)).rejects.toMatchObject({
      code: 'invalid_geometry',
    });
    await expect(exportSceneToFormat('stl', scene, META)).rejects.toMatchObject({
      code: 'invalid_geometry',
    });
  });

  it('rejects the render-only PNG format with a clear error', async () => {
    await expect(exportSceneToFormat('png', makeScene(), META)).rejects.toMatchObject({
      code: 'unsupported',
    });
  });
});


describe('A1 — hidden objects, OBJ units and empty exports', () => {
  function tableScene(id: string, visible = true): SceneData {
    return {
      schemaVersion: SCENE_SCHEMA_VERSION,
      room: { widthCm: 400, lengthCm: 500, heightCm: 280 },
      objects: [createTableSceneObject(id, { visible })],
      settings: createDefaultSettings(),
    };
  }

  it('writes OBJ vertices in millimetres, matching STL', async () => {
    const obj = await exportSceneToFormat('obj', tableScene('t1'), META, { includeRoom: false });
    const bounds = objBounds(await obj.blob.text());
    expect(bounds.max[0] - bounds.min[0]).toBeCloseTo(1200, 0);
    expect(bounds.max[1] - bounds.min[1]).toBeCloseTo(750, 0);
    expect(bounds.max[2] - bounds.min[2]).toBeCloseTo(600, 0);
  });

  it('omits the same hidden object from GLB, OBJ and STL', async () => {
    const visibleOnly = tableScene('v');
    const withHidden = {
      ...tableScene('v'),
      objects: [
        ...tableScene('v').objects,
        ...tableScene('hidden', false).objects,
      ],
    };
    for (const format of ['glb', 'obj', 'stl'] as const) {
      const a = await exportSceneToFormat(format, visibleOnly, META, { includeRoom: false });
      const b = await exportSceneToFormat(format, withHidden, META, { includeRoom: false });
      expect(b.blob.size, format).toBe(a.blob.size);
    }
  });

  it('rejects an empty export but keeps a room-only export valid', async () => {
    const empty = {
      schemaVersion: SCENE_SCHEMA_VERSION,
      room: { widthCm: 400, lengthCm: 500, heightCm: 280 },
      objects: [],
      settings: createDefaultSettings(),
    };
    for (const format of ['glb', 'obj', 'stl'] as const) {
      await expect(
        exportSceneToFormat(format, empty, META, { includeRoom: false }),
      ).rejects.toMatchObject({ code: 'empty_scene' });
      const roomOnly = await exportSceneToFormat(format, empty, META, { includeRoom: true });
      expect(roomOnly.blob.size, format).toBeGreaterThan(0);
    }
  });

  it('rejects an export whose only object is hidden and the room is excluded', async () => {
    await expect(
      exportSceneToFormat('obj', tableScene('hidden', false), META, { includeRoom: false }),
    ).rejects.toMatchObject({ code: 'empty_scene' });
  });
});
