import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { parseSceneJson, serializeSceneToJson } from '../export/sceneJson';
import { buildRoom } from '../geometry/buildRoom';
import { ROOM_STANDARD_DEFINITION_ID } from '../geometry/interior/roomDefinition';
import { DEFAULT_ROOM_SPEC } from '../geometry/interior/roomSpec';
import { validateSceneData } from './sceneValidation';
import { createDefaultSettings } from './sceneSettings';
import {
  MAX_ROOMS_PER_SCENE,
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createTableSceneObject,
  type RoomInstance,
  type SceneData,
} from './types';
import {
  RoomInstanceError,
  buildRoomInstance,
  createRoomInstance,
  tryBuildRoomInstance,
  validateRoomInstance,
  validateRoomInstances,
} from './roomInstance';

const EXPORT_METADATA = { name: 'Rooms', furnitureType: null, units: 'cm' as const };
const EXPORT_TIME = '2026-01-01T00:00:00.000Z';

function room(id = 'room-1', overrides: Partial<RoomInstance> = {}): RoomInstance {
  return {
    ...createRoomInstance(ROOM_STANDARD_DEFINITION_ID, id),
    ...overrides,
  };
}

function scene(
  objects: SceneData['objects'] = [],
  rooms?: SceneData['rooms'],
): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects,
    settings: createDefaultSettings(),
    ...(rooms !== undefined ? { rooms } : {}),
  };
}

function openingRoom(): RoomInstance {
  return createRoomInstance(ROOM_STANDARD_DEFINITION_ID, 'opening-room', {
    ...DEFAULT_ROOM_SPEC,
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
  });
}

function rayHits(
  mesh: THREE.Mesh,
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
): number {
  mesh.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(...origin),
    new THREE.Vector3(...direction),
    0,
    10_000,
  );
  return raycaster.intersectObject(mesh, false).length;
}

function positiveVolumeOverlap(a: THREE.Box3, b: THREE.Box3): boolean {
  const dx = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
  const dy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
  const dz = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
  return dx > 1e-6 && dy > 1e-6 && dz > 1e-6;
}

function zeroAreaTriangles(mesh: THREE.Mesh): number {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const edgeA = new THREE.Vector3();
  const edgeB = new THREE.Vector3();
  let zero = 0;
  for (let triangle = 0; triangle < count; triangle += 3) {
    const ia = index ? index.getX(triangle) : triangle;
    const ib = index ? index.getX(triangle + 1) : triangle + 1;
    const ic = index ? index.getX(triangle + 2) : triangle + 2;
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    edgeA.subVectors(b, a);
    edgeB.subVectors(c, a);
    if (edgeA.cross(edgeB).length() <= 1e-8) zero += 1;
  }
  return zero;
}

function meshNames(group: THREE.Object3D): string[] {
  const names: string[] = [];
  group.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) names.push(object.name);
  });
  return names;
}

function meshSize(mesh: THREE.Mesh): THREE.Vector3 {
  mesh.updateMatrixWorld(true);
  mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox?.getSize(new THREE.Vector3()) ?? new THREE.Vector3();
}

