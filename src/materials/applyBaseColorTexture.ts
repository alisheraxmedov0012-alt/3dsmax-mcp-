/**
 * Phase 4.3B — apply one resolved bitmap to the materials of a built object.
 *
 * The geometry builders intentionally stay unaware of bitmap assets. This
 * post-build step is the single place where a baseColor texture meets a
 * `MeshStandardMaterial`, shared by the viewport and the export pipeline.
 */
import * as THREE from 'three';

/**
 * Set `map` on every unique `MeshStandardMaterial` under `root`.
 *
 * The base colour is set to white so the bitmap is not tinted by the object's
 * colour control; removing the texture rebuilds the object and restores the
 * original material. Returns the number of materials changed.
 */
export function applyBaseColorTextureToGroup(
  root: THREE.Object3D,
  texture: THREE.Texture,
): number {
  const seen = new Set<THREE.Material>();
  let applied = 0;
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial) || seen.has(material)) {
        continue;
      }
      seen.add(material);
      material.map = texture;
      material.color.set('#ffffff');
      material.needsUpdate = true;
      applied += 1;
    }
  });
  return applied;
}
