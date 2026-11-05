import { describe, expect, it } from 'vitest';
import { createDefaultScene } from '../scene/types';
import { buildShadowKey, shadowKeyChanged } from './shadowInvalidation';

function scene() {
  return createDefaultScene(() => 'table-1');
}

describe('buildShadowKey', () => {
  it('is stable for an unchanged static scene', () => {
    const data = scene();
    expect(buildShadowKey(data, 'room', 'table-1', 1024)).toBe(
      buildShadowKey(scene(), 'room', 'table-1', 1024),
    );
    expect(
      shadowKeyChanged(buildShadowKey(data, 'room', 'table-1', 1024), buildShadowKey(data, 'room', 'table-1', 1024)),
    ).toBe(false);
  });

  it('invalidates for a transform, visibility or geometry change', () => {
    const base = scene();
    const key = buildShadowKey(base, 'room', 'table-1', 1024);

    const moved = {
      ...base,
      objects: base.objects.map((object) =>
        Object.assign({}, object, {
          position: { ...object.position, x: object.position.x + 1 },
        }),
      ),
    };
    const hidden = {
      ...base,
      objects: base.objects.map((object) => Object.assign({}, object, { visible: false })),
    };
    const resized = {
      ...base,
      objects: base.objects.map((object) =>
        Object.assign({}, object, {
          params: { ...object.params, widthCm: 180 },
        }),
      ),
    };

    expect(buildShadowKey(moved, 'room', 'table-1', 1024)).not.toBe(key);
    expect(buildShadowKey(hidden, 'room', 'table-1', 1024)).not.toBe(key);
    expect(buildShadowKey(resized, 'room', 'table-1', 1024)).not.toBe(key);
  });

  it('invalidates for light, shadow, quality or selection changes', () => {
    const base = scene();
    const key = buildShadowKey(base, 'room', 'table-1', 1024);

    const lightChanged = {
      ...base,
      settings: {
        ...base.settings,
        lights: { ...base.settings.lights, shadowRadius: 4 },
      },
    };
    const qualityChanged = {
      ...base,
      settings: { ...base.settings, qualityPreset: 'high' as const },
    };
    const presetChanged = {
      ...base,
      settings: { ...base.settings, lightingPreset: 'studioSoft' as const },
    };

    expect(buildShadowKey(lightChanged, 'room', 'table-1', 1024)).not.toBe(key);
    expect(buildShadowKey(qualityChanged, 'room', 'table-1', 1024)).not.toBe(key);
    expect(buildShadowKey(presetChanged, 'room', 'table-1', 1024)).not.toBe(key);
    expect(buildShadowKey(base, 'room', 'table-2', 1024)).not.toBe(key);
    expect(buildShadowKey(base, 'room', 'table-1', 2048)).not.toBe(key);
    expect(buildShadowKey(base, 'other-room', 'table-1', 1024)).not.toBe(key);
  });

  it('does not invalidate for fill/rim/ambient/background/environment changes', () => {
    const base = scene();
    const key = buildShadowKey(base, 'room', 'table-1', 1024);

    const lightingOnly = {
      ...base,
      settings: {
        ...base.settings,
        background: '#ffffff',
        environmentIntensity: 2,
        lights: {
          ...base.settings.lights,
          ambientIntensity: 4,
          fillIntensity: 4,
          fillColor: '#ff0000',
          rimEnabled: true,
          rimIntensity: 4,
          rimColor: '#00ff00',
          keyIntensity: 4,
          keyColor: '#0000ff',
        },
      },
    };

    expect(buildShadowKey(lightingOnly, 'room', 'table-1', 1024)).toBe(key);
  });

  it('reports the first key as a change', () => {
    expect(shadowKeyChanged(null, buildShadowKey(scene(), 'room', 'table-1', 1024))).toBe(true);
  });
});
