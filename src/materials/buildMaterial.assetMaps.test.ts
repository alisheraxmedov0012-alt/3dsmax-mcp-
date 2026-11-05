import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  MATERIAL_ASSET_VERSION,
  validateMaterialAsset,
  type MaterialAsset,
  type TextureAssetRef,
  type TextureColorSpace,
  type TextureMapRole,
} from './asset';
import { buildMaterialFromAsset } from './buildMaterial';

const COLOR: Record<TextureMapRole, TextureColorSpace> = {
  baseColor: 'srgb',
  normal: 'linear',
  roughness: 'linear',
  metalness: 'linear',
  ao: 'linear',
  orm: 'linear',
  emissive: 'srgb',
};

function ref(role: TextureMapRole): TextureAssetRef {
  return {
    id: `tex-${role.toLowerCase()}`,
    version: 3,
    role,
    colorSpace: COLOR[role],
    wrap: 'repeat',
  };
}

function asset(maps: Partial<Record<TextureMapRole, TextureAssetRef>>): MaterialAsset {
  const result = validateMaterialAsset({
    id: 'phase-4-5',
    version: MATERIAL_ASSET_VERSION,
    label: 'PBR maps',
    type: 'painted',
    colorPolicy: 'object',
    baseColor: null,
    pbr: {
      metalness: 0.25,
      roughness: 0.75,
      opacity: 1,
      normalStrength: 0.6,
      textureScale: 1,
      emissiveIntensity: 2.5,
    },
    maps,
    uv: { mode: 'physical-box', tileCm: 50 },
    license: { kind: 'user-owned' },
  });
  if (!result.ok) throw new Error(result.message);
  return result.asset;
}

describe('buildMaterialFromAsset with advanced PBR maps', () => {
  it('assigns baseColor, normal, roughness, metalness, AO and emissive', () => {
    const maps = {
      baseColor: ref('baseColor'),
      normal: ref('normal'),
      roughness: ref('roughness'),
      metalness: ref('metalness'),
      ao: ref('ao'),
      emissive: ref('emissive'),
    } as const;
    const textures = new Map<TextureMapRole, THREE.Texture>();
    for (const role of Object.keys(maps) as TextureMapRole[]) {
      const value = new THREE.Texture();
      value.name = role;
      textures.set(role, value);
    }
    const resolve = vi.fn((r: TextureAssetRef) => ({
      texture: textures.get(r.role) as THREE.Texture,
      dispose: vi.fn(),
    }));

    const built = buildMaterialFromAsset('#ff0000', asset(maps), { resolveTexture: resolve });
    const material = built.material;

    expect(resolve).toHaveBeenCalledTimes(6);
    expect(material.map?.name).toBe('baseColor');
    expect(material.normalMap?.name).toBe('normal');
    expect(material.normalScale.x).toBe(0.6);
    expect(material.roughnessMap?.name).toBe('roughness');
    expect(material.metalnessMap?.name).toBe('metalness');
    expect(material.aoMap?.name).toBe('ao');
    expect(material.emissiveMap?.name).toBe('emissive');
    expect(material.emissiveIntensity).toBe(2.5);
    expect(material.metalness).toBe(0.25);
    expect(material.roughness).toBe(0.75);
    expect(material.emissive.getHexString()).toBe('ffffff');
    expect(built.missingTextures).toEqual([]);

    const disposers = resolve.mock.results.map((result) => result.value.dispose);
    built.dispose();
    for (const dispose of disposers) {
      expect(dispose).toHaveBeenCalledTimes(1);
    }
  });

  it('applies ORM to all three channels and lets a dedicated map win', () => {
    const maps = { orm: ref('orm'), roughness: ref('roughness') } as const;
    const orm = new THREE.Texture();
    orm.name = 'orm';
    const rough = new THREE.Texture();
    rough.name = 'roughness';
    const resolve = (r: TextureAssetRef) => ({
      texture: r.role === 'orm' ? orm : rough,
      dispose: vi.fn(),
    });

    const built = buildMaterialFromAsset('#ffffff', asset(maps), { resolveTexture: resolve });
    expect(built.material.aoMap).toBe(orm);
    expect(built.material.metalnessMap).toBe(orm);
    expect(built.material.roughnessMap).toBe(rough);
    expect(orm.colorSpace).toBe(THREE.NoColorSpace);
    built.dispose();
  });

  it('keeps the fallback material when one required map cannot resolve', () => {
    const maps = { baseColor: ref('baseColor'), normal: ref('normal') } as const;
    const base = new THREE.Texture();
    const resolve = (r: TextureAssetRef) =>
      r.role === 'normal'
        ? null
        : { texture: base, dispose: vi.fn() };

    const built = buildMaterialFromAsset('#ffffff', asset(maps), { resolveTexture: resolve });
    expect(built.material.map).toBe(base);
    expect(built.material.normalMap).toBeNull();
    expect(built.missingTextures).toEqual(['normal']);
    expect(built.material.metalness).toBe(0.25);
    expect(built.material.roughness).toBe(0.75);
    built.dispose();
  });

  it('applies role colour space to every data map', () => {
    const maps = {
      normal: ref('normal'),
      roughness: ref('roughness'),
      metalness: ref('metalness'),
      ao: ref('ao'),
      orm: ref('orm'),
    } as const;
    const textures = new Map<string, THREE.Texture>();
    const resolve = (r: TextureAssetRef) => {
      const value = new THREE.Texture();
      textures.set(r.role, value);
      return { texture: value, dispose: vi.fn() };
    };
    const built = buildMaterialFromAsset('#ffffff', asset(maps), { resolveTexture: resolve });
    for (const value of textures.values()) {
      expect(value.colorSpace).toBe(THREE.NoColorSpace);
    }
    built.dispose();
  });

  it('never mutates the asset while building', () => {
    const maps = { emissive: ref('emissive') } as const;
    const built = asset(maps);
    const before = JSON.stringify(built);
    buildMaterialFromAsset('#ffffff', built, {
      resolveTexture: () => ({ texture: new THREE.Texture(), dispose: vi.fn() }),
    }).dispose();
    expect(JSON.stringify(built)).toBe(before);
  });
});
