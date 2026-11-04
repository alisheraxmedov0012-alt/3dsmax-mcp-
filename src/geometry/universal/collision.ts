/**
 * Stage 2.1a — minimal axis-aligned collision helper.
 *
 * This is deliberately not an OBB/SAT engine. Parts whose rotation is not zero
 * return `null` and are excluded from overlap checks; rotation-aware collision
 * is a Stage 2.1b task. The interface exists so callers can opt in without
 * mistaking an axis-aligned result for a full collision verdict.
 */
import type { Vec3Tuple } from '../kernel';
import type { PlanPart } from './types';

export interface PlanAabb {
  readonly min: Vec3Tuple;
  readonly max: Vec3Tuple;
}

export interface PlanOverlap {
  readonly aId: string;
  readonly bId: string;
}

const EPSILON = 1e-9;

function isZeroRotation(rotation: Vec3Tuple): boolean {
  return rotation.every((angle) => {
    const normalized = ((angle % 360) + 360) % 360;
    return normalized < EPSILON || 360 - normalized < EPSILON;
  });
}

/** AABB of an unrotated part, or `null` when the part needs an OBB. */
export function planPartAabb(part: PlanPart): PlanAabb | null {
  if (!isZeroRotation(part.rotation)) {
    return null;
  }
  const half = [
    part.dimensions.width / 2,
    part.dimensions.height / 2,
    part.dimensions.depth / 2,
  ] as const;
  return {
    min: [
      part.position[0] - half[0],
      part.position[1] - half[1],
      part.position[2] - half[2],
    ],
    max: [
      part.position[0] + half[0],
      part.position[1] + half[1],
      part.position[2] + half[2],
    ],
  };
}

function overlaps(a: PlanAabb, b: PlanAabb, tolerance: number): boolean {
  for (let axis = 0; axis < 3; axis += 1) {
    if (a.max[axis] <= b.min[axis] + tolerance || b.max[axis] <= a.min[axis] + tolerance) {
      return false;
    }
  }
  return true;
}

/** Parent/child pairs are excluded: containment is intentional, not a clash. */
export function findAxisAlignedOverlaps(
  parts: readonly PlanPart[],
  tolerance = 0.1,
): readonly PlanOverlap[] {
  const overlapsFound: PlanOverlap[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const a = parts[index];
    const aBox = planPartAabb(a);
    if (!aBox) {
      continue;
    }
    for (let other = index + 1; other < parts.length; other += 1) {
      const b = parts[other];
      if (a.parentId === b.id || b.parentId === a.id) {
        continue;
      }
      const bBox = planPartAabb(b);
      if (!bBox) {
        continue;
      }
      if (overlaps(aBox, bBox, tolerance)) {
        overlapsFound.push({ aId: a.id, bId: b.id });
      }
    }
  }
  return overlapsFound;
}
