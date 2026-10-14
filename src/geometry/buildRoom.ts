import * as THREE from 'three';
import type { RoomConfig } from '../scene/types';

export const ROOM_WALL_THICKNESS_CM = 4;
export const ROOM_FLOOR_THICKNESS_CM = 4;

export interface BuiltRoom {
  group: THREE.Group;
  dispose: () => void;
}

/**
 * Builds procedural room geometry from a room configuration: one floor slab and
 * four walls, as separate meshes inside a group.
 *
 * Coordinate convention: the floor's top surface is the Y = 0 plane (objects
 * stand on it), the room is centred on the X/Z origin, and walls rise to
 * `heightCm`. Kept in the geometry layer (no renderer) so it is testable
 * without a browser.
 */
export function buildRoom(room: RoomConfig): BuiltRoom {
  const { widthCm, lengthCm, heightCm } = room;

  const group = new THREE.Group();
  group.name = 'room';

  const floorMaterial = new THREE.MeshStandardMaterial({
    color: '#3b3f45',
    roughness: 0.95,
    metalness: 0,
  });
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: '#565d66',
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  const geometries: THREE.BufferGeometry[] = [];
  const materials = [floorMaterial, wallMaterial];

  const floorGeometry = new THREE.BoxGeometry(widthCm, ROOM_FLOOR_THICKNESS_CM, lengthCm);
  geometries.push(floorGeometry);
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.name = 'room-floor';
  floor.position.y = -ROOM_FLOOR_THICKNESS_CM / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const t = ROOM_WALL_THICKNESS_CM;
  const halfW = widthCm / 2;
  const halfL = lengthCm / 2;

  // Walls are thin boxes placed just outside the room boundary so the inner
  // faces align with the configured dimensions.
  const walls: Array<{ name: string; size: [number, number, number]; position: [number, number, number] }> = [
    { name: 'room-wall-north', size: [widthCm + t, heightCm, t], position: [0, heightCm / 2, -halfL - t / 2] },
    { name: 'room-wall-south', size: [widthCm + t, heightCm, t], position: [0, heightCm / 2, halfL + t / 2] },
    { name: 'room-wall-east', size: [t, heightCm, lengthCm + t], position: [halfW + t / 2, heightCm / 2, 0] },
    { name: 'room-wall-west', size: [t, heightCm, lengthCm + t], position: [-halfW - t / 2, heightCm / 2, 0] },
  ];

  walls.forEach(({ name, size, position }) => {
    const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
    geometries.push(geometry);
    const wall = new THREE.Mesh(geometry, wallMaterial);
    wall.name = name;
    wall.position.set(position[0], position[1], position[2]);
    wall.receiveShadow = true;
    group.add(wall);
  });

  return {
    group,
    dispose: () => {
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
    },
  };
}
