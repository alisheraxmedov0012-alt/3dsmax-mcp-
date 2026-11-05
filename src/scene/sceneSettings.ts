/**
 * Stage 6 visualization settings, extended in W5 with the render pipeline
 * (lighting preset, render quality, tone mapping, exposure). Kept free of
 * Three.js so it can be validated, serialized and tested without a WebGL
 * context.
 */
import {
  ENVIRONMENT_INTENSITY_LIMITS,
  isLightingPresetId,
  isQualityPresetId,
  isToneMappingMode,
  validateExposure,
  type LightingPresetChoice,
  type QualityPresetId,
  type ToneMappingMode,
} from '../render/renderPresets';

export type CameraPreset = 'product' | 'iso' | 'front' | 'side' | 'top';

export const CAMERA_PRESETS: readonly CameraPreset[] = ['product', 'iso', 'front', 'side', 'top'];

export const CAMERA_PRESET_LABELS: Record<CameraPreset, string> = {
  product: 'Mahsulot (perspektiva)',
  iso: 'Izometrik',
  front: 'Old',
  side: 'Yon',
  top: 'Yuqoridan',
};

export interface LightSettings {
  /** Hemisphere (ambient) intensity. */
  ambientIntensity: number;
  /** Hemisphere sky colour. */
  ambientColor: string;
  keyEnabled: boolean;
  keyIntensity: number;
  keyColor: string;
  fillEnabled: boolean;
  fillIntensity: number;
  fillColor: string;
  rimEnabled: boolean;
  rimIntensity: number;
  rimColor: string;
  shadowsEnabled: boolean;
  /** Phase 5.3: depth bias applied to the key light shadow. */
  shadowBias: number;
  /** Phase 5.3: world-space normal bias (cm). */
  shadowNormalBias: number;
  /** Phase 5.3: PCF softness radius in texels. */
  shadowRadius: number;
  /** Phase 5.3: light-shadow strength in [0, 1]. */
  shadowIntensity: number;
}

export interface RoomMaterialSettings {
  floorColor: string;
  wallColor: string;
  /** W6: ceiling material colour (used when the room shows a ceiling). */
  ceilingColor: string;
}

export interface SceneSettings {
  background: string;
  lights: LightSettings;
  roomMaterials: RoomMaterialSettings;
  cameraPreset: CameraPreset;
  /** W5: which lighting preset produced `lights` ('custom' = hand-edited). */
  lightingPreset: LightingPresetChoice;
  /** W5: render quality preset (drives pixel ratio, shadows, export size). */
  qualityPreset: QualityPresetId;
  /** W5: tone mapping exposure. */
  exposure: number;
  /** W5: tone mapping operator. */
  toneMapping: ToneMappingMode;
  /**
   * Phase 5.2: RoomEnvironment IBL. Defaults to false so scenes saved before
   * Phase 5.2 keep their exact pre-environment appearance.
   */
  environmentEnabled: boolean;
  /** Phase 5.2: scene.environmentIntensity (0–3). */
  environmentIntensity: number;
}

export interface NumericRange {
  min: number;
  max: number;
  step: number;
}

export const LIGHT_LIMITS: Record<'intensity', NumericRange> = {
  intensity: { min: 0, max: 5, step: 0.1 },
};

/** Phase 5.3 shadow controls; conservative ranges keep the depth pass usable. */
export const SHADOW_LIMITS = {
  bias: { min: -0.01, max: 0.01, step: 0.0001 },
  normalBias: { min: 0, max: 10, step: 0.1 },
  radius: { min: 0, max: 10, step: 0.1 },
  intensity: { min: 0, max: 1, step: 0.05 },
} satisfies Record<'bias' | 'normalBias' | 'radius' | 'intensity', NumericRange>;

