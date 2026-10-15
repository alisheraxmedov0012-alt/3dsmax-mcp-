import { describe, expect, it } from 'vitest';
import { hasUnsavedChanges, sceneSignature, shouldProtectUnload } from './unsavedChanges';
import { createDefaultSceneState } from '../scene/types';

function scene() {
  return createDefaultSceneState(() => 'scene-id-1').data;
}

describe('sceneSignature', () => {
  it('is stable for the same name and scene', () => {
    const data = scene();
    expect(sceneSignature('A', data)).toBe(sceneSignature('A', data));
  });

  it('changes when the name changes', () => {
    const data = scene();
    expect(sceneSignature('A', data)).not.toBe(sceneSignature('B', data));
  });

  it('ignores surrounding whitespace in the name', () => {
    const data = scene();
    expect(sceneSignature('  A  ', data)).toBe(sceneSignature('A', data));
  });

  it('changes when the scene changes', () => {
    const data = scene();
    const changed = { ...data, room: { ...data.room, widthCm: data.room.widthCm + 10 } };
    expect(sceneSignature('A', data)).not.toBe(sceneSignature('A', changed));
  });
});

describe('hasUnsavedChanges', () => {
  it('detects a difference', () => {
    expect(hasUnsavedChanges('a', 'b')).toBe(true);
    expect(hasUnsavedChanges('a', 'a')).toBe(false);
  });
});

describe('shouldProtectUnload', () => {
  it('protects only when dirty and not saving', () => {
    expect(shouldProtectUnload(true, false)).toBe(true);
    expect(shouldProtectUnload(true, true)).toBe(false);
    expect(shouldProtectUnload(false, false)).toBe(false);
  });
});
