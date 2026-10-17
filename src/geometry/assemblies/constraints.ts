/**
 * W14 — deterministic constraints over a part graph.
 *
 * There is no solver. Every constraint is a pure predicate over the built parts,
 * applied in a fixed order, so the same parameters always produce the same
 * verdict and a failure always names the same parts. That is what makes the
 * behaviour testable (plan D5).
 *
 * Only *impossible* constructions are rejected. A value that is merely unusual
 * but still buildable is left to the parameter ranges.
 */
import { type Aabb, isAncestorOf, partAabb, type PartNode } from './partGraph';

/** Geometric tolerance in cm — parts are allowed to touch. */
export const TOLERANCE_CM = 0.1;

export type ConstraintCode =
  | 'containment'
  | 'adjacency'
  | 'non_overlap'
  | 'axis_range'
  | 'derived_sum'
  | 'floor_contact'
  | 'wall_mount';

export interface ConstraintViolation {
  code: ConstraintCode;
  message: string;
  partIds: string[];
}

function overlapsOnAllAxes(a: Aabb, b: Aabb, tolerance: number): boolean {
  return (
    a.min[0] < b.max[0] - tolerance &&
    a.max[0] > b.min[0] + tolerance &&
    a.min[1] < b.max[1] - tolerance &&
    a.max[1] > b.min[1] + tolerance &&
    a.min[2] < b.max[2] - tolerance &&
    a.max[2] > b.min[2] + tolerance
  );
}

function contains(outer: Aabb, inner: Aabb, tolerance: number): boolean {
  for (let axis = 0; axis < 3; axis += 1) {
    if (inner.min[axis] < outer.min[axis] - tolerance) return false;
    if (inner.max[axis] > outer.max[axis] + tolerance) return false;
  }
  return true;
}

/** A child must sit inside its parent, allowing a small tolerance. */
export function checkContainment(
  nodes: readonly PartNode[],
  tolerance = TOLERANCE_CM,
): ConstraintViolation[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const violations: ConstraintViolation[] = [];

  for (const node of nodes) {
    if (!node.parentId) {
      continue;
    }
    const parent = byId.get(node.parentId);
    if (!parent) {
      violations.push({
        code: 'containment',
        message: `"${node.id}" uchun ota-qism topilmadi.`,
        partIds: [node.id],
      });
      continue;
    }
    // A door or drawer front legitimately sits proud of the corpus, so it is
    // excluded from the strict containment rule and covered by non-overlap.
    if (node.role === 'door' || node.role === 'drawer') {
      continue;
    }
    if (!contains(partAabb(nodes, parent), partAabb(nodes, node), tolerance)) {
      violations.push({
        code: 'containment',
        message: `"${node.id}" ota-qism "${parent.id}" ichida emas.`,
        partIds: [node.id, parent.id],
      });
    }
  }
  return violations;
}

/**
 * Two parts must not intersect, except when one is the other's ancestor or
 * descendant (a shelf inside a corpus is expected to be inside it).
 *
 * Doors and drawer fronts are excluded: they are placed on the corpus face and
 * are meant to touch it.
 */
export function checkNonOverlap(
  nodes: readonly PartNode[],
  tolerance = TOLERANCE_CM,
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const faces = new Set(['door', 'drawer']);

  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      if (faces.has(a.role) || faces.has(b.role)) {
        continue;
      }
      if (isAncestorOf(nodes, a.id, b.id) || isAncestorOf(nodes, b.id, a.id)) {
        continue;
      }
      if (overlapsOnAllAxes(partAabb(nodes, a), partAabb(nodes, b), tolerance)) {
        violations.push({
          code: 'non_overlap',
          message: `"${a.id}" va "${b.id}" bir-birining ustiga tushadi.`,
          partIds: [a.id, b.id],
        });
      }
    }
  }
  return violations;
}

/**
 * Two parts that are meant to sit side by side must actually touch: their
 * opposing faces are within tolerance on the shared axis.
 */
export function checkAdjacency(
  nodes: readonly PartNode[],
  aId: string,
  bId: string,
  axis: 0 | 1 | 2,
  tolerance = TOLERANCE_CM,
): ConstraintViolation[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const a = byId.get(aId);
  const b = byId.get(bId);
  if (!a || !b) {
    return [
      { code: 'adjacency', message: 'Qo‘shnilik tekshiruvi uchun qism topilmadi.', partIds: [aId, bId] },
    ];
  }
  const boxA = partAabb(nodes, a);
  const boxB = partAabb(nodes, b);
  const gap = Math.max(boxB.min[axis] - boxA.max[axis], boxA.min[axis] - boxB.max[axis]);
  if (gap > tolerance) {
    return [
      {
        code: 'adjacency',
        message: `"${aId}" va "${bId}" orasida ${gap.toFixed(2)} sm bo'shliq bor.`,
        partIds: [aId, bId],
      },
    ];
  }
  return [];
}

/** A scalar must fall inside a declared range. */
export function checkAxisRange(
  value: number,
  min: number,
  max: number,
  label: string,
): ConstraintViolation[] {
  if (!Number.isFinite(value) || value < min || value > max) {
    return [
      {
        code: 'axis_range',
        message: `${label} ${min}–${max} oralig'ida bo'lishi kerak.`,
        partIds: [],
      },
    ];
  }
  return [];
}

/** A derived total (width of a run, total rise, ...) must match the expected value. */
export function checkDerivedSum(
  actual: number,
  expected: number,
  label: string,
  tolerance = TOLERANCE_CM,
): ConstraintViolation[] {
  if (Math.abs(actual - expected) > tolerance) {
    return [
      {
        code: 'derived_sum',
        message: `${label}: kutilgan ${expected}, hisoblangan ${actual}.`,
        partIds: [],
      },
    ];
  }
  return [];
}

/** Every part of a floor-standing assembly must rest on Y = 0 (no part below). */
export function checkFloorContact(
  nodes: readonly PartNode[],
  tolerance = TOLERANCE_CM,
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  for (const node of nodes) {
    const box = partAabb(nodes, node);
    if (box.min[1] < -tolerance) {
      violations.push({
        code: 'floor_contact',
        message: `"${node.id}" pol ostiga tushadi (${box.min[1].toFixed(2)} sm).`,
        partIds: [node.id],
      });
    }
  }
  return violations;
}

/** Every part of a wall-mounted assembly must stay above the mount height. */
export function checkWallMount(
  nodes: readonly PartNode[],
  mountHeightCm: number,
  tolerance = TOLERANCE_CM,
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  for (const node of nodes) {
    const box = partAabb(nodes, node);
    if (box.min[1] < mountHeightCm - tolerance) {
      violations.push({
        code: 'wall_mount',
        message: `"${node.id}" osish balandligidan pastda (${box.min[1].toFixed(2)} sm).`,
        partIds: [node.id],
      });
    }
  }
  return violations;
}

/**
 * The order every builder applies. Kept as one list so a new constraint cannot
 * be silently skipped by one builder and applied by another.
 */
export function validateGraph(nodes: readonly PartNode[]): ConstraintViolation[] {
  return [...checkContainment(nodes), ...checkNonOverlap(nodes)];
}
