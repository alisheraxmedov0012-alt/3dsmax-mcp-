import { describe, expect, it } from 'vitest';
import { CAMERA_PRESETS } from '../scene/sceneSettings';
import { computeObjectFraming, isValidBounds, safeBounds, type BoundsBox } from './framing';

const box = (min: [number, number, number], max: [number, number, number]): BoundsBox => ({
  min: { x: min[0], y: min[1], z: min[2] },
  max: { x: max[0], y: max[1], z: max[2] },
});

const isFiniteFraming = (f: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } }) =>
  [f.position.x, f.position.y, f.position.z, f.target.x, f.target.y, f.target.z].every((v) =>
    Number.isFinite(v),
  );

describe('isValidBounds / safeBounds', () => {
  it('accepts a finite, non-degenerate box', () => {
    expect(isValidBounds(box([-10, 0, -10], [10, 20, 10]))).toBe(true);
  });

  it('rejects null, non-finite and degenerate boxes', () => {
    expect(isValidBounds(null)).toBe(false);
    expect(isValidBounds(undefined)).toBe(false);
    expect(isValidBounds(box([0, 0, 0], [0, 0, 0]))).toBe(false);
    expect(
      isValidBounds({ min: { x: Number.NaN, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }),
    ).toBe(false);
    expect(
      isValidBounds({
        min: { x: 0, y: 0, z: 0 },
        max: { x: Number.POSITIVE_INFINITY, y: 1, z: 1 },
      }),
    ).toBe(false);
  });

  it('returns a finite fallback for an invalid box', () => {
    const fallback = safeBounds({ min: { x: Number.NaN, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } });
    expect(isValidBounds(fallback)).toBe(true);
  });
});

describe('computeObjectFraming', () => {
  it('returns finite framing for every preset and never NaN', () => {
    for (const preset of CAMERA_PRESETS) {
      const framing = computeObjectFraming(box([-50, 0, -30], [50, 75, 30]), preset, 16 / 9);
      expect(isFiniteFraming(framing)).toBe(true);
    }
  });

  it('is NaN-safe for empty / invalid boxes and invalid aspect', () => {
    const cases: Array<[BoundsBox | null, number]> = [
      [null, 16 / 9],
      [box([0, 0, 0], [0, 0, 0]), 16 / 9],
      [box([-10, 0, -10], [10, 10, 10]), Number.NaN],
      [box([-10, 0, -10], [10, 10, 10]), 0],
      [box([-10, 0, -10], [10, 10, 10]), -3],
    ];
    for (const [bounds, aspect] of cases) {
      const framing = computeObjectFraming(bounds, 'product', aspect);
      expect(isFiniteFraming(framing)).toBe(true);
    }
  });

  it('targets the centre of the box', () => {
    const framing = computeObjectFraming(box([0, 0, 0], [100, 80, 60]), 'front', 1);
    expect(framing.target.x).toBeCloseTo(50, 5);
    expect(framing.target.y).toBeCloseTo(40, 5);
    expect(framing.target.z).toBeCloseTo(30, 5);
  });

  it('moves the camera further away for a larger object', () => {
    const small = computeObjectFraming(box([-10, 0, -10], [10, 20, 10]), 'product', 1);
    const large = computeObjectFraming(box([-200, 0, -200], [200, 400, 200]), 'product', 1);
    const distance = (f: ReturnType<typeof computeObjectFraming>) =>
      Math.hypot(f.position.x - f.target.x, f.position.y - f.target.y, f.position.z - f.target.z);
    expect(distance(large)).toBeGreaterThan(distance(small));
  });

  it('increases distance for a narrow (portrait) aspect so nothing is cropped', () => {
    const bounds = box([-100, 0, -20], [100, 100, 20]);
    const landscape = computeObjectFraming(bounds, 'product', 16 / 9);
    const portrait = computeObjectFraming(bounds, 'product', 9 / 16);
    const distance = (f: ReturnType<typeof computeObjectFraming>) =>
      Math.hypot(f.position.x - f.target.x, f.position.y - f.target.y, f.position.z - f.target.z);
    expect(distance(portrait)).toBeGreaterThanOrEqual(distance(landscape));
  });

  it('places the camera on the expected side for each view', () => {
    const bounds = box([-50, 0, -50], [50, 50, 50]);
    const front = computeObjectFraming(bounds, 'front', 1);
    expect(Math.abs(front.position.x - front.target.x)).toBeLessThan(1);
    expect(front.position.z).toBeGreaterThan(front.target.z);

    const top = computeObjectFraming(bounds, 'top', 1);
    expect(top.position.y).toBeGreaterThan(top.target.y);

    const side = computeObjectFraming(bounds, 'side', 1);
    expect(Math.abs(side.position.z - side.target.z)).toBeLessThan(1);
  });
});
