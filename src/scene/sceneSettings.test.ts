import { describe, expect, it } from 'vitest';
import {
  CAMERA_PRESETS,
  DEFAULT_SETTINGS,
  LIGHT_LIMITS,
  createDefaultSettings,
  SHADOW_LIMITS,
  validateColor,
  validateEnvironmentIntensity,
  validateIntensity,
  validateShadowBias,
  validateShadowNormalBias,
  validateShadowIntensity,
  validateShadowRadius,
  validateSceneSettings,
} from './sceneSettings';

describe('scene settings defaults', () => {
  it('exposes the documented default values', () => {
    expect(DEFAULT_SETTINGS.background).toBe('#1b1f24');
    expect(DEFAULT_SETTINGS.lights.ambientIntensity).toBe(1);
    expect(DEFAULT_SETTINGS.lights.keyIntensity).toBe(2);
    expect(DEFAULT_SETTINGS.lights.fillIntensity).toBe(0.6);
    expect(DEFAULT_SETTINGS.lights.keyEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.lights.fillEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.lights.rimEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.lights.rimIntensity).toBe(0.6);
    expect(DEFAULT_SETTINGS.lights.rimColor).toBe('#ffffff');
    expect(DEFAULT_SETTINGS.lights.shadowsEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.lights.shadowBias).toBe(-0.0005);
    expect(DEFAULT_SETTINGS.lights.shadowNormalBias).toBe(1);
    expect(DEFAULT_SETTINGS.lights.shadowRadius).toBe(2);
    expect(DEFAULT_SETTINGS.lights.shadowIntensity).toBe(1);
    expect(DEFAULT_SETTINGS.cameraPreset).toBe('iso');
    expect(CAMERA_PRESETS).toContain('front');
    expect(CAMERA_PRESETS).toContain('product');
  });

  it('exposes the documented render-pipeline defaults (W5)', () => {
    expect(DEFAULT_SETTINGS.lightingPreset).toBe('custom');
    expect(DEFAULT_SETTINGS.qualityPreset).toBe('standard');
    expect(DEFAULT_SETTINGS.exposure).toBe(1);
    expect(DEFAULT_SETTINGS.toneMapping).toBe('none');
    expect(DEFAULT_SETTINGS.environmentEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.environmentIntensity).toBe(1);
  });

  it('returns an independent copy from createDefaultSettings', () => {
    const a = createDefaultSettings();
    a.lights.keyIntensity = 4;
    a.roomMaterials.floorColor = '#000000';
    const b = createDefaultSettings();
    expect(b.lights.keyIntensity).toBe(DEFAULT_SETTINGS.lights.keyIntensity);
    expect(b.roomMaterials.floorColor).toBe(DEFAULT_SETTINGS.roomMaterials.floorColor);
    expect(b.environmentEnabled).toBe(DEFAULT_SETTINGS.environmentEnabled);
    expect(b.environmentIntensity).toBe(DEFAULT_SETTINGS.environmentIntensity);
  });
});

describe('validateIntensity', () => {
  it('keeps in-range values', () => {
    expect(validateIntensity(2.5, 1)).toBe(2.5);
  });

  it('clamps out-of-range values to the limits', () => {
    expect(validateIntensity(999, 1)).toBe(LIGHT_LIMITS.intensity.max);
    expect(validateIntensity(-5, 1)).toBe(LIGHT_LIMITS.intensity.min);
  });

  it('falls back on NaN / non-finite / non-number', () => {
    expect(validateIntensity(Number.NaN, 1)).toBe(1);
    expect(validateIntensity(Number.POSITIVE_INFINITY, 1)).toBe(1);
    expect(validateIntensity('3', 1)).toBe(1);
    expect(validateIntensity(undefined, 1)).toBe(1);
  });
});

describe('validateEnvironmentIntensity', () => {
  it('clamps in-range values and falls back for malformed input', () => {
    expect(validateEnvironmentIntensity(1.5, 1)).toBe(1.5);
    expect(validateEnvironmentIntensity(99, 1)).toBe(3);
    expect(validateEnvironmentIntensity(-1, 1)).toBe(0);
    expect(validateEnvironmentIntensity(Number.NaN, 1.2)).toBe(1.2);
    expect(validateEnvironmentIntensity('2', 1.2)).toBe(1.2);
    expect(validateEnvironmentIntensity(undefined, 1.2)).toBe(1.2);
  });
});

describe('shadow parameter validators', () => {
  it('clamps within the conservative shadow ranges', () => {
    expect(validateShadowBias(-0.0004, 0)).toBe(-0.0004);
    expect(validateShadowBias(-99, 0)).toBe(SHADOW_LIMITS.bias.min);
    expect(validateShadowNormalBias(0.5, 1)).toBe(0.5);
    expect(validateShadowNormalBias(99, 1)).toBe(SHADOW_LIMITS.normalBias.max);
    expect(validateShadowRadius(3, 2)).toBe(3);
    expect(validateShadowRadius(-1, 2)).toBe(SHADOW_LIMITS.radius.min);
    expect(validateShadowIntensity(0.5, 1)).toBe(0.5);
    expect(validateShadowIntensity(2, 1)).toBe(SHADOW_LIMITS.intensity.max);
  });

  it('falls back for malformed shadow values', () => {
    expect(validateShadowBias(Number.NaN, -0.0005)).toBe(-0.0005);
    expect(validateShadowNormalBias('1' as never, 1)).toBe(1);
    expect(validateShadowRadius(Number.POSITIVE_INFINITY, 2)).toBe(2);
    expect(validateShadowIntensity(undefined, 1)).toBe(1);
  });
});

