import { describe, expect, it } from 'vitest';
import {
  MATERIAL_PRESETS,
  MATERIAL_PRESET_IDS,
  getMaterialPreset,
  resolvePresetSettings,
} from './presets';
import { MATERIAL_TYPES, PBR_LIMITS } from './types';

describe('material presets', () => {
  it('loads a catalogue with unique ids', () => {
    expect(MATERIAL_PRESETS.length).toBeGreaterThanOrEqual(7);
    const ids = MATERIAL_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers every starter material type', () => {
    const types = new Set(MATERIAL_PRESETS.map((preset) => preset.type));
    for (const type of MATERIAL_TYPES) {
      expect(types.has(type)).toBe(true);
    }
  });

  it('keeps every preset value inside the supported ranges', () => {
    for (const preset of MATERIAL_PRESETS) {
      expect(preset.metalness).toBeGreaterThanOrEqual(PBR_LIMITS.metalness.min);
      expect(preset.metalness).toBeLessThanOrEqual(PBR_LIMITS.metalness.max);
      expect(preset.roughness).toBeGreaterThanOrEqual(PBR_LIMITS.roughness.min);
      expect(preset.roughness).toBeLessThanOrEqual(PBR_LIMITS.roughness.max);
      expect(preset.opacity).toBeGreaterThanOrEqual(PBR_LIMITS.opacity.min);
      expect(preset.opacity).toBeLessThanOrEqual(PBR_LIMITS.opacity.max);
      expect(preset.textureScale).toBeGreaterThanOrEqual(PBR_LIMITS.textureScale.min);
      expect(preset.textureScale).toBeLessThanOrEqual(PBR_LIMITS.textureScale.max);
      expect(preset.normalStrength).toBeGreaterThanOrEqual(PBR_LIMITS.normalStrength.min);
      expect(preset.normalStrength).toBeLessThanOrEqual(PBR_LIMITS.normalStrength.max);
    }
  });

  it('uses a valid hex colour when a preset suggests one', () => {
    for (const preset of MATERIAL_PRESETS) {
      if (preset.color !== null) {
        expect(preset.color).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('resolves a known id and falls back to the default preset', () => {
    expect(getMaterialPreset('wood-oak').type).toBe('wood');
    expect(getMaterialPreset('does-not-exist').id).toBe('default');
    expect(getMaterialPreset(null).id).toBe('default');
  });

  it('exposes ids that match the catalogue', () => {
    expect(MATERIAL_PRESET_IDS.has('glass-clear')).toBe(true);
    expect(MATERIAL_PRESET_IDS.has('nope')).toBe(false);
  });

  it('resolves settings consistently with the presets', () => {
    // A stored preset id alone resolves to that preset's physical values, and
    // an explicit channel overrides the preset.
    const fromPreset = resolvePresetSettings({ materialId: 'metal-steel' });
    expect(fromPreset.materialId).toBe('metal-steel');
    expect(fromPreset.metalness).toBeCloseTo(0.95, 5);
    expect(fromPreset.roughness).toBeCloseTo(0.3, 5);

    const overridden = resolvePresetSettings({ materialId: 'metal-steel', roughness: 0.8 });
    expect(overridden.roughness).toBeCloseTo(0.8, 5);
    expect(overridden.metalness).toBeCloseTo(0.95, 5);

    // An unknown id falls back to the default preset's values.
    expect(resolvePresetSettings({ materialId: 'nope' }).materialId).toBe('default');
  });
});
