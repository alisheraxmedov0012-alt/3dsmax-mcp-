import { describe, expect, it } from 'vitest';
import {
  MATERIAL_ASSET_VERSION,
  migrateMaterialAsset,
  parseMaterialAsset,
  serializeMaterialAsset,
  validateMaterialAsset,
  validateTextureAsset,
  type MaterialAsset,
  type TextureAsset,
} from './asset';

function rawAsset(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'studio-oak',
    version: MATERIAL_ASSET_VERSION,
    label: 'Studio eman',
    type: 'wood',
    colorPolicy: 'fixed',
    baseColor: '#A9744F',
    pbr: {
      metalness: 0.1,
      roughness: 0.55,
      opacity: 1,
      normalStrength: 0.4,
      textureScale: 2,
    },
    maps: {
      baseColor: {
        id: 'procedural:wood:color',
        version: 1,
        role: 'baseColor',
        colorSpace: 'srgb',
        wrap: 'repeat',
      },
      normal: {
        id: 'procedural:wood:normal',
        version: 1,
        role: 'normal',
        colorSpace: 'linear',
        wrap: 'repeat',
      },
    },
    uv: { mode: 'physical-box', tileCm: 50 },
    license: { kind: 'built-in', source: 'test fixture' },
    ...overrides,
  };
}

function validAsset(overrides: Record<string, unknown> = {}): MaterialAsset {
  const result = validateMaterialAsset(rawAsset(overrides));
  if (!result.ok) {
    throw new Error(`fixture invalid: ${result.message}`);
  }
  return result.asset;
}

