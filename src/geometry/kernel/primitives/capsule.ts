import * as THREE from 'three';
import type { CapsuleRecipe } from '../types';

/** Three.js' core CapsuleGeometry; `length` excludes the two hemispherical caps. */
export function createCapsule(recipe: CapsuleRecipe): THREE.CapsuleGeometry {
  return new THREE.CapsuleGeometry(
    recipe.radius,
    recipe.length,
    recipe.capSegments ?? 4,
    recipe.radialSegments ?? 16,
  );
}
