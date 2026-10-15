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
