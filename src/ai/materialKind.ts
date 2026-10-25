/**
 * Bridge from the AI wire vocabulary to the existing W4 material catalogue.
 *
 * The backend reports `material_kind` as a broad category (`wood`, `metal`, ...),
 * while the renderer works with concrete PBR presets (`wood-oak`, ...). This
 * module is the single place where the two vocabularies meet; no new material
 * type or preset is introduced here.
 *
 * An unknown or missing category resolves to `null`, which means "leave the
 * object's material at its default" — never a guess.
 */
import { MATERIAL_PRESET_IDS } from '../materials/presets';
import type { MaterialPresetId } from '../materials/types';

/** Every category the backend may send, mapped onto an existing preset. */
const PRESET_BY_MATERIAL_KIND: Readonly<Record<string, MaterialPresetId>> = {
  wood: 'wood-oak',
  metal: 'metal-steel',
  fabric: 'fabric-linen',
  leather: 'leather-brown',
  glass: 'glass-clear',
};

/**
 * Preset id for an AI `material_kind`, or `null` when it is absent or unknown.
 *
 * The preset id is checked against the catalogue, so a renamed or removed preset
 * degrades to the default material instead of storing an id the renderer cannot
 * resolve.
 */
export function presetIdForMaterialKind(
  materialKind: string | null | undefined,
): MaterialPresetId | null {
  if (!materialKind) {
    return null;
  }
  const presetId = PRESET_BY_MATERIAL_KIND[materialKind.trim().toLowerCase()];
  if (!presetId || !MATERIAL_PRESET_IDS.has(presetId)) {
    return null;
  }
  return presetId;
}

export type { MaterialPresetId };
