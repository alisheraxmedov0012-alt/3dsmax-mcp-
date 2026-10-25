/**
 * C8.4 — measured part boxes and the overall envelope.
 *
 * Three different "size" concepts exist in this app and they are not
 * interchangeable:
 *
 * 1. **Parametric size** — what the user types (`widthCm`, `heightCm`, ...).
 *    These drive the construction and do not always equal the result: a bed's
 *    `heightCm` is the *frame* height, so the headboard makes the piece taller;
 *    a dresser's `depthCm` is the *carcass* depth, so drawer fronts make it
 *    deeper.
 * 2. **Overall size** — the bounding box of the finished geometry. This is the
 *    only value quoted in the C2 drawing header and the C5/C8 documents as
 *    "Umumiy".
 * 3. **Part size** — each part's own box, used by the BOM and cut list.
 *
 * This module exists so (2) has exactly one implementation. It used to be
 * derived inline inside the drawing generator; the parameters panel needs the
 * same number, and two copies of the maths would eventually disagree.
 *
 * Units: geometry is built in centimetres; the envelope is reported in
 * millimetres, like every other manufacturing value.
 */
import * as THREE from 'three';
import { convertLength, roundLength } from './units';

/** One part's axis-aligned box in the piece's own frame (centimetres). */
export interface PartBox {
  partId: string;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** Overall envelope in millimetres, measured from geometry. */
export interface OverallEnvelope {
  widthMm: number;
  heightMm: number;
  depthMm: number;
}

/**
 * Collect one box per mesh under `group`.
 *
 * Boxes with a non-finite corner are skipped rather than poisoning the envelope:
 * a single NaN would otherwise make every dimension NaN.
 */
export function measurePartBoxes(group: THREE.Object3D): PartBox[] {
  const boxes: PartBox[] = [];
  group.updateMatrixWorld(true);
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh !== true) {
      return;
    }
    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) {
      return;
    }
    const { min, max } = box;
    if (![min.x, min.y, min.z, max.x, max.y, max.z].every((v) => Number.isFinite(v))) {
      return;
    }
    boxes.push({
      partId: mesh.name,
      minX: min.x,
      minY: min.y,
      minZ: min.z,
      maxX: max.x,
      maxY: max.y,
      maxZ: max.z,
    });
  });
  return boxes;
}

/**
 * Bounding box of every part, in millimetres.
 *
 * Returns null for an empty or degenerate set, so a caller shows "unknown"
 * instead of a fabricated 0 mm piece.
 */
export function envelopeMm(boxes: readonly PartBox[]): OverallEnvelope | null {
  if (boxes.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.minX);
    minY = Math.min(minY, box.minY);
    minZ = Math.min(minZ, box.minZ);
    maxX = Math.max(maxX, box.maxX);
    maxY = Math.max(maxY, box.maxY);
    maxZ = Math.max(maxZ, box.maxZ);
  }
  const span = (min: number, max: number): number =>
    roundLength(convertLength(max - min, 'cm', 'mm'), 'mm');
  const envelope = {
    widthMm: span(minX, maxX),
    heightMm: span(minY, maxY),
    depthMm: span(minZ, maxZ),
  };
  if (![envelope.widthMm, envelope.heightMm, envelope.depthMm].every((v) => Number.isFinite(v) && v > 0)) {
    return null;
  }
  return envelope;
}
