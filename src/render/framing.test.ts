import { describe, expect, it } from 'vitest';
import { CAMERA_PRESETS } from '../scene/sceneSettings';
import {
  captureAspect,
  computeCameraPlanes,
  computeCaptureFraming,
  computeObjectFraming,
  computeObjectFramingForDirection,
  computeOrbitDistanceLimits,
  FRAMING_FOV_DEG,
  isValidBounds,
  safeBounds,
  type BoundsBox,
} from './framing';

const box = (min: [number, number, number], max: [number, number, number]): BoundsBox => ({
  min: { x: min[0], y: min[1], z: min[2] },
  max: { x: max[0], y: max[1], z: max[2] },
});

const distanceOf = (framing: ReturnType<typeof computeObjectFraming>) =>
  Math.hypot(
    framing.position.x - framing.target.x,
    framing.position.y - framing.target.y,
    framing.position.z - framing.target.z,
  );

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

  it('shares the preset direction core with explicit-direction framing', () => {
    const bounds = box([-50, 0, -50], [50, 50, 50]);
    const fromDirection = computeObjectFramingForDirection(
      bounds,
      { x: 0, y: 0.08, z: 1 },
      16 / 9,
    );
    const fromPreset = computeObjectFraming(bounds, 'front', 16 / 9);
    expect(fromDirection).toEqual(fromPreset);
  });

  it('keeps the requested direction while targeting the box centre', () => {
    const bounds = box([20, 10, -30], [80, 70, 30]);
    const framing = computeObjectFramingForDirection(bounds, { x: 1, y: 0, z: 0 }, 4 / 3);

    expect(framing.target).toEqual({ x: 50, y: 40, z: 0 });
    expect(framing.position.x).toBeGreaterThan(framing.target.x);
    expect(framing.position.y).toBeCloseTo(framing.target.y, 10);
    expect(framing.position.z).toBeCloseTo(framing.target.z, 10);
  });

  it('nudges a perfectly vertical direction away from the lookAt pole', () => {
    const bounds = box([-50, 0, -50], [50, 50, 50]);
    const framing = computeObjectFramingForDirection(bounds, { x: 0, y: 1, z: 0 }, 1);
    expect(isFiniteFraming(framing)).toBe(true);
    expect(Math.abs(framing.position.z - framing.target.z)).toBeGreaterThan(0.01);
  });

  it('falls back to the iso direction for a zero/NaN direction', () => {
    const bounds = box([-20, 0, -20], [20, 40, 20]);
    const iso = computeObjectFraming(bounds, 'iso', 1);
    for (const direction of [
      { x: 0, y: 0, z: 0 },
      { x: Number.NaN, y: 1, z: 1 },
    ]) {
      expect(computeObjectFramingForDirection(bounds, direction, 1)).toEqual(iso);
    }
  });

  it('frames wide, tall and cube-shaped pieces without cropping the bounding sphere', () => {
    const pieces: Array<[string, BoundsBox]> = [
      ['wide', box([-200, 0, -20], [200, 80, 20])],
      ['tall', box([-20, 0, -20], [20, 300, 20])],
      ['cube', box([-60, 0, -60], [60, 120, 60])],
    ];
    const fovV = (FRAMING_FOV_DEG * Math.PI) / 180;

    for (const [, bounds] of pieces) {
      for (const preset of CAMERA_PRESETS) {
        const framing = computeObjectFraming(bounds, preset, 4 / 3);
        expect(isFiniteFraming(framing)).toBe(true);
        expect(framing.radius).toBeGreaterThan(0);
        expect(framing.distance).toBeGreaterThanOrEqual(
          framing.radius / Math.sin(fovV / 2),
        );
        expect(framing.near).toBeGreaterThan(0);
        expect(framing.near).toBeLessThan(framing.distance - framing.radius);
        expect(framing.far).toBeGreaterThan(framing.distance + framing.radius);
      }
    }
  });

  it('uses the output aspect ratio for capture framing', () => {
    const bounds = box([-200, 0, -20], [200, 80, 20]);

    for (const [width, height] of [
      [1024, 1024],
      [1600, 1200],
      [1920, 1080],
      [1080, 1920],
    ] as Array<[number, number]>) {
      const fromSize = computeCaptureFraming(bounds, 'product', width, height);
      const fromAspect = computeObjectFraming(bounds, 'product', width / height);
      expect(distanceOf(fromSize)).toBeCloseTo(distanceOf(fromAspect), 10);
      expect(fromSize.target).toEqual(fromAspect.target);
    }

    const square = computeCaptureFraming(bounds, 'product', 1024, 1024);
    const portrait = computeCaptureFraming(bounds, 'product', 1080, 1920);
    expect(distanceOf(portrait)).toBeGreaterThan(distanceOf(square));
  });

  it('computes stable near/far planes for tiny and huge pieces', () => {
    for (const [distance, radius] of [
      [3.27, 1],
      [326, 100],
      [5657, 2000],
    ] as Array<[number, number]>) {
      const planes = computeCameraPlanes(distance, radius);
      expect(Number.isFinite(planes.near)).toBe(true);
      expect(Number.isFinite(planes.far)).toBe(true);
      expect(planes.near).toBeGreaterThan(0);
      expect(planes.far).toBeGreaterThan(planes.near);
      expect(planes.near).toBeLessThan(distance - radius);
      expect(planes.far).toBeGreaterThan(distance + radius);
    }
  });

  it('keeps near/far valid at very small camera distances', () => {
    for (const distance of [0.2, 0.5, 1, 10, 100]) {
      const radius = distance * 0.2;
      const planes = computeCameraPlanes(distance, radius);
      expect(planes.near).toBeGreaterThan(0);
      expect(planes.near).toBeLessThanOrEqual(distance);
      expect(planes.near).toBeLessThanOrEqual(distance - radius);
      expect(planes.far).toBeGreaterThan(planes.near);
      expect(planes.far).toBeGreaterThanOrEqual(distance + radius);
    }
  });

  it('handles tiny objects, the camera-on-surface case and very large boxes', () => {
    const cases: Array<[number, number, boolean]> = [
      [0.2, 0.001, true], // tiny object, camera outside
      [0.2, 0.2, true], // camera exactly on the sphere surface
      [0.2, 1, false], // camera inside the object sphere
      [100, 2000, false], // huge object encloses the camera
      [100, 0.001, true],
    ];

    for (const [distance, radius, outside] of cases) {
      const planes = computeCameraPlanes(distance, radius);
      expect(planes.near).toBeGreaterThan(0);
      expect(planes.near).toBeLessThanOrEqual(distance);
      expect(planes.far).toBeGreaterThan(planes.near);
      expect(planes.far).toBeGreaterThan(distance + radius);
      if (outside && distance > radius) {
        expect(planes.near).toBeLessThan(distance - radius);
      }
    }
  });

  it('falls back to safe planes and orbit limits for invalid input', () => {
    for (const planes of [
      computeCameraPlanes(Number.NaN, Number.NaN),
      computeCameraPlanes(0, -10),
    ]) {
      expect(Number.isFinite(planes.near)).toBe(true);
      expect(Number.isFinite(planes.far)).toBe(true);
      expect(planes.near).toBeGreaterThan(0);
      expect(planes.far).toBeGreaterThan(planes.near);
    }

    for (const limits of [
      computeOrbitDistanceLimits(Number.NaN, Number.NaN),
      computeOrbitDistanceLimits(0, 0),
    ]) {
      expect(limits.minDistance).toBeGreaterThan(0);
      expect(limits.maxDistance).toBeGreaterThanOrEqual(limits.minDistance);
    }
  });
});

