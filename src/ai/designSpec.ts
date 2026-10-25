import type { AiDesignSpec, AiFurnitureType } from '../api/client';
import type { FurnitureType } from '../geometry/furniture';
import { buildFurnitureSpec, type BuiltFurnitureSpec } from './furnitureSpec';
import type { RawTableProposal } from './normalizeProposal';

/**
 * Shared furniture vocabulary between the backend contract and the frontend
 * geometry layer.
 *
 * `FURNITURE_TYPES` is the wire vocabulary; `SUPPORTED_FURNITURE_TYPES` is what
 * this build can actually turn into geometry. Since W13 every type has a
 * parametric builder, so the two lists agree. They are kept separate because the
 * `supported` flag still exists on the wire: a specification produced by an
 * older build (or a future type) may arrive marked `supported: false`, and the
 * UI must refuse it rather than guess.
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

export const SUPPORTED_FURNITURE_TYPES: readonly AiFurnitureType[] = [...FURNITURE_TYPES];

export function isSupportedFurnitureType(furniture: AiFurnitureType): boolean {
  return SUPPORTED_FURNITURE_TYPES.includes(furniture);
}

/**
 * Build geometry parameters for the spec's own furniture type.
 *
 * Returns `null` when the type is not buildable here or when the geometry layer
 * rejects the resulting parameters. Callers must treat `null` as "do not apply"
 * and show the message — never fall back to a different type.
 */
export function specToFurnitureParams(spec: AiDesignSpec): BuiltFurnitureSpec | null {
  if (!spec.supported || !isSupportedFurnitureType(spec.furniture)) {
    return null;
  }
  return buildFurnitureSpec(
    spec.furniture as FurnitureType,
    spec.dimensions,
    spec.details ?? null,
    spec.color,
    spec.material_kind,
  );
}

/**
 * Legacy table-only mapping, kept for callers that still pass a table proposal
 * through `normalizeProposal`. New code should use `specToFurnitureParams`.
 *
 * @deprecated use {@link specToFurnitureParams}
 */
export function specToTableProposal(spec: AiDesignSpec): RawTableProposal {
  return {
    widthCm: spec.dimensions?.width_cm,
    heightCm: spec.dimensions?.height_cm,
    depthCm: spec.dimensions?.depth_cm,
    color: spec.color ?? undefined,
  };
}
