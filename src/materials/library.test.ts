import { describe, expect, it } from 'vitest';
import { MATERIAL_PRESETS } from './presets';
import {
  BUILT_IN_MATERIAL_ASSETS,
  BUILT_IN_TEXTURE_ASSETS,
  BUILT_IN_TEXTURE_IDS,
  MATERIAL_ASSET_IDS,
  getMaterialAsset,
  materialAssetFromPreset,
  registerMaterialAssets,
  requireMaterialAsset,
  serializeMaterialAssetLibrary,
} from './library';
import { serializeMaterialAsset, validateMaterialAsset, validateTextureAsset } from './asset';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';
import { serializeSceneToJson, parseSceneJson } from '../export/sceneJson';

describe('built-in material assets', () => {
  it('exposes the full preset catalogue', () => {
    expect(BUILT_IN_MATERIAL_ASSETS).toHaveLength(MATERIAL_PRESETS.length);
    expect(BUILT_IN_MATERIAL_ASSETS.length).toBeGreaterThanOrEqual(24);
    expect([...MATERIAL_ASSET_IDS].sort()).toEqual(
      MATERIAL_PRESETS.map((preset) => preset.id).sort(),
    );
  });

  it('keeps preset values unchanged during conversion', () => {
    for (const preset of MATERIAL_PRESETS) {
      const asset = materialAssetFromPreset(preset);
      expect(asset.id).toBe(preset.id);
      expect(asset.label).toBe(preset.name);
      expect(asset.type).toBe(preset.type);
      expect(asset.baseColor).toBe(preset.color);
      expect(asset.colorPolicy).toBe(preset.color === null ? 'object' : 'fixed');
      expect(asset.pbr).toEqual({
        metalness: preset.metalness,
        roughness: preset.roughness,
        opacity: preset.opacity,
        normalStrength: preset.normalStrength,
        textureScale: preset.textureScale,
      });
    }
  });

  it('validates every built-in against the texture registry without warnings', () => {
    for (const asset of BUILT_IN_MATERIAL_ASSETS) {
      const result = validateMaterialAsset(asset, { knownTextureIds: BUILT_IN_TEXTURE_IDS });
      expect(result).toMatchObject({ ok: true });
      if (result.ok) {
        expect(result.warnings).toEqual([]);
        expect(serializeMaterialAsset(result.asset)).toBe(serializeMaterialAsset(asset));
      }
    }
  });

  it('only references textures that exist in the registry', () => {
    for (const asset of BUILT_IN_MATERIAL_ASSETS) {
      for (const ref of Object.values(asset.maps)) {
        expect(BUILT_IN_TEXTURE_IDS.has(ref.id)).toBe(true);
      }
    }
  });

  it('marks built-ins as built-in, never as a third-party commercial license', () => {
    for (const asset of BUILT_IN_MATERIAL_ASSETS) {
      expect(asset.license.kind).toBe('built-in');
      expect(asset.license.attribution).toBeUndefined();
    }
  });

  it('registers procedural texture metadata honestly', () => {
    expect(BUILT_IN_TEXTURE_ASSETS).toHaveLength(8);
    for (const texture of BUILT_IN_TEXTURE_ASSETS) {
      const result = validateTextureAsset(texture);
      expect(result).toMatchObject({ ok: true });
      if (!result.ok) continue;
      expect(result.asset.mimeType).toBeNull();
      expect(result.asset.byteSize).toBe(0);
      expect(result.asset.contentHash).toBeNull();
    }
  });
});

describe('deterministic id resolution', () => {
  it('resolves a known id and falls back to the default asset', () => {
    expect(getMaterialAsset('wood-oak').id).toBe('wood-oak');
    expect(getMaterialAsset('nope').id).toBe('default');
    expect(getMaterialAsset(null).id).toBe('default');
    expect(getMaterialAsset(undefined).id).toBe('default');
  });

  it('requireMaterialAsset throws for an unknown id', () => {
    expect(() => requireMaterialAsset('nope')).toThrow('Material asset topilmadi: nope');
  });
});

