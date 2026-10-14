import { describe, expect, it } from 'vitest';
import { MATERIAL_PRESET_IDS } from './presets';
import { DEFAULT_PBR_MATERIAL, PBR_LIMITS, resolveMaterialSettings } from './types';

describe('resolveMaterialSettings', () => {
  it('fills defaults when nothing is provided', () => {
    expect(resolveMaterialSettings(undefined, MATERIAL_PRESET_IDS)).toEqual({
      ...DEFAULT_PBR_MATERIAL,
    });
    expect(resolveMaterialSettings(null, MATERIAL_PRESET_IDS)).toEqual({
      ...DEFAULT_PBR_MATERIAL,
    });
  });

  it('keeps valid values untouched', () => {
    const resolved = resolveMaterialSettings(
      { materialId: 'wood-oak', metalness: 0.2, roughness: 0.7, opacity: 0.8, textureScale: 3, normalStrength: 1.2 },
      MATERIAL_PRESET_IDS,
    );
    expect(resolved).toEqual({
      materialId: 'wood-oak',
      metalness: 0.2,
      roughness: 0.7,
      opacity: 0.8,
      textureScale: 3,
      normalStrength: 1.2,
    });
  });

  it('clamps out-of-range values into the supported ranges', () => {
    const resolved = resolveMaterialSettings(
      { metalness: 9, roughness: -1, opacity: 99, textureScale: 100, normalStrength: 50 },
      MATERIAL_PRESET_IDS,
    );
    expect(resolved.metalness).toBe(PBR_LIMITS.metalness.max);
    expect(resolved.roughness).toBe(PBR_LIMITS.roughness.min);
    expect(resolved.opacity).toBe(PBR_LIMITS.opacity.max);
    expect(resolved.textureScale).toBe(PBR_LIMITS.textureScale.max);
    expect(resolved.normalStrength).toBe(PBR_LIMITS.normalStrength.max);
  });

  it('rejects non-finite values by falling back to defaults', () => {
    const resolved = resolveMaterialSettings(
      {
        metalness: Number.NaN,
        roughness: Number.POSITIVE_INFINITY,
        opacity: Number.NEGATIVE_INFINITY,
        textureScale: Number.NaN,
        normalStrength: Number.NaN,
      },
      MATERIAL_PRESET_IDS,
    );
    expect(resolved.metalness).toBe(DEFAULT_PBR_MATERIAL.metalness);
    expect(resolved.roughness).toBe(DEFAULT_PBR_MATERIAL.roughness);
    expect(resolved.opacity).toBe(DEFAULT_PBR_MATERIAL.opacity);
    expect(resolved.textureScale).toBe(DEFAULT_PBR_MATERIAL.textureScale);
    expect(resolved.normalStrength).toBe(DEFAULT_PBR_MATERIAL.normalStrength);
  });

  it('falls back to the default preset for an unknown or invalid id', () => {
    expect(resolveMaterialSettings({ materialId: 'unknown' }, MATERIAL_PRESET_IDS).materialId).toBe(
      DEFAULT_PBR_MATERIAL.materialId,
    );
    expect(
      resolveMaterialSettings({ materialId: '  ' }, MATERIAL_PRESET_IDS).materialId,
    ).toBe(DEFAULT_PBR_MATERIAL.materialId);
  });
});
