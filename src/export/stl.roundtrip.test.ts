/**
 * B2 — STL round-trip against the file bytes.
 *
 * The parser here is a plain binary-STL reader: 80-byte header, uint32 triangle
 * count, then 50 bytes per facet (normal + three vertices + attribute). It shares
 * no code with the exporter.
 */
import { describe, expect, it } from 'vitest';
import { createFurnitureSceneObject, createTableSceneObject, SCENE_SCHEMA_VERSION, type SceneData } from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';
import { exportSceneToFormat } from './sceneFileExport';
import type { ExportMetadata } from './exportTypes';

const META: ExportMetadata = { name: 'STL', furnitureType: 'table', units: 'cm' };

interface ParsedStl {
  triangles: number;
  finite: boolean;
  min: [number, number, number];
  max: [number, number, number];
}

function parseStl(buffer: ArrayBuffer): ParsedStl {
  const view = new DataView(buffer);
  const triangles = view.getUint32(80, true);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let finite = true;
  let offset = 84;
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    offset += 12; // facet normal is not read
    for (let vertex = 0; vertex < 3; vertex += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = view.getFloat32(offset, true);
        if (!Number.isFinite(value)) finite = false;
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
        offset += 4;
      }
    }
    offset += 2; // attribute byte count
  }
  return { triangles, finite, min, max };
}

async function stlOf(data: SceneData): Promise<ParsedStl> {
  const artifact = await exportSceneToFormat('stl', data, META, { includeRoom: false });
  return parseStl(await artifact.blob.arrayBuffer());
}

function scene(): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { widthCm: 400, lengthCm: 500, heightCm: 280 },
    objects: [createTableSceneObject('t1')],
    settings: createDefaultSettings(),
  };
}

describe('B2 — STL round-trip', () => {
  it('reads back the triangle count and millimetre bounds', async () => {
    const stl = await stlOf(scene());
    expect(stl.triangles).toBe(60);
    expect(stl.finite).toBe(true);
    expect(stl.max[0] - stl.min[0]).toBeCloseTo(1200, 1);
    expect(stl.max[1] - stl.min[1]).toBeCloseTo(750, 1);
    expect(stl.max[2] - stl.min[2]).toBeCloseTo(600, 1);
  });

  it('does not apply the centimetre scale twice', async () => {
    const stl = await stlOf(scene());
    expect(stl.max[0] - stl.min[0]).toBeLessThan(2000);
  });

  it('converts a 60 cm cube to 600 mm', async () => {
    const cubeScene = scene();
    cubeScene.objects = [
      createFurnitureSceneObject('table', 'small', {
        params: { ...createTableSceneObject('x').params, widthCm: 60, heightCm: 60, depthCm: 60 },
      }),
    ];
    const stl = await stlOf(cubeScene);
    expect(stl.max[0] - stl.min[0]).toBeCloseTo(600, 1);
  });

  it('preserves a nonzero translation and negative coordinates', async () => {
    const translated = scene();
    translated.objects = [
      createTableSceneObject('t1', { position: { x: -25, y: 0, z: -10 } }),
    ];
    const stl = await stlOf(translated);
    expect(stl.min[0]).toBeCloseTo(-250 - 600, 1);
    expect(stl.min[2]).toBeCloseTo(-100 - 300, 1);
    expect(stl.max[0] - stl.min[0]).toBeCloseTo(1200, 1);
  });

  it('applies a nonzero object scale exactly once', async () => {
    const scaled = scene();
    scaled.objects = [createTableSceneObject('t1', { scale: { x: 2, y: 2, z: 2 } })];
    const stl = await stlOf(scaled);
    expect(stl.max[0] - stl.min[0]).toBeCloseTo(2400, 1);
    expect(stl.max[1] - stl.min[1]).toBeCloseTo(1500, 1);
  });

  it('keeps multiple components as triangles, not as one merged solid', async () => {
    const multi = scene();
    multi.objects = [
      createTableSceneObject('a'),
      createTableSceneObject('b', { position: { x: 200, y: 0, z: 0 } }),
    ];
    const stl = await stlOf(multi);
    expect(stl.triangles).toBe(120);
    expect(stl.max[0] - stl.min[0]).toBeCloseTo(1200 + 2000, 0);
  });

  it('excludes hidden objects from the triangle count', async () => {
    const hidden = scene();
    hidden.objects = [
      createTableSceneObject('visible'),
      createTableSceneObject('hidden', { visible: false }),
    ];
    expect((await stlOf(hidden)).triangles).toBe(60);
  });

  it('raises a defined empty-scene error instead of writing an empty file', async () => {
    const empty = scene();
    empty.objects = [createTableSceneObject('hidden', { visible: false })];
    await expect(exportSceneToFormat('stl', empty, META, { includeRoom: false })).rejects.toMatchObject(
      { code: 'empty_scene' },
    );
  });

  it('rejects malformed geometry before a file exists', async () => {
    const bad = scene();
    bad.objects = [createTableSceneObject('bad', { position: { x: Number.NaN, y: 0, z: 0 } })];
    await expect(exportSceneToFormat('stl', bad, META, { includeRoom: false })).rejects.toMatchObject(
      { code: 'invalid_geometry' },
    );
  });
});
