/**
 * Public surface of the materials layer.
 *
 * Serializable models (`asset`, `presets`, `textureSource`, `library`) stay free
 * of Three.js; runtime objects come only from `buildMaterial` and `textures`.
 */
export * from './types';
export * from './asset';
export * from './textureSource';
export * from './library';
export {
  applyTextureResolution,
  buildMaterialFromAsset,
  buildPbrMaterial,
} from './buildMaterial';
export type {
  BuiltAssetMaterial,
  BuiltMaterial,
  MaterialBuildDependencies,
  PbrMaterialBuildOptions,
  ResolvedMaterialTexture,
} from './buildMaterial';
export {
  MATERIAL_PRESET_IDS,
  MATERIAL_PRESETS,
  getMaterialPreset,
  resolvePresetSettings,
} from './presets';
export type { MaterialPreset } from './presets';
export {
  DEFAULT_TEXTURE_SIZE,
  MAX_CACHED_TEXTURE_SETS,
  cachedTextureCount,
  createProceduralTextures,
  heightToNormal,
  patternHeight,
} from './textures';
export type { ProceduralTextures } from './textures';
export {
  MAX_UV_ABS,
  UV_TILE_CM,
  applyPhysicalBoxUvs,
  applyUvMapping,
  boxFaceUvScale,
  describeUvLayout,
  getUvDiagnostics,
  setUvDiagnostics,
  uvModeForRecipe,
  uvOrientationForPart,
  validateUvGeometry,
} from './uv';
export type {
  BoxUvScale,
  UvDiagnostics,
  UvLayoutRecord,
  UvLayoutSummary,
  UvMappingMode,
  UvMappingOptions,
  UvMappingResult,
  UvOrientation,
  UvPlane,
  UvRecipeDescriptor,
  UvRequestedMode,
} from './uv';
