import { describe, expect, it } from 'vitest';
import { convertLength, formatLength, roundLength, unitFactor } from './units';

describe('unit conversion', () => {
  it('converts cm to mm and back', () => {
    expect(convertLength(1, 'cm', 'mm')).toBe(10);
    expect(convertLength(120, 'cm', 'mm')).toBe(1200);
    expect(convertLength(10, 'mm', 'cm')).toBe(1);
    expect(convertLength(5, 'cm', 'cm')).toBe(5);
  });

  it('reports the factor', () => {
    expect(unitFactor('cm', 'mm')).toBe(10);
    expect(unitFactor('mm', 'cm')).toBe(0.1);
    expect(unitFactor('cm', 'cm')).toBe(1);
  });

  it('is NaN-safe (never propagates a non-finite value)', () => {
    expect(convertLength(Number.NaN, 'cm', 'mm')).toBe(0);
    expect(convertLength(Number.POSITIVE_INFINITY, 'cm', 'mm')).toBe(0);
    expect(roundLength(Number.NaN, 'mm')).toBe(0);
  });

  it('rounds to display precision', () => {
    expect(roundLength(1.2345, 'mm')).toBe(1.2);
    expect(roundLength(1.2345, 'cm')).toBe(1.23);
  });

  it('formats lengths with the right unit suffix', () => {
    expect(formatLength(120, 'mm')).toBe('1200 mm');
    expect(formatLength(120, 'cm')).toBe('120 sm');
  });
});
