import type * as THREE from 'three';
import { createCapsule } from './primitives/capsule';
import { createBox } from './primitives/box';
import { createCylinder } from './primitives/cylinder';
import { createRoundedBox } from './primitives/roundedBox';
import { createSphere } from './primitives/sphere';
import { createExtrude } from './profiles/extrude';
import { createLathe } from './profiles/lathe';
import { createTube } from './profiles/tube';
import { createCustomGeometry } from './custom/customGeometry';
import { validateRecipe } from './validation/validateRecipe';
import { validateGeometry } from './validation/validateGeometry';
import { assertGeometryBudget } from './optimization/optimizeGeometry';
import {
  GEOMETRY_KERNEL_VERSION,
  GeometryKernelError,
  type CreateGeometryOptions,
  type GeometryRecipe,
  type KernelGeometry,
} from './types';

function build(recipe: GeometryRecipe): THREE.BufferGeometry {
  switch (recipe.kind) {
    case 'box':
      return createBox(recipe);
    case 'roundedBox':
      return createRoundedBox(recipe);
    case 'cylinder':
      return createCylinder(recipe);
    case 'sphere':
      return createSphere(recipe);
    case 'capsule':
      return createCapsule(recipe);
    case 'extrude':
      return createExtrude(recipe);
    case 'lathe':
      return createLathe(recipe);
    case 'tube':
      return createTube(recipe);
    case 'custom':
      return createCustomGeometry(recipe);
    default: {
      const exhaustive: never = recipe;
      throw new GeometryKernelError(
        'unsupported_recipe',
        `Qo'llab-quvvatlanmaydigan geometry recipe: ${String(exhaustive)}`,
      );
    }
  }
}

/**
 * Build and validate one geometry from a declarative recipe.
 *
 * Any failure disposes the partially constructed geometry before rethrowing, so
 * a rejected recipe never leaves an unattached GPU buffer behind.
 */
export function createGeometry(
  recipe: GeometryRecipe,
  options: CreateGeometryOptions = {},
): KernelGeometry {
  validateRecipe(recipe);

  let geometry: THREE.BufferGeometry | null = null;
  try {
    geometry = build(recipe);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const validation = validateGeometry(geometry, options);
    const rejectDegenerate = options.rejectDegenerate ?? false;
    const problems = [...validation.errors];
    if (rejectDegenerate && validation.hasDegenerateTriangles) {
      problems.push('degenerativ triangle aniqlandi.');
    }
    if (problems.length > 0) {
      throw new GeometryKernelError('invalid_geometry', problems.join(' '));
    }

    assertGeometryBudget(geometry, {
      maxVertices: options.maxVertices,
      maxTriangles: options.maxTriangles,
    });

    geometry.userData.kernel = {
      version: GEOMETRY_KERNEL_VERSION,
      kind: recipe.kind,
      warnings: validation.warnings,
    };
    return geometry as KernelGeometry;
  } catch (error) {
    geometry?.dispose();
    if (error instanceof GeometryKernelError) {
      throw error;
    }
    throw new GeometryKernelError(
      'invalid_geometry',
      error instanceof Error ? error.message : 'Geometry yaratilmadi.',
    );
  }
}
