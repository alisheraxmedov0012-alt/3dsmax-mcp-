export {
  GEOMETRY_KERNEL_VERSION,
  GEOMETRY_LIMITS,
  GeometryKernelError,
  type BoxRecipe,
  type CapsuleRecipe,
  type CreateGeometryOptions,
  type CustomGeometryRecipe,
  type CylinderRecipe,
  type ExtrudeRecipe,
  type GeometryKernelErrorCode,
  type GeometryRecipe,
  type GeometryRecipeKind,
  type GeometryStats,
  type GeometryValidationResult,
  type KernelGeometry,
  type LatheRecipe,
  type RoundedBoxRecipe,
  type SphereRecipe,
  type TubeRecipe,
  type Vec2Tuple,
  type Vec3Tuple,
} from './types';
export { createGeometry } from './geometryFactory';
export { validateRecipe } from './validation/validateRecipe';
export { validateGeometry } from './validation/validateGeometry';
export { validateNormals, type NormalValidation, type NormalValidationOptions } from './validation/validateNormals';
export {
  validateDegenerate,
  type DegenerateValidation,
} from './validation/validateDegenerate';
export {
  assertGeometryBudget,
  disposeGeometries,
  geometryStats,
  type GeometryBudget,
} from './optimization/optimizeGeometry';
