import { describe, expect, it } from 'vitest';
import { furnitureDefinitions } from '../../geometry/universal';
import {
  applyDesignPreset,
  findMatchingPreset,
  getDesignPresets,
  getFurnitureParameters,
  updateFurnitureSpec,
} from './index';

const DEFINITION_IDS = [
  'desk.computer',
  'desk.gaming',
  'table.dining',
  'desk.writing',
  'chair.office',
  'chair.dining',
  'chair.armchair',
  'chair.ergonomic',
  'sofa.standard',
  'cabinet.standard',
  'bed.standard',
  'kitchen.baseCabinet',
  'stand.tv',
] as const;

function defaultsOf(definitionId: string) {
  const parameters = getFurnitureParameters(definitionId);
  if (!parameters) throw new Error(`no parameters for ${definitionId}`);
  return parameters.defaults;
}

describe('design preset catalog', () => {
  it.each(DEFINITION_IDS)('every preset of %s builds through the Universal Core', (definitionId) => {
    const presets = getDesignPresets(definitionId);
    expect(presets.length).toBeGreaterThan(0);
    expect(presets[0].id).toBe('standard');

    for (const preset of presets) {
      const result = applyDesignPreset(definitionId, preset.id);
      expect(result.ok, `${definitionId}/${preset.id}: ${JSON.stringify(result)}`).toBe(true);
    }
  });

  it.each(DEFINITION_IDS)('standard of %s equals the definition defaults', (definitionId) => {
    const result = applyDesignPreset(definitionId, 'standard');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec).toEqual(defaultsOf(definitionId));
  });

  it.each(DEFINITION_IDS)('non-standard presets of %s differ from the defaults', (definitionId) => {
    const defaults = defaultsOf(definitionId);
    for (const preset of getDesignPresets(definitionId)) {
      if (preset.id === 'standard') continue;
      const result = applyDesignPreset(definitionId, preset.id);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.spec, `${definitionId}/${preset.id}`).not.toEqual(defaults);
      // A preset only touches channels the definition declares.
      const declared = new Set(Object.keys(defaults));
      for (const key of Object.keys(preset.patch)) {
        expect(declared.has(key), `${definitionId}/${preset.id}: ${key}`).toBe(true);
      }
    }
  });

  it('only applies a preset to its own definition', () => {
    // `compact` exists for the desk, but the preset ids are catalogued per
    // definition — an id from another definition is still resolved there.
    expect(getDesignPresets('desk.computer').map((preset) => preset.id)).toContain('compact');
    expect(getDesignPresets('chair.dining').map((preset) => preset.id)).toContain('compact');

    // A definition without catalog entries falls back to Standard only.
    expect(getDesignPresets('desk.missing')).toEqual([]);
    const unknown = applyDesignPreset('desk.computer', 'no-such-preset');
    expect(unknown.ok).toBe(false);
    if (unknown.ok) return;
    expect(unknown.issues[0].code).toBe('unknown_preset');
  });

  it('does not validate an unknown definition', () => {
    expect(getDesignPresets('desk.missing')).toEqual([]);
  });

  it('matches the preset that produced the current spec', () => {
    const defaults = defaultsOf('desk.computer');
    expect(findMatchingPreset('desk.computer', defaults)?.id).toBe('standard');

    const compact = applyDesignPreset('desk.computer', 'compact');
    expect(compact.ok).toBe(true);
    if (!compact.ok) return;
    expect(findMatchingPreset('desk.computer', compact.spec)?.id).toBe('compact');
  });

  it('reports a custom spec as unmatched', () => {
    const custom = updateFurnitureSpec('desk.computer', defaultsOf('desk.computer'), {
      width: 171,
    });
    expect(custom.ok).toBe(true);
    if (!custom.ok) return;
    expect(findMatchingPreset('desk.computer', custom.spec)).toBeNull();
  });

  it('keeps every definition addressable by the registry', () => {
    expect(furnitureDefinitions.list()).toHaveLength(13);
  });
});
