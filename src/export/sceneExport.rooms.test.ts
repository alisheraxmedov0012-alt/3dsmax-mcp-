import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { buildExportScene, exportSceneToGlb, pruneInvisible } from './sceneExport';
import {
  createRoomInstance,
} from '../scene/roomInstance';
import {
  SCENE_SCHEMA_VERSION,
  createTableSceneObject,
  type RoomInstance,
  type SceneData,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';
import { ROOM_STANDARD_DEFINITION_ID } from '../geometry/interior/roomDefinition';
import { DEFAULT_ROOM_SPEC } from '../geometry/interior/roomSpec';

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

interface ParsedGlb {
  json: {
    meshes?: Array<{ name?: string }>;
    materials?: Array<{ name?: string; alphaMode?: string; pbrMetallicRoughness?: unknown }>;
    nodes?: Array<{ name?: string; matrix?: number[] }>;
  };
}

function parseGlb(buffer: ArrayBuffer): ParsedGlb {
  const view = new DataView(buffer);
  expect(view.getUint32(0, true)).toBe(GLB_MAGIC);
  const totalLength = view.getUint32(8, true);
  let offset = 12;
  let json: ParsedGlb['json'] = {};
  while (offset + 8 <= totalLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const bytes = new Uint8Array(buffer, offset + 8, length);
    if (type === CHUNK_TYPE_JSON) {
      json = JSON.parse(new TextDecoder().decode(bytes));
    }
    offset += 8 + length;
  }
  return { json };
}

function room(id: string, overrides: Partial<RoomInstance> = {}): RoomInstance {
  return {
    ...createRoomInstance(ROOM_STANDARD_DEFINITION_ID, id, {
      ...DEFAULT_ROOM_SPEC,
      showCeiling: true,
      openings: [
        {
          id: 'door-1',
          type: 'door',
          wallId: 'north',
          offsetCm: 100,
          widthCm: 90,
          heightCm: 200,
          sillHeightCm: 0,
        },
        {
          id: 'window-1',
          type: 'window',
          wallId: 'north',
          offsetCm: 250,
          widthCm: 100,
          heightCm: 100,
          sillHeightCm: 90,
        },
      ],
      materials: {
        floor: { materialId: 'oak-parquet' },
        wall: { materialId: 'paint-white' },
        baseboard: { materialId: 'baseboard-oak' },
        'crown-molding': { materialId: 'crown-matte' },
      },
    }),
    ...overrides,
  };
}

function sceneWith(rooms?: RoomInstance[], objects: SceneData['objects'] = []): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { widthCm: 400, lengthCm: 500, heightCm: 280 },
    objects,
    settings: createDefaultSettings(),
    ...(rooms !== undefined ? { rooms } : {}),
  };
}

function meshNamed(root: THREE.Object3D, name: string): THREE.Mesh {
  const found = root.getObjectByName(name);
  if (!(found instanceof THREE.Mesh)) {
    throw new Error(`Mesh "${name}" topilmadi.`);
  }
  return found;
}

