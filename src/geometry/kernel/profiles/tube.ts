import * as THREE from 'three';
import type { TubeRecipe } from '../types';

/** Sweep a circular section along a Catmull-Rom curve. */
export function createTube(recipe: TubeRecipe): THREE.TubeGeometry {
  const curve = new THREE.CatmullRomCurve3(
    recipe.points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    recipe.closed ?? false,
  );
  return new THREE.TubeGeometry(
    curve,
    recipe.tubularSegments ?? 32,
    recipe.radius,
    recipe.radialSegments ?? 12,
    recipe.closed ?? false,
  );
}
