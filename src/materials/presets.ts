/**
 * W4 starter material catalogue.
 *
 * Every preset is defined locally from physically-plausible PBR values and is
 * available offline. No external texture or paid asset is referenced, so there
 * is no licensing concern: the finer surface detail is generated procedurally at
 * render time (see `materials/textures.ts`) and degrades to a plain PBR material
 * when texture generation is unavailable.
 */
import {
  DEFAULT_MATERIAL_ID,
  resolveMaterialSettings,
  type MaterialPresetId,
  type MaterialType,
  type MaterialSettingsInput,
  type ResolvedMaterialSettings,
} from './types';

export interface MaterialPreset {
  id: MaterialPresetId;
  /** Uzbek display name. */
  name: string;
  type: MaterialType;
  /**
   * Suggested base colour (hex) applied when the preset is chosen. `null` keeps
   * the object's current colour (used by the neutral "standart" preset).
   */
  color: string | null;
  metalness: number;
  roughness: number;
  opacity: number;
  textureScale: number;
  normalStrength: number;
}

export const MATERIAL_PRESETS: readonly MaterialPreset[] = [
  {
    id: DEFAULT_MATERIAL_ID,
    name: 'Standart',
    type: 'painted',
    color: null,
    metalness: 0.05,
    roughness: 0.6,
    opacity: 1,
    textureScale: 1,
    normalStrength: 0,
  },
  {
    id: 'wood-oak',
    name: "Yog'och (eman)",
    type: 'wood',
    color: '#a9744f',
    metalness: 0,
    roughness: 0.65,
    opacity: 1,
    textureScale: 1,
    normalStrength: 0.3,
  },
  {
    id: 'metal-steel',
    name: 'Metall (po\u2019lat)',
    type: 'metal',
    color: '#c9ced3',
    metalness: 0.95,
    roughness: 0.3,
    opacity: 1,
    textureScale: 1,
    normalStrength: 0.05,
  },
  {
    id: 'fabric-linen',
    name: 'Mato (zig\u2019ir)',
    type: 'fabric',
    color: '#7d8b99',
    metalness: 0,
    roughness: 0.9,
    opacity: 1,
    textureScale: 2,
    normalStrength: 0.6,
  },
  {
    id: 'leather-brown',
    name: 'Charm',
    type: 'leather',
    color: '#5b3a29',
    metalness: 0,
    roughness: 0.55,
    opacity: 1,
    textureScale: 1.5,
    normalStrength: 0.5,
  },
  {
    id: 'glass-clear',
    name: 'Shisha',
    type: 'glass',
    color: '#bfe3ea',
    metalness: 0,
    roughness: 0.05,
    opacity: 0.3,
    textureScale: 1,
    normalStrength: 0,
  },
  {
    id: 'plastic-white',
    name: 'Plastmassa',
    type: 'plastic',
    color: '#dcdcdc',
    metalness: 0,
    roughness: 0.4,
    opacity: 1,
    textureScale: 1,
    normalStrength: 0.05,
  },
  {
    id: 'painted-red',
    name: "Bo'yalgan sirt",
    type: 'painted',
    color: '#c0392b',
    metalness: 0.05,
    roughness: 0.5,
    opacity: 1,
    textureScale: 1,
    normalStrength: 0.05,
  },
];

/** Ids of every known preset; used to validate stored/edited values. */
export const MATERIAL_PRESET_IDS: ReadonlySet<string> = new Set(
  MATERIAL_PRESETS.map((preset) => preset.id),
);

const PRESETS_BY_ID = new Map(MATERIAL_PRESETS.map((preset) => [preset.id, preset]));

/** Look up a preset, falling back to the neutral default preset. */
export function getMaterialPreset(id: MaterialPresetId | null | undefined): MaterialPreset {
  if (id && PRESETS_BY_ID.has(id)) {
    return PRESETS_BY_ID.get(id) as MaterialPreset;
  }
  return PRESETS_BY_ID.get(DEFAULT_MATERIAL_ID) as MaterialPreset;
}

/**
 * Resolve material settings using the selected preset as the per-channel
 * fallback: a stored `materialId` alone renders with that preset's numbers, and
 * any explicitly stored channel overrides the preset. This is what the renderer
 * and the material panel both use, so a value the user sees is exactly the value
 * the renderer applies.
 */
export function resolvePresetSettings(
  input: MaterialSettingsInput | null | undefined,
): ResolvedMaterialSettings {
  const preset = getMaterialPreset(input?.materialId ?? undefined);
  return resolveMaterialSettings(input, MATERIAL_PRESET_IDS, {
    materialId: preset.id,
    metalness: preset.metalness,
    roughness: preset.roughness,
    opacity: preset.opacity,
    textureScale: preset.textureScale,
    normalStrength: preset.normalStrength,
  });
}
