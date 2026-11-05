/**
 * Phase 4.3B — apply one resolved bitmap to the materials of a built object.
 *
 * The geometry builders intentionally stay unaware of bitmap assets. This
 * post-build step is the single place where a baseColor texture meets a
 * `MeshStandardMaterial`, shared by the viewport and the export pipeline.
 */
import * as THREE from 'three';
import { applyTextureMapToGroup } from './applyTextureMaps';

/**
 * Set `map` on every unique `MeshStandardMaterial` under `root`.
 *
 * The base colour is set to white so the bitmap is not tinted by the object's
 * colour control; removing the texture rebuilds the object and restores the
 * original material. Returns the number of materials changed.
 *
 * Kept as the Phase 4.3 entry point; Phase 4.5 routes every role through the
 * shared `applyTextureMapToGroup` implementation.
 */
export function applyBaseColorTextureToGroup(
  root: THREE.Object3D,
  texture: THREE.Texture,
): number {
  return applyTextureMapToGroup(root, 'baseColor', texture);
}
