import { describe, expect, it } from 'vitest';
import { normalizeProposal } from './normalizeProposal';
import {
  paramsToFieldValues,
  parseTableValues,
  TABLE_DEFAULTS,
  TABLE_LIMITS,
} from '../geometry/tableParams';

describe('normalizeProposal', () => {
  it('keeps in-range values unchanged', () => {
    const { params, notes, warnings } = normalizeProposal({
      widthCm: 180,
      heightCm: 75,
      depthCm: 60,
      color: '#8b5a2b',
    });

    expect(params).toEqual({ widthCm: 180, heightCm: 75, depthCm: 60, color: '#8b5a2b' });
    expect(notes).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('clamps an out-of-range dimension and reports a warning', () => {
    const { params, warnings } = normalizeProposal({ widthCm: 500 });

    expect(params.widthCm).toBe(TABLE_LIMITS.widthCm.max);
    expect(warnings.some((line) => line.includes('Kenglik'))).toBe(true);
  });

  it('fills missing dimensions with defaults and notes it', () => {
    const { params, notes } = normalizeProposal({});

    expect(params).toEqual(TABLE_DEFAULTS);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.some((line) => line.includes('Kenglik'))).toBe(true);
  });

  it('replaces an invalid colour with the default and warns', () => {
    const { params, warnings } = normalizeProposal({ color: 'nope' });

    expect(params.color).toBe(TABLE_DEFAULTS.color);
    expect(warnings.some((line) => line.includes('Rang'))).toBe(true);
  });

  it('accepts lowercase hex colours', () => {
    const { params } = normalizeProposal({ color: '#AbCdEf' });

    expect(params.color).toBe('#abcdef');
  });

  it('always returns parameters accepted by the geometry layer', () => {
    const cases = [
      {},
      { widthCm: 500, heightCm: 1, depthCm: 9999 },
      { color: 'bad', widthCm: 40 },
    ];

    cases.forEach((input) => {
      const { params } = normalizeProposal(input);
      expect(parseTableValues(paramsToFieldValues(params)).valid).toBe(true);
    });
  });
});
