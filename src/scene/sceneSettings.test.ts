import { describe, expect, it } from 'vitest';
import {
  CAMERA_PRESETS,
  DEFAULT_SETTINGS,
  LIGHT_LIMITS,
  createDefaultSettings,
  validateColor,
  validateIntensity,
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
    expect(DEFAULT_SETTINGS.lights.shadowsEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.cameraPreset).toBe('iso');
    expect(CAMERA_PRESETS).toContain('front');
  });

  it('returns an independent copy from createDefaultSettings', () => {
    const a = createDefaultSettings();
    a.lights.keyIntensity = 4;
    a.roomMaterials.floorColor = '#000000';
    const b = createDefaultSettings();
    expect(b.lights.keyIntensity).toBe(DEFAULT_SETTINGS.lights.keyIntensity);
    expect(b.roomMaterials.floorColor).toBe(DEFAULT_SETTINGS.roomMaterials.floorColor);
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
    expect(settings.roomMaterials.floorColor).toBe('#111111');
    expect(settings.roomMaterials.wallColor).toBe(DEFAULT_SETTINGS.roomMaterials.wallColor);
    expect(settings.cameraPreset).toBe('top');
  });

  it('rejects an unknown camera preset', () => {
    expect(validateSceneSettings({ cameraPreset: 'diagonal' }).cameraPreset).toBe('iso');
  });
});
