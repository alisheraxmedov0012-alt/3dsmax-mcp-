import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { buildExportScene, exportSceneToGlb, SCENE_EXPORT_FILENAME } from './sceneExport';
import {
  createFurnitureSceneObject,
  createTableSceneObject,
  SCENE_SCHEMA_VERSION,
  type SceneData,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';
import { FURNITURE_TYPES } from '../geometry/furniture/types';
import { inferDesignSpec, specToFurnitureParams } from '../image/referenceInference';

/**
 * Node has no FileReader, which GLTFExporter uses to assemble the binary (.glb)
 * payload. This shim reads real Blob contents so the production export path is
 * exercised end-to-end rather than mocked.
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

const GLB_MAGIC = 0x46546c67;
const CHUNK_TYPE_JSON = 0x4e4f534a;
const CHUNK_TYPE_BIN = 0x004e4942;

interface ParsedGlb {
  version: number;
  totalLength: number;
  json: {
    meshes?: unknown[];
    materials?: unknown[];
    nodes?: Array<{ name?: string; matrix?: number[]; translation?: number[] }>;
  };
  hasBin: boolean;
}

function parseGlb(buffer: ArrayBuffer): ParsedGlb {
  const view = new DataView(buffer);
  expect(view.getUint32(0, true)).toBe(GLB_MAGIC);
  const version = view.getUint32(4, true);
  const totalLength = view.getUint32(8, true);

  let offset = 12;
  let json: ParsedGlb['json'] = {};
  let hasBin = false;
  while (offset + 8 <= totalLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const bytes = new Uint8Array(buffer, offset + 8, length);
    if (type === CHUNK_TYPE_JSON) {
      json = JSON.parse(new TextDecoder().decode(bytes));
    } else if (type === CHUNK_TYPE_BIN) {
      hasBin = true;
    }
    offset += 8 + length;
  }

  return { version, totalLength, json, hasBin };
}

function makeScene(overrides?: Partial<SceneData>): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { widthCm: 400, lengthCm: 500, heightCm: 280 },
    objects: [createTableSceneObject('t1')],
    settings: createDefaultSettings(),
    ...overrides,
  };
}

beforeAll(() => {
  vi.stubGlobal('FileReader', TestFileReader);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('buildExportScene', () => {
  it('includes the room and every object', () => {
    const scene = makeScene({
      objects: [createTableSceneObject('t1'), createTableSceneObject('t2')],
    });
    const { scene: exportScene, dispose } = buildExportScene(scene);

    expect(exportScene.getObjectByName('room')).toBeDefined();
    expect(exportScene.getObjectByName('object:t1')).toBeDefined();
    expect(exportScene.getObjectByName('object:t2')).toBeDefined();

    dispose();
  });

  it('does not mutate the source scene data', () => {
    const scene = makeScene();
    const before = JSON.stringify(scene);
    const exported = buildExportScene(scene);
    expect(JSON.stringify(scene)).toBe(before);
    exported.dispose();
  });

  it('groups objects under a root whose transform matches the object', () => {
    const scene = makeScene({
      objects: [createTableSceneObject('t1', { position: { x: 100, y: 0, z: -50 } })],
    });
    const { scene: exportScene, dispose } = buildExportScene(scene);
    const group = exportScene.getObjectByName('object:t1') as THREE.Group;

    expect(group.position.x).toBe(100);
    expect(group.position.z).toBe(-50);

    dispose();
  });
});

describe('exportSceneToGlb', () => {
  it('produces a valid binary glTF container', async () => {
    const buffer = await exportSceneToGlb(makeScene());
    const parsed = parseGlb(buffer);

    expect(buffer.byteLength).toBeGreaterThan(0);
    expect(parsed.version).toBe(2);
    expect(parsed.totalLength).toBe(buffer.byteLength);
    expect(parsed.hasBin).toBe(true);
  });

  it('contains the room and object geometry plus materials', async () => {
    const buffer = await exportSceneToGlb(makeScene());
    const { json } = parseGlb(buffer);

    const names = (json.nodes ?? []).map((node) => node.name ?? '');
    expect(names).toContain('room-floor');
    expect(names.some((name) => name.startsWith('room-wall-'))).toBe(true);
    expect(names).toContain('object:t1');

    // Room floor + four walls, plus the table's geometries.
    expect(json.meshes && json.meshes.length).toBeGreaterThanOrEqual(5);
    // Floor, wall and table materials.
    expect(json.materials && json.materials.length).toBeGreaterThanOrEqual(3);
  });

  it('preserves object transforms in the exported nodes', async () => {
    const buffer = await exportSceneToGlb(
      makeScene({
        objects: [createTableSceneObject('t1', { position: { x: 120, y: 0, z: 40 } })],
      }),
    );
    const { json } = parseGlb(buffer);

    // GLTFExporter writes a column-major matrix per node; translation lives at
    // indices 12, 13, 14.
    const node = (json.nodes ?? []).find((entry) => entry.name === 'object:t1');
    expect(node?.matrix).toBeDefined();
    expect(node?.matrix?.[12]).toBeCloseTo(120, 3);
    expect(node?.matrix?.[14]).toBeCloseTo(40, 3);
  });

  it('exposes a meaningful default filename', () => {
    expect(SCENE_EXPORT_FILENAME).toBe('3d-studio-ai-scene.glb');
  });

  it('exports a non-table furniture type (sofa) with all its parts', async () => {
    const buffer = await exportSceneToGlb(
      makeScene({ objects: [createFurnitureSceneObject('sofa', 's1')] }),
    );
    const { json } = parseGlb(buffer);

    const node = (json.nodes ?? []).find((entry) => entry.name === 'object:s1');
    expect(node).toBeDefined();
    // The sofa is built from several parts, so more than one mesh is written.
    expect((json.meshes ?? []).length).toBeGreaterThan(1);
  });

  it('exports a scene containing several different furniture types', async () => {
    const buffer = await exportSceneToGlb(
      makeScene({
        objects: [
          createTableSceneObject('t1'),
          createFurnitureSceneObject('chair', 'c1'),
          createFurnitureSceneObject('wardrobe', 'w1'),
        ],
      }),
    );
    const parsed = parseGlb(buffer);
    expect(parsed.version).toBe(2);
    expect(parsed.hasBin).toBe(true);
    const names = (parsed.json.nodes ?? []).map((entry) => entry.name);
    expect(names).toContain('object:t1');
    expect(names).toContain('object:c1');
    expect(names).toContain('object:w1');
  });

  it('writes per-object PBR material values into the GLB', async () => {
    const buffer = await exportSceneToGlb(
      makeScene({
        objects: [createTableSceneObject('t1', { material: { metalness: 0.9, roughness: 0.1 } })],
      }),
    );
    const { json } = parseGlb(buffer);

    const match = (json.materials ?? []).some((material) => {
      const pbr = (material as { pbrMetallicRoughness?: { metallicFactor?: number; roughnessFactor?: number } })
        .pbrMetallicRoughness;
      return (
        pbr !== undefined &&
        Math.abs((pbr.metallicFactor ?? 0) - 0.9) < 0.001 &&
        Math.abs((pbr.roughnessFactor ?? 0) - 0.1) < 0.001
      );
    });
    expect(match).toBe(true);
  });

  it('exports a transparent (glass) material as alphaMode BLEND', async () => {
    const buffer = await exportSceneToGlb(
      makeScene({
        objects: [
          createTableSceneObject('t1', {
            material: { metalness: 0, roughness: 0.05, materialId: 'glass-clear', opacity: 0.3 },
          }),
        ],
      }),
    );
    const { json } = parseGlb(buffer);

    const blend = (json.materials ?? []).some(
      (material) => (material as { alphaMode?: string }).alphaMode === 'BLEND',
    );
    expect(blend).toBe(true);
  });

  it('still exports a valid GLB when visualization settings are customized', async () => {
    const scene = makeScene();
    scene.settings.background = '#000000';
    scene.settings.lights.keyEnabled = false;
    scene.settings.lights.shadowsEnabled = false;
    scene.settings.roomMaterials.floorColor = '#101010';

    const buffer = await exportSceneToGlb(scene);
    const parsed = parseGlb(buffer);
    expect(parsed.version).toBe(2);
    expect(parsed.hasBin).toBe(true);
  });

  it('exports every W2 furniture type as a valid multi-mesh GLB', async () => {
    for (const type of FURNITURE_TYPES) {
      // Sequential on purpose: GLTFExporter is not run concurrently here.
      // eslint-disable-next-line no-await-in-loop
      const buffer = await exportSceneToGlb(
        makeScene({ objects: [createFurnitureSceneObject(type, `x-${type}`)] }),
      );
      const parsed = parseGlb(buffer);
      expect(parsed.version).toBe(2);
      expect(parsed.hasBin).toBe(true);
      // Each furniture type is made of several parts.
      expect((parsed.json.meshes ?? []).length).toBeGreaterThan(1);
      const names = (parsed.json.nodes ?? []).map((entry) => entry.name);
      expect(names).toContain(`object:x-${type}`);
    }
  });

  it('exports a scene containing an image-derived object with all its parts', async () => {
    // Emulate the confirmed W7 flow: inference -> params -> scene object.
    const inference = inferDesignSpec({
      type: 'wardrobe',
      sample: { aspectRatio: 0.9, averageColor: '#8b5a2b' },
      referenceWidthCm: 180,
      reference: 'widthCm',
    });
    expect(inference.ok).toBe(true);
    if (!inference.ok) return;

    const params = specToFurnitureParams(inference.spec.furniture, inference.spec.dimensions);
    const object = createFurnitureSceneObject('wardrobe', 'img-1', { params });

    const buffer = await exportSceneToGlb(makeScene({ objects: [object] }));
    const parsed = parseGlb(buffer);
    expect(parsed.version).toBe(2);
    expect(parsed.hasBin).toBe(true);
    expect((parsed.json.meshes ?? []).length).toBeGreaterThan(1);
    const names = (parsed.json.nodes ?? []).map((entry) => entry.name);
    expect(names).toContain('object:img-1');
  });
});
