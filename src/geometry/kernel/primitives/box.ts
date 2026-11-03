import * as THREE from 'three';
import type { BoxRecipe } from '../types';

/** Plain box; defaults match Three.js' BoxGeometry segment defaults. */
export function createBox(recipe: BoxRecipe): THREE.BoxGeometry {
  return new THREE.BoxGeometry(
    recipe.width,
    recipe.height,
    recipe.depth,
    recipe.widthSegments ?? 1,
    recipe.heightSegments ?? 1,
    recipe.depthSegments ?? 1,
  );
}
