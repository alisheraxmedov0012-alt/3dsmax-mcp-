import * as THREE from 'three';
import type { SphereRecipe } from '../types';

export function createSphere(recipe: SphereRecipe): THREE.SphereGeometry {
  return new THREE.SphereGeometry(
    recipe.radius,
    recipe.widthSegments ?? 24,
    recipe.heightSegments ?? 16,
    recipe.phiStart ?? 0,
    recipe.phiLength ?? Math.PI * 2,
    recipe.thetaStart ?? 0,
    recipe.thetaLength ?? Math.PI,
  );
}