describe('validateMaterialAsset', () => {
  it('normalizes a complete asset without warnings', () => {
    const result = validateMaterialAsset(rawAsset());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(result.asset.id).toBe('studio-oak');
    expect(result.asset.version).toBe(MATERIAL_ASSET_VERSION);
    expect(result.asset.baseColor).toBe('#a9744f');
    expect(result.asset.pbr.textureScale).toBe(2);
  });

  it('rejects input that is not an object', () => {
    expect(validateMaterialAsset(null)).toMatchObject({ ok: false, code: 'not_an_object' });
    expect(validateMaterialAsset('asset')).toMatchObject({ ok: false, code: 'not_an_object' });
  });

  it('rejects an unsupported version', () => {
    expect(validateMaterialAsset(rawAsset({ version: 2 }))).toMatchObject({
      ok: false,
      code: 'unsupported_version',
    });
    expect(validateMaterialAsset(rawAsset({ version: undefined }))).toMatchObject({
      ok: false,
      code: 'unsupported_version',
    });
  });

  it('rejects invalid ids and labels', () => {
    expect(validateMaterialAsset(rawAsset({ id: 'Studio Oak' }))).toMatchObject({
      ok: false,
      code: 'invalid_id',
    });
    expect(validateMaterialAsset(rawAsset({ label: '   ' }))).toMatchObject({
      ok: false,
      code: 'invalid_label',
    });
  });

  it('rejects unknown material types and invalid fixed colours', () => {
    expect(validateMaterialAsset(rawAsset({ type: 'stone' }))).toMatchObject({
      ok: false,
      code: 'invalid_type',
    });
    expect(
      validateMaterialAsset(rawAsset({ colorPolicy: 'fixed', baseColor: '#12' })),
    ).toMatchObject({ ok: false, code: 'invalid_color' });
  });

  it('falls back to defaults for NaN and Infinity', () => {
    const asset = validAsset({
      pbr: {
        metalness: Number.NaN,
        roughness: Number.POSITIVE_INFINITY,
        opacity: Number.NEGATIVE_INFINITY,
        normalStrength: Number.NaN,
        textureScale: Number.NaN,
      },
    });
    expect(asset.pbr).toEqual({
      metalness: 0.05,
      roughness: 0.6,
      opacity: 1,
      normalStrength: 0,
      textureScale: 1,
    });
  });

  it('clamps finite values into supported ranges', () => {
    const asset = validAsset({
      pbr: {
        metalness: 5,
        roughness: -2,
        opacity: 0,
        normalStrength: 9,
        textureScale: 100,
      },
    });
    expect(asset.pbr.metalness).toBe(1);
    expect(asset.pbr.roughness).toBe(0);
    expect(asset.pbr.opacity).toBe(0.1);
    expect(asset.pbr.normalStrength).toBe(2);
    expect(asset.pbr.textureScale).toBe(8);
  });

  it('converts an object-colour asset and drops a stray baseColor', () => {
    const result = validateMaterialAsset(
      rawAsset({ colorPolicy: 'object', baseColor: '#ffffff' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.asset.baseColor).toBeNull();
    expect(result.warnings.join(' ')).toContain('baseColor');
  });

  it('derives colorPolicy when it is missing', () => {
    const fixed = validateMaterialAsset(rawAsset({ colorPolicy: undefined }));
    expect(fixed.ok && fixed.asset.colorPolicy).toBe('fixed');
    const object = validateMaterialAsset(
      rawAsset({ colorPolicy: undefined, baseColor: null }),
    );
    expect(object.ok && object.asset.colorPolicy).toBe('object');
  });

  it('accepts the supported baseColor and normal map roles', () => {
    const result = validateMaterialAsset(rawAsset());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.asset.maps).sort()).toEqual(['baseColor', 'normal']);
  });

  for (const role of ['roughness', 'metalness', 'ao'] as const) {
    it(`rejects the v1-unsupported "${role}" map role`, () => {
      const result = validateMaterialAsset(
        rawAsset({
          maps: {
            [role]: {
              id: 'procedural:wood:normal',
              version: 1,
              role,
              colorSpace: 'linear',
              wrap: 'repeat',
            },
          },
        }),
      );
      expect(result).toMatchObject({ ok: false, code: 'unknown_map_role' });
      if (result.ok) return;
      // The message must name the offending role and the supported set.
      expect(result.message).toContain(`"${role}"`);
      expect(result.message).toContain('baseColor');
      expect(result.message).toContain('normal');
      expect(result).not.toHaveProperty('asset');
    });
  }

  it('does not return a partial asset when an unsupported role is present', () => {
    const baseRef = (rawAsset().maps as Record<string, unknown>).baseColor;
    const result = validateMaterialAsset(
      rawAsset({
        maps: {
          baseColor: baseRef,
          roughness: { id: 'procedural:wood:normal' },
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ ok: false, code: 'unknown_map_role' });
    if (result.ok) return;
    expect(result.message).toContain('"roughness"');
    // No silently trimmed asset is offered alongside the error.
    expect('asset' in result).toBe(false);
  });

  it('reports malformed and role-mismatched texture references instead of dropping them silently', () => {
    const malformed = validateMaterialAsset(
      rawAsset({ maps: { baseColor: { id: 'Not Valid', version: 1 } } }),
    );
    expect(malformed.ok).toBe(true);
    if (!malformed.ok) return;
    expect(malformed.asset.maps.baseColor).toBeUndefined();
    expect(malformed.warnings.join(' ')).toContain('baseColor');

    const mismatch = validateMaterialAsset(
      rawAsset({
        maps: {
          normal: {
            id: 'procedural:wood:normal',
            version: 1,
            role: 'baseColor',
            colorSpace: 'linear',
            wrap: 'repeat',
          },
        },
      }),
    );
    expect(mismatch.ok).toBe(true);
    if (!mismatch.ok) return;
    expect(mismatch.asset.maps.normal).toBeUndefined();
    expect(mismatch.warnings.join(' ')).toContain('normal');
  });

  it('never mutates the original input on an unknown-role error', () => {
    const input = rawAsset({
      maps: { roughness: { id: 'procedural:wood:normal' } },
    });
    const before = JSON.stringify(input);
    const result = validateMaterialAsset(input);
    expect(result).toMatchObject({ ok: false, code: 'unknown_map_role' });
    expect(JSON.stringify(input)).toBe(before);
  });

  it('forces the role color space and reports the correction', () => {
    const result = validateMaterialAsset(
      rawAsset({
        maps: {
          baseColor: {
            id: 'procedural:wood:color',
            version: 1,
            role: 'baseColor',
            colorSpace: 'linear',
            wrap: 'repeat',
          },
          normal: {
            id: 'procedural:wood:normal',
            version: 1,
            role: 'normal',
            colorSpace: 'srgb',
            wrap: 'clamp',
          },
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.asset.maps.baseColor?.colorSpace).toBe('srgb');
    expect(result.asset.maps.normal?.colorSpace).toBe('linear');
    expect(result.asset.maps.normal?.wrap).toBe('clamp');
    expect(result.warnings).toHaveLength(2);
  });

  it('rejects an unknown texture id when a registry is supplied', () => {
    const result = validateMaterialAsset(rawAsset(), {
      knownTextureIds: new Set(['procedural:wood:color']),
    });
    expect(result).toMatchObject({ ok: false, code: 'unknown_texture' });
  });

  it('rejects an unsupported UV mode and clamps the tile size', () => {
    expect(validateMaterialAsset(rawAsset({ uv: { mode: 'atlas' } }))).toMatchObject({
      ok: false,
      code: 'invalid_uv',
    });
    const asset = validAsset({ uv: { mode: 'physical-box', tileCm: 99999 } });
    expect(asset.uv.tileCm).toBe(1000);
  });

  it('never invents a commercial license for unknown provenance', () => {
    const asset = validAsset({ license: undefined });
    expect(asset.license.kind).toBe('unknown');
    expect(asset.license.source).toBeUndefined();
  });
});

describe('material asset serialization', () => {
  it('round-trips through JSON deterministically', () => {
    const asset = validAsset();
    const first = serializeMaterialAsset(asset);
    const parsed = parseMaterialAsset(first);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serializeMaterialAsset(parsed.asset)).toBe(first);
    expect(parsed.asset).toEqual(asset);
  });

  it('is independent of input key order', () => {
    const asset = validAsset();
    const reordered = Object.fromEntries(
      Object.entries(asset).sort(([a], [b]) => b.localeCompare(a)),
    ) as unknown as MaterialAsset;
    expect(serializeMaterialAsset(reordered)).toBe(serializeMaterialAsset(asset));
  });

  it('rejects oversized and malformed documents without throwing', () => {
    expect(parseMaterialAsset('{')).toMatchObject({ ok: false, code: 'not_an_object' });
    expect(parseMaterialAsset('x'.repeat(300 * 1024))).toMatchObject({
      ok: false,
      code: 'not_an_object',
    });
  });

  it('never serializes runtime objects', () => {
    const serialized = serializeMaterialAsset(validAsset());
    expect(serialized).not.toContain('[object Object]');
    expect(JSON.parse(serialized)).toMatchObject({
      pbr: { metalness: expect.any(Number) },
      uv: { mode: 'physical-box' },
    });
    expect(Object.keys(JSON.parse(serialized)).sort()).toEqual([
      'baseColor',
      'colorPolicy',
      'id',
      'label',
      'license',
      'maps',
      'pbr',
      'type',
      'uv',
      'version',
    ]);
  });
});

describe('migrateMaterialAsset', () => {
  it('accepts the current version as identity', () => {
    const result = migrateMaterialAsset(rawAsset());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fromVersion).toBe(MATERIAL_ASSET_VERSION);
    expect(result.toVersion).toBe(MATERIAL_ASSET_VERSION);
    expect(result.asset.id).toBe('studio-oak');
  });

  it('rejects future versions instead of guessing', () => {
    expect(migrateMaterialAsset(rawAsset({ version: 99 }))).toMatchObject({
      ok: false,
      code: 'unsupported_version',
    });
  });

  it('rejects a missing or non-integer version', () => {
    expect(migrateMaterialAsset(rawAsset({ version: undefined }))).toMatchObject({
      ok: false,
      code: 'unsupported_version',
    });
    expect(migrateMaterialAsset(rawAsset({ version: 1.5 }))).toMatchObject({
      ok: false,
      code: 'unsupported_version',
    });
  });
});

describe('validateTextureAsset', () => {
  const procedural: TextureAsset = {
    id: 'procedural:wood:color',
    version: 1,
    mimeType: null,
    width: 0,
    height: 0,
    byteSize: 0,
    contentHash: null,
    source: { kind: 'procedural', generator: 'procedural:wood' },
  };

  it('accepts a procedural asset with honest empty file metadata', () => {
    expect(validateTextureAsset(procedural)).toMatchObject({ ok: true });
  });

  it('normalizes file facts off a procedural asset', () => {
    const result = validateTextureAsset({
      ...procedural,
      mimeType: 'image/png',
      width: 512,
      height: 512,
      byteSize: 10,
      contentHash: 'sha256:abc',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.asset).toMatchObject({
      mimeType: null,
      width: 0,
      height: 0,
      byteSize: 0,
      contentHash: null,
    });
    expect(result.warnings.length).toBe(4);
  });

  it('requires bitmap facts', () => {
    const bitmap = {
      id: 'textures:oak-1',
      version: 1,
      mimeType: 'image/png',
      width: 1024,
      height: 1024,
      byteSize: 2048,
      contentHash: 'sha256:abc',
      source: { kind: 'bitmap' },
    };
    expect(validateTextureAsset(bitmap)).toMatchObject({ ok: true });
    expect(validateTextureAsset({ ...bitmap, contentHash: null })).toMatchObject({
      ok: false,
      code: 'invalid_hash',
    });
    expect(validateTextureAsset({ ...bitmap, width: 0 })).toMatchObject({
      ok: false,
      code: 'invalid_dimensions',
    });
    expect(validateTextureAsset({ ...bitmap, mimeType: 'image/svg+xml' })).toMatchObject({
      ok: false,
      code: 'invalid_mime_type',
    });
  });

  it('rejects an unknown source kind', () => {
    expect(validateTextureAsset({ ...procedural, source: { kind: 'cloud' } })).toMatchObject({
      ok: false,
      code: 'invalid_source',
    });
  });
});
