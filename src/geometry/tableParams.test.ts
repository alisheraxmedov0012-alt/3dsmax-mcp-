import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FIELD_VALUES,
  paramsToFieldValues,
  parseTableValues,
  TABLE_DEFAULTS,
  TABLE_LIMITS,
  type TableFieldValues,
} from './tableParams';

const base: TableFieldValues = { ...DEFAULT_FIELD_VALUES };

describe('parseTableValues', () => {
  it('accepts the default values and returns numeric params', () => {
    const result = parseTableValues(base);

    expect(result.valid).toBe(true);
    expect(result.params).toEqual(TABLE_DEFAULTS);
    expect(result.errors).toEqual({});
  });

  it('accepts boundary values of every range', () => {
    const result = parseTableValues({
      widthCm: String(TABLE_LIMITS.widthCm.min),
      heightCm: String(TABLE_LIMITS.heightCm.max),
      depthCm: String(TABLE_LIMITS.depthCm.max),
      color: '#000000',
    });

    expect(result.valid).toBe(true);
    expect(result.params).not.toBeNull();
  });

  it('rejects a width above the maximum', () => {
    const result = parseTableValues({ ...base, widthCm: '1000' });

    expect(result.valid).toBe(false);
    expect(result.params).toBeNull();
    expect(result.errors.widthCm).toContain(String(TABLE_LIMITS.widthCm.max));
  });

  it('rejects a depth below the minimum', () => {
    const result = parseTableValues({ ...base, depthCm: '10' });

    expect(result.valid).toBe(false);
    expect(result.errors.depthCm).toContain(String(TABLE_LIMITS.depthCm.min));
  });

  it('rejects non-numeric input', () => {
    const result = parseTableValues({ ...base, heightCm: 'baland' });

    expect(result.valid).toBe(false);
    expect(result.errors.heightCm).toContain('son');
  });

  it('rejects empty input', () => {
    const result = parseTableValues({ ...base, widthCm: '   ' });

    expect(result.valid).toBe(false);
    expect(result.errors.widthCm).toContain('shart');
  });

  it('rejects an invalid color', () => {
    const result = parseTableValues({ ...base, color: 'red' });

    expect(result.valid).toBe(false);
    expect(result.errors.color).toBeDefined();
  });

  it('reports errors for several fields at once', () => {
    const result = parseTableValues({
      widthCm: '',
      heightCm: '999',
      depthCm: 'abc',
      color: '#zzzzzz',
    });

    expect(result.valid).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(
      ['color', 'depthCm', 'heightCm', 'widthCm'].sort(),
    );
  });
});

describe('paramsToFieldValues', () => {
  it('converts numeric params into string field values', () => {
    expect(
      paramsToFieldValues({ widthCm: 180, heightCm: 75, depthCm: 60, color: '#8b5a2b' }),
    ).toEqual({ widthCm: '180', heightCm: '75', depthCm: '60', color: '#8b5a2b' });
  });

  it('round-trips with parseTableValues', () => {
    const params = { widthCm: 150, heightCm: 90, depthCm: 65, color: '#c0392b' };
    const result = parseTableValues(paramsToFieldValues(params));

    expect(result.valid).toBe(true);
    expect(result.params).toEqual(params);
  });
});
