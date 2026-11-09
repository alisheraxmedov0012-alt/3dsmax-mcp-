import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildSceneObject } from '../scene/buildSceneObject';
import { createRoomInstance } from '../scene/roomInstance';
import { buildRoomEntry, type BuiltRoomEntry } from '../scene/roomScene';
import { createTableSceneObject, type RoomInstance } from '../scene/types';
import { ROOM_STANDARD_DEFINITION_ID } from '../geometry/interior/roomDefinition';
import { DEFAULT_ROOM_SPEC } from '../geometry/interior/roomSpec';
import { computeObjectFraming, isValidBounds } from '../render/framing';
import { mergeBounds, objectBounds } from './sceneBounds';

function room(id: string, overrides: Partial<RoomInstance> = {}): RoomInstance {
  return {
    ...createRoomInstance(ROOM_STANDARD_DEFINITION_ID, id, {
      ...DEFAULT_ROOM_SPEC,
      showCeiling: false,
    }),
    ...overrides,
  };
}

function builtRoom(id: string, overrides: Partial<RoomInstance> = {}): BuiltRoomEntry {
  const result = buildRoomEntry(room(id, overrides));
  if (!result.ok) {
    throw new Error(result.issues.map((issue) => issue.message).join(' '));
  }
  return result.entry;
}

describe('9A.2.7 — viewer scene bounds', () => {
  it('measures a room-only scene including wall thickness', () => {
    const entry = builtRoom('room-a');
    try {
      const bounds = objectBounds(entry.group);
      expect(bounds).not.toBeNull();
      if (!bounds) return;
      expect(bounds.min.x).toBeCloseTo(-204, 5);
      expect(bounds.max.x).toBeCloseTo(204, 5);
      expect(bounds.min.z).toBeCloseTo(-254, 5);
      expect(bounds.max.z).toBeCloseTo(254, 5);
      expect(bounds.min.y).toBeCloseTo(-4, 5);
      expect(bounds.max.y).toBeCloseTo(280, 5);
    } finally {
      entry.dispose();
    }
  });

  it('includes the ceiling slab when it exists', () => {
    const entry = builtRoom('room-ceiling', {
      spec: { ...DEFAULT_ROOM_SPEC, showCeiling: true },
    });
    try {
      const bounds = objectBounds(entry.group);
      expect(bounds).not.toBeNull();
      if (!bounds) return;
      expect(bounds.max.y).toBeCloseTo(284, 5);
    } finally {
      entry.dispose();
    }
  });

  it('excludes a hidden room from framing bounds', () => {
    const entry = builtRoom('room-hidden', { visible: false });
    try {
      expect(objectBounds(entry.group)).toBeNull();
      expect(objectBounds(entry.group, true)).not.toBeNull();
    } finally {
      entry.dispose();
    }
  });

  it('merges several rooms into one bounds box', () => {
    const first = builtRoom('room-a');
    const second = builtRoom('room-b', { position: { x: 800, y: 0, z: 0 } });
    try {
      const bounds = mergeBounds([objectBounds(first.group), objectBounds(second.group)]);
      expect(bounds).not.toBeNull();
      if (!bounds) return;
      expect(bounds.min.x).toBeCloseTo(-204, 5);
      expect(bounds.max.x).toBeCloseTo(1004, 5);
      expect(bounds.min.z).toBeCloseTo(-254, 5);
      expect(bounds.max.z).toBeCloseTo(254, 5);
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  it('merges furniture and room bounds in a mixed scene', () => {
    const entry = builtRoom('room-a');
    const table = buildSceneObject(
      createTableSceneObject('t1', { position: { x: 600, y: 0, z: 0 } }),
    );
    try {
      const bounds = mergeBounds([objectBounds(entry.group), objectBounds(table.group)]);
      expect(bounds).not.toBeNull();
      if (!bounds) return;
      // The table sits outside the room; the union must reach it.
      expect(bounds.max.x).toBeGreaterThan(600);
    } finally {
      entry.dispose();
      table.dispose();
    }
  });

  it('returns null for empty and invalid input without throwing', () => {
    expect(mergeBounds([])).toBeNull();
    expect(mergeBounds([null, undefined])).toBeNull();
    const empty = new THREE.Group();
    expect(objectBounds(empty)).toBeNull();
    expect(
      mergeBounds([
        { min: { x: 0, y: 0, z: 0 }, max: { x: Number.NaN, y: 1, z: 1 } },
        { min: { x: 0, y: 0, z: 0 }, max: { x: 0.5, y: 0.5, z: 0.5 } },
      ]),
    ).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 0.5, y: 0.5, z: 0.5 } });
  });

  it('frames room-only and mixed scenes with finite camera data', () => {
    const entry = builtRoom('room-a');
    const table = buildSceneObject(createTableSceneObject('t1'));
    try {
      const roomBounds = objectBounds(entry.group);
      const mixed = mergeBounds([roomBounds, objectBounds(table.group)]);
      for (const bounds of [roomBounds, mixed]) {
        expect(bounds && isValidBounds(bounds)).toBe(true);
        const framing = computeObjectFraming(bounds, 'iso', 16 / 9);
        expect(Number.isFinite(framing.position.x)).toBe(true);
        expect(Number.isFinite(framing.position.y)).toBe(true);
        expect(Number.isFinite(framing.position.z)).toBe(true);
        expect(framing.distance).toBeGreaterThan(framing.radius);
        expect(framing.far).toBeGreaterThan(framing.distance);
        expect(framing.target.x).toBeCloseTo(0, 5);
      }
    } finally {
      entry.dispose();
      table.dispose();
    }
  });

  it('keeps framing valid when the ceiling is off', () => {
    const entry = builtRoom('room-no-ceiling', { spec: { ...DEFAULT_ROOM_SPEC } });
    try {
      const bounds = objectBounds(entry.group);
      expect(bounds && isValidBounds(bounds)).toBe(true);
      const framing = computeObjectFraming(bounds, 'product', 1);
      expect(framing.target.y).toBeCloseTo(138, 5);
      expect(framing.near).toBeGreaterThan(0);
    } finally {
      entry.dispose();
    }
  });
});
