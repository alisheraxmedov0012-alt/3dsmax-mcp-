import { describe, expect, it } from 'vitest';
import { LIGHTING_PRESET_POSITIONS } from '../render/renderPresets';
import type { BoundsBox } from '../render/framing';
import { computeLightRig } from './lightRig';
import { computeShadowFit } from './shadowFit';

const box = (min: [number, number, number], max: [number, number, number]): BoundsBox => ({
  min: { x: min[0], y: min[1], z: min[2] },
  max: { x: max[0], y: max[1], z: max[2] },
});

describe('computeLightRig', () => {
  it('places key, fill and rim around the active bounds centre', () => {
    const bounds = box([0, 0, 0], [100, 80, 60]);
    const rig = computeLightRig(bounds, LIGHTING_PRESET_POSITIONS.studioSoft);

    expect(rig.target).toEqual({ x: 50, y: 40, z: 30 });
    for (const position of [rig.key, rig.fill, rig.rim]) {
      [position.x, position.y, position.z].forEach((value) =>
        expect(Number.isFinite(value)).toBe(true),
      );
    }

    const keyFit = computeShadowFit(
      bounds,
      {
        x: LIGHTING_PRESET_POSITIONS.studioSoft.key[0],
        y: LIGHTING_PRESET_POSITIONS.studioSoft.key[1],
        z: LIGHTING_PRESET_POSITIONS.studioSoft.key[2],
      },
      {
        preferredDistance: Math.hypot(
          LIGHTING_PRESET_POSITIONS.studioSoft.key[0],
          LIGHTING_PRESET_POSITIONS.studioSoft.key[1],
          LIGHTING_PRESET_POSITIONS.studioSoft.key[2],
        ),
      },
    );
    expect(rig.key).toEqual(keyFit.position);
    expect(rig.fill).not.toEqual(rig.key);
    expect(rig.rim).not.toEqual(rig.key);
    expect(rig.fill).not.toEqual(rig.rim);
  });

  it('moves the rig with the bounds and scales distances for large products', () => {
    const small = computeLightRig(
      box([-10, 0, -10], [10, 20, 10]),
      LIGHTING_PRESET_POSITIONS.neutralProduct,
    );
    const large = computeLightRig(
      box([1000, 0, 1000], [5000, 4000, 5000]),
      LIGHTING_PRESET_POSITIONS.neutralProduct,
    );

    expect(large.target.x).toBeGreaterThan(small.target.x);
    expect(large.target.z).toBeGreaterThan(small.target.z);
    const length = (
      a: { x: number; y: number; z: number },
      b: { x: number; y: number; z: number },
    ) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    expect(length(large.key, large.target)).toBeGreaterThan(length(small.key, small.target));
    expect(length(large.fill, large.target)).toBeGreaterThan(length(small.fill, small.target));
    expect(length(large.rim, large.target)).toBeGreaterThan(length(small.rim, small.target));
  });

  it('keeps the rim on the opposite side from the key light', () => {
    const positions = LIGHTING_PRESET_POSITIONS.highContrast;
    const rig = computeLightRig(box([-50, 0, -50], [50, 100, 50]), positions);
    const keyOffset = {
      x: rig.key.x - rig.target.x,
      z: rig.key.z - rig.target.z,
    };
    const rimOffset = {
      x: rig.rim.x - rig.target.x,
      z: rig.rim.z - rig.target.z,
    };
    expect(keyOffset.x * rimOffset.x + keyOffset.z * rimOffset.z).toBeLessThan(0);
  });

  it('is finite for fallback bounds', () => {
    const rig = computeLightRig(null, LIGHTING_PRESET_POSITIONS.coolDaylight);
    [rig.target, rig.key, rig.fill, rig.rim].forEach((position) => {
      [position.x, position.y, position.z].forEach((value) =>
        expect(Number.isFinite(value)).toBe(true),
      );
    });
  });
});
