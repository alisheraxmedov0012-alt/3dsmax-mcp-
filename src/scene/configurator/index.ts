export { checkSpecBuildable, type SpecBuildabilityResult } from './buildability';
export {
  canonicalizeFurnitureSpec,
  type CanonicalSpecResult,
} from './canonicalSpec';
export {
  getFurnitureParameters,
  type FurnitureParameterInfo,
  type FurnitureParameterSet,
} from './parameters';
export {
  updateFurnitureSpec,
  type SpecPatch,
  type SpecUpdateErrorCode,
  type SpecUpdateIssue,
  type SpecUpdateResult,
} from './updateSpec';
export {
  applyDesignPreset,
  findMatchingPreset,
  getDesignPresets,
  type DesignPreset,
} from './presets';
