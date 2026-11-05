import { describe, expect, it } from 'vitest';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createDefaultSceneState,
  createFurnitureSceneObject,
  createUniversalSceneObject,
  type SceneData,
  type SceneState,
} from './types';
import { createDefaultSettings } from './sceneSettings';
import { validateSceneData } from './sceneValidation';
import { sceneReducer } from './sceneReducer';
import { parseSceneJson, serializeSceneToJson } from '../export/sceneJson';

function sceneWith(material: Record<string, unknown>): SceneData {
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

function stateWith(material: Record<string, unknown>): SceneState {
  return { ...createDefaultSceneState(() => 'obj-1'), data: sceneWith(material) };
}

describe('Phase 4.6 material editor model', () => {
  it('normalizes colour overrides and clamps AO intensity', () => {
    const result = validateSceneData(
      sceneWith({
        baseColor: '#AABBCC',
        emissiveColor: '#112233',
        aoIntensity: 9,
      }),
    );
    const material = result.scene?.objects[0].material;
    expect(material?.baseColor).toBe('#aabbcc');
    expect(material?.emissiveColor).toBe('#112233');
    expect(material?.aoIntensity).toBe(2);
  });

  it('drops malformed colours and non-finite AO intensity', () => {
    const result = validateSceneData(
      sceneWith({ baseColor: 'red', emissiveColor: '#12', aoIntensity: Number.NaN }),
    );
    const material = result.scene?.objects[0].material;
    expect(material?.baseColor).toBeUndefined();
    expect(material?.emissiveColor).toBeUndefined();
    expect(material?.aoIntensity).toBeUndefined();
  });

  it('round-trips the editor fields through scene JSON', () => {
    const json = serializeSceneToJson(
      sceneWith({ baseColor: '#abcdef', emissiveColor: '#010203', aoIntensity: 0.5 }),
      { name: 'editor', furnitureType: 'table', units: 'cm' },
    );
    const parsed = parseSceneJson(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.scene.objects[0].material.baseColor).toBe('#abcdef');
    expect(parsed.scene.objects[0].material.emissiveColor).toBe('#010203');
    expect(parsed.scene.objects[0].material.aoIntensity).toBe(0.5);
    expect(parsed.scene.schemaVersion).toBe(3);
  });

  it('keeps old scenes without the new fields unchanged', () => {
    const result = validateSceneData(sceneWith({}));
    const material = result.scene?.objects[0].material;
    expect(material?.baseColor).toBeUndefined();
    expect(material?.emissiveColor).toBeUndefined();
    expect(material?.aoIntensity).toBeUndefined();
  });

  it('merges editor fields through UPDATE_MATERIAL', () => {
    const state = sceneReducer(stateWith({}), {
      type: 'UPDATE_MATERIAL',
      id: 'obj-1',
      material: {
        baseColor: '#ABCDEF',
        emissiveColor: '#010203',
        aoIntensity: 0.4,
        emissiveIntensity: 3,
      },
    });
    const material = state.data.objects[0].material;
    expect(material.baseColor).toBe('#abcdef');
    expect(material.emissiveColor).toBe('#010203');
    expect(material.aoIntensity).toBe(0.4);
    expect(material.emissiveIntensity).toBe(3);
  });

  it('rejects an invalid colour without losing the previous value', () => {
    const start = sceneReducer(stateWith({ baseColor: '#123456' }), {
      type: 'UPDATE_MATERIAL',
      id: 'obj-1',
      material: { baseColor: 'not-a-colour' },
    });
    expect(start.data.objects[0].material.baseColor).toBe('#123456');
  });

  it('clears every editor override on reset', () => {
    const state = sceneReducer(
      stateWith({
        baseColor: '#123456',
        emissiveColor: '#654321',
        aoIntensity: 1.5,
        emissiveIntensity: 2,
      }),
      { type: 'RESET_MATERIAL', id: 'obj-1' },
    );
    const material = state.data.objects[0].material;
    expect(material.baseColor).toBeUndefined();
    expect(material.emissiveColor).toBeUndefined();
    expect(material.aoIntensity).toBeUndefined();
    expect(material.emissiveIntensity).toBeUndefined();
  });

  it('gives universal preset colours a visible material override', () => {
    const object = createUniversalSceneObject('desk.computer', 'u1');
    const base = createDefaultSceneState(() => 'x');
    const state: SceneState = {
      ...base,
      data: { ...base.data, objects: [object] },
      selectedId: 'u1',
    };
    const applied = sceneReducer(state, {
      type: 'APPLY_MATERIAL_PRESET',
      id: 'u1',
      presetId: 'wood-oak',
    });
    expect(applied.data.objects[0].material.baseColor).toBe('#a9744f');
    expect(applied.data.objects[0].params.color).toBe('#a9744f');

    const cleared = sceneReducer(applied, {
      type: 'APPLY_MATERIAL_PRESET',
      id: 'u1',
      presetId: 'default',
    });
    expect(cleared.data.objects[0].material.baseColor).toBeUndefined();
  });
});