describe('validateColor', () => {
  it('accepts 6-digit hex and lowercases it', () => {
    expect(validateColor('#AbC123', '#000000')).toBe('#abc123');
  });

  it('rejects invalid colours', () => {
    expect(validateColor('red', '#000000')).toBe('#000000');
    expect(validateColor('#fff', '#000000')).toBe('#000000');
    expect(validateColor(42, '#000000')).toBe('#000000');
  });
});

describe('validateSceneSettings', () => {
  it('fills defaults for an empty/legacy value', () => {
    expect(validateSceneSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(validateSceneSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps and normalizes provided values', () => {
    const settings = validateSceneSettings({
      background: '#ABCDEF',
      lights: { keyIntensity: 99, fillIntensity: -1, keyColor: 'nope', shadowsEnabled: false },
      roomMaterials: { floorColor: '#111111' },
      cameraPreset: 'top',
    });

    expect(settings.background).toBe('#abcdef');
    expect(settings.lights.keyIntensity).toBe(LIGHT_LIMITS.intensity.max);
    expect(settings.lights.fillIntensity).toBe(LIGHT_LIMITS.intensity.min);
    expect(settings.lights.keyColor).toBe(DEFAULT_SETTINGS.lights.keyColor);
    expect(settings.lights.shadowsEnabled).toBe(false);
    expect(settings.lights.rimColor).toBe(DEFAULT_SETTINGS.lights.rimColor);
    expect(settings.roomMaterials.floorColor).toBe('#111111');
    expect(settings.roomMaterials.wallColor).toBe(DEFAULT_SETTINGS.roomMaterials.wallColor);
    expect(settings.cameraPreset).toBe('top');
  });

  it('rejects an unknown camera preset', () => {
    expect(validateSceneSettings({ cameraPreset: 'diagonal' }).cameraPreset).toBe('iso');
  });

  it('fills additive Phase 5.3 shadow defaults for legacy settings', () => {
    const legacy = validateSceneSettings({ lights: { shadowsEnabled: false } });
    expect(legacy.lights.shadowsEnabled).toBe(false);
    expect(legacy.lights.shadowBias).toBe(DEFAULT_SETTINGS.lights.shadowBias);
    expect(legacy.lights.shadowNormalBias).toBe(DEFAULT_SETTINGS.lights.shadowNormalBias);
    expect(legacy.lights.shadowRadius).toBe(DEFAULT_SETTINGS.lights.shadowRadius);
    expect(legacy.lights.shadowIntensity).toBe(DEFAULT_SETTINGS.lights.shadowIntensity);
    expect(legacy.lights.rimEnabled).toBe(DEFAULT_SETTINGS.lights.rimEnabled);
    expect(legacy.lights.rimIntensity).toBe(DEFAULT_SETTINGS.lights.rimIntensity);

    const custom = validateSceneSettings({
      lights: {
        shadowBias: 99,
        shadowNormalBias: -1,
        shadowRadius: 99,
        shadowIntensity: 99,
      },
    });
    expect(custom.lights.shadowBias).toBe(SHADOW_LIMITS.bias.max);
    expect(custom.lights.shadowNormalBias).toBe(SHADOW_LIMITS.normalBias.min);
    expect(custom.lights.shadowRadius).toBe(SHADOW_LIMITS.radius.max);
    expect(custom.lights.shadowIntensity).toBe(SHADOW_LIMITS.intensity.max);
  });

  it('fills additive Phase 5.2 environment defaults for legacy settings', () => {
    const legacy = validateSceneSettings({
      background: '#101010',
      cameraPreset: 'front',
    });
    expect(legacy.environmentEnabled).toBe(false);
    expect(legacy.environmentIntensity).toBe(1);

    const enabled = validateSceneSettings({
      environmentEnabled: true,
      environmentIntensity: 2.4,
    });
    expect(enabled.environmentEnabled).toBe(true);
    expect(enabled.environmentIntensity).toBe(2.4);

    const clamped = validateSceneSettings({
      environmentEnabled: 'yes',
      environmentIntensity: 99,
    });
    expect(clamped.environmentEnabled).toBe(false);
    expect(clamped.environmentIntensity).toBe(3);
  });

  it('normalizes the W5 render fields and rejects unknown values', () => {
    const settings = validateSceneSettings({
      lightingPreset: 'warmInterior',
      qualityPreset: 'high',
      exposure: 2.5,
      toneMapping: 'aces',
    });
    expect(settings.lightingPreset).toBe('warmInterior');
    expect(settings.qualityPreset).toBe('high');
    expect(settings.exposure).toBe(2.5);
    expect(settings.toneMapping).toBe('aces');

    const bad = validateSceneSettings({
      lightingPreset: 'nonsense',
      qualityPreset: 'ultra',
      exposure: Number.NaN,
      toneMapping: 'filmic',
    });
    expect(bad.lightingPreset).toBe(DEFAULT_SETTINGS.lightingPreset);
    expect(bad.qualityPreset).toBe(DEFAULT_SETTINGS.qualityPreset);
    expect(bad.exposure).toBe(DEFAULT_SETTINGS.exposure);
    expect(bad.toneMapping).toBe(DEFAULT_SETTINGS.toneMapping);
  });

  it('clamps an out-of-range exposure', () => {
    expect(validateSceneSettings({ exposure: 999 }).exposure).toBe(4);
    expect(validateSceneSettings({ exposure: -5 }).exposure).toBe(0.25);
  });
});
