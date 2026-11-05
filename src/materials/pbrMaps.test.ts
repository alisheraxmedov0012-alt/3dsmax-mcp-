import { describe, expect, it } from 'vitest';
import {
  MATERIAL_ASSET_VERSION,
  PROCEDURAL_TEXTURE_MAP_ROLES,
  TEXTURE_MAP_ROLES,
  TEXTURE_ROLE_COLOR_SPACE,
  serializeMaterialAsset,
  validateMaterialAsset,
  validateMaterialAssetMaps,
  type MaterialAssetMaps,
  type TextureMapRole,
} from './asset';
import { materialAssetFromPreset } from './library';
import { MATERIAL_PRESETS } from './presets';

function ref(role: TextureMapRole, overrides: Record<string, unknown> = {}) {
  return {
    id: `tex-${role.toLowerCase()}`,
    version: 1,
    role,
    colorSpace: TEXTURE_ROLE_COLOR_SPACE[role],
    wrap: 'repeat' as const,
    ...overrides,
  };
}

const ALL_MAPS: MaterialAssetMaps = {
  baseColor: ref('baseColor'),
  normal: ref('normal'),
  roughness: ref('roughness'),
  metalness: ref('metalness'),
  ao: ref('ao'),
  orm: ref('orm'),
  emissive: ref('emissive'),
};

function rawAsset(maps: unknown = ALL_MAPS) {
  return {
    id: 'phase-4-5',
    version: MATERIAL_ASSET_VERSION,
    label: 'Phase 4.5',
    type: 'wood',
    colorPolicy: 'object',
    baseColor: null,
    pbr: {
      metalness: 0.1,
      roughness: 0.5,
      opacity: 1,
      normalStrength: 0.5,
      textureScale: 1,
      emissiveIntensity: 2,
    },
    maps,
    uv: { mode: 'physical-box', tileCm: 50 },
    license: { kind: 'user-owned' },
  };
}

describe('Phase 4.5 map roles', () => {
  it('supports all seven roles and validates every one', () => {
    expect([...TEXTURE_MAP_ROLES]).toEqual([
      'baseColor',
      'normal',
      'roughness',
      'metalness',
      'ao',
      'orm',
      'emissive',
    ]);
    const result = validateMaterialAsset(rawAsset());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.asset.maps).sort()).toEqual([...TEXTURE_MAP_ROLES].sort());
    expect(result.asset.pbr.emissiveIntensity).toBe(2);
    expect(result.warnings).toEqual([]);
  });

  it('assigns the exact glTF colour space to each role', () => {
    expect(TEXTURE_ROLE_COLOR_SPACE.baseColor).toBe('srgb');
    expect(TEXTURE_ROLE_COLOR_SPACE.emissive).toBe('srgb');
    for (const role of ['normal', 'roughness', 'metalness', 'ao', 'orm'] as const) {
      expect(TEXTURE_ROLE_COLOR_SPACE[role]).toBe('linear');
    }
  });

  it('corrects a colour-space mismatch instead of accepting it', () => {
    const result = validateMaterialAssetMaps({
      orm: ref('orm', { colorSpace: 'srgb' }),
      emissive: ref('emissive', { colorSpace: 'linear' }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.maps.orm?.colorSpace).toBe('linear');
    expect(result.maps.emissive?.colorSpace).toBe('srgb');
    expect(result.warnings).toHaveLength(2);
  });

  it('rejects an invalid reference format and an unknown role', () => {
    const invalid = validateMaterialAssetMaps({
      roughness: { id: 'Not Valid', version: 1 },
    });
    expect(invalid.ok).toBe(true);
    if (!invalid.ok) return;
    expect(invalid.maps.roughness).toBeUndefined();
    expect(invalid.warnings.join(' ')).toContain('roughness');

    const unknown = validateMaterialAssetMaps({ specular: ref('normal') });
    expect(unknown).toMatchObject({ ok: false, code: 'unknown_map_role' });
  });

  it('rejects a map whose stored role disagrees with its slot', () => {
    const result = validateMaterialAssetMaps({ normal: ref('baseColor') });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.maps.normal).toBeUndefined();
    expect(result.warnings.join(' ')).toContain('normal');
  });

  it('serializes only references and scalar metadata', () => {
    const validated = validateMaterialAsset(rawAsset());
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const json = serializeMaterialAsset(validated.asset);
    expect(json).not.toContain('data:image');
    expect(json).not.toContain('base64');
    expect(JSON.parse(json).maps.orm).toEqual(ref('orm'));
    expect(JSON.parse(json).pbr.emissiveIntensity).toBe(2);
  });

  it('keeps procedural library assets limited to baseColor and normal', () => {
    expect([...PROCEDURAL_TEXTURE_MAP_ROLES]).toEqual(['baseColor', 'normal']);
    for (const preset of MATERIAL_PRESETS) {
      const asset = materialAssetFromPreset(preset);
      for (const role of Object.keys(asset.maps)) {
        expect([...PROCEDURAL_TEXTURE_MAP_ROLES]).toContain(role);
      }
    }
  });
});