describe('RoomInstance model and validation', () => {
  it('creates identity defaults from the room definition', () => {
    const instance = createRoomInstance(ROOM_STANDARD_DEFINITION_ID, 'room-1');
    expect(instance).toMatchObject({
      id: 'room-1',
      name: 'Standart xona',
      definitionId: ROOM_STANDARD_DEFINITION_ID,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
    });
    expect(instance.spec).toEqual(DEFAULT_ROOM_SPEC);
    expect(validateRoomInstance(instance).ok).toBe(true);
  });

  it('rejects invalid ids, unknown definitions and invalid specs', () => {
    expect(validateRoomInstance({ ...room(), id: '' }).ok).toBe(false);
    expect(validateRoomInstance({ ...room(), definitionId: 'room.missing' }).ok).toBe(false);
    expect(
      validateRoomInstance({ ...room(), spec: { widthCm: Number.NaN } }).ok,
    ).toBe(false);
  });

  it('rejects invalid transforms and visibility instead of clamping them', () => {
    for (const bad of [
      { position: { x: Number.NaN, y: 0, z: 0 } },
      { position: { x: 3000, y: 0, z: 0 } },
      { rotation: { x: 0, y: -1, z: 0 } },
      { scale: { x: 0, y: 1, z: 1 } },
      { visible: 'yes' as never },
    ]) {
      expect(validateRoomInstance({ ...room(), ...bad }).ok).toBe(false);
    }
  });

  it('accepts and sanitizes known slot material assignments', () => {
    const result = validateRoomInstance({
      ...room(),
      materialAssignments: {
        floor: { materialId: 'wood-walnut', baseColor: '#123456', metalness: 2 },
        unknownSlot: { baseColor: '#ffffff' },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.room.materialAssignments?.floor).toEqual({
      materialId: 'wood-walnut',
      baseColor: '#123456',
      metalness: 1,
    });
    expect(result.room.materialAssignments?.unknownSlot).toBeUndefined();
  });

  it('rejects a non-object material assignment container', () => {
    expect(
      validateRoomInstance({ ...room(), materialAssignments: 'floor' as never }).ok,
    ).toBe(false);
  });

  it('rejects an invalid opening spec before building', () => {
    const invalid = {
      ...room('bad-opening'),
      spec: {
        ...DEFAULT_ROOM_SPEC,
        openings: [
          {
            id: 'door-1',
            type: 'door',
            wallId: 'north',
            offsetCm: 5,
            widthCm: 90,
            heightCm: 200,
            sillHeightCm: 0,
          },
        ],
      },
    };
    expect(validateRoomInstance(invalid).ok).toBe(false);
    expect(() => buildRoomInstance(invalid)).toThrowError(
      expect.objectContaining({ code: 'invalid_room_instance' }),
    );
  });

  it('drops duplicate ids and rooms beyond the cap', () => {
    const duplicate = validateRoomInstances([room('same'), room('same')]);
    expect(duplicate.rooms).toHaveLength(1);
    expect(duplicate.dropped).toBe(1);
    expect(duplicate.issues.some((entry) => entry.code === 'duplicate_id')).toBe(true);

    const tooMany = validateRoomInstances(
      Array.from({ length: MAX_ROOMS_PER_SCENE + 1 }, (_, index) =>
        room(`room-${index}`),
      ),
    );
    expect(tooMany.rooms).toHaveLength(MAX_ROOMS_PER_SCENE);
    expect(tooMany.dropped).toBe(1);
    expect(tooMany.issues.some((entry) => entry.code === 'limit_exceeded')).toBe(true);
  });
});

describe('opt-in room geometry builder', () => {
  it('builds floor and four walls without a ceiling', () => {
    const built = buildRoomInstance(room());
    try {
      expect(meshNames(built.group)).toHaveLength(5);
      expect(meshNames(built.group).sort()).toEqual([
        'room-floor',
        'room-wall-east',
        'room-wall-north',
        'room-wall-south',
        'room-wall-west',
      ]);
      const floor = built.group.getObjectByName('room-floor') as THREE.Mesh;
      const size = meshSize(floor);
      expect(size.x).toBeCloseTo(400, 5);
      expect(size.y).toBeCloseTo(4, 5);
      expect(size.z).toBeCloseTo(500, 5);
      const north = built.group.getObjectByName('room-wall-north') as THREE.Mesh;
      expect(meshSize(north).toArray()).toEqual([408, 280, 4]);
      expect(built.plan.floor.partId).toBe('room-floor');
    } finally {
      built.dispose();
    }
  });

  it('butt-joints wall corners without positive-volume overlap', () => {
    const built = buildRoomInstance(room());
    try {
      built.group.updateMatrixWorld(true);
      const wallBoxes = new Map<string, THREE.Box3>();
      for (const name of [
        'room-wall-north',
        'room-wall-east',
        'room-wall-south',
        'room-wall-west',
      ]) {
        const mesh = built.group.getObjectByName(name) as THREE.Mesh;
        wallBoxes.set(name, new THREE.Box3().setFromObject(mesh));
      }
      const names = [...wallBoxes.keys()];
      for (let first = 0; first < names.length; first += 1) {
        for (let second = first + 1; second < names.length; second += 1) {
          expect(
            positiveVolumeOverlap(
              wallBoxes.get(names[first])!,
              wallBoxes.get(names[second])!,
            ),
            `${names[first]} / ${names[second]}`,
          ).toBe(false);
        }
      }
      const north = wallBoxes.get('room-wall-north')!;
      const east = wallBoxes.get('room-wall-east')!;
      expect(north.max.z).toBeLessThanOrEqual(east.min.z + 1e-6);
      expect(north.min.z).toBeLessThan(-250);
      expect(east.max.x).toBeCloseTo(204, 6);

      const roomBox = new THREE.Box3().setFromObject(built.group);
      const roomBounds = roomBox.getSize(new THREE.Vector3());
      expect(roomBounds.x).toBeCloseTo(408, 6);
      expect(roomBounds.y).toBeCloseTo(284, 6);
      expect(roomBounds.z).toBeCloseTo(508, 6);
      expect(roomBox.min.y).toBeCloseTo(-4, 6);
      expect(roomBox.max.y).toBeCloseTo(280, 6);
    } finally {
      built.dispose();
    }
  });

  it('creates real door and window holes in the north wall', () => {
    const built = buildRoomInstance(openingRoom());
    try {
      built.group.updateMatrixWorld(true);
      const wall = built.group.getObjectByName('room-wall-north') as THREE.Mesh;
      const door = built.plan.openings.find((entry) => entry.id === 'door-1');
      const window = built.plan.openings.find((entry) => entry.id === 'window-1');
      expect(door).toBeDefined();
      expect(window).toBeDefined();
      if (!door || !window) return;

      // Through the door and window volumes: the wall must be absent.
      expect(
        rayHits(wall, [door.center[0], door.center[1], door.center[2] - 100], [0, 0, 1]),
      ).toBe(0);
      expect(
        rayHits(wall, [window.center[0], window.center[1], window.center[2] - 100], [0, 0, 1]),
      ).toBe(0);

      // A door reaches the floor; a window keeps a wall below its sill.
      expect(
        rayHits(wall, [door.center[0], 1, door.center[2] - 100], [0, 0, 1]),
      ).toBe(0);
      expect(
        rayHits(wall, [window.center[0], window.sillHeightCm - 5, window.center[2] - 100], [0, 0, 1]),
      ).toBeGreaterThan(0);

      // Between the openings the wall is continuous.
      expect(rayHits(wall, [0, 100, -400], [0, 0, 1])).toBeGreaterThan(0);

      expect(wall.geometry.getAttribute('uv')).toBeDefined();
      expect(wall.geometry.getAttribute('normal')).toBeDefined();
      expect(zeroAreaTriangles(wall)).toBe(0);
    } finally {
      built.dispose();
    }
  });

  it('builds multiple openings deterministically and disposes them', () => {
    const first = buildRoomInstance(openingRoom());
    const second = buildRoomInstance(openingRoom());
    try {
      const firstWall = first.group.getObjectByName('room-wall-north') as THREE.Mesh;
      const secondWall = second.group.getObjectByName('room-wall-north') as THREE.Mesh;
      first.group.updateMatrixWorld(true);
      second.group.updateMatrixWorld(true);
      expect(firstWall.geometry.getAttribute('position').count).toBe(
        secondWall.geometry.getAttribute('position').count,
      );
      expect(new THREE.Box3().setFromObject(firstWall)).toEqual(
        new THREE.Box3().setFromObject(secondWall),
      );
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  it('creates real openings on rotated east/west walls', () => {
    const instance = createRoomInstance(ROOM_STANDARD_DEFINITION_ID, 'rotated-openings', {
      ...DEFAULT_ROOM_SPEC,
      openings: [
        {
          id: 'east-door',
          type: 'door',
          wallId: 'east',
          offsetCm: 100,
          widthCm: 90,
          heightCm: 200,
          sillHeightCm: 0,
        },
        {
          id: 'west-window',
          type: 'window',
          wallId: 'west',
          offsetCm: 200,
          widthCm: 100,
          heightCm: 100,
          sillHeightCm: 90,
        },
      ],
    });
    const built = buildRoomInstance(instance);
    try {
      built.group.updateMatrixWorld(true);
      const east = built.group.getObjectByName('room-wall-east') as THREE.Mesh;
      const west = built.group.getObjectByName('room-wall-west') as THREE.Mesh;
      const door = built.plan.openings.find((entry) => entry.id === 'east-door');
      const window = built.plan.openings.find((entry) => entry.id === 'west-window');
      expect(door).toBeDefined();
      expect(window).toBeDefined();
      if (!door || !window) return;
      expect(door.center).toEqual([202, 100, -105]);
      expect(window.center).toEqual([-202, 140, 0]);
      expect(door.bounds).toEqual({
        min: [200, 0, -150],
        max: [204, 200, -60],
      });

      expect(
        rayHits(east, [door.center[0] + 100, door.center[1], door.center[2]], [-1, 0, 0]),
      ).toBe(0);
      expect(
        rayHits(west, [window.center[0] - 100, window.center[1], window.center[2]], [1, 0, 0]),
      ).toBe(0);
      expect(rayHits(east, [300, 100, 0], [-1, 0, 0])).toBeGreaterThan(0);
    } finally {
      built.dispose();
    }
  });

  it('builds door/window components and applies slot material assignments', () => {
    const instance = {
      ...openingRoom(),
      materialAssignments: {
        'door-leaf': { baseColor: '#123456' },
        'window-glass': { opacity: 0.25 },
      },
    };
    const built = buildRoomInstance(instance);
    try {
      built.group.updateMatrixWorld(true);
      expect(meshNames(built.group)).toHaveLength(16);
      expect(meshNames(built.group)).toContain('door-1-door-frame-left');
      expect(meshNames(built.group)).toContain('door-1-door-leaf');
      expect(meshNames(built.group)).toContain('door-1-door-handle');
      expect(meshNames(built.group)).toContain('window-1-window-frame-left');
      expect(meshNames(built.group)).toContain('window-1-window-glass-1-1');
      expect(meshNames(built.group)).toContain('window-1-window-sill');

      const leaf = built.group.getObjectByName('door-1-door-leaf') as THREE.Mesh;
      const leafMaterial = leaf.material as THREE.MeshStandardMaterial;
      expect(leafMaterial.color.getHexString()).toBe('123456');
      expect(leaf.geometry.getAttribute('uv')).toBeDefined();
      expect(leaf.geometry.getAttribute('normal')).toBeDefined();
      expect(zeroAreaTriangles(leaf)).toBe(0);

      const glass = built.group.getObjectByName(
        'window-1-window-glass-1-1',
      ) as THREE.Mesh;
      const glassMaterial = glass.material as THREE.MeshStandardMaterial;
      expect(glassMaterial.opacity).toBe(0.25);
      expect(glassMaterial.transparent).toBe(true);
      expect(glass.geometry.getAttribute('uv')).toBeDefined();
      expect(glass.geometry.getAttribute('normal')).toBeDefined();

      const door = built.plan.openings.find((entry) => entry.type === 'door');
      expect(door?.door?.framePartIds).toHaveLength(3);
      expect(door?.door?.hingePositions).toHaveLength(3);
      if (door) {
        const leafBounds = new THREE.Box3().setFromObject(leaf);
        expect(leafBounds.min.x).toBeGreaterThanOrEqual(door.bounds.min[0] - 1e-6);
        expect(leafBounds.max.x).toBeLessThanOrEqual(door.bounds.max[0] + 1e-6);
        expect(leafBounds.min.y).toBeGreaterThanOrEqual(door.bounds.min[1] - 1e-6);
        expect(leafBounds.max.y).toBeLessThanOrEqual(door.bounds.max[1] + 1e-6);
      }
    } finally {
      built.dispose();
    }
  });

  it('keeps door and window components inside their opening bounds', () => {
    const built = buildRoomInstance(openingRoom());
    try {
      built.group.updateMatrixWorld(true);
      for (const opening of built.plan.openings) {
        const ids =
          opening.type === 'door'
            ? [...(opening.door?.framePartIds ?? []), opening.door?.leafPartId ?? '']
            : [
                ...(opening.window?.framePartIds ?? []),
                ...(opening.window?.glassPartIds ?? []),
              ];
        for (const id of ids) {
          const mesh = built.group.getObjectByName(id) as THREE.Mesh;
          expect(mesh, id).toBeDefined();
          const box = new THREE.Box3().setFromObject(mesh);
          expect(box.min.x, id).toBeGreaterThanOrEqual(opening.bounds.min[0] - 1e-6);
          expect(box.max.x, id).toBeLessThanOrEqual(opening.bounds.max[0] + 1e-6);
          expect(box.min.y, id).toBeGreaterThanOrEqual(opening.bounds.min[1] - 1e-6);
          expect(box.max.y, id).toBeLessThanOrEqual(opening.bounds.max[1] + 1e-6);
          expect(box.min.z, id).toBeGreaterThanOrEqual(opening.bounds.min[2] - 1e-6);
          expect(box.max.z, id).toBeLessThanOrEqual(opening.bounds.max[2] + 1e-6);
        }
        if (opening.type === 'window') {
          const sill = built.group.getObjectByName(
            opening.window?.sillPartId ?? '',
          ) as THREE.Mesh;
          const box = new THREE.Box3().setFromObject(sill);
          expect(box.min.y).toBeGreaterThanOrEqual(opening.bounds.min[1] - 1e-6);
          expect(box.max.y).toBeLessThanOrEqual(opening.bounds.max[1] + 1e-6);
        }
      }
    } finally {
      built.dispose();
    }
  });

  it('builds six meshes when the ceiling is enabled', () => {
    const built = buildRoomInstance(room('with-ceiling', { spec: { ...DEFAULT_ROOM_SPEC, showCeiling: true } }));
    try {
      expect(meshNames(built.group)).toHaveLength(6);
      const ceiling = built.group.getObjectByName('room-ceiling') as THREE.Mesh;
      expect(ceiling).toBeDefined();
      const size = meshSize(ceiling);
      expect(size.x).toBeCloseTo(408, 5);
      expect(size.z).toBeCloseTo(508, 5);
      expect(ceiling.position.y).toBeCloseTo(282, 5);
    } finally {
      built.dispose();
    }
  });

  it('applies position, rotation, scale and visibility through the scene helper', () => {
    const built = buildRoomInstance(
      room('transformed', {
        position: { x: 100, y: 10, z: -50 },
        rotation: { x: 0, y: 90, z: 0 },
        scale: { x: 2, y: 1, z: 1 },
        visible: false,
      }),
    );
    try {
      expect(built.group.position.toArray()).toEqual([100, 10, -50]);
      expect(built.group.rotation.y).toBeCloseTo(Math.PI / 2, 6);
      expect(built.group.scale.toArray()).toEqual([2, 1, 1]);
      expect(built.group.visible).toBe(false);
    } finally {
      built.dispose();
    }
  });

  it('applies a per-slot material assignment through the generic builder', () => {
    const built = buildRoomInstance(
      room('material-room', {
        materialAssignments: { floor: { baseColor: '#123456' } },
      }),
    );
    try {
      const floor = built.group.getObjectByName('room-floor') as THREE.Mesh;
      const material = floor.material as THREE.MeshStandardMaterial;
      expect(material.color.getHexString()).toBe('123456');
    } finally {
      built.dispose();
    }
  });

  it('disposes the built geometry', () => {
    const built = buildRoomInstance(room());
    built.dispose();
    expect(built.group.children).toHaveLength(0);
  });

  it('returns typed issues and throws a typed error for invalid input', () => {
    const invalid = { ...room(), spec: { widthCm: Number.NaN } };
    const result = tryBuildRoomInstance(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((entry) => entry.code === 'invalid_spec')).toBe(true);
    }
    expect(() => buildRoomInstance(invalid)).toThrowError(
      expect.objectContaining({ code: 'invalid_room_instance' }),
    );
    expect(() =>
      buildRoomInstance({ ...room(), definitionId: 'room.missing' }),
    ).toThrowError(expect.objectContaining({ code: 'invalid_room_instance' }));
  });

  it('exposes a typed RoomInstanceError', () => {
    expect(new RoomInstanceError('invalid_plan', 'x')).toMatchObject({
      name: 'RoomInstanceError',
      code: 'invalid_plan',
    });
  });
});

describe('RoomInstance scene JSON and legacy compatibility', () => {
  it('keeps rooms absent for an old scene and accepts an explicit empty list', () => {
    const oldScene = scene();
    const oldResult = validateSceneData(oldScene);
    expect(oldResult.scene?.rooms).toBeUndefined();
    expect(oldResult.droppedRooms).toBeUndefined();
    expect(
      serializeSceneToJson(oldScene, EXPORT_METADATA, EXPORT_TIME),
    ).not.toContain('"rooms"');

    const emptyResult = validateSceneData({ ...oldScene, rooms: [] });
    expect(emptyResult.scene?.rooms).toEqual([]);
    expect(emptyResult.droppedRooms).toBe(0);
  });

  it('round-trips one and multiple room instances without persisting a plan', () => {
    const rooms = [
      room('room-a', {
        materialAssignments: { floor: { materialId: 'wood-walnut', baseColor: '#123456' } },
      }),
      room('room-b'),
    ];
    const json = serializeSceneToJson(scene([], rooms), EXPORT_METADATA, EXPORT_TIME);
    expect(json).toContain('"rooms"');
    expect(json).not.toContain('room-assembly');
    expect(json).not.toContain('"parts"');

    const parsed = parseSceneJson(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.droppedRooms).toBe(0);
    expect(parsed.scene.rooms?.map((entry) => entry.id)).toEqual(['room-a', 'room-b']);
    expect(parsed.scene.rooms?.[0].spec).toEqual(DEFAULT_ROOM_SPEC);
    expect(parsed.scene.rooms?.[0].materialAssignments?.floor).toEqual({
      materialId: 'wood-walnut',
      baseColor: '#123456',
    });
  });

  it('round-trips room opening parameters through scene JSON', () => {
    const data = scene([], [openingRoom()]);
    const json = serializeSceneToJson(data, EXPORT_METADATA, EXPORT_TIME);
    const parsed = parseSceneJson(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.scene.rooms?.[0].spec.openings).toEqual(
      openingRoom().spec.openings,
    );
    expect(parsed.scene.rooms?.[0].spec.openings).toHaveLength(2);
  });

  it('round-trips door and window component configs through scene JSON', () => {
    const doorConfig = {
      frameWidthCm: 6,
      frameDepthCm: 4,
      leafThicknessCm: 4,
      leafInsetCm: 0.5,
      hingeSide: 'right' as const,
      swingDirection: 'outward' as const,
      swingAngleDeg: 45,
      handleHeightCm: 110,
    };
    const windowConfig = {
      frameWidthCm: 6,
      frameDepthCm: 4,
      glassThicknessCm: 1,
      sillThicknessCm: 4,
      mullionCount: 1,
      transomCount: 1,
    };
    const configured = createRoomInstance(ROOM_STANDARD_DEFINITION_ID, 'configured', {
      ...DEFAULT_ROOM_SPEC,
      openings: [
        {
          id: 'door-cfg',
          type: 'door',
          wallId: 'north',
          offsetCm: 100,
          widthCm: 90,
          heightCm: 200,
          sillHeightCm: 0,
          door: doorConfig,
        },
        {
          id: 'window-cfg',
          type: 'window',
          wallId: 'north',
          offsetCm: 250,
          widthCm: 100,
          heightCm: 100,
          sillHeightCm: 90,
          window: windowConfig,
        },
      ],
    });
    const parsed = parseSceneJson(
      serializeSceneToJson(scene([], [configured]), EXPORT_METADATA, EXPORT_TIME),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const openings = parsed.scene.rooms?.[0].spec.openings;
    expect(openings?.[0].door).toEqual(doorConfig);
    expect(openings?.[1].window).toEqual(windowConfig);
  });

  it('drops invalid, unknown, duplicate and over-limit rooms during scene validation', () => {
    const invalidSpec = validateSceneData(
      scene([], [
        { ...room('bad-spec'), spec: { ...DEFAULT_ROOM_SPEC, widthCm: Number.NaN } },
      ]),
    );
    expect(invalidSpec.scene?.rooms).toEqual([]);
    expect(invalidSpec.droppedRooms).toBe(1);

    const unknown = validateSceneData(
      scene([], [{ ...room('bad-definition'), definitionId: 'room.missing' }]),
    );
    expect(unknown.scene?.rooms).toEqual([]);
    expect(unknown.droppedRooms).toBe(1);

    const duplicate = validateSceneData(scene([], [room('same'), room('same')]));
    expect(duplicate.scene?.rooms).toHaveLength(1);
    expect(duplicate.droppedRooms).toBe(1);

    const overLimit = validateSceneData(
      scene(
        [],
        Array.from({ length: MAX_ROOMS_PER_SCENE + 1 }, (_, index) =>
          room(`limited-${index}`),
        ),
      ),
    );
    expect(overLimit.scene?.rooms).toHaveLength(MAX_ROOMS_PER_SCENE);
    expect(overLimit.droppedRooms).toBe(1);
  });

  it('rejects invalid rooms arrays and invalid transforms', () => {
    const notArray = validateSceneData({
      ...scene(),
      rooms: 'not-a-list' as never,
    });
    expect(notArray.scene?.rooms).toEqual([]);
    expect(notArray.droppedRooms).toBe(1);

    const badTransform = validateSceneData(
      scene([], [{ ...room('bad-transform'), position: { x: 99999, y: 0, z: 0 } }]),
    );
    expect(badTransform.scene?.rooms).toEqual([]);
    expect(badTransform.droppedRooms).toBe(1);
  });

  it('keeps legacy room and opt-in rooms independent in one scene', () => {
    const legacyObject = createTableSceneObject('table-1');
    const newRoom = room('new-room');
    const data = scene([legacyObject], [newRoom]);

    const validated = validateSceneData(data);
    expect(validated.scene?.room).toEqual({ ...ROOM_DEFAULTS });
    expect(validated.scene?.rooms?.map((entry) => entry.id)).toEqual(['new-room']);
    expect(validated.scene?.objects.map((entry) => entry.id)).toEqual(['table-1']);

    const legacyBuilt = buildRoom(validated.scene!.room);
    const newBuilt = buildRoomInstance(validated.scene!.rooms![0]);
    try {
      expect(legacyBuilt.group.name).toBe('room');
      expect(newBuilt.group.name).toBe('room:new-room');
      expect(legacyBuilt.group.name).not.toBe(newBuilt.group.name);
    } finally {
      legacyBuilt.dispose();
      newBuilt.dispose();
    }
  });
});
