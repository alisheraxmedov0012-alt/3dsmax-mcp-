/**
 * W5 render presets: lighting, render quality, tone mapping and exposure.
 *
 * Pure data + pure resolution helpers (no Three.js), so the presets and the
 * renderer-config math can be validated and tested without a WebGL context. The
 * viewer layer maps these neutral values onto its actual WebGL renderer.
 *
 * Everything here is a real, applied setting — there are no decorative
 * "presets" that only change a label. No external HDRI or paid asset is used;
 * lighting is composed from the lights the viewer already owns.
 */
import { clampPngSize, type PngSize } from '../export/sceneImage';

// ---------------------------------------------------------------------------
// Lighting presets
// ---------------------------------------------------------------------------

export type LightingPresetId =
  | 'studioSoft'
  | 'neutralProduct'
  | 'warmInterior'
  | 'coolDaylight'
  | 'highContrast';

/** A lighting preset also selects a "custom" manual mode. */
export type LightingPresetChoice = LightingPresetId | 'custom';

export const LIGHTING_PRESETS: readonly LightingPresetId[] = [
  'studioSoft',
  'neutralProduct',
  'warmInterior',
  'coolDaylight',
  'highContrast',
];

export const LIGHTING_PRESET_LABELS: Record<LightingPresetId, string> = {
  studioSoft: 'Studio yumshoq',
  neutralProduct: 'Neytral mahsulot',
  warmInterior: 'Iliq interyer',
  coolDaylight: 'Sovuq kunduzi',
  highContrast: 'Yuqori kontrast',
};

/** Concrete light values a preset writes into the scene's light settings. */
export interface LightingPresetConfig {
  ambientIntensity: number;
  ambientColor: string;
  keyIntensity: number;
  keyColor: string;
  fillIntensity: number;
  fillColor: string;
  shadowsEnabled: boolean;
}

export const LIGHTING_PRESET_CONFIGS: Record<LightingPresetId, LightingPresetConfig> = {
  studioSoft: {
    ambientIntensity: 0.9,
    ambientColor: '#eef2f7',
    keyIntensity: 2.2,
    keyColor: '#fff6ec',
    fillIntensity: 1.0,
    fillColor: '#dbe6f2',
    shadowsEnabled: true,
  },
  neutralProduct: {
    ambientIntensity: 1.2,
    ambientColor: '#ffffff',
    keyIntensity: 2.4,
    keyColor: '#ffffff',
    fillIntensity: 0.9,
    fillColor: '#f2f5f8',
    shadowsEnabled: true,
  },
  warmInterior: {
    ambientIntensity: 0.8,
    ambientColor: '#ffe6c9',
    keyIntensity: 2.0,
    keyColor: '#ffd9a8',
    fillIntensity: 0.7,
    fillColor: '#ffcf9a',
    shadowsEnabled: true,
  },
  coolDaylight: {
    ambientIntensity: 1.3,
    ambientColor: '#e6f0ff',
    keyIntensity: 2.6,
    keyColor: '#eaf2ff',
    fillIntensity: 1.1,
    fillColor: '#cfe0f5',
    shadowsEnabled: true,
  },
  highContrast: {
    ambientIntensity: 0.35,
    ambientColor: '#ffffff',
    keyIntensity: 3.2,
    keyColor: '#ffffff',
    fillIntensity: 0.25,
    fillColor: '#ccd6e0',
    shadowsEnabled: true,
  },
};

/**
 * Light directions per preset (viewer-owned, in cm relative to the scene
 * centre). Only the direction matters for directional lights; positions are
 * fixed so switching presets never depends on any external asset.
 */
export interface LightingPresetPositions {
  key: readonly [number, number, number];
  fill: readonly [number, number, number];
}

export const LIGHTING_PRESET_POSITIONS: Record<LightingPresetId, LightingPresetPositions> = {
  studioSoft: { key: [420, 760, 520], fill: [-520, 420, -420] },
  neutralProduct: { key: [360, 820, 560], fill: [-460, 460, -380] },
  warmInterior: { key: [520, 620, 480], fill: [-420, 360, -500] },
  coolDaylight: { key: [280, 900, 620], fill: [-540, 520, -360] },
  highContrast: { key: [680, 700, 420], fill: [-380, 300, -560] },
};

