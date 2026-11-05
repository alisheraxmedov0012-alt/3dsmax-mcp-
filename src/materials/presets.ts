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
  type MaterialCategory,
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
  /** Library category, shown by the material panel. */
  category: MaterialCategory;
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

/**
 * Built-in catalogue. The first eight entries are the original presets and keep
 * their ids and values; the rest extend the same families with distinct,
 * physically-plausible PBR values. All surface detail is procedural — no bitmap
 * texture is claimed here.
 */
export const MATERIAL_PRESETS: readonly MaterialPreset[] = [
  {
    id: DEFAULT_MATERIAL_ID,
    name: 'Standart',
    type: 'painted',
    category: 'painted',
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
    category: 'wood',
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
    category: 'metal',
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
    category: 'fabric',
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
    category: 'leather',
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
    category: 'glass',
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
    category: 'plastic',
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
    category: 'painted',
    color: '#c0392b',
    metalness: 0.05,
    roughness: 0.5,
    opacity: 1,
    textureScale: 1,
    normalStrength: 0.05,
  },
  {
    id: 'wood-walnut',
    name: "Yog'och (yong'oq)",
    type: 'wood',
    category: 'wood',
    color: '#5a3a28',
    metalness: 0,
    roughness: 0.55,
    opacity: 1,
    textureScale: 1.5,
    normalStrength: 0.35,
  },
  {
    id: 'wood-pine',
    name: "Yog'och (qarag'ay)",
    type: 'wood',
    category: 'wood',
    color: '#d8b07a',
    metalness: 0,
    roughness: 0.58,
    opacity: 1,
    textureScale: 1.25,
    normalStrength: 0.25,
  },
  {
    id: 'wood-beech',
    name: "Yog'och (buk)",
    type: 'wood',
    category: 'wood',
    color: '#c49a6c',
    metalness: 0,
    roughness: 0.6,
    opacity: 1,
    textureScale: 1.25,
    normalStrength: 0.22,
  },
  {
    id: 'wood-mahogany',
    name: "Yog'och (mahogani)",
    type: 'wood',
    category: 'wood',
    color: '#6b2f24',
    metalness: 0,
    roughness: 0.45,
    opacity: 1,
    textureScale: 1.5,
    normalStrength: 0.35,
  },
  {
    id: 'metal-chrome',
    name: 'Metall (xrom)',
    type: 'metal',
    category: 'metal',
    color: '#e6ebf0',
    metalness: 1,
    roughness: 0.08,
    opacity: 1,
    textureScale: 1,
    normalStrength: 0.02,
  },
  {
    id: 'metal-aluminum',
    name: 'Metall (alyuminiy)',
    type: 'metal',
    category: 'metal',
    color: '#b8bec5',
    metalness: 0.9,
    roughness: 0.4,
    opacity: 1,
    textureScale: 1.25,
    normalStrength: 0.08,
  },
  {
    id: 'metal-brass',
    name: 'Metall (jez)',
    type: 'metal',
    category: 'metal',
    color: '#c9a24b',
    metalness: 0.95,
    roughness: 0.32,
    opacity: 1,
    textureScale: 1.5,
    normalStrength: 0.06,
  },
  {
    id: 'fabric-velvet',
    name: 'Mato (baxmal)',
    type: 'fabric',
    category: 'fabric',
    color: '#5b2e4a',
    metalness: 0,
    roughness: 0.95,
    opacity: 1,
    textureScale: 1.5,
    normalStrength: 0.7,
  },
  {
    id: 'fabric-cotton',
    name: 'Mato (paxta)',
    type: 'fabric',
    category: 'fabric',
    color: '#e4ded1',
    metalness: 0,
    roughness: 0.88,
    opacity: 1,
    textureScale: 2.5,
    normalStrength: 0.5,
  },
  {
    id: 'fabric-polyester',
    name: 'Mato (poliester)',
    type: 'fabric',
    category: 'fabric',
    color: '#3f5d6d',
    metalness: 0,
    roughness: 0.7,
    opacity: 1,
    textureScale: 2,
    normalStrength: 0.35,
  },
  {
    id: 'leather-synthetic',
    name: "Charm (sun'iy)",
    type: 'leather',
    category: 'leather',
    color: '#2f2f33',
    metalness: 0,
    roughness: 0.35,
    opacity: 1,
    textureScale: 2,
    normalStrength: 0.4,
  },
  {
    id: 'leather-suede',
    name: 'Charm (zamsh)',
    type: 'leather',
    category: 'leather',
    color: '#8a6a52',
    metalness: 0,
    roughness: 0.8,
    opacity: 1,
    textureScale: 2.25,
    normalStrength: 0.75,
  },
  {
    id: 'glass-frosted',
    name: 'Shisha (xira)',
    type: 'glass',
    category: 'glass',
    color: '#d6e6ea',
    metalness: 0,
    roughness: 0.55,
    opacity: 0.55,
    textureScale: 1,
    normalStrength: 0.1,
  },
  {
    id: 'glass-tinted',
    name: 'Shisha (tusli)',
    type: 'glass',
    category: 'glass',
    color: '#4c6b73',
    metalness: 0,
    roughness: 0.08,
    opacity: 0.45,
    textureScale: 1,
    normalStrength: 0,
  },
  {
    id: 'plastic-matte',
    name: 'Plastmassa (mat)',
    type: 'plastic',
    category: 'plastic',
    color: '#cfd3d6',
    metalness: 0,
    roughness: 0.82,
    opacity: 1,
    textureScale: 1,
    normalStrength: 0.1,
  },
  {
    id: 'plastic-glossy',
    name: 'Plastmassa (yaltiroq)',
    type: 'plastic',
    category: 'plastic',
    color: '#1f2933',
    metalness: 0.02,
    roughness: 0.12,
    opacity: 1,
    textureScale: 1,
    normalStrength: 0.02,
  },
  {
    id: 'plastic-abs',
    name: 'Plastmassa (ABS)',
    type: 'plastic',
    category: 'plastic',
    color: '#b4b9be',
    metalness: 0,
    roughness: 0.5,
    opacity: 1,
    textureScale: 1.5,
    normalStrength: 0.12,
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
