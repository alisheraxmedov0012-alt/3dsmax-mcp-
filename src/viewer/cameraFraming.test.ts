import { describe, expect, it } from 'vitest';
import { computeTableFraming } from './cameraFraming';
import { TABLE_DEFAULTS } from '../geometry/tableParams';

describe('computeTableFraming', () => {
  it('returns finite camera position and target values', () => {
    const framing = computeTableFraming(TABLE_DEFAULTS);
    const values = [
      framing.position.x,
      framing.position.y,
      framing.position.z,
      framing.target.x,
      framing.target.y,
      framing.target.z,
    ];

    values.forEach((value) => expect(Number.isFinite(value)).toBe(true));
  });

  it('aims the orbit target at the middle of the table height', () => {
    const framing = computeTableFraming({
      widthCm: 100,
      heightCm: 80,
      depthCm: 50,
      color: '#a9744f',
    });

    expect(framing.target.x).toBe(0);
    expect(framing.target.y).toBeCloseTo(40, 5);
    expect(framing.target.z).toBe(0);
  });

  it('frames larger tables from further away', () => {
    const small = computeTableFraming({
      widthCm: 60,
      heightCm: 40,
      depthCm: 40,
      color: '#a9744f',
    });
    const large = computeTableFraming({
      widthCm: 240,
      heightCm: 120,
      depthCm: 120,
      color: '#a9744f',
    });

    expect(large.position.z).toBeGreaterThan(small.position.z);
    expect(large.position.y).toBeGreaterThan(small.position.y);
  });

  it('is deterministic for identical parameters', () => {
    expect(computeTableFraming(TABLE_DEFAULTS)).toEqual(computeTableFraming(TABLE_DEFAULTS));
  });
});
