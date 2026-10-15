import { describe, expect, it } from 'vitest';
import { LIGHT_LIMITS } from '../scene/sceneSettings';
import { MAX_RENDER_DIMENSION, MAX_RENDER_PIXELS } from '../export/sceneImage';
import {
  EXPOSURE_LIMITS,
  LIGHTING_PRESETS,
  LIGHTING_PRESET_CONFIGS,
  LIGHTING_PRESET_POSITIONS,
  QUALITY_PRESETS,
  QUALITY_PRESET_CONFIGS,
  TONE_MAPPING_MODES,
  isLightingPresetId,
  isQualityPresetId,
  isToneMappingMode,
  resolveRendererConfig,
  validateExposure,
} from './renderPresets';

const HEX = /^#[0-9a-fA-F]{6}$/;
const INTENSITY = LIGHT_LIMITS.intensity;

describe('lighting presets', () => {
  it('defines the five requested presets', () => {
    expect(LIGHTING_PRESETS).toEqual([
      'studioSoft',
      'neutralProduct',
      'warmInterior',
      'coolDaylight',
      'highContrast',
    ]);
  });

  it('gives every preset concrete, in-range light values', () => {
    for (const id of LIGHTING_PRESETS) {
      const config = LIGHTING_PRESET_CONFIGS[id];
      for (const intensity of [config.ambientIntensity, config.keyIntensity, config.fillIntensity]) {
        expect(Number.isFinite(intensity)).toBe(true);
        expect(intensity).toBeGreaterThanOrEqual(INTENSITY.min);
        expect(intensity).toBeLessThanOrEqual(INTENSITY.max);
      }
      expect(config.ambientColor).toMatch(HEX);
      expect(config.keyColor).toMatch(HEX);
      expect(config.fillColor).toMatch(HEX);
      expect(typeof config.shadowsEnabled).toBe('boolean');
    }
  });

  it('provides finite light positions for every preset', () => {
    for (const id of LIGHTING_PRESETS) {
      const positions = LIGHTING_PRESET_POSITIONS[id];
      for (const value of [...positions.key, ...positions.fill]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it('validates preset ids', () => {
    expect(isLightingPresetId('studioSoft')).toBe(true);
    expect(isLightingPresetId('custom')).toBe(false);
    expect(isLightingPresetId('nope')).toBe(false);
    expect(isLightingPresetId(42)).toBe(false);
  });
});

describe('quality presets', () => {
  it('defines preview, standard and high', () => {
    expect(QUALITY_PRESETS).toEqual(['preview', 'standard', 'high']);
  });

  it('actually differs between presets (pixel ratio, shadows, resolution)', () => {
    const preview = QUALITY_PRESET_CONFIGS.preview;
    const standard = QUALITY_PRESET_CONFIGS.standard;
    const high = QUALITY_PRESET_CONFIGS.high;
    expect(preview.maxPixelRatio).toBeLessThan(standard.maxPixelRatio);
    expect(standard.maxPixelRatio).toBeLessThan(high.maxPixelRatio);
    expect(preview.shadowMapSize).toBeLessThan(standard.shadowMapSize);
    expect(standard.shadowMapSize).toBeLessThan(high.shadowMapSize);
    expect(preview.antialias).toBe(false);
    expect(high.antialias).toBe(true);
    const previewPixels = preview.targetResolution.width * preview.targetResolution.height;
    const highPixels = high.targetResolution.width * high.targetResolution.height;
    expect(highPixels).toBeGreaterThan(previewPixels);
  });

  it('validates quality ids', () => {
    expect(isQualityPresetId('high')).toBe(true);
    expect(isQualityPresetId('ultra')).toBe(false);
  });
});

describe('resolveRendererConfig', () => {
  it('caps the pixel ratio by the preset and the hard cap', () => {
    expect(resolveRendererConfig('preview', { devicePixelRatio: 3 }).pixelRatio).toBe(1);
    expect(resolveRendererConfig('standard', { devicePixelRatio: 3 }).pixelRatio).toBe(1.5);
    expect(resolveRendererConfig('high', { devicePixelRatio: 3 }).pixelRatio).toBe(2);
    // High can never exceed the absolute cap.
    expect(
      resolveRendererConfig('high', { devicePixelRatio: 4, absoluteMaxPixelRatio: 2 }).pixelRatio,
    ).toBe(2);
  });

  it('falls back to pixel ratio 1 for a non-finite device pixel ratio', () => {
    expect(resolveRendererConfig('high', { devicePixelRatio: Number.NaN }).pixelRatio).toBe(1);
  });

  it('clamps every preset resolution within the render caps', () => {
    for (const id of QUALITY_PRESETS) {
      const { resolution } = resolveRendererConfig(id, { devicePixelRatio: 1 });
      expect(resolution.width).toBeLessThanOrEqual(MAX_RENDER_DIMENSION);
      expect(resolution.height).toBeLessThanOrEqual(MAX_RENDER_DIMENSION);
      expect(resolution.width * resolution.height).toBeLessThanOrEqual(MAX_RENDER_PIXELS);
      expect(resolution.width).toBeGreaterThan(0);
      expect(resolution.height).toBeGreaterThan(0);
    }
  });

  it('reports the shadow filter kind and AA per quality', () => {
    expect(resolveRendererConfig('preview', {}).shadowMapKind).toBe('pcf');
    expect(resolveRendererConfig('preview', {}).antialias).toBe(false);
    expect(resolveRendererConfig('high', {}).shadowMapKind).toBe('pcfSoft');
    expect(resolveRendererConfig('high', {}).antialias).toBe(true);
  });
});

describe('tone mapping and exposure', () => {
  it('exposes the ACES operator and others', () => {
    expect(TONE_MAPPING_MODES).toContain('aces');
    expect(isToneMappingMode('aces')).toBe(true);
    expect(isToneMappingMode('filmic')).toBe(false);
  });

  it('clamps exposure and rejects non-finite input', () => {
    expect(validateExposure(2)).toBe(2);
    expect(validateExposure(999)).toBe(EXPOSURE_LIMITS.max);
    expect(validateExposure(0)).toBe(EXPOSURE_LIMITS.min);
    expect(validateExposure(Number.NaN)).toBe(1);
    expect(validateExposure(Number.POSITIVE_INFINITY)).toBe(1);
    expect(validateExposure('x')).toBe(1);
  });
});
