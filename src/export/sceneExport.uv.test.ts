// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { exportSceneToGlb } from './sceneExport';
import { buildSceneObject } from '../scene/buildSceneObject';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createUniversalSceneObject,
  type SceneData,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';
import { validateUvGeometry } from '../materials/uv';

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
}

interface GltfBufferView {
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

interface GltfNode {
  name?: string;
  mesh?: number;
}

interface GltfMesh {
  primitives: Array<{
    attributes: Record<string, number>;
    mode?: number;
    indices?: number;
  }>;
}

interface GltfJson {
  accessors: GltfAccessor[];
  bufferViews: GltfBufferView[];
  meshes: GltfMesh[];
  nodes: GltfNode[];
}

function parseGlb(buffer: ArrayBuffer): { json: GltfJson; bin: Uint8Array } {
  const view = new DataView(buffer);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)),
  ) as GltfJson;
  const binHeader = 20 + jsonLength;
  const binStart = binHeader + 8;
  return { json, bin: new Uint8Array(buffer, binStart) };
}

function accessorValues(
  json: GltfJson,
  bin: Uint8Array,
  accessorIndex: number,
  components: number,
): number[] {
  const accessor = json.accessors[accessorIndex];
  const bufferView = json.bufferViews[accessor.bufferView ?? -1];
  if (!bufferView) {
    throw new Error(`missing bufferView for accessor ${accessorIndex}`);
  }
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = bufferView.byteStride ?? components * 4;
  const values: number[] = [];
  for (let i = 0; i < accessor.count; i += 1) {
    const base = start + i * stride;
    for (let c = 0; c < components; c += 1) {
      values.push(new DataView(bin.buffer, bin.byteOffset + base + c * 4, 4).getFloat32(0, true));
    }
  }
  return values;
}

function sceneOf(): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects: [createUniversalSceneObject('bed.standard', 'bed-1')],
    settings: createDefaultSettings(),
  };
}

describe('GLB UV export', () => {
  it('writes TEXCOORD_0 for every primitive and preserves runtime UV values', async () => {
    const glb = await exportSceneToGlb(sceneOf(), { includeRoom: false });
    const { json, bin } = parseGlb(glb);

    let primitives = 0;
    for (const mesh of json.meshes) {
      for (const primitive of mesh.primitives) {
        primitives += 1;
        expect(primitive.attributes.TEXCOORD_0, 'TEXCOORD_0').toBeTypeOf('number');
        expect(primitive.attributes.POSITION, 'POSITION').toBeTypeOf('number');
        const uvAccessor = json.accessors[primitive.attributes.TEXCOORD_0];
        const positionAccessor = json.accessors[primitive.attributes.POSITION];
        expect(uvAccessor.type).toBe('VEC2');
        expect(uvAccessor.componentType).toBe(5126);
        expect(uvAccessor.count).toBe(positionAccessor.count);
        const uvs = accessorValues(json, bin, primitive.attributes.TEXCOORD_0, 2);
        expect(uvs.length).toBe(uvAccessor.count * 2);
        expect(uvs.every((value) => Number.isFinite(value))).toBe(true);
      }
    }
    expect(primitives).toBeGreaterThan(0);

    // Runtime geometry and the exported TEXCOORD_0 values are the same data.
    const runtime = buildSceneObject(createUniversalSceneObject('bed.standard', 'bed-1'));
    const runtimeByName = new Map<string, number[]>();
    runtime.group.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const uv = (mesh.geometry as THREE.BufferGeometry).getAttribute('uv') as
        | THREE.BufferAttribute
        | undefined;
      if (uv) runtimeByName.set(mesh.name, Array.from(uv.array as ArrayLike<number>));
    });

    let compared = 0;
    for (const node of json.nodes) {
      if (node.mesh === undefined || !node.name) continue;
      const expected = runtimeByName.get(node.name);
      if (!expected) continue;
      const primitive = json.meshes[node.mesh]?.primitives[0];
      if (!primitive) continue;
      const exported = accessorValues(json, bin, primitive.attributes.TEXCOORD_0, 2);
      expect(exported, node.name).toEqual(expected);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(0);
    runtime.dispose();
  });

  it('keeps every exported UV finite and non-degenerate on rounded and cylindrical parts', () => {
    const built = buildSceneObject(createUniversalSceneObject('bed.standard', 'bed-1'));
    try {
      built.group.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        const diagnostics = validateUvGeometry(mesh.geometry as THREE.BufferGeometry);
        expect(diagnostics.valid, mesh.name).toBe(true);
        expect(diagnostics.spanU + diagnostics.spanV, mesh.name).toBeGreaterThan(0);
      });
    } finally {
      built.dispose();
    }
  });
});