export const DEFAULT_SETTINGS: SceneSettings = {
  background: '#1b1f24',
  // Stage 6 lighting defaults are preserved exactly, so existing scenes look
  // unchanged. `lightingPreset: 'custom'` records that these values are the
  // hand-set default rather than one of the W5 presets.
  lights: {
    ambientIntensity: 1,
    ambientColor: '#ffffff',
    keyEnabled: true,
    keyIntensity: 2,
    keyColor: '#ffffff',
    fillEnabled: true,
    fillIntensity: 0.6,
    fillColor: '#ffffff',
    rimEnabled: false,
    rimIntensity: 0.6,
    rimColor: '#ffffff',
    shadowsEnabled: true,
    shadowBias: -0.0005,
    shadowNormalBias: 1,
    shadowRadius: 2,
    shadowIntensity: 1,
  },
  roomMaterials: {
    floorColor: '#3b3f45',
    wallColor: '#565d66',
    ceilingColor: '#d9dee5',
  },
  cameraPreset: 'iso',
  lightingPreset: 'custom',
  qualityPreset: 'standard',
  // Tone mapping is off by default so the Stage 1–6 appearance is unchanged;
  // exposure 1 with no tone mapping is exactly the previous behaviour.
  exposure: 1,
  toneMapping: 'none',
  environmentEnabled: false,
  environmentIntensity: 1,
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const INTENSITY = LIGHT_LIMITS.intensity;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Returns a `#rrggbb` colour, falling back when missing/invalid. */
export function validateColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return HEX_COLOR.test(trimmed) ? trimmed.toLowerCase() : fallback;
}

/** Clamps a light intensity; NaN / non-finite / out-of-range fall back or clamp. */
export function validateIntensity(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return clamp(value, INTENSITY.min, INTENSITY.max);
}

/** Clamps the Phase 5.2 environment intensity; malformed input falls back. */
export function validateEnvironmentIntensity(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return clamp(
    value,
    ENVIRONMENT_INTENSITY_LIMITS.min,
    ENVIRONMENT_INTENSITY_LIMITS.max,
  );
}

function validateRange(
  value: unknown,
  fallback: number,
  range: NumericRange,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return clamp(value, range.min, range.max);
}

/** Phase 5.3 shadow parameter validators. */
export function validateShadowBias(value: unknown, fallback: number): number {
  return validateRange(value, fallback, SHADOW_LIMITS.bias);
}
export function validateShadowNormalBias(value: unknown, fallback: number): number {
  return validateRange(value, fallback, SHADOW_LIMITS.normalBias);
}
export function validateShadowRadius(value: unknown, fallback: number): number {
  return validateRange(value, fallback, SHADOW_LIMITS.radius);
}
export function validateShadowIntensity(value: unknown, fallback: number): number {
  return validateRange(value, fallback, SHADOW_LIMITS.intensity);
}

function validatePreset(value: unknown): CameraPreset {
  return typeof value === 'string' && (CAMERA_PRESETS as readonly string[]).includes(value)
    ? (value as CameraPreset)
    : DEFAULT_SETTINGS.cameraPreset;
}

function validateLightingPreset(value: unknown): LightingPresetChoice {
  if (value === 'custom' || isLightingPresetId(value)) {
    return value;
  }
  return DEFAULT_SETTINGS.lightingPreset;
}

function validateQuality(value: unknown): QualityPresetId {
  return isQualityPresetId(value) ? value : DEFAULT_SETTINGS.qualityPreset;
}

function validateToneMapping(value: unknown): ToneMappingMode {
  return isToneMappingMode(value) ? value : DEFAULT_SETTINGS.toneMapping;
}

/**
 * Validates and normalizes scene settings. Missing or malformed values fall
 * back to defaults; out-of-range values are clamped. Never throws, so a stored
 * scene with older/partial settings can always be opened.
 */
