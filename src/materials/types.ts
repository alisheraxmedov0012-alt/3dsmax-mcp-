/**
 * W4 material model (PBR).
 *
 * This module is deliberately free of Three.js types so it can be serialized,
 * validated and unit-tested without a WebGL context (same rule as `scene/`).
 *
 * Base colour / albedo is taken from the object's `params.color` (the existing
 * "Stol parametrlari" colour control is the single source of truth). Everything
 * that is *not* geometry — material type, and the PBR channels below — lives in
 * the object's material settings and is resolved through
 * {@link resolveMaterialSettings} before it reaches the renderer or the
 * exporter.
 *
 * All values are validated: non-finite ("NaN"/Infinity) or missing values fall
 * back to defaults, and out-of-range values are clamped, so a bad stored or
 * edited value can never reach the renderer or the exporter.
 */

export type MaterialType =
  | 'painted'
  | 'wood'
  | 'metal'
  | 'fabric'
  | 'leather'
  | 'glass'
  | 'plastic';

export const MATERIAL_TYPES: readonly MaterialType[] = [
  'painted',
  'wood',
  'metal',
  'fabric',
  'leather',
  'glass',
  'plastic',
];

export const MATERIAL_TYPE_LABELS: Record<MaterialType, string> = {
  painted: "Bo'yalgan sirt",
  wood: "Yog'och",
  metal: 'Metall',
  fabric: 'Mato',
  leather: 'Charm',
  glass: 'Shisha',
  plastic: 'Plastmassa',
};

/** Identifier of a material preset (see `materials/presets.ts`). */
export type MaterialPresetId = string;

export interface NumericRange {
  min: number;
  max: number;
  step: number;
}

/** Supported ranges for the PBR channels. */
export const PBR_LIMITS = {
  metalness: { min: 0, max: 1, step: 0.01 },
  roughness: { min: 0, max: 1, step: 0.01 },
  // Opacity never reaches 0: a fully invisible material would look broken.
  opacity: { min: 0.1, max: 1, step: 0.05 },
  // UV repeat multiplier for the procedural detail texture.
  textureScale: { min: 0.25, max: 8, step: 0.25 },
  // Normal-map strength.
  normalStrength: { min: 0, max: 2, step: 0.05 },
} satisfies Record<string, NumericRange>;

export const DEFAULT_MATERIAL_ID = 'default';

/**
 * Extra PBR channels that W4 adds on top of the Stage 6 metalness/roughness.
 * Kept separate from `MATERIAL_DEFAULTS` (which only carries the two original
 * channels) so existing saved projects stay byte-for-byte compatible.
 */
export const DEFAULT_PBR_MATERIAL = {
  materialId: DEFAULT_MATERIAL_ID,
  metalness: 0.05,
  roughness: 0.6,
  opacity: 1,
  textureScale: 1,
  normalStrength: 0,
} as const;

/**
 * The optional material fields accepted from a scene object (a structurally
 * compatible subset of `ObjectMaterial`). Every field is optional so old
 * projects and callers that only know metalness/roughness keep working.
 */
export interface MaterialSettingsInput {
  materialId?: MaterialPresetId;
  metalness?: number;
  roughness?: number;
  opacity?: number;
  textureScale?: number;
  normalStrength?: number;
}

/** Fully-resolved material settings — every field present and valid. */
export interface ResolvedMaterialSettings {
  materialId: MaterialPresetId;
  metalness: number;
  roughness: number;
  opacity: number;
  textureScale: number;
  normalStrength: number;
}

function clampRange(value: unknown, range: NumericRange, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, range.min), range.max);
}

function normalizePresetId(value: unknown, known: ReadonlySet<string>, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return known.has(trimmed) ? trimmed : fallback;
}

/**
 * Resolve any partially-specified material into a complete, valid set of PBR
 * channels. Unknown preset ids fall back to the default preset; non-finite
 * values fall back to defaults; out-of-range values are clamped.
 *
 * `knownPresetIds` is injected so this stays a pure function (the preset
 * catalogue lives in `materials/presets.ts`).
 */
export function resolveMaterialSettings(
  input: MaterialSettingsInput | null | undefined,
  knownPresetIds: ReadonlySet<string>,
  fallback: ResolvedMaterialSettings = {
    materialId: DEFAULT_PBR_MATERIAL.materialId,
    metalness: DEFAULT_PBR_MATERIAL.metalness,
    roughness: DEFAULT_PBR_MATERIAL.roughness,
    opacity: DEFAULT_PBR_MATERIAL.opacity,
    textureScale: DEFAULT_PBR_MATERIAL.textureScale,
    normalStrength: DEFAULT_PBR_MATERIAL.normalStrength,
  },
): ResolvedMaterialSettings {
  const source: MaterialSettingsInput = input ?? {};
  return {
    materialId: normalizePresetId(source.materialId, knownPresetIds, fallback.materialId),
    metalness: clampRange(source.metalness, PBR_LIMITS.metalness, fallback.metalness),
    roughness: clampRange(source.roughness, PBR_LIMITS.roughness, fallback.roughness),
    opacity: clampRange(source.opacity, PBR_LIMITS.opacity, fallback.opacity),
    textureScale: clampRange(source.textureScale, PBR_LIMITS.textureScale, fallback.textureScale),
    normalStrength: clampRange(
      source.normalStrength,
      PBR_LIMITS.normalStrength,
      fallback.normalStrength,
    ),
  };
}
