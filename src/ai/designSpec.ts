import type { AiDesignSpec, AiFurnitureType } from '../api/client';
import type { RawTableProposal } from './normalizeProposal';

/**
 * W1 <-> W2 shared vocabulary (frontend mirror of the backend contract).
 *
 * `SUPPORTED_FURNITURE_TYPES` is the seam: it lists the furniture types the
 * current geometry layer can build. W2 extends both the type union and this set
 * as parametric builders are added; W1 (this adapter) then needs no change.
 */
export const FURNITURE_TYPES: readonly AiFurnitureType[] = [
  'table',
  'chair',
  'armchair',
  'sofa',
  'bed',
  'wardrobe',
  'shelf',
  'dresser',
];

export const SUPPORTED_FURNITURE_TYPES: readonly AiFurnitureType[] = ['table'];

export function isSupportedFurnitureType(furniture: AiFurnitureType): boolean {
  return SUPPORTED_FURNITURE_TYPES.includes(furniture);
}

/**
 * Map a validated design spec onto the table proposal shape understood by
 * `normalizeProposal`, which clamps values into the supported table ranges and
 * performs the final geometry-layer validation. Returns `null` when the spec
 * carries no dimensions (the caller then uses defaults with a warning).
 */
export function specToTableProposal(spec: AiDesignSpec): RawTableProposal {
  return {
    widthCm: spec.dimensions?.width_cm,
    heightCm: spec.dimensions?.height_cm,
    depthCm: spec.dimensions?.depth_cm,
    color: spec.color ?? undefined,
  };
}
