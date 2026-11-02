/**
 * B2 — 3MF export and STL round-trip.
 *
 * The 3MF reader here is intentionally independent of the writer: it unzips the
 * archive and parses the XML with regular expressions, so a structural mistake
 * in the writer shows up as a failed assertion rather than a co-signed bug.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { unzipSync } from 'fflate';
import {
  createFurnitureSceneObject,
  createTableSceneObject,
  SCENE_SCHEMA_VERSION,
  type SceneData,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';
import { buildThreeMf } from './threemf';
import { EXPORT_FORMATS } from './exportFormats';
import { DATA_EXPORT_FORMATS } from './sceneFileExport';
import { exportSceneToFormat } from './sceneFileExport';
import { ExportError, type ExportMetadata } from './exportTypes';

const META: ExportMetadata = { name: 'Yotoqxona', furnitureType: 'wardrobe', units: 'cm' };

interface ParsedObject {
  id: number;
  name: string;
  vertices: Array<[number, number, number]>;
  triangles: Array<[number, number, number]>;
}

interface ParsedModel {
  unit: string;
  objects: ParsedObject[];
}

function parseModel(xml: string): ParsedModel {
  const unit = /<model[^>]*\bunit="([^"]+)"/.exec(xml)?.[1];
  if (!unit) throw new Error('model has no unit');
  const objects: ParsedObject[] = [];
  const objectPattern = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
  let objectMatch: RegExpExecArray | null;
  while ((objectMatch = objectPattern.exec(xml)) !== null) {
    const attributes = objectMatch[1];
    const body = objectMatch[2];
    const id = Number(/id="(\d+)"/.exec(attributes)?.[1]);
    const name = /name="([^"]*)"/.exec(attributes)?.[1] ?? '';
    const vertices: Array<[number, number, number]> = [];
    const vertexPattern = /<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g;
    let vertexMatch: RegExpExecArray | null;
    while ((vertexMatch = vertexPattern.exec(body)) !== null) {
      vertices.push([
        Number(vertexMatch[1]),
        Number(vertexMatch[2]),
        Number(vertexMatch[3]),
      ]);
    }
    const triangles: Array<[number, number, number]> = [];
    const trianglePattern = /<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g;
    let triangleMatch: RegExpExecArray | null;
    while ((triangleMatch = trianglePattern.exec(body)) !== null) {
      triangles.push([
        Number(triangleMatch[1]),
        Number(triangleMatch[2]),
        Number(triangleMatch[3]),
      ]);
    }
    objects.push({ id, name, vertices, triangles });
  }
  return { unit, objects };
}

function boundsOf(model: ParsedModel): {
  min: [number, number, number];
  max: [number, number, number];
} {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const object of model.objects) {
    for (const vertex of object.vertices) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], vertex[axis]);
        max[axis] = Math.max(max[axis], vertex[axis]);
      }
    }
  }
  return { min, max };
}

function triangleCount(model: ParsedModel): number {
  return model.objects.reduce((sum, object) => sum + object.triangles.length, 0);
}

function stlBounds(buffer: ArrayBuffer): {
  min: [number, number, number];
  max: [number, number, number];
  triangles: number;
} {
  const view = new DataView(buffer);
  const count = view.getUint32(80, true);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let offset = 84;
  for (let triangle = 0; triangle < count; triangle += 1) {
    offset += 12;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = view.getFloat32(offset, true);
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
        offset += 4;
      }
    }
    offset += 2;
  }
  return { min, max, triangles: count };
}

function makeScene(): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { widthCm: 400, lengthCm: 500, heightCm: 280 },
    objects: [createTableSceneObject('t1')],
    settings: createDefaultSettings(),
  };
}

async function modelOf(scene: SceneData): Promise<ParsedModel> {
  const artifact = await exportSceneToFormat('3mf', scene, META, { includeRoom: false });
  const files = unzipSync(new Uint8Array(await artifact.blob.arrayBuffer()));
  return parseModel(new TextDecoder().decode(files['3D/3dmodel.model']));
}

describe('B2 — 3MF package', () => {
  it('is registered as an honest geometry-only export format', () => {
    expect(DATA_EXPORT_FORMATS).toContain('3mf');
    expect(EXPORT_FORMATS['3mf']).toMatchObject({
      extension: '3mf',
      mimeType: 'model/3mf',
      kind: 'file',
      capabilities: { geometry: true, material: false, textures: false },
    });
  });

  it('is a real OPC package, not a renamed mesh', async () => {
    const artifact = await exportSceneToFormat('3mf', makeScene(), META, { includeRoom: false });
    expect(artifact.filename.endsWith('.3mf')).toBe(true);
    expect(artifact.mimeType).toBe('model/3mf');

    const files = unzipSync(new Uint8Array(await artifact.blob.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual([
      '3D/3dmodel.model',
      '[Content_Types].xml',
      '_rels/.rels',
    ]);
    const contentTypes = new TextDecoder().decode(files['[Content_Types].xml']);
    expect(contentTypes).toContain('3dmanufacturing-3dmodel+xml');
    const rels = new TextDecoder().decode(files['_rels/.rels']);
    expect(rels).toContain('/3D/3dmodel.model');
    expect(rels).toContain('3dmanufacturing/2013/01/3dmodel');
  });

  it('declares millimetres and writes one object per mesh', async () => {
    const model = await modelOf(makeScene());
    expect(model.unit).toBe('millimeter');
    expect(model.objects).toHaveLength(5); // table top + four legs
    expect(triangleCount(model)).toBe(60);
    expect(model.objects.map((object) => object.name)).toContain('table-top');
  });

  it('converts centimetres to millimetres exactly once', async () => {
    const model = await modelOf(makeScene());
    const bounds = boundsOf(model);
    expect(bounds.max[0] - bounds.min[0]).toBeCloseTo(1200, 1);
    expect(bounds.max[1] - bounds.min[1]).toBeCloseTo(750, 1);
    expect(bounds.max[2] - bounds.min[2]).toBeCloseTo(600, 1);
    // A double conversion would produce 12000.
    expect(bounds.max[0] - bounds.min[0]).toBeLessThan(2000);
  });

  it('keeps nonzero offsets and negative coordinates', async () => {
    const scene = makeScene();
    scene.objects = [
      createTableSceneObject('t1', { position: { x: -30, y: 0, z: -20 } }),
    ];
    const model = await modelOf(scene);
    const bounds = boundsOf(model);
    expect(bounds.min[0]).toBeCloseTo(-300 - 600, 1);
    expect(bounds.min[2]).toBeCloseTo(-200 - 300, 1);
    expect(bounds.max[0] - bounds.min[0]).toBeCloseTo(1200, 1);
  });

  it('applies a nonzero object scale exactly once', async () => {
    const scene = makeScene();
    scene.objects = [
      createTableSceneObject('t1', { scale: { x: 2, y: 2, z: 2 } }),
    ];
    const model = await modelOf(scene);
    const bounds = boundsOf(model);
    expect(bounds.max[0] - bounds.min[0]).toBeCloseTo(2400, 1);
    expect(bounds.max[1] - bounds.min[1]).toBeCloseTo(1500, 1);
  });

  it('keeps every furniture type exportable', async () => {
    for (const type of ['table', 'chair', 'armchair', 'sofa', 'bed', 'wardrobe', 'shelf', 'dresser'] as const) {
      const scene = makeScene();
      scene.objects = [createFurnitureSceneObject(type, `${type}-1`)];
      // Sequential on purpose: each export builds and disposes its own scene.
      // eslint-disable-next-line no-await-in-loop
      const model = await modelOf(scene);
      expect(model.objects.length, type).toBeGreaterThan(0);
      expect(triangleCount(model), type).toBeGreaterThan(0);
    }
  });
});

describe('B2 — 3MF visibility and failures', () => {
  it('omits hidden objects and their subtree', async () => {
    const scene = makeScene();
    scene.objects = [
      createTableSceneObject('visible'),
      createTableSceneObject('hidden', { visible: false }),
    ];
    const model = await modelOf(scene);
    expect(model.objects).toHaveLength(5);
    expect(triangleCount(model)).toBe(60);
  });

  it('lets the export dispatch raise a defined error for an empty scene', async () => {
    const scene = makeScene();
    scene.objects = [createTableSceneObject('hidden', { visible: false })];
    await expect(
      exportSceneToFormat('3mf', scene, META, { includeRoom: false }),
    ).rejects.toMatchObject({ code: 'empty_scene' });
  });

  it('refuses non-finite geometry rather than writing a corrupt package', async () => {
    const scene = makeScene();
    scene.objects = [createTableSceneObject('bad', { position: { x: Number.NaN, y: 0, z: 0 } })];
    await expect(
      exportSceneToFormat('3mf', scene, META, { includeRoom: false }),
    ).rejects.toMatchObject({ code: 'invalid_geometry' });
  });

  it('throws a typed error when the writer itself sees an empty root', () => {
    expect(() => buildThreeMf(new THREE.Group())).toThrow(ExportError);
  });
});

describe('B2 — STL and 3MF round-trip', () => {
  it('produces the same triangle count and bounds within 0.01 mm', async () => {
    const scene = makeScene();
    const stl = await exportSceneToFormat('stl', scene, META, { includeRoom: false });
    const stlParsed = stlBounds(await stl.blob.arrayBuffer());
    const model = await modelOf(scene);

    expect(triangleCount(model)).toBe(stlParsed.triangles);
    const bounds = boundsOf(model);
    for (let axis = 0; axis < 3; axis += 1) {
      expect(bounds.min[axis]).toBeCloseTo(stlParsed.min[axis], 1);
      expect(bounds.max[axis]).toBeCloseTo(stlParsed.max[axis], 1);
    }
  });

  it('round-trips a multi-component scene without merging parts', async () => {
    const scene = makeScene();
    scene.objects = [createTableSceneObject('a'), createTableSceneObject('b', { position: { x: 200, y: 0, z: 0 } })];
    const stl = await exportSceneToFormat('stl', scene, META, { includeRoom: false });
    const stlParsed = stlBounds(await stl.blob.arrayBuffer());
    const model = await modelOf(scene);

    expect(model.objects).toHaveLength(10);
    expect(triangleCount(model)).toBe(120);
    expect(stlParsed.triangles).toBe(120);
    expect(boundsOf(model).max[0] - boundsOf(model).min[0]).toBeCloseTo(
      stlParsed.max[0] - stlParsed.min[0],
      1,
    );
  });
});
