/**
 * Phase 5.3 — a minimal product-shadow catcher for captures where the room is
 * hidden. It is viewer-only: it never enters the export scene and is sized to
 * the selected piece rather than covering the whole floor.
 */
import * as THREE from 'three';
import { isValidBounds, type BoundsBox } from '../render/framing';

export interface ShadowCatcher {
  object: THREE.Mesh;
  update(bounds: BoundsBox | null | undefined, visible: boolean): void;
  dispose(): void;
}

const FLOOR_Y = 0.02;

export function createShadowCatcher(): ShadowCatcher {
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShadowMaterial({
    color: 0x000000,
    opacity: 0.3,
    transparent: true,
    depthWrite: false,
  });
  const object = new THREE.Mesh(geometry, material);
  object.name = 'shadow-catcher';
  object.receiveShadow = true;
  object.castShadow = false;
  object.frustumCulled = false;
  object.renderOrder = -1;
  object.visible = false;

  let disposed = false;

  return {
    object,
    update(bounds, visible) {
      if (disposed || !visible || !isValidBounds(bounds)) {
        object.visible = false;
        return;
      }
      const width = bounds.max.x - bounds.min.x;
      const depth = bounds.max.z - bounds.min.z;
      const size = Math.max(width, depth, 1) * 1.8 + 10;
      object.position.set(
        (bounds.min.x + bounds.max.x) / 2,
        FLOOR_Y,
        (bounds.min.z + bounds.max.z) / 2,
      );
      object.scale.set(size, 1, size);
      object.visible = true;
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      object.visible = false;
      geometry.dispose();
      material.dispose();
    },
  };
}
