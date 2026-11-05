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
import { updateFurnitureSpec } from './configurator';
import {
  TEXTURE_MAP_ROLES,
  TEXTURE_ROLE_COLOR_SPACE,
  type MaterialAssetMaps,
  type TextureAssetRef,
  type TextureMapRole,
} from '../materials/asset';

function ref(role: TextureMapRole): TextureAssetRef {
  return {
    id: `tex-${role.toLowerCase()}`,
    version: 1,
    role,
    colorSpace: TEXTURE_ROLE_COLOR_SPACE[role],
    wrap: 'repeat',
  };
}

const ALL_MAPS: MaterialAssetMaps = Object.fromEntries(
  TEXTURE_MAP_ROLES.map((role) => [role, ref(role)]),
) as MaterialAssetMaps;

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
  const base = createDefaultSceneState(() => 'obj-1');
  const data = sceneWith(material);
  return { ...base, data, selectedId: 'obj-1' };
}

describe('Phase 4.5 scene persistence', () => {
  it('stores every map role with the role colour space', () => {
    const result = validateSceneData(sceneWith({ maps: ALL_MAPS, emissiveIntensity: 2.5 }));
    expect(result.scene?.objects[0].material.maps).toEqual(ALL_MAPS);
    expect(result.scene?.objects[0].material.emissiveIntensity).toBe(2.5);
  });

  it('corrects and rejects bad role data without losing the object', () => {
    const wrongSpace = validateSceneData(
      sceneWith({ maps: { orm: { ...ref('orm'), colorSpace: 'srgb' } } }),
    );
    expect(wrongSpace.scene?.objects[0].material.maps?.orm?.colorSpace).toBe('linear');

    const unknownRole = validateSceneData(
      sceneWith({ maps: { specular: ref('normal'), roughness: ref('roughness') } }),
    );
    expect(unknownRole.scene?.objects).toHaveLength(1);
    expect(unknownRole.scene?.objects[0].material.maps).toBeUndefined();
  });

  it('round-trips all maps through JSON without embedding bytes', () => {
    const json = serializeSceneToJson(sceneWith({ maps: ALL_MAPS }), {
      name: 'pbr-maps',
      furnitureType: 'table',
      units: 'cm',
    });
    expect(json).not.toContain('data:image');
    expect(json).not.toContain('base64');

    const parsed = parseSceneJson(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.scene.objects[0].material.maps).toEqual(ALL_MAPS);
    expect(parsed.scene.schemaVersion).toBe(3);
  });

  it('loads a pre-4.3 scene with no maps unchanged', () => {
    const result = validateSceneData(sceneWith({}));
    expect(result.scene?.objects[0].material.maps).toBeUndefined();
    expect(result.scene?.objects[0].material.emissiveIntensity).toBeUndefined();
  });
});

describe('Phase 4.5 reducer integration', () => {
  it('sets and removes each map role independently', () => {
    let state = stateWith({});
    for (const role of TEXTURE_MAP_ROLES) {
      state = sceneReducer(state, {
        type: 'SET_MATERIAL_MAP',
        id: 'obj-1',
        role,
        ref: ref(role),
      });
      expect(state.data.objects[0].material.maps?.[role]).toEqual(ref(role));
    }
    expect(Object.keys(state.data.objects[0].material.maps ?? {})).toHaveLength(
      TEXTURE_MAP_ROLES.length,
    );

    for (const role of TEXTURE_MAP_ROLES) {
      state = sceneReducer(state, {
        type: 'SET_MATERIAL_MAP',
        id: 'obj-1',
        role,
        ref: null,
      });
    }
    expect(state.data.objects[0].material.maps).toBeUndefined();
  });

  it('rejects a map whose role does not match its slot', () => {
    const state = stateWith({});
    const next = sceneReducer(state, {
      type: 'SET_MATERIAL_MAP',
      id: 'obj-1',
      role: 'normal',
      ref: ref('baseColor'),
    });
    expect(next.data.objects[0].material.maps).toBeUndefined();
  });

  it('clamps emissiveIntensity through the material update path', () => {
    const state = sceneReducer(stateWith({}), {
      type: 'UPDATE_MATERIAL',
      id: 'obj-1',
      material: { emissiveIntensity: 99 },
    });
    expect(state.data.objects[0].material.emissiveIntensity).toBe(5);

    const negative = sceneReducer(state, {
      type: 'UPDATE_MATERIAL',
      id: 'obj-1',
      material: { emissiveIntensity: -3 },
    });
    expect(negative.data.objects[0].material.emissiveIntensity).toBe(0);
  });

  it('preserves maps when a compatible preset is applied', () => {
    const state = stateWith({ maps: ALL_MAPS });
    const next = sceneReducer(state, {
      type: 'APPLY_MATERIAL_PRESET',
      id: 'obj-1',
      presetId: 'metal-steel',
    });
    expect(next.data.objects[0].material.maps).toEqual(ALL_MAPS);
  });

  it('preserves maps through an unrelated scalar material update', () => {
    const state = stateWith({ maps: ALL_MAPS });
    const next = sceneReducer(state, {
      type: 'UPDATE_MATERIAL',
      id: 'obj-1',
      material: { roughness: 0.2 },
    });
    expect(next.data.objects[0].material.roughness).toBe(0.2);
    expect(next.data.objects[0].material.maps).toEqual(ALL_MAPS);
  });

  it('clears every map when the material is reset', () => {
    const state = stateWith({ maps: ALL_MAPS });
    const next = sceneReducer(state, { type: 'RESET_MATERIAL', id: 'obj-1' });
    expect(next.data.objects[0].material.maps).toBeUndefined();
  });

  it('keeps maps intact across spec undo and redo', () => {
    const universal = createUniversalSceneObject('desk.computer', 'u1');
    const base = createDefaultSceneState(() => 'x');
    const state: SceneState = {
      ...base,
      data: {
        ...base.data,
        objects: [{ ...universal, material: { ...universal.material, maps: ALL_MAPS } }],
      },
      selectedId: 'u1',
    };

    const proposal = updateFurnitureSpec(universal.definitionId as string, universal.spec ?? {}, {
      width: 180,
    });
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    const edited = sceneReducer(state, { type: 'UPDATE_SPEC', id: 'u1', spec: proposal.spec });

    const undone = sceneReducer(edited, { type: 'UNDO_SPEC' });
    expect(undone.data.objects[0].material.maps).toEqual(ALL_MAPS);

    const redone = sceneReducer(undone, { type: 'REDO_SPEC' });
    expect(redone.data.objects[0].material.maps).toEqual(ALL_MAPS);
  });
});
