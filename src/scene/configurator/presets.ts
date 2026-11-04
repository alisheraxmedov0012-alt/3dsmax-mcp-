/**
 * Stage 3.2 — design presets for the universal configurator.
 *
 * A preset is an absolute configuration: a patch merged over the definition's own
 * defaults and validated by the Universal Core, never a set of guessed limits.
 * Only parameters that already exist in the definition are touched, and every
 * entry is exercised by `presets.test.ts`, so an invalid entry fails the build
 * instead of reaching a user.
 *
 * Presets are per definition: a catalog entry can never be applied to another
 * piece. `Custom` is not a preset — it is the absence of a match, so the user's
 * own values are never overwritten by a preset that happens to be selected.
 */
import { getFurnitureDefinition } from '../../geometry/universal/registry';
import type { SceneSpec } from '../types';
import { canonicalizeFurnitureSpec } from './canonicalSpec';
import { updateFurnitureSpec, type SpecPatch, type SpecUpdateResult } from './updateSpec';

export interface DesignPreset {
  readonly id: string;
  readonly label: string;
  /** Values merged over the definition defaults. */
  readonly patch: SpecPatch;
}

const STANDARD: DesignPreset = { id: 'standard', label: 'Standart', patch: {} };

/**
 * Catalog, keyed by definition id. Values stay close to the definition defaults
 * and only use channels the definition declares; anything that does not build is
 * caught by the catalog test.
 */
const PRESETS: Readonly<Record<string, readonly DesignPreset[]>> = {
  'bed.standard': [
    STANDARD,
    { id: 'compact', label: 'Ixcham', patch: { width: 140, headboardWidth: 140 } },
    { id: 'spacious', label: 'Keng', patch: { width: 180 } },
  ],
  'cabinet.standard': [
    STANDARD,
    { id: 'compact', label: 'Ixcham', patch: { width: 90, height: 90 } },
    { id: 'spacious', label: 'Keng', patch: { width: 150, height: 120 } },
  ],
  'chair.armchair': [
    STANDARD,
    { id: 'compact', label: 'Ixcham', patch: { seatWidth: 48, seatDepth: 46, backrestWidth: 46 } },
    { id: 'spacious', label: 'Keng', patch: { seatWidth: 56, seatDepth: 54 } },
  ],
  'chair.dining': [
    STANDARD,
    { id: 'compact', label: 'Ixcham', patch: { seatWidth: 42, seatDepth: 40, backrestWidth: 41 } },
    { id: 'spacious', label: 'Keng', patch: { seatWidth: 50, seatDepth: 46 } },
  ],
  'chair.ergonomic': [
    STANDARD,
    { id: 'compact', label: 'Ixcham', patch: { seatWidth: 46, seatDepth: 44 } },
    { id: 'spacious', label: 'Keng', patch: { seatWidth: 54, seatDepth: 52 } },
  ],
  'chair.office': [
    STANDARD,
    { id: 'compact', label: 'Ixcham', patch: { seatWidth: 44, seatDepth: 44, backrestWidth: 43 } },
    { id: 'spacious', label: 'Keng', patch: { seatWidth: 52, seatDepth: 50 } },
  ],
  'desk.computer': [
    STANDARD,
    { id: 'compact', label: 'Ixcham', patch: { width: 120, depth: 70 } },
    { id: 'spacious', label: 'Keng', patch: { width: 180, depth: 90 } },
  ],
  'desk.gaming': [
    STANDARD,
    { id: 'compact', label: 'Ixcham', patch: { width: 140, depth: 70 } },
    { id: 'spacious', label: 'Keng', patch: { width: 180, depth: 85 } },
  ],
  'desk.writing': [
    STANDARD,
    { id: 'compact', label: 'Ixcham', patch: { width: 120, depth: 65, drawerDepth: 35 } },
    { id: 'spacious', label: 'Keng', patch: { width: 160, depth: 80 } },
  ],
  'kitchen.baseCabinet': [
    STANDARD,
    { id: 'compact', label: 'Ixcham', patch: { width: 45 } },
    { id: 'spacious', label: 'Keng', patch: { width: 90 } },
  ],
  'sofa.standard': [
    STANDARD,
    { id: 'compact', label: 'Ixcham', patch: { width: 180 } },
    { id: 'spacious', label: 'Keng', patch: { width: 240 } },
  ],
  'stand.tv': [
    STANDARD,
    { id: 'compact', label: 'Ixcham', patch: { width: 140 } },
    { id: 'spacious', label: 'Keng', patch: { width: 200 } },
  ],
  'table.dining': [
    STANDARD,
    { id: 'compact', label: 'Ixcham', patch: { width: 140, depth: 80 } },
    { id: 'spacious', label: 'Keng', patch: { width: 200, depth: 100 } },
  ],
};

/** Presets declared for a definition; every known definition has at least one. */
export function getDesignPresets(definitionId: string): readonly DesignPreset[] {
  if (!getFurnitureDefinition(definitionId)) {
    return [];
  }
  return PRESETS[definitionId] ?? [STANDARD];
}

/**
 * Applies a preset over the definition defaults and validates the result through
 * the same pipeline as a manual edit. An unknown preset (wrong definition, typo)
 * is an error, never a silent no-op.
 */
export function applyDesignPreset(definitionId: string, presetId: string): SpecUpdateResult {
  const preset = getDesignPresets(definitionId).find((entry) => entry.id === presetId);
  if (!preset) {
    return {
      ok: false,
      issues: [
        {
          code: 'unknown_preset',
          message: `"${presetId}" preseti "${definitionId}" uchun mavjud emas.`,
        },
      ],
    };
  }

  const definition = getFurnitureDefinition(definitionId);
  if (!definition) {
    return {
      ok: false,
      issues: [{ code: 'unknown_definition', message: `Definition "${definitionId}" topilmadi.` }],
    };
  }

  return updateFurnitureSpec(definitionId, definition.defaults, preset.patch);
}

function sameSpec(left: SceneSpec, right: SceneSpec): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) {
    return false;
  }
  return leftKeys.every((key) => key in right && left[key] === right[key]);
}

const resolvedPresetCache = new Map<string, SceneSpec | null>();

/** Canonical spec a preset produces, or null when the preset cannot be resolved. */
function presetSpec(definitionId: string, preset: DesignPreset): SceneSpec | null {
  const key = `${definitionId}:${preset.id}`;
  const cached = resolvedPresetCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const definition = getFurnitureDefinition(definitionId);
  // Canonicalisation only (no plan): presets are validated by the catalog test and
  // again by `applyDesignPreset`, this just answers "which preset is selected?".
  const resolved = definition
    ? canonicalizeFurnitureSpec(definitionId, { ...definition.defaults, ...preset.patch })
    : null;
  const spec = resolved?.ok ? resolved.spec : null;
  resolvedPresetCache.set(key, spec);
  return spec;
}

/** The preset whose configuration equals `spec`, or null for a custom setup. */
export function findMatchingPreset(definitionId: string, spec: SceneSpec): DesignPreset | null {
  for (const preset of getDesignPresets(definitionId)) {
    const expected = presetSpec(definitionId, preset);
    if (expected && sameSpec(expected, spec)) {
      return preset;
    }
  }
  return null;
}
