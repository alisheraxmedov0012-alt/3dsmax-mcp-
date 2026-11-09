import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { parseSceneJson, serializeSceneToJson } from '../export/sceneJson';
import { ROOM_STANDARD_DEFINITION_ID } from '../geometry/interior/roomDefinition';
import { DEFAULT_ROOM_SPEC } from '../geometry/interior/roomSpec';
import { createRoomInstance, roomInstanceGeometryKey } from './roomInstance';
import { buildRoomEntry } from './roomScene';
import { sceneReducer } from './sceneReducer';
import {
  OBJECT_LIMITS,
  createDefaultSceneState,
  type RoomInstance,
  type SceneState,
} from './types';
import { roomSelectionId } from '../viewer/selection';

const EXPORT_METADATA = { name: 'Rooms', furnitureType: null, units: 'cm' as const };
const EXPORT_TIME = '2026-01-01T00:00:00.000Z';

function room(id: string, overrides: Partial<RoomInstance> = {}): RoomInstance {
  return {
    ...createRoomInstance(ROOM_STANDARD_DEFINITION_ID, id, {
      ...DEFAULT_ROOM_SPEC,
      showCeiling: false,
    }),
    ...overrides,
  };
}

function stateWithRooms(rooms: RoomInstance[]): SceneState {
  const base = createDefaultSceneState(() => 'object-1');
  return {
    data: { ...base.data, objects: [], rooms },
    selectedId: roomSelectionId(rooms[0]?.id ?? 'room-a'),
  };
}

describe('9A.2.9 — room transform persistence', () => {
  it('updates position, rotation and scale for the matching room only', () => {
    const first = room('room-a');
    const second = room('room-b', { position: { x: 700, y: 0, z: 0 } });
    const before = stateWithRooms([first, second]);
    const after = sceneReducer(before, {
      type: 'UPDATE_ROOM_TRANSFORM',
      id: 'room-a',
      position: { x: 120, y: 5, z: -40 },
      rotation: { x: 0, y: 30, z: 0 },
      scale: { x: 2, y: 1, z: 1.5 },
    });

    expect(after.data.rooms?.[0].position).toEqual({ x: 120, y: 5, z: -40 });
    expect(after.data.rooms?.[0].rotation).toEqual({ x: 0, y: 30, z: 0 });
    expect(after.data.rooms?.[0].scale).toEqual({ x: 2, y: 1, z: 1.5 });
    expect(after.data.rooms?.[1]).toBe(second);
    expect(after.selectedId).toBe(before.selectedId);
    expect(before.data.rooms?.[0].position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('normalizes a negative gizmo angle and clamps scale to the shared limits', () => {
    const before = stateWithRooms([room('room-a')]);
    const after = sceneReducer(before, {
      type: 'UPDATE_ROOM_TRANSFORM',
      id: 'room-a',
      rotation: { y: -45 },
      scale: { x: 0, y: -2, z: 25 },
      position: { x: 9000, y: -9000, z: 0 },
    });
    const updated = after.data.rooms?.[0];
    expect(updated?.rotation.y).toBe(315);
    expect(updated?.scale).toEqual({
      x: OBJECT_LIMITS.scale.min,
      y: OBJECT_LIMITS.scale.min,
      z: OBJECT_LIMITS.scale.max,
    });
    expect(updated?.position).toEqual({
      x: OBJECT_LIMITS.position.max,
      y: OBJECT_LIMITS.position.min,
      z: 0,
    });
  });

  it('ignores an unknown room without changing state identity', () => {
    const before = stateWithRooms([room('room-a')]);
    const after = sceneReducer(before, {
      type: 'UPDATE_ROOM_TRANSFORM',
      id: 'room-missing',
      position: { x: 100 },
    });
    expect(after).toBe(before);
  });

  it('does not touch the spec undo history', () => {
    const before = stateWithRooms([room('room-a')]);
    const withHistory: SceneState = {
      ...before,
      history: { past: [], future: [] },
    };
    const after = sceneReducer(withHistory, {
      type: 'UPDATE_ROOM_TRANSFORM',
      id: 'room-a',
      position: { x: 10 },
    });
    expect(after.history).toBe(withHistory.history);
    expect(after.history?.past).toHaveLength(0);
  });

  it('keeps the geometry key stable while the transform changes', () => {
    const before = room('room-a');
    const after = { ...before, position: { x: 100, y: 0, z: 0 }, scale: { x: 2, y: 2, z: 2 } };
    expect(roomInstanceGeometryKey(after)).toBe(roomInstanceGeometryKey(before));
  });

  it('re-applies the stored transform when the room is rebuilt', () => {
    const stored = room('room-a', {
      position: { x: 120, y: 5, z: -40 },
      rotation: { x: 0, y: 30, z: 0 },
      scale: { x: 2, y: 1, z: 1.5 },
    });
    const built = buildRoomEntry(stored);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    try {
      expect(built.entry.group.position.toArray()).toEqual([120, 5, -40]);
      expect(built.entry.group.rotation.y).toBeCloseTo(THREE.MathUtils.degToRad(30), 6);
      expect(built.entry.group.scale.toArray()).toEqual([2, 1, 1.5]);
    } finally {
      built.entry.dispose();
    }
  });

  it('round-trips the transform through scene JSON', () => {
    const transformed = room('room-a', {
      position: { x: 120, y: 5, z: -40 },
      rotation: { x: 0, y: 315, z: 0 },
      scale: { x: 2, y: 1, z: 1.5 },
    });
    const state = stateWithRooms([transformed]);
    const parsed = parseSceneJson(
      serializeSceneToJson(state.data, EXPORT_METADATA, EXPORT_TIME),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.scene.rooms?.[0].position).toEqual(transformed.position);
    expect(parsed.scene.rooms?.[0].rotation).toEqual(transformed.rotation);
    expect(parsed.scene.rooms?.[0].scale).toEqual(transformed.scale);
  });
});
