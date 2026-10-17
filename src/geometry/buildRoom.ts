import * as THREE from 'three';
import type { RoomConfig, RoomOpening } from '../scene/types';
import { DEFAULT_SETTINGS, type RoomMaterialSettings } from '../scene/sceneSettings';

export const ROOM_WALL_THICKNESS_CM = 4;
export const ROOM_FLOOR_THICKNESS_CM = 4;
export const ROOM_CEILING_THICKNESS_CM = 4;

export interface BuiltRoom {
  group: THREE.Group;
  dispose: () => void;
}

/** Inner-face position and orientation of a wall (for opening markers). */
function wallPlacement(
  wall: RoomOpening['wall'],
  room: RoomConfig,
): { position: [number, number, number]; sizeX: number } {
  const t = ROOM_WALL_THICKNESS_CM;
  const halfW = room.widthCm / 2;
  const halfL = room.lengthCm / 2;
  switch (wall) {
    case 'north':
      return { position: [0, 0, -halfL + t / 2], sizeX: room.widthCm };
    case 'south':
      return { position: [0, 0, halfL - t / 2], sizeX: room.widthCm };
    case 'west':
      return { position: [-halfW + t / 2, 0, 0], sizeX: room.lengthCm };
    case 'east':
    default:
      return { position: [halfW - t / 2, 0, 0], sizeX: room.lengthCm };
  }
}

/**
 * Builds procedural room geometry from a room configuration: one floor slab and
 * four walls, as separate meshes inside a group.
 *
 * Coordinate convention: the floor's top surface is the Y = 0 plane (objects
 * stand on it), the room is centred on the X/Z origin, and walls rise to
 * `heightCm`. Kept in the geometry layer (no renderer) so it is testable
 * without a browser.
 *
 * `materials` optionally overrides the floor/wall colours (Stage 6); defaults
 * preserve the Stage 5 appearance.
 */
export function buildRoom(
  room: RoomConfig,
  materials: RoomMaterialSettings = DEFAULT_SETTINGS.roomMaterials,
): BuiltRoom {
  const { widthCm, lengthCm, heightCm } = room;

  const group = new THREE.Group();
  group.name = 'room';

  const floorMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(materials.floorColor),
    roughness: 0.95,
    metalness: 0,
  });
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(materials.wallColor),
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const ceilingMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(materials.ceilingColor),
    roughness: 0.95,
    metalness: 0,
  });
  // Marker material for door/window positions (thin frames, not real holes).
  const openingMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#8a939c'),
    roughness: 0.6,
    metalness: 0.1,
  });

  const geometries: THREE.BufferGeometry[] = [];
  const materialList = [floorMaterial, wallMaterial, ceilingMaterial, openingMaterial];

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

  // Optional ceiling slab.
  if (room.showCeiling) {
    const ceilingGeometry = new THREE.BoxGeometry(
      widthCm + 2 * t,
      ROOM_CEILING_THICKNESS_CM,
      lengthCm + 2 * t,
    );
    geometries.push(ceilingGeometry);
    const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
    ceiling.name = 'room-ceiling';
    ceiling.position.y = heightCm + ROOM_CEILING_THICKNESS_CM / 2;
    ceiling.receiveShadow = true;
    group.add(ceiling);
  }

  // Door/window positions are shown as thin frame markers on the wall. They are
  // descriptive only — no geometry is cut out of the wall (documented).
  (room.openings ?? []).forEach((opening, index) => {
    const { position, sizeX } = wallPlacement(opening.wall, room);
    const alongX = opening.wall === 'north' || opening.wall === 'south';
    const limit = sizeX / 2;
    const offset = Math.min(
      Math.max(opening.offsetCm, -limit + opening.widthCm / 2),
      limit - opening.widthCm / 2,
    );
    const centreY = opening.sillCm + opening.heightCm / 2;
    const x = alongX ? position[0] + offset : position[0];
    const z = alongX ? position[2] : position[2] + offset;
    const frame = new THREE.Group();
    frame.name = `room-opening-${index + 1}`;
    frame.userData.openingId = opening.id;
    const bar = 2;
    const parts: Array<{ name: string; size: [number, number, number]; pos: [number, number, number] }> = [
      { name: 'bottom', size: [opening.widthCm, bar, t], pos: [0, -opening.heightCm / 2, 0] },
      { name: 'top', size: [opening.widthCm, bar, t], pos: [0, opening.heightCm / 2, 0] },
      { name: 'left', size: [bar, opening.heightCm, t], pos: [-opening.widthCm / 2, 0, 0] },
      { name: 'right', size: [bar, opening.heightCm, t], pos: [opening.widthCm / 2, 0, 0] },
    ];
    parts.forEach((part) => {
      // For east/west walls the frame is rotated 90° about Y so the bars run
      // along Z instead of X.
      const size: [number, number, number] = alongX
        ? part.size
        : [part.size[2], part.size[1], part.size[0]];
      const pos: [number, number, number] = alongX
        ? part.pos
        : [part.pos[2], part.pos[1], part.pos[0]];
      const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
      geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, openingMaterial);
      mesh.name = `room-opening-${index + 1}-${part.name}`;
      mesh.position.set(pos[0], pos[1], pos[2]);
      frame.add(mesh);
    });
    frame.position.set(x, centreY, z);
    group.add(frame);
  });

  return {
    group,
    dispose: () => {
      geometries.forEach((geometry) => geometry.dispose());
      materialList.forEach((material) => material.dispose());
    },
  };
}
