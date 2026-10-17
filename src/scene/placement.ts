/**
 * W6 furniture placement and room-boundary checks.
 *
 * Pure geometry (no Three.js), built on the analytic footprint. It provides:
 * - room-boundary containment + overhang measurement,
 * - axis-aligned overlap detection between pieces,
 * - a "place against the nearest wall" helper that keeps a piece inside the room
 *   and rotates it to face inward.
 *
 * These are conservative AABB checks. They are **not** a physical collision
 * simulation and are not measured mesh-to-mesh; they are deliberately simple so
 * placement feedback stays predictable and cheap.
 */
import type { FurnitureParams, FurnitureType } from '../geometry/furniture/types';
import { furnitureFootprint } from './footprint';
import type { RoomConfig, RoomWall, SceneObject, Vec3 } from './types';

const DEG_TO_RAD = Math.PI / 180;

export interface Aabb2 {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface PlacementIssue {
  kind: 'outside' | 'collision';
  objectId: string;
  /** Present for a `collision` issue: the other piece involved. */
  otherId?: string;
}

/** Half-extents along X/Z after applying the object's Y rotation (degrees). */
export function rotatedHalfExtents(
  type: FurnitureType,
  params: FurnitureParams,
  rotationYDeg: number,
): { halfX: number; halfZ: number } {
  const { widthCm, depthCm } = furnitureFootprint(type, params);
  const halfW = widthCm / 2;
  const halfD = depthCm / 2;
  const theta = (Number.isFinite(rotationYDeg) ? rotationYDeg : 0) * DEG_TO_RAD;
  const cos = Math.abs(Math.cos(theta));
  const sin = Math.abs(Math.sin(theta));
  return { halfX: halfW * cos + halfD * sin, halfZ: halfW * sin + halfD * cos };
}

/** World-space AABB (XZ) of an object, ignoring scale-free vertical extent. */
export function objectAabb(object: SceneObject): Aabb2 {
  const { halfX, halfZ } = rotatedHalfExtents(
    object.type as FurnitureType,
    object.params as FurnitureParams,
    object.rotation.y,
  );
  const cx = Number.isFinite(object.position.x) ? object.position.x : 0;
  const cz = Number.isFinite(object.position.z) ? object.position.z : 0;
  return { minX: cx - halfX, maxX: cx + halfX, minZ: cz - halfZ, maxZ: cz + halfZ };
}

export interface BoundaryResult {
  inside: boolean;
  /** How far the AABB sticks out of the room, per axis (0 when inside). */
  overhangX: number;
  overhangZ: number;
}

/**
 * Checks whether an object's footprint lies within the room. The room spans
 * x ∈ [-width/2, width/2] and z ∈ [-length/2, length/2]. Negative or zero room
 * dimensions are treated as zero-size (nothing fits).
 */
export function boundaryCheck(object: SceneObject, room: RoomConfig): BoundaryResult {
  const box = objectAabb(object);
  const halfW = Math.max(room.widthCm / 2, 0);
  const halfL = Math.max(room.lengthCm / 2, 0);
  const overhangX = Math.max(0, -halfW - box.minX, box.maxX - halfW);
  const overhangZ = Math.max(0, -halfL - box.minZ, box.maxZ - halfL);
  return { inside: overhangX <= 1e-6 && overhangZ <= 1e-6, overhangX, overhangZ };
}

/** Whether two objects' footprints overlap in the XZ plane. */
export function objectsOverlap(a: SceneObject, b: SceneObject): boolean {
  if (a.id === b.id) {
    return false;
  }
  const boxA = objectAabb(a);
  const boxB = objectAabb(b);
  const overlapX = Math.min(boxA.maxX, boxB.maxX) - Math.max(boxA.minX, boxB.minX);
  const overlapZ = Math.min(boxA.maxZ, boxB.maxZ) - Math.max(boxA.minZ, boxB.minZ);
  return overlapX > 0 && overlapZ > 0;
}

/**
 * Finds placement issues for the given objects against the room and each other.
 * Hidden objects are skipped (they are not visible in the layout).
 */
export function findPlacementIssues(objects: SceneObject[], room: RoomConfig): PlacementIssue[] {
  const visible = objects.filter((object) => object.visible);
  const issues: PlacementIssue[] = [];
  for (const object of visible) {
    if (!boundaryCheck(object, room).inside) {
      issues.push({ kind: 'outside', objectId: object.id });
    }
  }
  for (let i = 0; i < visible.length; i += 1) {
    for (let j = i + 1; j < visible.length; j += 1) {
      if (objectsOverlap(visible[i], visible[j])) {
        issues.push({ kind: 'collision', objectId: visible[i].id, otherId: visible[j].id });
      }
    }
  }
  return issues;
}

export type WallId = RoomWall;

export const WALL_LABELS: Record<WallId, string> = {
  north: 'Shimoliy devor',
  south: 'Janubiy devor',
  west: "G'arbiy devor",
  east: 'Sharqiy devor',
};

/** Y rotation that makes the piece's back face each wall and its front inward. */
export const WALL_ROTATION_DEG: Record<WallId, number> = {
  north: 0,
  east: 270,
  south: 180,
  west: 90,
};

/** The wall whose inner face is nearest to the object's current centre. */
export function nearestWall(object: SceneObject, room: RoomConfig): WallId {
  const cx = Number.isFinite(object.position.x) ? object.position.x : 0;
  const cz = Number.isFinite(object.position.z) ? object.position.z : 0;
  const halfW = room.widthCm / 2;
  const halfL = room.lengthCm / 2;
  const distances: Array<[WallId, number]> = [
    ['north', Math.abs(cz + halfL)],
    ['south', Math.abs(halfL - cz)],
    ['west', Math.abs(cx + halfW)],
    ['east', Math.abs(halfW - cx)],
  ];
  distances.sort((a, b) => a[1] - b[1]);
  return distances[0][0];
}

function clamp(value: number, min: number, max: number): number {
  if (min > max) {
    // Room is smaller than the piece; centre it.
    return (min + max) / 2;
  }
  return Math.min(Math.max(value, min), max);
}

export interface WallPlacement {
  position: Vec3;
  rotation: Vec3;
  wall: WallId;
}

/**
 * Places an object flush against `wall` (defaulting to the nearest one),
 * rotated to face inward, and clamped so its footprint stays inside the room.
 * The Y position/rotation of the piece and its X/Z rotations are preserved.
 */
export function placeAgainstWall(
  object: SceneObject,
  room: RoomConfig,
  wall: WallId = nearestWall(object, room),
): WallPlacement {
  const rotationY = WALL_ROTATION_DEG[wall];
  const { halfX, halfZ } = rotatedHalfExtents(
    object.type as FurnitureType,
    object.params as FurnitureParams,
    rotationY,
  );
  const halfW = Math.max(room.widthCm / 2, 0);
  const halfL = Math.max(room.lengthCm / 2, 0);
  const eps = 0.01;

  let x = Number.isFinite(object.position.x) ? object.position.x : 0;
  let z = Number.isFinite(object.position.z) ? object.position.z : 0;

  if (wall === 'north' || wall === 'south') {
    z = wall === 'north' ? -halfL + halfZ + eps : halfL - halfZ - eps;
    x = clamp(x, -halfW + halfX, halfW - halfX);
  } else {
    x = wall === 'west' ? -halfW + halfX + eps : halfW - halfX - eps;
    z = clamp(z, -halfL + halfZ, halfL - halfZ);
  }

  return {
    wall,
    position: { x, y: object.position.y, z },
    rotation: { x: object.rotation.x, y: rotationY, z: object.rotation.z },
  };
}
