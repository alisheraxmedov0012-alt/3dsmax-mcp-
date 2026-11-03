import * as THREE from 'three';
import type { LatheRecipe } from '../types';

/** Revolve a 2D radius/height profile around the Y axis. */
export function createLathe(recipe: LatheRecipe): THREE.LatheGeometry {
  const points = recipe.points.map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(
    points,
    recipe.segments ?? 32,
    recipe.phiStart ?? 0,
    recipe.phiLength ?? Math.PI * 2,
  );
}