beforeAll(() => {
  vi.stubGlobal('FileReader', TestFileReader);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('9A.2.7 — export scene room integration', () => {
  it('exports a room-only scene through the opt-in room path', () => {
    const { scene, dispose } = buildExportScene(sceneWith([room('room-a')]));
    try {
      expect(scene.getObjectByName('room')).toBeUndefined();
      expect(scene.getObjectByName('room:room-a')).toBeDefined();
      expect(scene.getObjectByName('room-floor')).toBeDefined();
      expect(scene.getObjectByName('room-ceiling')).toBeDefined();
      expect(scene.getObjectByName('room-wall-north')).toBeDefined();
      expect(scene.getObjectByName('room-baseboard-north-1')).toBeDefined();
      expect(scene.getObjectByName('room-crown-molding-north-1')).toBeDefined();
    } finally {
      dispose();
    }
  });

  it('omits every room when includeRoom is false', () => {
    const { scene, dispose } = buildExportScene(sceneWith([room('room-a')]), {
      includeRoom: false,
    });
    try {
      expect(scene.getObjectByName('room')).toBeUndefined();
      expect(scene.getObjectByName('room:room-a')).toBeUndefined();
    } finally {
      dispose();
    }
  });

  it('omits rooms for a single-object product export', () => {
    const { scene, dispose } = buildExportScene(
      sceneWith([room('room-a')], [createTableSceneObject('t1')]),
      { onlyObjectId: 't1' },
    );
    try {
      expect(scene.getObjectByName('room:room-a')).toBeUndefined();
      expect(scene.getObjectByName('object:t1')).toBeDefined();
    } finally {
      dispose();
    }
  });

  it('keeps the legacy room when no opt-in room exists', () => {
    const { scene, dispose } = buildExportScene(sceneWith());
    try {
      expect(scene.getObjectByName('room')).toBeDefined();
      expect(scene.getObjectByName('room-floor')).toBeDefined();
    } finally {
      dispose();
    }
  });

  it('exports multiple rooms with their transforms', () => {
    const { scene, dispose } = buildExportScene(
      sceneWith([
        room('room-a'),
        room('room-b', { position: { x: 800, y: 0, z: -100 } }),
      ]),
    );
    try {
      const second = scene.getObjectByName('room:room-b');
      expect(second).toBeDefined();
      expect(second?.position.x).toBe(800);
      expect(second?.position.z).toBe(-100);
      expect(scene.getObjectByName('room:room-a')).toBeDefined();
    } finally {
      dispose();
    }
  });

  it('prunes a hidden room without disturbing visible geometry', () => {
    const { scene, dispose } = buildExportScene(
      sceneWith([room('room-hidden', { visible: false }), room('room-visible')]),
    );
    try {
      expect(scene.getObjectByName('room:room-hidden')).toBeUndefined();
      expect(scene.getObjectByName('room:room-visible')).toBeDefined();
    } finally {
      dispose();
    }
  });

  it('keeps furniture and rooms in one export scene', () => {
    const { scene, dispose } = buildExportScene(
      sceneWith([room('room-a')], [createTableSceneObject('t1')]),
    );
    try {
      expect(scene.getObjectByName('room:room-a')).toBeDefined();
      expect(scene.getObjectByName('object:t1')).toBeDefined();
      expect(scene.getObjectByName('table-top')).toBeDefined();
    } finally {
      dispose();
    }
  });

  it('keeps door and window openings as real holes in the wall geometry', () => {
    const { scene, dispose } = buildExportScene(sceneWith([room('room-a')]));
    try {
      const wall = meshNamed(scene, 'room-wall-north');
      scene.updateMatrixWorld(true);
      const raycaster = new THREE.Raycaster();
      const throughDoor = new THREE.Vector3(-59, 100, -200);
      raycaster.set(throughDoor, new THREE.Vector3(0, 0, -1));
      expect(raycaster.intersectObject(wall, false)).toHaveLength(0);

      const throughWindow = new THREE.Vector3(97, 140, -200);
      raycaster.set(throughWindow, new THREE.Vector3(0, 0, -1));
      expect(raycaster.intersectObject(wall, false)).toHaveLength(0);

      const throughWall = new THREE.Vector3(150, 100, -200);
      raycaster.set(throughWall, new THREE.Vector3(0, 0, -1));
      expect(raycaster.intersectObject(wall, false).length).toBeGreaterThan(0);
    } finally {
      dispose();
    }
  });

  it('preserves material assignments, trim materials and glass transparency', () => {
    const roomA = room('room-a');
    roomA.spec = {
      ...roomA.spec,
      materials: {
        floor: { materialId: 'oak-parquet' },
        'window-glass': { materialId: 'glass-clear' },
      },
    };
    const { scene, dispose } = buildExportScene(sceneWith([roomA]));
    try {
      const floorMaterial = meshNamed(scene, 'room-floor').material as THREE.MeshStandardMaterial;
      expect(floorMaterial.color.getHexString()).toBe('a97a52');
      const glass = meshNamed(scene, 'window-1-window-glass-1-1')
        .material as THREE.MeshStandardMaterial;
      expect(glass.transparent).toBe(true);
      expect(glass.opacity).toBeLessThan(1);
      const baseboard = meshNamed(scene, 'room-baseboard-north-1')
        .material as THREE.MeshStandardMaterial;
      expect(baseboard.name).toBe('Room_Baseboard');
      const crown = meshNamed(scene, 'room-crown-molding-north-1')
        .material as THREE.MeshStandardMaterial;
      expect(crown.name).toBe('Room_Crown_Molding');
    } finally {
      dispose();
    }
  });

  it('skips an invalid room and reports it without failing the export', () => {
    const invalid = { ...room('room-bad'), definitionId: 'room.missing' } as RoomInstance;
    const built = buildExportScene(sceneWith([invalid, room('room-good')]));
    try {
      expect(built.scene.getObjectByName('room:room-good')).toBeDefined();
      expect(built.scene.getObjectByName('room:room-bad')).toBeUndefined();
      expect(built.roomIssues?.length).toBeGreaterThan(0);
    } finally {
      built.dispose();
    }
  });

  it('disposes room geometry when the export scene is released', () => {
    const disposeSpy = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const built = buildExportScene(sceneWith([room('room-a')]));
    try {
      disposeSpy.mockClear();
      built.dispose();
      expect(disposeSpy).toHaveBeenCalled();
    } finally {
      disposeSpy.mockRestore();
    }
  });

  it('does not mutate the source scene data', () => {
    const data = sceneWith([room('room-a')], [createTableSceneObject('t1')]);
    const before = JSON.stringify(data);
    const built = buildExportScene(data);
    built.dispose();
    expect(JSON.stringify(data)).toBe(before);
  });
});

describe('9A.2.7 — GLB export with rooms', () => {
  it('writes a room-only GLB with structural, opening and trim meshes', async () => {
    const buffer = await exportSceneToGlb(sceneWith([room('room-a')]));
    const { json } = parseGlb(buffer);
    const names = (json.meshes ?? []).map((mesh) => mesh.name ?? '');
    expect(names.some((name) => name.includes('room-floor'))).toBe(true);
    expect(names.some((name) => name.includes('room-wall-north'))).toBe(true);
    expect(names.some((name) => name.includes('room-ceiling'))).toBe(true);
    expect(names.some((name) => name.includes('room-baseboard'))).toBe(true);
    expect(names.some((name) => name.includes('room-crown-molding'))).toBe(true);
    expect(names.some((name) => name.includes('door-1-door-leaf'))).toBe(true);
    expect(names.some((name) => name.includes('window-1-window-glass'))).toBe(true);
  });

  it('writes furniture and room geometry into one GLB', async () => {
    const buffer = await exportSceneToGlb(
      sceneWith([room('room-a')], [createTableSceneObject('t1')]),
    );
    const { json } = parseGlb(buffer);
    const nodes = (json.nodes ?? []).map((node) => node.name ?? '');
    expect(nodes).toContain('object:t1');
    expect(nodes).toContain('room:room-a');
    expect(nodes).toContain('room-floor');
  });

  it('writes every room and preserves its transform', async () => {
    const buffer = await exportSceneToGlb(
      sceneWith([room('room-a'), room('room-b', { position: { x: 800, y: 0, z: 0 } })]),
    );
    const { json } = parseGlb(buffer);
    const nodes = json.nodes ?? [];
    const second = nodes.find((node) => node.name === 'room:room-b');
    expect(second?.matrix?.[12]).toBeCloseTo(800, 3);
    expect(nodes.some((node) => node.name === 'room:room-a')).toBe(true);
  });

  it('writes room materials including trim slots', async () => {
    const buffer = await exportSceneToGlb(sceneWith([room('room-a')]));
    const { json } = parseGlb(buffer);
    const names = (json.materials ?? []).map((material) => material.name ?? '');
    expect(names).toContain('Room_Floor');
    expect(names).toContain('Room_Baseboard');
    expect(names).toContain('Room_Crown_Molding');
    expect(names).toContain('Room_Window_Glass');
  });

  it('keeps the hidden-room policy in the exported file', async () => {
    const buffer = await exportSceneToGlb(
      sceneWith([room('room-hidden', { visible: false }), room('room-visible')]),
    );
    const { json } = parseGlb(buffer);
    const nodes = (json.nodes ?? []).map((node) => node.name ?? '');
    expect(nodes).not.toContain('room:room-hidden');
    expect(nodes).toContain('room:room-visible');
  });

  it('preserves room rotation and scale in the exported node', async () => {
    const buffer = await exportSceneToGlb(
      sceneWith([
        room('room-a', {
          position: { x: 100, y: 0, z: 50 },
          rotation: { x: 0, y: 30, z: 0 },
          scale: { x: 2, y: 1, z: 0.5 },
        }),
      ]),
    );
    const { json } = parseGlb(buffer);
    const node = (json.nodes ?? []).find((entry) => entry.name === 'room:room-a');
    expect(node?.matrix).toBeDefined();
    if (!node?.matrix) return;
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    new THREE.Matrix4().fromArray(node.matrix).decompose(position, quaternion, scale);
    expect(position.x).toBeCloseTo(100, 3);
    expect(position.z).toBeCloseTo(50, 3);
    expect(scale.x).toBeCloseTo(2, 4);
    expect(scale.y).toBeCloseTo(1, 4);
    expect(scale.z).toBeCloseTo(0.5, 4);
    expect(new THREE.Euler().setFromQuaternion(quaternion, 'XYZ').y).toBeCloseTo(
      THREE.MathUtils.degToRad(30),
      4,
    );
  });

  it('keeps stable id-based node names after a display-name rename', () => {
    const renamed = { ...room('room-a'), name: 'Mehmonxona' };
    const { scene, dispose } = buildExportScene(sceneWith([renamed]));
    try {
      expect(scene.getObjectByName('room:room-a')).toBeDefined();
      expect(scene.getObjectByName('room:Mehmonxona')).toBeUndefined();
    } finally {
      dispose();
    }
  });

  it('pruneInvisible removes a hidden room subtree from any scene', () => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    group.name = 'room:hidden';
    group.visible = false;
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    scene.add(group);
    pruneInvisible(scene);
    expect(scene.getObjectByName('room:hidden')).toBeUndefined();
  });
});
