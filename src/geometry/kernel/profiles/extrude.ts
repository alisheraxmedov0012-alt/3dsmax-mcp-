import * as THREE from 'three';
import type { ExtrudeRecipe, Vec2Tuple } from '../types';

function pathFromPoints(points: readonly Vec2Tuple[]): THREE.Vector2[] {
  return points.map(([x, y]) => new THREE.Vector2(x, y));
}

/** Extrude a closed 2D profile (with optional holes) along Z. */
export function createExtrude(recipe: ExtrudeRecipe): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape(pathFromPoints(recipe.profile));
  for (const hole of recipe.holes ?? []) {
    shape.holes.push(new THREE.Path(pathFromPoints(hole)));
  }

  return new THREE.ExtrudeGeometry(shape, {
    depth: recipe.depth,
    bevelEnabled: recipe.bevelEnabled ?? false,
    bevelThickness: recipe.bevelThickness ?? 0.2,
    bevelSize: recipe.bevelSize ?? 0.1,
    bevelSegments: recipe.bevelSegments ?? 2,
    curveSegments: recipe.curveSegments ?? 12,
    steps: recipe.steps ?? 1,
  });
}