export function isLightingPresetId(value: unknown): value is LightingPresetId {
  return typeof value === 'string' && (LIGHTING_PRESETS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Render quality presets
// ---------------------------------------------------------------------------

export type QualityPresetId = 'preview' | 'standard' | 'high';

export const QUALITY_PRESETS: readonly QualityPresetId[] = ['preview', 'standard', 'high'];

export const QUALITY_PRESET_LABELS: Record<QualityPresetId, string> = {
  preview: 'Tezkor',
  standard: 'Standart',
  high: 'Yuqori',
};

/** Shadow filter, mapped to the matching Three.js constant by the viewer. */
export type ShadowMapKind = 'basic' | 'pcf' | 'pcfSoft';

export interface QualityPresetConfig {
  /** Device-pixel-ratio cap for the interactive canvas. */
  maxPixelRatio: number;
  /** Interactive antialiasing (fixed at renderer creation; documented per preset). */
  antialias: boolean;
  shadowMapKind: ShadowMapKind;
  /** Square shadow-map size in pixels. */
  shadowMapSize: number;
  /** Default export resolution for this quality level. */
  targetResolution: PngSize;
}

export const QUALITY_PRESET_CONFIGS: Record<QualityPresetId, QualityPresetConfig> = {
  preview: {
    maxPixelRatio: 1,
    antialias: false,
    shadowMapKind: 'pcf',
    shadowMapSize: 512,
    targetResolution: { width: 1024, height: 576 },
  },
  standard: {
    maxPixelRatio: 1.5,
    antialias: true,
    shadowMapKind: 'pcfSoft',
    shadowMapSize: 1024,
    targetResolution: { width: 1280, height: 720 },
  },
  high: {
    maxPixelRatio: 2,
    antialias: true,
    shadowMapKind: 'pcfSoft',
    shadowMapSize: 2048,
    targetResolution: { width: 2560, height: 1440 },
  },
};

export function isQualityPresetId(value: unknown): value is QualityPresetId {
  return typeof value === 'string' && (QUALITY_PRESETS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Tone mapping / exposure
// ---------------------------------------------------------------------------

export type ToneMappingMode = 'none' | 'linear' | 'reinhard' | 'cineon' | 'aces';

export const TONE_MAPPING_MODES: readonly ToneMappingMode[] = [
  'none',
  'linear',
  'reinhard',
  'cineon',
  'aces',
];

export const TONE_MAPPING_LABELS: Record<ToneMappingMode, string> = {
  none: "O'chirilgan",
  linear: 'Chiziqli',
  reinhard: 'Reinhard',
  cineon: 'Cineon',
  aces: 'ACES Filmic',
};

export const EXPOSURE_LIMITS = { min: 0.25, max: 4, step: 0.05 } as const;

export function isToneMappingMode(value: unknown): value is ToneMappingMode {
  return typeof value === 'string' && (TONE_MAPPING_MODES as readonly string[]).includes(value);
}

/** Clamps an exposure value; non-finite input falls back to 1. */
export function validateExposure(value: unknown, fallback = 1): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, EXPOSURE_LIMITS.min), EXPOSURE_LIMITS.max);
}

// ---------------------------------------------------------------------------
// Resolved renderer configuration
// ---------------------------------------------------------------------------

export interface ResolvedRendererConfig {
  preset: QualityPresetId;
  pixelRatio: number;
  shadowMapKind: ShadowMapKind;
  shadowMapSize: number;
  antialias: boolean;
  /** Export resolution for this quality level, already clamped to the caps. */
  resolution: PngSize & { clamped: boolean };
}

/**
 * Resolve a quality preset into concrete renderer parameters for a given
 * device pixel ratio. The pixel ratio is capped by the preset and the export
 * resolution is clamped by the shared render-size caps so "High" can never force
 * an unsafe framebuffer.
 */
export function resolveRendererConfig(
  quality: QualityPresetId,
  options: { devicePixelRatio?: number; absoluteMaxPixelRatio?: number } = {},
): ResolvedRendererConfig {
  const config = QUALITY_PRESET_CONFIGS[quality];
  const dpr = Number.isFinite(options.devicePixelRatio) && (options.devicePixelRatio ?? 0) > 0
    ? (options.devicePixelRatio as number)
    : 1;
  const absoluteCap = options.absoluteMaxPixelRatio ?? 2;
  const pixelRatio = Math.min(dpr, config.maxPixelRatio, absoluteCap);
  const resolution = clampPngSize(config.targetResolution);
  return {
    preset: quality,
    pixelRatio,
    shadowMapKind: config.shadowMapKind,
    shadowMapSize: config.shadowMapSize,
    antialias: config.antialias,
    resolution,
  };
}
