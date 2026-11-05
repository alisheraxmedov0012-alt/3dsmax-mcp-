import { describe, expect, it } from 'vitest';
import type { TextureAssetRef } from '../materials/asset';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createDefaultSceneState,
  createFurnitureSceneObject,
} from './types';
import { createDefaultSettings } from './sceneSettings';
import { validateSceneData } from './sceneValidation';
import { sceneReducer } from './sceneReducer';
import { parseSceneJson, serializeSceneToJson } from '../export/sceneJson';
import { deserializeProjects, serializeProjects } from '../projects/projectValidation';
import { PROJECTS_SCHEMA_VERSION } from '../projects/types';

const REF: TextureAssetRef = {
  id: 'tex-12345678',
  version: 1,
  role: 'baseColor',
  colorSpace: 'srgb',
  wrap: 'repeat',
};

function sceneWith(material: Record<string, unknown>) {
  const object = createFurnitureSceneObject('table', 'obj-1', {
    material: { metalness: 0.05, roughness: 0.6, ...material },
  });
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects: [object],
    settings: createDefaultSettings(),
  };
}

describe('scene texture references', () => {
  it('keeps a valid baseColor reference and normalizes its role rules', () => {
    const result = validateSceneData(sceneWith({ maps: { baseColor: REF } }));
    expect(result.scene?.objects[0].material.maps?.baseColor).toEqual(REF);

    const corrected = validateSceneData(
      sceneWith({
        maps: {
          baseColor: { ...REF, colorSpace: 'linear', wrap: 'clamp' },
        },
      }),
    );
    expect(corrected.scene?.objects[0].material.maps?.baseColor).toMatchObject({
      colorSpace: 'srgb',
      wrap: 'clamp',
    });
  });

  it('drops malformed references without rejecting the object', () => {
    for (const maps of [
      { baseColor: { id: 'Not Valid', version: 1 } },
      { baseColor: { ...REF, role: 'normal' } },
      { baseColor: 'nope' },
    ]) {
      const result = validateSceneData(sceneWith({ maps }));
      expect(result.scene?.objects).toHaveLength(1);
      expect(result.scene?.objects[0].material.maps).toBeUndefined();
    }
  });

  it('loads a pre-4.3 scene with no maps unchanged', () => {
    const result = validateSceneData(sceneWith({}));
    expect(result.scene?.objects[0].material.maps).toBeUndefined();
  });

  it('round-trips through JSON without embedding image bytes', () => {
    const scene = sceneWith({ maps: { baseColor: REF } });
    const json = serializeSceneToJson(scene, {
      name: 'texture',
      furnitureType: 'table',
      units: 'cm',
    });
    expect(json).not.toContain('data:image');
    expect(json).not.toContain('base64');

    const parsed = parseSceneJson(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.scene.objects[0].material.maps?.baseColor).toEqual(REF);
    expect(parsed.scene.schemaVersion).toBe(3);
  });

  it('survives the browser project repository round-trip', () => {
    const scene = sceneWith({ maps: { baseColor: REF } });
    const saved = {
      id: 'p-1',
      name: 'Textured',
      scene,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      schemaVersion: PROJECTS_SCHEMA_VERSION,
    };
    const restored = deserializeProjects(serializeProjects([saved]));
    expect(restored.projects).toHaveLength(1);
    expect(restored.projects[0].scene.objects[0].material.maps?.baseColor).toEqual(REF);
  });
});

describe('SET_MATERIAL_MAP reducer action', () => {
  it('sets and removes the baseColor reference', () => {
    const state = createDefaultSceneState(() => 'obj-1');
    const id = state.data.objects[0].id;

    const applied = sceneReducer(state, {
      type: 'SET_MATERIAL_MAP',
      id,
      role: 'baseColor',
      ref: REF,
    });
    expect(applied.data.objects[0].material.maps?.baseColor).toEqual(REF);

    const removed = sceneReducer(applied, {
      type: 'SET_MATERIAL_MAP',
      id,
      role: 'baseColor',
      ref: null,
    });
    expect(removed.data.objects[0].material.maps).toBeUndefined();
  });

  it('keeps the bitmap when a new PBR preset is applied', () => {
    const state = createDefaultSceneState(() => 'obj-1');
    const id = state.data.objects[0].id;
    const withMap = sceneReducer(state, {
      type: 'SET_MATERIAL_MAP',
      id,
      role: 'baseColor',
      ref: REF,
    });
    const withPreset = sceneReducer(withMap, {
      type: 'APPLY_MATERIAL_PRESET',
      id,
      presetId: 'metal-brass',
    });
    expect(withPreset.data.objects[0].material.materialId).toBe('metal-brass');
    expect(withPreset.data.objects[0].material.maps?.baseColor).toEqual(REF);
  });

  it('ignores an invalid reference and leaves spec undo history untouched', () => {
    const state = createDefaultSceneState(() => 'obj-1');
    const id = state.data.objects[0].id;
    const invalid = { ...REF, role: 'normal' as const };

    const rejected = sceneReducer(state, {
      type: 'SET_MATERIAL_MAP',
      id,
      role: 'baseColor',
      ref: invalid,
    });
    expect(rejected.data.objects[0].material.maps).toBeUndefined();
    expect(rejected.history).toEqual(state.history);

    const applied = sceneReducer(state, {
      type: 'SET_MATERIAL_MAP',
      id,
      role: 'baseColor',
      ref: REF,
    });
    // Material changes are not spec edits; the existing undo stack is untouched.
    expect(applied.history).toEqual(state.history);
  });
});
