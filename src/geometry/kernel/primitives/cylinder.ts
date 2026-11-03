import * as THREE from 'three';
import type { CylinderRecipe } from '../types';

export function createCylinder(recipe: CylinderRecipe): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(
    recipe.radiusTop,
    recipe.radiusBottom,
    recipe.height,
    recipe.radialSegments ?? 32,
    recipe.heightSegments ?? 1,
    recipe.openEnded ?? false,
    recipe.thetaStart ?? 0,
    recipe.thetaLength ?? Math.PI * 2,
  );
}
