import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildSceneObject } from './buildSceneObject';
import { createRoomInstance, roomInstanceGeometryKey } from './roomInstance';
import {
  buildRoomEntry,
  buildSceneRooms,
  disposeRoomEntries,
  includeLegacyRoom,
} from './roomScene';
import { ROOM_STANDARD_DEFINITION_ID } from '../geometry/interior/roomDefinition';
import { DEFAULT_ROOM_SPEC } from '../geometry/interior/roomSpec';
import { createTableSceneObject, type RoomInstance } from './types';

function room(id: string, overrides: Partial<RoomInstance> = {}): RoomInstance {
  return {
    ...createRoomInstance(ROOM_STANDARD_DEFINITION_ID, id, {
      ...DEFAULT_ROOM_SPEC,
      showCeiling: true,
      trim: { baseboard: { enabled: true }, crownMolding: { enabled: true } },
    }),
    ...overrides,
  };
}

function meshNames(group: THREE.Object3D): string[] {
  const names: string[] = [];
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      names.push(object.name);
    }
  });
  return names;
}

describe('9A.2.7 — shared room scene assembly', () => {
  it('builds one room with floor, walls, ceiling, openings and trim', () => {
    const result = buildRoomEntry(
      createRoomInstance(ROOM_STANDARD_DEFINITION_ID, 'room-a', {
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
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    try {
      expect(result.entry.group.name).toBe('room:room-a');
      expect(result.entry.group.userData.roomInstanceId).toBe('room-a');
      const names = meshNames(result.entry.group);
      expect(names).toContain('room-floor');
      expect(names).toContain('room-ceiling');
      expect(names.filter((name) => name.startsWith('room-wall-'))).toHaveLength(4);
      expect(names).toContain('door-1-door-leaf');
      expect(names).toContain('window-1-window-glass-1-1');
      expect(names.some((name) => name.startsWith('room-baseboard-'))).toBe(true);
      expect(names.some((name) => name.startsWith('room-crown-molding-'))).toBe(true);
    } finally {
      result.entry.dispose();
    }
  });

  it('builds several rooms in one scene', () => {
    const built = buildSceneRooms([
      room('room-a', { position: { x: 0, y: 0, z: 0 } }),
      room('room-b', { position: { x: 800, y: 0, z: 0 } }),
    ]);
    try {
      expect(built.issues).toEqual([]);
      expect(built.entries.map((entry) => entry.roomId)).toEqual(['room-a', 'room-b']);
      const scene = new THREE.Scene();
      for (const entry of built.entries) {
        scene.add(entry.group);
      }
      expect(scene.getObjectByName('room:room-a')).toBeDefined();
      expect(scene.getObjectByName('room:room-b')).toBeDefined();
      expect(scene.getObjectByName('room:room-b')?.position.x).toBe(800);
    } finally {
      disposeRoomEntries(built.entries);
    }
  });

  it('applies position, rotation, scale and visibility', () => {
    const result = buildRoomEntry(
      room('room-t', {
        position: { x: 120, y: 10, z: -40 },
        rotation: { x: 0, y: 45, z: 0 },
        scale: { x: 2, y: 1, z: 1.5 },
        visible: false,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    try {
      expect(result.entry.group.position.toArray()).toEqual([120, 10, -40]);
      expect(result.entry.group.rotation.y).toBeCloseTo(Math.PI / 4, 6);
      expect(result.entry.group.scale.toArray()).toEqual([2, 1, 1.5]);
      expect(result.entry.group.visible).toBe(false);
    } finally {
      result.entry.dispose();
    }
  });

  it('skips an invalid room and keeps the valid ones', () => {
    const invalid = { ...room('room-bad'), definitionId: 'room.missing' } as RoomInstance;
    const built = buildSceneRooms([invalid, room('room-good')]);
    try {
      expect(built.entries.map((entry) => entry.roomId)).toEqual(['room-good']);
      expect(built.issues.length).toBeGreaterThan(0);
      expect(built.issues[0]?.code).toBe('unknown_definition');
    } finally {
      disposeRoomEntries(built.entries);
    }
  });

  it('returns no entries and no issues for an absent room list', () => {
    expect(buildSceneRooms(undefined)).toEqual({ entries: [], issues: [] });
    expect(buildSceneRooms([])).toEqual({ entries: [], issues: [] });
  });

  it('keeps furniture and room geometry in the same scene', () => {
    const built = buildRoomEntry(room('room-a'));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const furniture = buildSceneObject(createTableSceneObject('t1'));
    const scene = new THREE.Scene();
    scene.add(built.entry.group);
    scene.add(furniture.group);
    try {
      expect(scene.getObjectByName('room:room-a')).toBeDefined();
      expect(scene.getObjectByName('object:t1')).toBeDefined();
      expect(meshNames(scene).length).toBeGreaterThan(10);
    } finally {
      built.entry.dispose();
      furniture.dispose();
    }
  });

  it('changes the geometry key only for geometry-affecting edits', () => {
    const base = room('room-a');
    const moved = { ...base, position: { x: 300, y: 0, z: 0 }, visible: false };
    const materialChanged = {
      ...base,
      materialAssignments: { floor: { materialId: 'marble' } },
    };
    expect(roomInstanceGeometryKey(moved)).toBe(roomInstanceGeometryKey(base));
    expect(roomInstanceGeometryKey(materialChanged)).not.toBe(roomInstanceGeometryKey(base));
  });

  it('lets an opt-in room supersede the legacy room', () => {
    expect(includeLegacyRoom(undefined)).toBe(true);
    expect(includeLegacyRoom([])).toBe(true);
    expect(includeLegacyRoom([room('room-a')])).toBe(false);
  });
});
