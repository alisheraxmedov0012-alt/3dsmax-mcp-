import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createRoomInstance } from '../scene/roomInstance';
import { buildRoomEntry } from '../scene/roomScene';
import { ROOM_STANDARD_DEFINITION_ID } from '../geometry/interior/roomDefinition';
import { DEFAULT_ROOM_SPEC } from '../geometry/interior/roomSpec';
import { ROOM_OBJECT_ID } from '../scene/types';
import {
  parseRoomSelectionId,
  pickSelectionFromHits,
  resolveSelectionTarget,
  roomSelectionId,
  type SceneHit,
  type SelectionGroupEntry,
} from './selection';

function room(id: string) {
  return createRoomInstance(ROOM_STANDARD_DEFINITION_ID, id, {
    ...DEFAULT_ROOM_SPEC,
    showCeiling: false,
  });
}

function builtRoom(id: string): THREE.Group {
  const built = buildRoomEntry(room(id));
  if (!built.ok) {
    throw new Error(built.issues.map((issue) => issue.message).join(' '));
  }
  return built.entry.group;
}

function objectGroup(visible = true): THREE.Group {
  const group = new THREE.Group();
  group.visible = visible;
  return group;
}

function disposeGroup(group: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  group.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      (node.geometry as THREE.BufferGeometry).dispose();
      materials.add(node.material as THREE.Material);
    }
  });
  for (const material of materials) {
    material.dispose();
  }
  group.removeFromParent();
}

describe('9A.2.9 — universal selection identity', () => {
  it('round-trips room selection ids and leaves other ids alone', () => {
    expect(roomSelectionId('room-a')).toBe('room-instance:room-a');
    expect(parseRoomSelectionId('room-instance:room-a')).toBe('room-a');
    expect(parseRoomSelectionId('room-instance:')).toBeNull();
    expect(parseRoomSelectionId('object-1')).toBeNull();
    expect(parseRoomSelectionId(null)).toBeNull();
  });

  it('resolves a room, an object, the legacy room and no selection', () => {
    const roomGroup = builtRoom('room-a');
    const object = objectGroup();
    const legacy = new THREE.Group();
    try {
      const rooms = new Map<string, SelectionGroupEntry>([['room-a', { group: roomGroup }]]);
      const objects = new Map<string, SelectionGroupEntry>([['table-1', { group: object }]]);

      const roomTarget = resolveSelectionTarget(roomSelectionId('room-a'), legacy, rooms, objects);
      expect(roomTarget).toMatchObject({
        kind: 'room',
        roomId: 'room-a',
        selectionId: 'room-instance:room-a',
      });
      expect(roomTarget?.group).toBe(roomGroup);

      expect(resolveSelectionTarget('table-1', legacy, rooms, objects)).toMatchObject({
        kind: 'object',
        objectId: 'table-1',
      });
      expect(resolveSelectionTarget(ROOM_OBJECT_ID, legacy, rooms, objects)).toMatchObject({
        kind: 'legacy-room',
      });
      expect(resolveSelectionTarget(null, legacy, rooms, objects)).toBeNull();
      expect(resolveSelectionTarget('missing', legacy, rooms, objects)).toBeNull();
    } finally {
      disposeGroup(roomGroup);
    }
  });

  it('resolves exactly one room in a multi-room scene', () => {
    const first = builtRoom('room-a');
    const second = builtRoom('room-b');
    try {
      const rooms = new Map<string, SelectionGroupEntry>([
        ['room-a', { group: first }],
        ['room-b', { group: second }],
      ]);
      const target = resolveSelectionTarget(roomSelectionId('room-b'), null, rooms, new Map());
      expect(target?.roomId).toBe('room-b');
      expect(target?.group).toBe(second);
      expect(resolveSelectionTarget(roomSelectionId('room-a'), null, rooms, new Map())?.group).toBe(
        first,
      );
    } finally {
      disposeGroup(first);
      disposeGroup(second);
    }
  });

  it('never resolves a hidden room or object', () => {
    const hiddenRoom = builtRoom('room-hidden');
    hiddenRoom.visible = false;
    const hiddenObject = objectGroup(false);
    const rooms = new Map<string, SelectionGroupEntry>([['room-hidden', { group: hiddenRoom }]]);
    const objects = new Map<string, SelectionGroupEntry>([['hidden-object', { group: hiddenObject }]]);

    try {
      expect(resolveSelectionTarget(roomSelectionId('room-hidden'), null, rooms, objects)).toBeNull();
      expect(resolveSelectionTarget('hidden-object', null, rooms, objects)).toBeNull();
    } finally {
      disposeGroup(hiddenRoom);
    }
  });

  it('picks the nearest room and the nearest object', () => {
    const roomHit: SceneHit = {
      selectionId: roomSelectionId('room-a'),
      kind: 'room',
      distance: 300,
    };
    expect(pickSelectionFromHits([roomHit])).toBe(roomSelectionId('room-a'));

    const objectHit: SceneHit = { selectionId: 'table-1', kind: 'object', distance: 100 };
    expect(pickSelectionFromHits([objectHit, roomHit])).toBe('table-1');
    expect(pickSelectionFromHits([])).toBeNull();
  });

  it('prefers furniture on a near tie but not through a wall', () => {
    const roomHit: SceneHit = {
      selectionId: roomSelectionId('room-a'),
      kind: 'room',
      distance: 200,
    };
    const furnitureTie: SceneHit = { selectionId: 'table-1', kind: 'object', distance: 200.3 };
    expect(pickSelectionFromHits([roomHit, furnitureTie])).toBe('table-1');

    const furnitureBehindWall: SceneHit = {
      selectionId: 'table-1',
      kind: 'object',
      distance: 260,
    };
    expect(pickSelectionFromHits([roomHit, furnitureBehindWall])).toBe(
      roomSelectionId('room-a'),
    );
  });

  it('chooses the nearest of several rooms', () => {
    const near: SceneHit = {
      selectionId: roomSelectionId('room-near'),
      kind: 'room',
      distance: 100,
    };
    const far: SceneHit = {
      selectionId: roomSelectionId('room-far'),
      kind: 'room',
      distance: 400,
    };
    expect(pickSelectionFromHits([far, near])).toBe(roomSelectionId('room-near'));
  });

  it('creates and disposes a highlight without touching the room materials', () => {
    const group = builtRoom('room-a');
    const materials: THREE.Material[] = [];
    group.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        materials.push(node.material as THREE.Material);
      }
    });
    const before = materials.map((material) => material.uuid);
    const helper = new THREE.BoxHelper(group, 0x4f9dff);
    try {
      expect(helper.visible).toBe(true);
      expect(materials.map((material) => material.uuid)).toEqual(before);
    } finally {
      helper.removeFromParent();
      helper.geometry.dispose();
      (helper.material as THREE.Material).dispose();
    }
    expect(materials.map((material) => material.uuid)).toEqual(before);
    disposeGroup(group);
  });
});
