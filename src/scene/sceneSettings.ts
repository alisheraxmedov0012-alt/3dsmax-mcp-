/**
 * Stage 6 visualization settings: scene background, lighting, room materials
 * and the selected camera preset. Kept free of Three.js so it can be validated,
 * serialized and tested without a WebGL context.
 */

export type CameraPreset = 'iso' | 'front' | 'side' | 'top';

export const CAMERA_PRESETS: readonly CameraPreset[] = ['iso', 'front', 'side', 'top'];

export const CAMERA_PRESET_LABELS: Record<CameraPreset, string> = {
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
  shadowsEnabled: boolean;
}

export interface RoomMaterialSettings {
  floorColor: string;
  wallColor: string;
}

export interface SceneSettings {
  background: string;
  lights: LightSettings;
  roomMaterials: RoomMaterialSettings;
  cameraPreset: CameraPreset;
}

export interface NumericRange {
  min: number;
  max: number;
  step: number;
}

export const LIGHT_LIMITS: Record<'intensity', NumericRange> = {
  intensity: { min: 0, max: 5, step: 0.1 },
};

export const DEFAULT_SETTINGS: SceneSettings = {
  background: '#1b1f24',
  lights: {
    ambientIntensity: 1,
    ambientColor: '#ffffff',
    keyEnabled: true,
    keyIntensity: 2,
    keyColor: '#ffffff',
    fillEnabled: true,
    fillIntensity: 0.6,
    fillColor: '#ffffff',
    shadowsEnabled: true,
  },
  roomMaterials: {
    floorColor: '#3b3f45',
    wallColor: '#565d66',
  },
  cameraPreset: 'iso',
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

function validatePreset(value: unknown): CameraPreset {
  return typeof value === 'string' && (CAMERA_PRESETS as readonly string[]).includes(value)
    ? (value as CameraPreset)
    : DEFAULT_SETTINGS.cameraPreset;
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
      shadowsEnabled:
        typeof lights.shadowsEnabled === 'boolean'
          ? lights.shadowsEnabled
          : DEFAULT_SETTINGS.lights.shadowsEnabled,
    },
    roomMaterials: {
      floorColor: validateColor(room.floorColor, DEFAULT_SETTINGS.roomMaterials.floorColor),
      wallColor: validateColor(room.wallColor, DEFAULT_SETTINGS.roomMaterials.wallColor),
    },
    cameraPreset: validatePreset(record.cameraPreset),
  };
}

export function createDefaultSettings(): SceneSettings {
  return {
    background: DEFAULT_SETTINGS.background,
    lights: { ...DEFAULT_SETTINGS.lights },
    roomMaterials: { ...DEFAULT_SETTINGS.roomMaterials },
    cameraPreset: DEFAULT_SETTINGS.cameraPreset,
  };
}
