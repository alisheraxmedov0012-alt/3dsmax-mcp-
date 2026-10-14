import { describe, expect, it } from 'vitest';
import { computePresetFraming, computeRoomFraming, computeTableFraming } from './cameraFraming';
import { TABLE_DEFAULTS } from '../geometry/tableParams';
import { CAMERA_PRESETS } from '../scene/sceneSettings';

const ROOM = { widthCm: 400, lengthCm: 500, heightCm: 280 };

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

describe('computeRoomFraming', () => {
  it('returns finite values aimed at the middle of the room', () => {
    const framing = computeRoomFraming({ widthCm: 400, lengthCm: 500, heightCm: 280 });

    [
      framing.position.x,
      framing.position.y,
      framing.position.z,
      framing.target.x,
      framing.target.y,
      framing.target.z,
    ].forEach((value) => expect(Number.isFinite(value)).toBe(true));

    expect(framing.target.x).toBe(0);
    expect(framing.target.y).toBeCloseTo(140, 5);
    expect(framing.target.z).toBe(0);
  });

  it('frames larger rooms from further away', () => {
    const small = computeRoomFraming({ widthCm: 200, lengthCm: 200, heightCm: 200 });
    const large = computeRoomFraming({ widthCm: 2000, lengthCm: 2000, heightCm: 600 });

    expect(large.position.z).toBeGreaterThan(small.position.z);
    expect(large.position.y).toBeGreaterThan(small.position.y);
  });
});

describe('computePresetFraming', () => {
  it('produces finite positions for every preset', () => {
    CAMERA_PRESETS.forEach((preset) => {
      const framing = computePresetFraming(ROOM, preset);
      [
        framing.position.x,
        framing.position.y,
        framing.position.z,
        framing.target.x,
        framing.target.y,
        framing.target.z,
      ].forEach((value) => expect(Number.isFinite(value)).toBe(true));
    });
  });

  it('puts the front view on the +Z axis and the side view on the +X axis', () => {
    const front = computePresetFraming(ROOM, 'front');
    expect(front.position.x).toBe(0);
    expect(front.position.z).toBeGreaterThan(0);

    const side = computePresetFraming(ROOM, 'side');
    expect(side.position.z).toBe(0);
    expect(side.position.x).toBeGreaterThan(0);
  });

  it('looks straight down for the top preset', () => {
    const top = computePresetFraming(ROOM, 'top');
    expect(top.position.y).toBeGreaterThan(ROOM.heightCm);
    expect(top.target).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('reuses the room framing for the iso preset', () => {
    expect(computePresetFraming(ROOM, 'iso')).toEqual(computeRoomFraming(ROOM));
  });

  it('never moves the orbit target out of the room centre (object coords unchanged)', () => {
    CAMERA_PRESETS.forEach((preset) => {
      const framing = computePresetFraming(ROOM, preset);
      expect(framing.target.x).toBe(0);
      expect(framing.target.z).toBe(0);
    });
  });
});
