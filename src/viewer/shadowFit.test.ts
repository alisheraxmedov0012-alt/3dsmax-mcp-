import { describe, expect, it } from 'vitest';
import { boundsRadius, type BoundsBox } from '../render/framing';
import { computeShadowFit } from './shadowFit';

const box = (min: [number, number, number], max: [number, number, number]): BoundsBox => ({
  min: { x: min[0], y: min[1], z: min[2] },
  max: { x: max[0], y: max[1], z: max[2] },
});

const distanceOf = (fit: ReturnType<typeof computeShadowFit>): number =>
  Math.hypot(
    fit.position.x - fit.target.x,
    fit.position.y - fit.target.y,
    fit.position.z - fit.target.z,
  );

describe('computeShadowFit', () => {
  it('centres the shadow target and keeps the light direction', () => {
    const fit = computeShadowFit(box([10, 20, 30], [110, 120, 130]), { x: 0, y: 1, z: 0 }, {
      preferredDistance: 1000,
    });

    expect(fit.target).toEqual({ x: 60, y: 70, z: 80 });
    expect(fit.position.x).toBeCloseTo(fit.target.x, 8);
    expect(fit.position.y).toBeGreaterThan(fit.target.y);
    expect(fit.position.z).toBeCloseTo(fit.target.z, 8);
    expect(distanceOf(fit)).toBeCloseTo(1000, 8);
  });

  it('fits a small piece with a tight orthographic extent', () => {
    const bounds = box([-5, 0, -5], [5, 10, 5]);
    const fit = computeShadowFit(bounds, { x: 0.4, y: 0.8, z: 0.5 });

    expect(fit.extent).toBeGreaterThanOrEqual(10);
    expect(fit.extent).toBeGreaterThan(boundsRadius(bounds));
    expect(fit.near).toBeGreaterThan(0);
    expect(fit.far).toBeGreaterThan(fit.near);
    expect(fit.near).toBeLessThan(distanceOf(fit) - boundsRadius(bounds));
    expect(fit.far).toBeGreaterThan(distanceOf(fit) + boundsRadius(bounds));
  });

  it('grows the extent for large bounds instead of clipping them', () => {
    const small = computeShadowFit(box([-10, 0, -10], [10, 20, 10]), { x: 1, y: 1, z: 1 });
    const large = computeShadowFit(
      box([-1000, 0, -1000], [1000, 600, 1000]),
      { x: 1, y: 1, z: 1 },
    );

    expect(large.extent).toBeGreaterThan(small.extent);
    expect(distanceOf(large)).toBeGreaterThan(distanceOf(small));
    expect(large.extent).toBeGreaterThanOrEqual(
      boundsRadius(box([-1000, 0, -1000], [1000, 600, 1000])),
    );
  });

  it('honours a preferred distance when it is larger than the minimum', () => {
    const fit = computeShadowFit(box([-10, 0, -10], [10, 20, 10]), { x: 0, y: 1, z: 0 }, {
      preferredDistance: 1200,
    });
    expect(distanceOf(fit)).toBeCloseTo(1200, 8);
  });

  it('is finite for zero/invalid light directions and fallback bounds', () => {
    for (const direction of [
      { x: 0, y: 0, z: 0 },
      { x: Number.NaN, y: 1, z: 1 },
    ]) {
      const fit = computeShadowFit(box([-10, 0, -10], [10, 10, 10]), direction);
      [
        fit.target.x,
        fit.target.y,
        fit.target.z,
        fit.position.x,
        fit.position.y,
        fit.position.z,
        fit.extent,
        fit.near,
        fit.far,
      ].forEach((value) => expect(Number.isFinite(value)).toBe(true));
    }
  });
});