describe('registerMaterialAssets', () => {
  const addition = {
    ...materialAssetFromPreset(MATERIAL_PRESETS[1]),
    id: 'custom-oak',
    label: 'Custom oak',
  };

  it('adds a valid asset', () => {
    const result = registerMaterialAssets(BUILT_IN_MATERIAL_ASSETS, [addition]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assets).toHaveLength(MATERIAL_PRESETS.length + 1);
    expect(result.assets[result.assets.length - 1].id).toBe('custom-oak');
  });

  it('rejects a duplicate id instead of replacing the existing asset', () => {
    const result = registerMaterialAssets(BUILT_IN_MATERIAL_ASSETS, [
      { ...addition, id: 'wood-oak' },
    ]);
    expect(result).toMatchObject({ ok: false, code: 'duplicate_id', id: 'wood-oak' });
  });

  it('rejects an invalid asset', () => {
    const result = registerMaterialAssets(BUILT_IN_MATERIAL_ASSETS, [
      { id: 'broken', version: 1 },
    ]);
    expect(result).toMatchObject({ ok: false, code: 'invalid_label' });
  });

  it('rejects a reference to an unknown texture', () => {
    const result = registerMaterialAssets(BUILT_IN_MATERIAL_ASSETS, [
      {
        ...addition,
        maps: {
          baseColor: {
            id: 'textures:missing',
            version: 1,
            role: 'baseColor',
            colorSpace: 'srgb',
            wrap: 'repeat',
          },
        },
      },
    ]);
    expect(result).toMatchObject({ ok: false, code: 'unknown_texture' });
  });

  it('accepts a caller-supplied texture registry for later phases', () => {
    const result = registerMaterialAssets(
      BUILT_IN_MATERIAL_ASSETS,
      [
        {
          ...addition,
          maps: {
            baseColor: {
              id: 'textures:oak-1',
              version: 1,
              role: 'baseColor',
              colorSpace: 'srgb',
              wrap: 'repeat',
            },
          },
        },
      ],
      { knownTextureIds: new Set(['textures:oak-1']) },
    );
    expect(result.ok).toBe(true);
  });
});

describe('library serialization', () => {
  it('is deterministic regardless of input order', () => {
    const forward = serializeMaterialAssetLibrary(BUILT_IN_MATERIAL_ASSETS);
    const reversed = serializeMaterialAssetLibrary(
      [...BUILT_IN_MATERIAL_ASSETS].sort((a, b) => b.id.localeCompare(a.id)),
    );
    expect(reversed).toBe(forward);
    const parsed = JSON.parse(forward) as Array<{ id: string }>;
    expect(parsed.map((asset) => asset.id)).toEqual(
      [...MATERIAL_ASSET_IDS].sort((a, b) => a.localeCompare(b)),
    );
  });
});

describe('existing scene serialization', () => {
  it('keeps the scene schema at v3 and preserves legacy material fields', () => {
    expect(SCENE_SCHEMA_VERSION).toBe(3);

    const object = createFurnitureSceneObject('table', 'obj-1', {
      material: { metalness: 0.2, roughness: 0.35, materialId: 'wood-oak' },
    });
    const scene = {
      schemaVersion: SCENE_SCHEMA_VERSION,
      room: { ...ROOM_DEFAULTS },
      objects: [object],
      settings: createDefaultSettings(),
    };

    const json = serializeSceneToJson(scene, {
      name: 'test',
      furnitureType: 'table',
      units: 'cm',
    });
    const parsed = parseSceneJson(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.scene.schemaVersion).toBe(3);
    expect(parsed.scene.objects[0].material).toMatchObject({
      metalness: 0.2,
      roughness: 0.35,
      materialId: 'wood-oak',
    });
  });
});