export function validateSceneSettings(value: unknown): SceneSettings {
  const record = isRecord(value) ? value : {};
  const lights = isRecord(record.lights) ? record.lights : {};
  const room = isRecord(record.roomMaterials) ? record.roomMaterials : {};

  return {
    background: validateColor(record.background, DEFAULT_SETTINGS.background),
    lights: {
      ambientIntensity: validateIntensity(
        lights.ambientIntensity,
        DEFAULT_SETTINGS.lights.ambientIntensity,
      ),
      ambientColor: validateColor(lights.ambientColor, DEFAULT_SETTINGS.lights.ambientColor),
      keyEnabled:
        typeof lights.keyEnabled === 'boolean'
          ? lights.keyEnabled
          : DEFAULT_SETTINGS.lights.keyEnabled,
      keyIntensity: validateIntensity(lights.keyIntensity, DEFAULT_SETTINGS.lights.keyIntensity),
      keyColor: validateColor(lights.keyColor, DEFAULT_SETTINGS.lights.keyColor),
      fillEnabled:
        typeof lights.fillEnabled === 'boolean'
          ? lights.fillEnabled
          : DEFAULT_SETTINGS.lights.fillEnabled,
      fillIntensity: validateIntensity(lights.fillIntensity, DEFAULT_SETTINGS.lights.fillIntensity),
      fillColor: validateColor(lights.fillColor, DEFAULT_SETTINGS.lights.fillColor),
      rimEnabled:
        typeof lights.rimEnabled === 'boolean'
          ? lights.rimEnabled
          : DEFAULT_SETTINGS.lights.rimEnabled,
      rimIntensity: validateIntensity(
        lights.rimIntensity,
        DEFAULT_SETTINGS.lights.rimIntensity,
      ),
      rimColor: validateColor(lights.rimColor, DEFAULT_SETTINGS.lights.rimColor),
      shadowsEnabled:
        typeof lights.shadowsEnabled === 'boolean'
          ? lights.shadowsEnabled
          : DEFAULT_SETTINGS.lights.shadowsEnabled,
      shadowBias: validateShadowBias(
        lights.shadowBias,
        DEFAULT_SETTINGS.lights.shadowBias,
      ),
      shadowNormalBias: validateShadowNormalBias(
        lights.shadowNormalBias,
        DEFAULT_SETTINGS.lights.shadowNormalBias,
      ),
      shadowRadius: validateShadowRadius(
        lights.shadowRadius,
        DEFAULT_SETTINGS.lights.shadowRadius,
      ),
      shadowIntensity: validateShadowIntensity(
        lights.shadowIntensity,
        DEFAULT_SETTINGS.lights.shadowIntensity,
      ),
    },
    roomMaterials: {
      floorColor: validateColor(room.floorColor, DEFAULT_SETTINGS.roomMaterials.floorColor),
      wallColor: validateColor(room.wallColor, DEFAULT_SETTINGS.roomMaterials.wallColor),
      ceilingColor: validateColor(
        room.ceilingColor,
        DEFAULT_SETTINGS.roomMaterials.ceilingColor,
      ),
    },
    cameraPreset: validatePreset(record.cameraPreset),
    lightingPreset: validateLightingPreset(record.lightingPreset),
    qualityPreset: validateQuality(record.qualityPreset),
    exposure: validateExposure(record.exposure, DEFAULT_SETTINGS.exposure),
    toneMapping: validateToneMapping(record.toneMapping),
    environmentEnabled:
      typeof record.environmentEnabled === 'boolean'
        ? record.environmentEnabled
        : DEFAULT_SETTINGS.environmentEnabled,
    environmentIntensity: validateEnvironmentIntensity(
      record.environmentIntensity,
      DEFAULT_SETTINGS.environmentIntensity,
    ),
  };
}

export function createDefaultSettings(): SceneSettings {
  return {
    background: DEFAULT_SETTINGS.background,
    lights: { ...DEFAULT_SETTINGS.lights },
    roomMaterials: { ...DEFAULT_SETTINGS.roomMaterials },
    cameraPreset: DEFAULT_SETTINGS.cameraPreset,
    lightingPreset: DEFAULT_SETTINGS.lightingPreset,
    qualityPreset: DEFAULT_SETTINGS.qualityPreset,
    exposure: DEFAULT_SETTINGS.exposure,
    toneMapping: DEFAULT_SETTINGS.toneMapping,
    environmentEnabled: DEFAULT_SETTINGS.environmentEnabled,
    environmentIntensity: DEFAULT_SETTINGS.environmentIntensity,
  };
}
