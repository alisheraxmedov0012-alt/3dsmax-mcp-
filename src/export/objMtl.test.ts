/**
 * Phase 6.1-B — deterministic OBJ/MTL writer tests.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { exportObjWithMtl } from './objMtl';
import { testPngBytes } from './pngFixture';
import { sha256Hex } from '../util/sha256';

function sceneWithMaterials(): {
  scene: THREE.Scene;
  material: THREE.MeshStandardMaterial;
  second: THREE.MeshStandardMaterial;
  texture: THREE.Texture;
} {
  const scene = new THREE.Scene();
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ name: 'oak', color: '#ffffff' });
  material.map = texture;
  material.normalMap = texture;
  const second = new THREE.MeshStandardMaterial({ name: 'oak', color: '#cccccc' });
  second.map = texture;

  const top = new THREE.Mesh(new THREE.BoxGeometry(10, 2, 10), material);
  top.name = 'table-top';
  const leg = new THREE.Mesh(new THREE.BoxGeometry(2, 10, 2), second);
  leg.name = 'table-leg';
  leg.position.set(10, 5, 0);
  scene.add(top, leg);
  return { scene, material, second, texture };
}

describe('exportObjWithMtl', () => {
  it('writes OBJ names, mtllib and unique MTL materials', async () => {
    const { scene } = sceneWithMaterials();
    const png = testPngBytes(4, 4);
    const result = await exportObjWithMtl(scene, {
      textureEncoder: vi.fn(async () => png),
    });

    const obj = new TextDecoder().decode(result.objBytes);
    const mtl = new TextDecoder().decode(result.mtlBytes);
    expect(obj.startsWith('mtllib model.mtl\n')).toBe(true);
    expect(obj).toContain('o table-top');
    expect(obj).toContain('o table-leg');
    expect(obj).toContain('usemtl oak');
    expect(obj).toContain('usemtl oak-2');
    expect(mtl).toContain('newmtl oak');
    expect(mtl).toContain('newmtl oak-2');
    expect(mtl).toContain('Kd 1 1 1');
    expect(result.stats.objects).toBe(2);
    expect(result.stats.vertices).toBeGreaterThan(0);
    expect(result.stats.faces).toBeGreaterThan(0);
  });

  it('deduplicates identical texture bytes and preserves both role names', async () => {
    const { scene, texture } = sceneWithMaterials();
    const encoder = vi.fn(async () => testPngBytes(4, 4));
    const result = await exportObjWithMtl(scene, { textureEncoder: encoder });

    // The same bytes serve baseColor and normal, so there is one file; its name
    // lists both roles and both MTL directives point at that file.
    expect(result.textures).toHaveLength(1);
    const sidecar = result.textures[0];
    expect(sidecar.role).toBe('baseColor+normal');
    expect(sidecar.roles).toEqual(['baseColor', 'normal']);
    expect(sidecar.file).toBe(
      `textures/${sha256Hex(testPngBytes(4, 4))}-baseColor+normal.png`,
    );
    expect(encoder).toHaveBeenCalledTimes(2);

    const mtl = new TextDecoder().decode(result.mtlBytes);
    const kdRefs = [
      ...mtl.matchAll(
        new RegExp(`map_Kd ..\\/${sidecar.file.replace(/[.+]/gu, '\\$&')}`, 'gu'),
      ),
    ];
    expect(kdRefs).toHaveLength(2);
    expect(new Set(kdRefs.map((match) => match[0])).size).toBe(1);
    expect(
      mtl.match(
        new RegExp(`map_Bump -bm 1 ..\\/${sidecar.file.replace(/[.+]/gu, '\\$&')}`, 'gu'),
      ),
    ).toHaveLength(1);
    expect(texture).toBeDefined();
  });

  it('uses every MTL texture reference as a relative POSIX path', async () => {
    const { scene } = sceneWithMaterials();
    const result = await exportObjWithMtl(scene, {
      textureEncoder: async () => testPngBytes(2, 2),
    });
    const mtl = new TextDecoder().decode(result.mtlBytes);
    const refs = [...mtl.matchAll(/^(?:map_Kd|map_Bump(?:\s+-bm\s+\S+)?)\s+(.+)$/gmu)].map(
      (match) => match[1],
    );
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.startsWith('../textures/')).toBe(true);
      expect(ref).not.toContain('..\\');
      expect(ref).not.toContain('/../');
    }
  });

  it('fails instead of omitting a texture the MTL needs', async () => {
    const { scene } = sceneWithMaterials();
    await expect(
      exportObjWithMtl(scene, {
        textureEncoder: async () => {
          throw new Error('encode failed');
        },
      }),
    ).rejects.toThrow(/encode failed/);
  });
});
