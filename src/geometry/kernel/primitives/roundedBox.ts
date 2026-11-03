import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { RoundedBoxRecipe } from '../types';

/** Rounded box from the Three.js addon already bundled with the project. */
export function createRoundedBox(recipe: RoundedBoxRecipe): RoundedBoxGeometry {
  return new RoundedBoxGeometry(
    recipe.width,
    recipe.height,
    recipe.depth,
    recipe.segments ?? 4,
    recipe.radius,
  );
}
