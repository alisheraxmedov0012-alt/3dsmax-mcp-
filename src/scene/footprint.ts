/**
 * W6 furniture footprint.
 *
 * A pure, analytic footprint per furniture type derived from its parameters
 * (no Three.js, no mesh inspection), used by the placement/containment checks.
 * It is intentionally conservative: it is the axis-aligned XZ extent of the
 * piece on the floor, plus its height. It is **not** a mesh-derived bounding box
 * and must not be presented as one.
 */
import type { FurnitureParams, FurnitureType } from '../geometry/furniture/types';

export interface Footprint {
  /** Full width along the object's local X (cm). */
  widthCm: number;
  /** Full depth along the object's local Z (cm). */
  depthCm: number;
  /** Height along Y (cm). */
  heightCm: number;
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Conservative analytic footprint of a furniture piece in cm. */
export function furnitureFootprint(_type: FurnitureType, params: FurnitureParams): Footprint {
  // All eight W2 types lay their footprint along widthCm × depthCm and rise to
  // (at least) heightCm; the bed's mattress/headboard add height but do not
  // change the floor extent, which is all placement cares about.
  return {
    widthCm: finite(params.widthCm, 100),
    depthCm: finite(params.depthCm, 60),
    heightCm: finite(params.heightCm, 75),
  };
}
