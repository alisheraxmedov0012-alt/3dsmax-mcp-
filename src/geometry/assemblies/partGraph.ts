/**
 * W14 — the part graph an assembly is built from.
 *
 * An assembly is described as a flat list of parts with a parent link. Offsets
 * are relative to the parent, so moving a corpus moves its shelves with it; the
 * absolute position is derived by walking up the chain (`absoluteParts`).
 *
 * This is deliberately not a scene graph: it has no transforms, no materials and
 * no Three.js types, so the constraint layer and the tests can run without a
 * renderer.
 */

export type PartRole =
  | 'corpus'
  | 'divider'
  | 'shelf'
  | 'door'
  | 'drawer'
  | 'plinth'
  | 'top'
  | 'step'
  | 'stringer'
  | 'back';

export interface PartNode {
  /** Stable, deterministic id. Rebuilding the same parameters yields the same id. */
  id: string;
  role: PartRole;
  /** Parent part id, or `null` for a root-level part. */
  parentId: string | null;
  /** Centre offset from the parent's centre, in cm. Roots are relative to the origin. */
  offset: [number, number, number];
  /** Box size (x, y, z) in cm. Always positive. */
  size: [number, number, number];
}

export interface Aabb {
  min: [number, number, number];
  max: [number, number, number];
}

/** Absolute centre of a part, by summing the offsets up the parent chain. */
export function absoluteCentre(nodes: readonly PartNode[], partId: string): [number, number, number] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let current = byId.get(partId);
  const centre: [number, number, number] = [0, 0, 0];
  let guard = 0;
  while (current) {
    centre[0] += current.offset[0];
    centre[1] += current.offset[1];
    centre[2] += current.offset[2];
    guard += 1;
    if (guard > nodes.length + 1) {
      // A parent cycle would otherwise loop forever; the graph validator
      // reports this explicitly, this is the last-resort stop.
      break;
    }
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return centre;
}

/** Absolute bounding box of a part. */
export function partAabb(nodes: readonly PartNode[], part: PartNode): Aabb {
  const centre = absoluteCentre(nodes, part.id);
  return {
    min: [
      centre[0] - part.size[0] / 2,
      centre[1] - part.size[1] / 2,
      centre[2] - part.size[2] / 2,
    ],
    max: [
      centre[0] + part.size[0] / 2,
      centre[1] + part.size[1] / 2,
      centre[2] + part.size[2] / 2,
    ],
  };
}

/** Total bounding box of a set of parts (used for envelope checks). */
export function groupAabb(nodes: readonly PartNode[]): Aabb {
  const boxes = nodes.map((part) => partAabb(nodes, part));
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], box.min[axis]);
      max[axis] = Math.max(max[axis], box.max[axis]);
    }
  }
  return { min, max };
}

/** True when `a` is an ancestor of `b` (or the same part). */
export function isAncestorOf(
  nodes: readonly PartNode[],
  ancestorId: string,
  descendantId: string,
): boolean {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let current = byId.get(descendantId);
  let guard = 0;
  while (current) {
    if (current.id === ancestorId) {
      return true;
    }
    guard += 1;
    if (guard > nodes.length + 1) {
      return false;
    }
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return false;
}
