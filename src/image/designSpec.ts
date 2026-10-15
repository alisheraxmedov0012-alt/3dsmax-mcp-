/**
 * W7 design-spec contract (image pipeline side).
 *
 * Mirrors the documented W1 `DesignSpec` wire contract
 * (`furniture / dimensions / color / material_kind / style / confidence /
 * notes / warnings / supported`) so an image-derived proposal can later be handed
 * to a real W1 AI provider, and so a W1 response can be consumed here, without a
 * shape change.
 *
 * IMPORTANT: W1 is not merged into this branch, so this is a **local mirror** of
 * the documented contract — not a copy of W1 code. The `FurnitureType` vocabulary
 * is the real W2 one (re-exported below), which is the W1 <-> W2 seam.
 */
import {
  FURNITURE_TYPES,
  isFurnitureType,
  type FurnitureType,
} from '../geometry/furniture/types';

export type DesignFurnitureType = FurnitureType;

export const DESIGN_FURNITURE_TYPES = FURNITURE_TYPES;

export function isDesignFurnitureType(value: unknown): value is DesignFurnitureType {
  return isFurnitureType(value);
}

export type DesignConfidence = 'high' | 'medium' | 'low';

export interface DesignDimensions {
  /** All lengths in centimetres. */
  width_cm: number;
  height_cm: number;
  depth_cm: number;
}

/**
 * Validated design specification. `supported` reports whether the current build
 * can turn this spec into geometry (W2 built all eight types, so it is true for
 * every known type here).
 */
export interface DesignSpec {
  furniture: DesignFurnitureType;
  dimensions: DesignDimensions | null;
  color: string | null;
  material_kind: string | null;
  style: string | null;
  confidence: DesignConfidence;
  notes: string[];
  warnings: string[];
  supported: boolean;
}

/** Furniture types this build can actually assemble (W2 builders). */
export const SUPPORTED_DESIGN_FURNITURE_TYPES: readonly DesignFurnitureType[] = FURNITURE_TYPES;

export function isSupportedDesignFurniture(type: DesignFurnitureType): boolean {
  return SUPPORTED_DESIGN_FURNITURE_TYPES.includes(type);
}