describe('captureAspect', () => {
  it('returns the requested size ratio', () => {
    expect(captureAspect(1024, 1024)).toBeCloseTo(1, 10);
    expect(captureAspect(1600, 1200)).toBeCloseTo(4 / 3, 10);
    expect(captureAspect(1920, 1080)).toBeCloseTo(16 / 9, 10);
    expect(captureAspect(1080, 1920)).toBeCloseTo(9 / 16, 10);
  });

  it('is safe for invalid sizes', () => {
    for (const [width, height] of [
      [0, 100],
      [100, 0],
      [-1, 100],
      [Number.NaN, 100],
      [100, Number.POSITIVE_INFINITY],
    ] as Array<[number, number]>) {
      expect(captureAspect(width, height)).toBe(1);
    }
  });
});

describe('computeOrbitDistanceLimits', () => {
  it('lowers the minimum for small pieces without exceeding the framing distance', () => {
    const limits = computeOrbitDistanceLimits(3.27, 1);
    expect(limits.minDistance).toBeLessThan(40);
    expect(limits.minDistance).toBeLessThanOrEqual(3.27 * 0.8);
    expect(limits.maxDistance).toBe(6000);
  });

  it('widens the maximum for very large pieces so framing is not clamped', () => {
    const limits = computeOrbitDistanceLimits(10000, 2000);
    expect(limits.maxDistance).toBeGreaterThanOrEqual(15000);
    expect(limits.minDistance).toBeLessThanOrEqual(10000 * 0.8);
  });

  it('keeps the historical 40/6000 limits for a normal room-sized view', () => {
    const limits = computeOrbitDistanceLimits(3200, 500);
    expect(limits.minDistance).toBe(40);
    expect(limits.maxDistance).toBe(6000);
  });
});
