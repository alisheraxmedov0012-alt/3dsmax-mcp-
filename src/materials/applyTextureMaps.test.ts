import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyTextureMapToGroup,
  applyTextureMapToMaterial,
  presentTextureMapRoles,
  TEXTURE_MAP_APPLY_ORDER,
  textureMapsKey,
} from './applyTextureMaps';
import type { MaterialAssetMaps } from './asset';

function texture(name: string): THREE.Texture {
  const value = new THREE.Texture();
  value.name = name;
  return value;
}

function material(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ metalness: 0.2, roughness: 0.7 });
}

describe('applyTextureMapToMaterial', () => {
  it('maps baseColor to map and clears the tint', () => {
    const target = material();
    target.color.set('#123456');
    applyTextureMapToMaterial(target, 'baseColor', texture('base'));
    expect(target.map?.name).toBe('base');
    expect(target.color.getHexString()).toBe('ffffff');
  });

  it('maps normal and applies normalScale', () => {
    const target = material();
    applyTextureMapToMaterial(target, 'normal', texture('normal'), { normalStrength: 0.75 });
    expect(target.normalMap?.name).toBe('normal');
    expect(target.normalScale.x).toBe(0.75);
    expect(target.normalScale.y).toBe(0.75);
  });

  it('maps roughness and metalness to their own slots', () => {
    const target = material();
    applyTextureMapToMaterial(target, 'roughness', texture('rough'));
    expect(target.roughnessMap?.name).toBe('rough');
    expect(target.metalnessMap).toBeNull();

    applyTextureMapToMaterial(target, 'metalness', texture('metal'));
    expect(target.metalnessMap?.name).toBe('metal');
    expect(target.roughnessMap?.name).toBe('rough');

    // The scalar factors stay as authored; the maps multiply them in the shader.
    expect(target.roughness).toBe(0.7);
    expect(target.metalness).toBe(0.2);
  });

  it('maps emissive and preserves emissiveIntensity', () => {
    const target = material();
    applyTextureMapToMaterial(target, 'emissive', texture('emissive'), {
      emissiveIntensity: 3,
    });
    expect(target.emissiveMap?.name).toBe('emissive');
    expect(target.emissive.getHexString()).toBe('ffffff');
    expect(target.emissiveIntensity).toBe(3);
  });

  it('maps AO to the primary UV channel', () => {
    const target = material();
    const ao = texture('ao');
    applyTextureMapToMaterial(target, 'ao', ao);
    expect(target.aoMap).toBe(ao);
    expect(ao.channel).toBe(0);
    expect(target.aoMapIntensity).toBe(1);
  });

  it('applies one ORM image to AO, roughness and metalness (glTF channels)', () => {
    const target = material();
    const orm = texture('orm');
    applyTextureMapToMaterial(target, 'orm', orm);
    expect(target.aoMap).toBe(orm);
    expect(target.roughnessMap).toBe(orm);
    expect(target.metalnessMap).toBe(orm);
    expect(orm.channel).toBe(0);
  });

  it('lets a dedicated map win over the packed ORM channels', () => {
    const maps: MaterialAssetMaps = {
      orm: {
        id: 'tex-orm',
        version: 1,
        role: 'orm',
        colorSpace: 'linear',
        wrap: 'repeat',
      },
      roughness: {
        id: 'tex-rough',
        version: 1,
        role: 'roughness',
        colorSpace: 'linear',
        wrap: 'repeat',
      },
    };
    const target = material();
    const orm = texture('orm');
    const rough = texture('rough');
    // Mirror the application order used by the builder/viewer/exporter.
    for (const role of TEXTURE_MAP_APPLY_ORDER) {
      if (!maps[role]) continue;
      applyTextureMapToMaterial(target, role, role === 'orm' ? orm : rough);
    }
    expect(target.roughnessMap).toBe(rough);
    expect(target.metalnessMap).toBe(orm);
    expect(target.aoMap).toBe(orm);
  });
});

describe('group helpers', () => {
  it('applies once per unique standard material and skips other types', () => {
    const root = new THREE.Group();
    const shared = material();
    const basic = new THREE.MeshBasicMaterial();
    const meshA = new THREE.Mesh(new THREE.BoxGeometry(), shared);
    const meshB = new THREE.Mesh(new THREE.BoxGeometry(), shared);
    const meshC = new THREE.Mesh(new THREE.BoxGeometry(), basic);
    root.add(meshA, meshB, meshC);

    const applied = applyTextureMapToGroup(root, 'roughness', texture('rough'));
    expect(applied).toBe(1);
    expect(shared.roughnessMap?.name).toBe('rough');
  });

  it('builds a deterministic key from roles, versions and repeat', () => {
    const maps = {
      baseColor: { id: 'a', version: 1 },
      orm: { id: 'b', version: 2 },
    };
    expect(textureMapsKey(maps, 2)).toBe('orm:b@2:repeat|baseColor:a@1:repeat#2');
    expect(textureMapsKey(maps, 2)).toBe(textureMapsKey(maps, 2));
    expect(textureMapsKey(maps, 3)).not.toBe(textureMapsKey(maps, 2));
  });

  it('lists only present roles in application order', () => {
    expect(presentTextureMapRoles(undefined)).toEqual([]);
    expect(
      presentTextureMapRoles({ emissive: {}, orm: {}, normal: {} } as never),
    ).toEqual(['orm', 'normal', 'emissive']);
  });
});
