import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildRoom, ROOM_FLOOR_THICKNESS_CM } from './buildRoom';
import type { RoomConfig } from '../scene/types';

const room: RoomConfig = { widthCm: 400, lengthCm: 500, heightCm: 280 };

function sizeOf(object: THREE.Object3D): THREE.Vector3 {
  object.updateMatrixWorld(true);
  const size = new THREE.Vector3();
  new THREE.Box3().setFromObject(object).getSize(size);
  return size;
}

describe('buildRoom', () => {
  it('creates a floor and four walls', () => {
    const { group, dispose } = buildRoom(room);

    expect(group.getObjectByName('room-floor')).toBeDefined();
    const walls = group.children.filter((child) => child.name.startsWith('room-wall-'));
    expect(walls).toHaveLength(4);

    dispose();
  });

  it('scales the floor to the configured width and length', () => {
    const { group, dispose } = buildRoom(room);
    const floor = group.getObjectByName('room-floor')!;
    const size = sizeOf(floor);

    expect(size.x).toBeCloseTo(room.widthCm, 5);
    expect(size.z).toBeCloseTo(room.lengthCm, 5);
    expect(size.y).toBeCloseTo(ROOM_FLOOR_THICKNESS_CM, 5);

    dispose();
  });

  it('scales the walls to the configured height', () => {
    const { group, dispose } = buildRoom(room);
    const wall = group.getObjectByName('room-wall-north')!;
    const size = sizeOf(wall);

    expect(size.y).toBeCloseTo(room.heightCm, 5);

    dispose();
  });

  it('rests the floor top on the Y = 0 plane', () => {
    const { group, dispose } = buildRoom(room);
    group.updateMatrixWorld(true);
    const floor = group.getObjectByName('room-floor')!;
    const box = new THREE.Box3().setFromObject(floor);

    expect(box.max.y).toBeCloseTo(0, 5);
    expect(box.min.y).toBeCloseTo(-ROOM_FLOOR_THICKNESS_CM, 5);

    dispose();
  });

  it('positions walls outside the configured dimensions', () => {
    const { group, dispose } = buildRoom(room);
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);

    // Walls sit just outside the half-extents, so the total span is slightly
    // larger than the configured dimensions.
    expect(box.max.x).toBeGreaterThan(room.widthCm / 2);
    expect(box.min.x).toBeLessThan(-room.widthCm / 2);
    expect(box.max.y).toBeCloseTo(room.heightCm, 5);

    dispose();
  });

  it('uses lightweight geometry (roughly six boxes)', () => {
    const { group, dispose } = buildRoom(room);
    let triangles = 0;
    group.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const geometry = (child as THREE.Mesh).geometry;
        const index = geometry.getIndex();
        const position = geometry.getAttribute('position');
        const count = index ? index.count : position ? position.count : 0;
        triangles += count / 3;
      }
    });
    // 6 boxes × 12 triangles = 72.
    expect(triangles).toBeLessThanOrEqual(100);

    dispose();
  });
});
