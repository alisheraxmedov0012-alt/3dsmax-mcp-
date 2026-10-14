import { describe, expect, it } from 'vitest';
import {
  createFurnitureParams,
  FURNITURE_FIELDS,
  FURNITURE_TYPES,
  type FurnitureType,
} from './types';
import {
  furnitureParamsToFieldValues,
  parseFurnitureValues,
  relationErrors,
  validateFurnitureParams,
} from './params';

const DEFAULTS_STRINGS = (type: FurnitureType) =>
  furnitureParamsToFieldValues(type, createFurnitureParams(type));

describe('createFurnitureParams', () => {
  it('returns a complete, finite default set for every type', () => {
    for (const type of FURNITURE_TYPES) {
      const params = createFurnitureParams(type);
      for (const spec of FURNITURE_FIELDS[type]) {
        const value = params[spec.key];
        expect(Number.isFinite(value as number)).toBe(true);
        expect(value as number).toBeGreaterThanOrEqual(spec.range.min);
        expect(value as number).toBeLessThanOrEqual(spec.range.max);
      }
      expect(params.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('parseFurnitureValues', () => {
  it('accepts the defaults for every type', () => {
    for (const type of FURNITURE_TYPES) {
      const result = parseFurnitureValues(type, DEFAULTS_STRINGS(type));
      expect(result.valid).toBe(true);
      expect(result.params).not.toBeNull();
    }
  });

  it('reports out-of-range values per field', () => {
    const values = { ...DEFAULTS_STRINGS('table'), widthCm: '9999' };
    const result = parseFurnitureValues('table', values);
    expect(result.valid).toBe(false);
    expect(result.params).toBeNull();
    expect(result.errors.widthCm).toBeDefined();
  });

  it('rejects empty, non-numeric, NaN and Infinity input', () => {
    for (const bad of ['', 'abc', 'NaN', 'Infinity', '-Infinity']) {
      const result = parseFurnitureValues('chair', { ...DEFAULTS_STRINGS('chair'), widthCm: bad });
      expect(result.valid).toBe(false);
      expect(result.errors.widthCm).toBeDefined();
    }
  });

  it('rejects a non-integer value for an integer field', () => {
    const result = parseFurnitureValues('table', { ...DEFAULTS_STRINGS('table'), legCount: '4.5' });
    expect(result.valid).toBe(false);
    expect(result.errors.legCount).toBeDefined();
  });

  it('rejects an invalid colour', () => {
    const result = parseFurnitureValues('table', { ...DEFAULTS_STRINGS('table'), color: 'red' });
    expect(result.valid).toBe(false);
    expect(result.errors.color).toBeDefined();
  });

  it('enforces cross-field relations', () => {
    // The seat cannot reach the chair's total height.
    const chair = parseFurnitureValues('chair', {
      ...DEFAULTS_STRINGS('chair'),
      heightCm: '45',
      seatHeightCm: '45',
    });
    expect(chair.valid).toBe(false);
    expect(chair.errors.seatHeightCm).toBeDefined();

    // An armrest cannot be taller than the sofa.
    const sofa = parseFurnitureValues('sofa', {
      ...DEFAULTS_STRINGS('sofa'),
      heightCm: '60',
      armHeightCm: '80',
    });
    expect(sofa.valid).toBe(false);
    expect(sofa.errors.armHeightCm).toBeDefined();
  });
});

describe('validateFurnitureParams', () => {
  it('preserves a legacy four-field table shape', () => {
    const legacy = { widthCm: 120, heightCm: 75, depthCm: 60, color: '#a9744f' };
    expect(validateFurnitureParams('table', legacy)).toEqual(legacy);
  });

  it('accepts a complete new-type object and keeps the extra channels', () => {
    const params = createFurnitureParams('wardrobe');
    const validated = validateFurnitureParams('wardrobe', params);
    expect(validated).toEqual(params);
  });

  it('rejects unknown types, missing fields and invalid values', () => {
    expect(validateFurnitureParams('table', null)).toBeNull();
    expect(validateFurnitureParams('table', {})).toBeNull();
    expect(validateFurnitureParams('table', { widthCm: 1, heightCm: 75, depthCm: 60, color: '#a9744f' })).toBeNull();
    expect(
      validateFurnitureParams('table', {
        widthCm: Number.NaN,
        heightCm: 75,
        depthCm: 60,
        color: '#a9744f',
      }),
    ).toBeNull();
    expect(
      validateFurnitureParams('table', {
        widthCm: 120,
        heightCm: 75,
        depthCm: 60,
        color: 'not-a-colour',
      }),
    ).toBeNull();
  });

  it('drops out-of-range optional channels but keeps the base', () => {
    const validated = validateFurnitureParams('table', {
      widthCm: 120,
      heightCm: 75,
      depthCm: 60,
      color: '#a9744f',
      topThicknessCm: 999,
      legCount: 4,
    });
    expect(validated?.topThicknessCm).toBeUndefined();
    expect(validated?.legCount).toBe(4);
  });
});

describe('relationErrors', () => {
  it('is empty for every type at its defaults', () => {
    for (const type of FURNITURE_TYPES) {
      expect(relationErrors(type, createFurnitureParams(type))).toEqual({});
    }
  });
});
