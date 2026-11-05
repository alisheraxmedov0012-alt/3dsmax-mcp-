import { describe, expect, it } from 'vitest';
import { DEFAULT_ORBIT_MAX_DISTANCE, DEFAULT_ORBIT_MIN_DISTANCE } from '../render/framing';
import { applyOrbitSettings, VIEWER_ORBIT_SETTINGS, type OrbitSettings } from './orbitSettings';

function emptyControls(): OrbitSettings {
  return {
    enableDamping: false,
    dampingFactor: 0,
    minDistance: 0,
    maxDistance: 0,
    maxPolarAngle: 0,
  };
}

describe('VIEWER_ORBIT_SETTINGS', () => {
  it('keeps damping enabled with the existing factor', () => {
    expect(VIEWER_ORBIT_SETTINGS.enableDamping).toBe(true);
    expect(VIEWER_ORBIT_SETTINGS.dampingFactor).toBeGreaterThan(0);
    expect(VIEWER_ORBIT_SETTINGS.dampingFactor).toBeLessThanOrEqual(1);
  });

  it('uses the historical distance range for a room view', () => {
    expect(VIEWER_ORBIT_SETTINGS.minDistance).toBe(DEFAULT_ORBIT_MIN_DISTANCE);
    expect(VIEWER_ORBIT_SETTINGS.maxDistance).toBe(DEFAULT_ORBIT_MAX_DISTANCE);
    expect(VIEWER_ORBIT_SETTINGS.minDistance).toBeLessThan(VIEWER_ORBIT_SETTINGS.maxDistance);
  });

  it('keeps the polar limit strictly above the floor', () => {
    expect(VIEWER_ORBIT_SETTINGS.maxPolarAngle).toBeGreaterThan(0);
    expect(VIEWER_ORBIT_SETTINGS.maxPolarAngle).toBeLessThan(Math.PI / 2);
  });
});

describe('applyOrbitSettings', () => {
  it('applies every setting to the controls object', () => {
    const controls = emptyControls();
    applyOrbitSettings(controls);
    expect(controls).toEqual(VIEWER_ORBIT_SETTINGS);
  });

  it('supports an explicit settings object', () => {
    const controls = emptyControls();
    const custom: OrbitSettings = {
      enableDamping: false,
      dampingFactor: 0.5,
      minDistance: 2,
      maxDistance: 200,
      maxPolarAngle: 1.2,
    };
    applyOrbitSettings(controls, custom);
    expect(controls).toEqual(custom);
  });
});
