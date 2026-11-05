import { describe, expect, it } from 'vitest';
import {
  CAMERA_ANGLES,
  CAMERA_ANGLE_DEFINITIONS,
  computeCameraAngleFraming,
} from './cameraAngles';
import type { BoundsBox, Framing } from '../render/framing';

const box = (min: [number, number, number], max: [number, number, number]): BoundsBox => ({
  min: { x: min[0], y: min[1], z: min[2] },
  max: { x: max[0], y: max[1], z: max[2] },
});

const distanceOf = (framing: Framing): number =>
  Math.hypot(
    framing.position.x - framing.target.x,
    framing.position.y - framing.target.y,
    framing.position.z - framing.target.z,
  );

const PRODUCT = box([-100, 0, -50], [100, 150, 50]);

describe('camera angle definitions', () => {
  it('defines the seven stable runtime angles', () => {
    expect(CAMERA_ANGLES).toEqual(['hero', 'front', 'back', 'left', 'right', 'top', 'detail']);
    for (const id of CAMERA_ANGLES) {
      const definition = CAMERA_ANGLE_DEFINITIONS[id];
      expect(definition.id).toBe(id);
      expect(definition.label.length).toBeGreaterThan(0);
      [definition.direction.x, definition.direction.y, definition.direction.z].forEach((value) =>
        expect(Number.isFinite(value)).toBe(true),
      );
    }
  });

  it('frames every angle finitely and distinctly', () => {
    const positions = CAMERA_ANGLES.map((angle) =>
      computeCameraAngleFraming(PRODUCT, angle, 16 / 9),
    );
    for (const framing of positions) {
      [framing.position.x, framing.position.y, framing.position.z].forEach((value) =>
        expect(Number.isFinite(value)).toBe(true),
      );
      expect(framing.target).toEqual({ x: 0, y: 75, z: 0 });
      expect(framing.near).toBeGreaterThan(0);
      expect(framing.far).toBeGreaterThan(framing.near);
    }
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        const a = positions[i].position;
        const b = positions[j].position;
        expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThan(1);
      }
    }
  });

  it('puts front and back on opposite sides of the product', () => {
    const front = computeCameraAngleFraming(PRODUCT, 'front', 1);
    const back = computeCameraAngleFraming(PRODUCT, 'back', 1);
    expect(front.position.z).toBeGreaterThan(front.target.z);
    expect(back.position.z).toBeLessThan(back.target.z);
    expect(front.position.x).toBeCloseTo(front.target.x, 8);
    expect(back.position.x).toBeCloseTo(back.target.x, 8);
    expect(front.position.z - front.target.z).toBeCloseTo(
      -(back.position.z - back.target.z),
      8,
    );
  });

  it('keeps left and right symmetric', () => {
    const left = computeCameraAngleFraming(PRODUCT, 'left', 1);
    const right = computeCameraAngleFraming(PRODUCT, 'right', 1);
    expect(left.position.x).toBeLessThan(left.target.x);
    expect(right.position.x).toBeGreaterThan(right.target.x);
    expect(left.position.x - left.target.x).toBeCloseTo(-(right.position.x - right.target.x), 8);
    expect(left.position.y).toBeCloseTo(right.position.y, 8);
    expect(left.position.z).toBeCloseTo(right.position.z, 8);
    expect(distanceOf(left)).toBeCloseTo(distanceOf(right), 8);
  });

  it('keeps top above the target without a degenerate up-vector', () => {
    const top = computeCameraAngleFraming(PRODUCT, 'top', 1);
    expect(top.position.y).toBeGreaterThan(top.target.y);
    expect(Math.abs(top.position.z - top.target.z)).toBeGreaterThan(0.01);
    expect(Number.isFinite(top.position.x)).toBe(true);
  });

  it('frames a hero from the front-side quarter', () => {
    const hero = computeCameraAngleFraming(PRODUCT, 'hero', 16 / 9);
    expect(hero.position.x).toBeGreaterThan(hero.target.x);
    expect(hero.position.z).toBeGreaterThan(hero.target.z);
    expect(hero.position.y).toBeGreaterThan(hero.target.y);
  });

  it('focuses detail on a selected part and falls back to the product centre', () => {
    const part = box([40, 100, 20], [60, 120, 40]);
    const withPart = computeCameraAngleFraming(PRODUCT, 'detail', 4 / 3, part);
    expect(withPart.target).toEqual({ x: 50, y: 110, z: 30 });
    expect(withPart.near).toBeGreaterThan(0);
    expect(withPart.far).toBeGreaterThan(withPart.near);

    const withoutPart = computeCameraAngleFraming(PRODUCT, 'detail', 4 / 3, null);
    expect(withoutPart.target).toEqual({ x: 0, y: 75, z: 0 });
    expect(distanceOf(withoutPart)).toBeLessThan(
      distanceOf(computeCameraAngleFraming(PRODUCT, 'hero', 4 / 3)),
    );
  });

  it('handles tiny, huge and invalid detail bounds safely', () => {
    const tiny = box([0, 0, 0], [0.001, 0.001, 0.001]);
    const huge = box([-2000, 0, -2000], [2000, 4000, 2000]);
    for (const detailBounds of [tiny, huge, undefined, null]) {
      const framing = computeCameraAngleFraming(PRODUCT, 'detail', 1, detailBounds);
      expect(Number.isFinite(framing.near)).toBe(true);
      expect(Number.isFinite(framing.far)).toBe(true);
      expect(framing.near).toBeGreaterThan(0);
      expect(framing.far).toBeGreaterThan(framing.near);
    }
  });

  it('uses the output aspect for every angle', () => {
    for (const angle of CAMERA_ANGLES) {
      const square = computeCameraAngleFraming(PRODUCT, angle, 1);
      const portrait = computeCameraAngleFraming(PRODUCT, angle, 9 / 16);
      expect(distanceOf(portrait)).toBeGreaterThanOrEqual(distanceOf(square));
      expect(portrait.target).toEqual(square.target);
    }
  });
});
