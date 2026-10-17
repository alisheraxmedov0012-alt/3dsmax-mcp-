import { describe, expect, it } from 'vitest';
import { ASSEMBLY_KINDS } from '../../scene/types';
import {
  ASSEMBLY_DEFAULTS,
  ASSEMBLY_FIELDS,
  assemblyDefaults,
  kitchenRunWidthCm,
  requireAssemblyParams,
  stairTotalRiseCm,
  stairTotalRunCm,
  validateAssemblyParams,
} from './params';
import { AssemblyError } from './limits';

describe('W14 assembly parameter schemas', () => {
  it('defines defaults and field ranges for all four kinds', () => {
    for (const kind of ASSEMBLY_KINDS) {
      expect(ASSEMBLY_DEFAULTS[kind]).toBeDefined();
      expect(ASSEMBLY_FIELDS[kind]).toBeDefined();
      // Every non-colour default channel has a declared range.
      for (const key of Object.keys(ASSEMBLY_FIELDS[kind])) {
        expect(ASSEMBLY_DEFAULTS[kind]).toHaveProperty(key);
      }
      expect(ASSEMBLY_DEFAULTS[kind].color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('returns an independent copy of the defaults', () => {
    const first = assemblyDefaults('wall-cabinet');
    const second = assemblyDefaults('wall-cabinet');
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    first.widthCm = 999;
    expect(second.widthCm).toBe(80);
    expect(ASSEMBLY_DEFAULTS['wall-cabinet'].widthCm).toBe(80);
  });

  it('fills missing channels from the defaults', () => {
    const params = validateAssemblyParams('wardrobe-section', { widthCm: 200 });
    expect(params).not.toBeNull();
    expect(params?.widthCm).toBe(200);
    expect(params?.heightCm).toBe(ASSEMBLY_DEFAULTS['wardrobe-section'].heightCm);
    expect(params?.sectionCount).toBe(ASSEMBLY_DEFAULTS['wardrobe-section'].sectionCount);
  });

  it('accepts a complete valid parameter set for every kind', () => {
    for (const kind of ASSEMBLY_KINDS) {
      const params = validateAssemblyParams(kind, assemblyDefaults(kind));
      expect(params, kind).not.toBeNull();
    }
  });

  it('rejects an out-of-range value', () => {
    expect(validateAssemblyParams('wall-cabinet', { widthCm: 39 })).toBeNull();
    expect(validateAssemblyParams('wall-cabinet', { widthCm: 121 })).toBeNull();
    expect(validateAssemblyParams('stair-straight', { riseCm: 21 })).toBeNull();
    expect(validateAssemblyParams('kitchen-base-run', { moduleCount: 5 })).toBeNull();
  });

  it('rejects a non-integer value for an integer channel', () => {
    expect(validateAssemblyParams('wardrobe-section', { sectionCount: 1.5 })).toBeNull();
    expect(validateAssemblyParams('stair-straight', { stepCount: 7.5 })).toBeNull();
  });

  it('rejects booleans, strings, NaN and null-shaped input', () => {
    expect(validateAssemblyParams('wall-cabinet', { widthCm: true })).toBeNull();
    expect(validateAssemblyParams('wall-cabinet', { widthCm: '80' })).toBeNull();
    expect(validateAssemblyParams('wall-cabinet', { widthCm: Number.NaN })).toBeNull();
    expect(validateAssemblyParams('wall-cabinet', { widthCm: Infinity })).toBeNull();
    expect(validateAssemblyParams('wall-cabinet', null)).toBeNull();
    expect(validateAssemblyParams('wall-cabinet', [1, 2])).toBeNull();
    expect(validateAssemblyParams('wall-cabinet', 'nope')).toBeNull();
  });

  it('rejects an invalid colour', () => {
    expect(validateAssemblyParams('wall-cabinet', { color: 'red' })).toBeNull();
    expect(validateAssemblyParams('wall-cabinet', { color: '#fff' })).toBeNull();
  });

  it('normalises a valid colour to lower case', () => {
    const params = validateAssemblyParams('wall-cabinet', { color: '#A9744F' });
    expect(params?.color).toBe('#a9744f');
  });

  it('ignores channels that do not belong to the kind', () => {
    const params = validateAssemblyParams('wall-cabinet', { stepCount: 12 } as never);
    expect(params).not.toBeNull();
    expect(params).not.toHaveProperty('stepCount');
  });

  it('requireAssemblyParams throws a coded error for bad input', () => {
    try {
      requireAssemblyParams('wall-cabinet', { widthCm: 0 });
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AssemblyError);
      expect((error as AssemblyError).code).toBe('assembly_invalid_params');
    }
  });

  it('derives kitchen run width from module count and width', () => {
    const params = requireAssemblyParams('kitchen-base-run', {
      moduleCount: 4,
      moduleWidthCm: 60,
    });
    expect(kitchenRunWidthCm(params)).toBe(240);
  });

  it('derives stair rise and run', () => {
    const params = requireAssemblyParams('stair-straight', {
      stepCount: 12,
      stepDepthCm: 28,
      riseCm: 17.5,
    });
    expect(stairTotalRiseCm(params)).toBe(210);
    expect(stairTotalRunCm(params)).toBe(336);
  });

  it('keeps the safety range for stair rise in one place', () => {
    // 15–20 cm is the range the plan records as "commonly accepted", not a
    // certified standard (OD-4). The test pins the value so a change is visible.
    expect(ASSEMBLY_FIELDS['stair-straight'].riseCm.min).toBe(15);
    expect(ASSEMBLY_FIELDS['stair-straight'].riseCm.max).toBe(20);
  });
});
