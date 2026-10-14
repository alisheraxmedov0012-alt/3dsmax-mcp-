import { describe, expect, it } from 'vitest';
import { findSceneObject, sceneReducer } from './sceneReducer';
import {
  createDefaultSceneState,
  createTableSceneObject,
  ROOM_DEFAULTS,
  ROOM_LIMITS,
  ROOM_OBJECT_ID,
} from './types';
import { createLayoutObjects } from './layoutPresets';
import { createDefaultSettings } from './sceneSettings';
import { buildTable } from '../geometry/buildTable';

function initialState() {
  let counter = 0;
  return createDefaultSceneState(() => `id-${++counter}`);
}

describe('sceneReducer', () => {
  it('creates a default scene with a room and one table', () => {
    const state = initialState();
    expect(state.data.room).toEqual(ROOM_DEFAULTS);
    expect(state.data.objects).toHaveLength(1);
    expect(state.selectedId).toBe(state.data.objects[0].id);
  });

  it('creates/reset a room with valid dimensions', () => {
    const state = sceneReducer(initialState(), {
      type: 'SET_ROOM',
      room: { widthCm: 700, lengthCm: 800, heightCm: 320 },
    });

    expect(state.data.room).toEqual({ widthCm: 700, lengthCm: 800, heightCm: 320 });
  });

  it('clamps invalid room dimensions instead of accepting them', () => {
    const state = sceneReducer(initialState(), {
      type: 'SET_ROOM',
      room: { widthCm: 99999, lengthCm: -100, heightCm: 10 },
    });

    expect(state.data.room.widthCm).toBe(ROOM_LIMITS.widthCm.max);
    expect(state.data.room.lengthCm).toBe(ROOM_LIMITS.lengthCm.min);
    expect(state.data.room.heightCm).toBe(ROOM_LIMITS.heightCm.min);
  });

  it('adds a table that can coexist with a unique id', () => {
    let state = initialState();
    state = sceneReducer(state, { type: 'ADD_TABLE', id: 'table-2' });

    expect(state.data.objects).toHaveLength(2);
    const ids = state.data.objects.map((object) => object.id);
    expect(new Set(ids).size).toBe(2);
    expect(state.selectedId).toBe('table-2');
  });

  it('keeps stable ids for other objects when one is deleted', () => {
    let state = initialState();
    const firstId = state.data.objects[0].id;
    state = sceneReducer(state, { type: 'ADD_TABLE', id: 'table-2' });
    state = sceneReducer(state, { type: 'DELETE_OBJECT', id: 'table-2' });

    expect(state.data.objects).toHaveLength(1);
    expect(state.data.objects[0].id).toBe(firstId);
  });

  it('changes only the targeted object transform', () => {
    let state = initialState();
    state = sceneReducer(state, { type: 'ADD_TABLE', id: 'table-2' });
    const [a, b] = state.data.objects;

    state = sceneReducer(state, {
      type: 'UPDATE_TRANSFORM',
      id: a.id,
      position: { x: 100 },
      rotation: { y: 90 },
      scale: { x: 2 },
    });

    const updatedA = findSceneObject(state, a.id);
    const untouchedB = findSceneObject(state, b.id);

    expect(updatedA?.position.x).toBe(100);
    expect(updatedA?.rotation.y).toBe(90);
    expect(updatedA?.scale.x).toBe(2);
    expect(untouchedB?.position).toEqual(b.position);
    expect(untouchedB?.rotation).toEqual(b.rotation);
    expect(untouchedB?.scale).toEqual(b.scale);
  });

  it('clamps transforms into the object limits', () => {
    const state0 = initialState();
    const id = state0.data.objects[0].id;
    const state = sceneReducer(state0, {
      type: 'UPDATE_TRANSFORM',
      id,
      position: { x: 999999 },
      rotation: { y: 1000 },
      scale: { z: 0.0001 },
    });

    const object = findSceneObject(state, id);
    expect(object?.position.x).toBeLessThanOrEqual(2000);
    expect(object?.rotation.y).toBeLessThanOrEqual(360);
    expect(object?.scale.z).toBeGreaterThanOrEqual(0.1);
  });

  it('updates params only for the selected object', () => {
    let state = initialState();
    state = sceneReducer(state, { type: 'ADD_TABLE', id: 'table-2' });
    const [a, b] = state.data.objects;

    state = sceneReducer(state, {
      type: 'UPDATE_PARAMS',
      id: a.id,
      params: { widthCm: 200, heightCm: 90, depthCm: 80, color: '#123456' },
    });

    expect(findSceneObject(state, a.id)?.params.widthCm).toBe(200);
    expect(findSceneObject(state, b.id)?.params).toEqual(b.params);
  });

  it('toggles visibility of a single object', () => {
    let state = initialState();
    state = sceneReducer(state, { type: 'ADD_TABLE', id: 'table-2' });
    const [a, b] = state.data.objects;

    state = sceneReducer(state, { type: 'TOGGLE_VISIBILITY', id: a.id });
    expect(findSceneObject(state, a.id)?.visible).toBe(false);
    expect(findSceneObject(state, b.id)?.visible).toBe(true);
  });

  it('renames an object', () => {
    const state0 = initialState();
    const id = state0.data.objects[0].id;
    const state = sceneReducer(state0, { type: 'RENAME_OBJECT', id, name: 'Katta stol' });
    expect(findSceneObject(state, id)?.name).toBe('Katta stol');
  });

  it('deletes an object and moves selection safely', () => {
    const state0 = initialState();
    const id = state0.data.objects[0].id;
    const deleted = sceneReducer(state0, { type: 'DELETE_OBJECT', id: 'missing' });
    expect(deleted.data.objects).toHaveLength(1);
    expect(deleted).toBe(state0);

    const state = sceneReducer(state0, { type: 'DELETE_OBJECT', id });
    expect(state.data.objects).toHaveLength(0);
    expect(state.selectedId).toBe(ROOM_OBJECT_ID);
  });

  it('selects the room', () => {
    const state = sceneReducer(initialState(), { type: 'SELECT', id: ROOM_OBJECT_ID });
    expect(state.selectedId).toBe(ROOM_OBJECT_ID);
  });

  it('updates material for only the targeted object', () => {
    let state = initialState();
    state = sceneReducer(state, { type: 'ADD_TABLE', id: 'table-2' });
    const [a, b] = state.data.objects;

    state = sceneReducer(state, {
      type: 'UPDATE_MATERIAL',
      id: a.id,
      material: { metalness: 0.9, roughness: 0.2 },
    });

    expect(findSceneObject(state, a.id)?.material).toEqual({ metalness: 0.9, roughness: 0.2 });
    expect(findSceneObject(state, b.id)?.material).toEqual(b.material);
  });

  it('clamps material values into 0–1', () => {
    const state0 = initialState();
    const id = state0.data.objects[0].id;

    const high = sceneReducer(state0, {
      type: 'UPDATE_MATERIAL',
      id,
      material: { metalness: 5, roughness: -3 },
    });
    expect(findSceneObject(high, id)?.material.metalness).toBe(1);
    expect(findSceneObject(high, id)?.material.roughness).toBe(0);

    const nan = sceneReducer(state0, {
      type: 'UPDATE_MATERIAL',
      id,
      material: { metalness: Number.NaN },
    });
    expect(findSceneObject(nan, id)?.material.metalness).toBe(state0.data.objects[0].material.metalness);
  });

  it('resets material to defaults', () => {
    const state0 = initialState();
    const id = state0.data.objects[0].id;
    const changed = sceneReducer(state0, { type: 'UPDATE_MATERIAL', id, material: { metalness: 1 } });
    const reset = sceneReducer(changed, { type: 'RESET_MATERIAL', id });

    expect(findSceneObject(reset, id)?.material.metalness).toBe(0.05);
    expect(findSceneObject(reset, id)?.material.roughness).toBe(0.6);
  });

  it('adds a furniture object of the chosen type and selects it', () => {
    const state = sceneReducer(initialState(), {
      type: 'ADD_FURNITURE',
      furnitureType: 'wardrobe',
      id: 'w1',
    });
    const added = findSceneObject(state, 'w1');
    expect(added?.type).toBe('wardrobe');
    expect(state.selectedId).toBe('w1');
    expect(added?.params.widthCm).toBeGreaterThan(0);
    expect(state.data.objects).toHaveLength(2);
  });

  it('applies transform/visibility/delete to any furniture type', () => {
    let state = sceneReducer(initialState(), {
      type: 'ADD_FURNITURE',
      furnitureType: 'sofa',
      id: 's1',
    });
    state = sceneReducer(state, {
      type: 'UPDATE_TRANSFORM',
      id: 's1',
      position: { x: 100 },
    });
    expect(findSceneObject(state, 's1')?.position.x).toBe(100);

    state = sceneReducer(state, { type: 'TOGGLE_VISIBILITY', id: 's1' });
    expect(findSceneObject(state, 's1')?.visible).toBe(false);

    state = sceneReducer(state, { type: 'DELETE_OBJECT', id: 's1' });
    expect(findSceneObject(state, 's1')).toBeNull();
  });

  it('ignores UPDATE_PARAMS with values invalid for the object type', () => {
    const state0 = initialState();
    const id = state0.data.objects[0].id; // a table
    const next = sceneReducer(state0, {
      type: 'UPDATE_PARAMS',
      id,
      params: { widthCm: 9999, heightCm: 75, depthCm: 60, color: '#a9744f' },
    });
    // Out of range -> rejected, the object keeps its previous parameters.
    expect(findSceneObject(next, id)?.params.widthCm).toBe(120);
  });

  it('sets the scene background', () => {
    const state = sceneReducer(initialState(), { type: 'SET_BACKGROUND', color: '#ff0000' });
    expect(state.data.settings.background).toBe('#ff0000');
  });

  it('ignores an invalid background colour (keeps the current one)', () => {
    const custom = sceneReducer(initialState(), { type: 'SET_BACKGROUND', color: '#123456' });
    const still = sceneReducer(custom, { type: 'SET_BACKGROUND', color: 'not-a-colour' });
    expect(still.data.settings.background).toBe('#123456');
  });

  it('updates and resets lights with clamping', () => {
    const state0 = initialState();
    const updated = sceneReducer(state0, {
      type: 'UPDATE_LIGHTS',
      lights: { keyIntensity: 99, keyEnabled: false },
    });
    expect(updated.data.settings.lights.keyIntensity).toBe(5);
    expect(updated.data.settings.lights.keyEnabled).toBe(false);

    const reset = sceneReducer(updated, { type: 'RESET_LIGHTS' });
    expect(reset.data.settings.lights.keyIntensity).toBe(2);
    expect(reset.data.settings.lights.keyEnabled).toBe(true);
  });

  it('updates room material colours', () => {
    const state = sceneReducer(initialState(), {
      type: 'UPDATE_ROOM_MATERIALS',
      floorColor: '#101010',
      wallColor: '#202020',
      ceilingColor: '#303030',
    });
    expect(state.data.settings.roomMaterials).toEqual({
      floorColor: '#101010',
      wallColor: '#202020',
      ceilingColor: '#303030',
    });
  });

  it('sets a valid camera preset and ignores an invalid one', () => {
    const good = sceneReducer(initialState(), { type: 'SET_CAMERA_PRESET', preset: 'front' });
    expect(good.data.settings.cameraPreset).toBe('front');

    const bad = sceneReducer(good, { type: 'SET_CAMERA_PRESET', preset: 'diagonal' as never });
    expect(bad.data.settings.cameraPreset).toBe('front');
  });

  it('applies a lighting preset as concrete light values', () => {
    const applied = sceneReducer(initialState(), {
      type: 'APPLY_LIGHTING_PRESET',
      preset: 'highContrast',
    });
    const settings = applied.data.settings;
    expect(settings.lightingPreset).toBe('highContrast');
    expect(settings.lights.keyIntensity).toBe(3.2);
    expect(settings.lights.ambientIntensity).toBe(0.35);
    expect(settings.lights.keyColor).toBe('#ffffff');
  });

  it('marks lighting as custom after a manual light edit', () => {
    const applied = sceneReducer(initialState(), {
      type: 'APPLY_LIGHTING_PRESET',
      preset: 'coolDaylight',
    });
    expect(applied.data.settings.lightingPreset).toBe('coolDaylight');
    const edited = sceneReducer(applied, {
      type: 'UPDATE_LIGHTS',
      lights: { keyIntensity: 1 },
    });
    expect(edited.data.settings.lightingPreset).toBe('custom');
  });

  it('sets a valid render quality and ignores an invalid one', () => {
    const good = sceneReducer(initialState(), { type: 'SET_RENDER_QUALITY', quality: 'high' });
    expect(good.data.settings.qualityPreset).toBe('high');
    const bad = sceneReducer(good, { type: 'SET_RENDER_QUALITY', quality: 'ultra' as never });
    expect(bad.data.settings.qualityPreset).toBe('high');
  });

  it('sets and clamps the exposure, and sets a valid tone mapping', () => {
    const set = sceneReducer(initialState(), { type: 'SET_EXPOSURE', exposure: 2.2 });
    expect(set.data.settings.exposure).toBeCloseTo(2.2, 5);

    const clamped = sceneReducer(set, { type: 'SET_EXPOSURE', exposure: 99 });
    expect(clamped.data.settings.exposure).toBe(4);

    const nonFinite = sceneReducer(clamped, { type: 'SET_EXPOSURE', exposure: Number.NaN });
    expect(nonFinite.data.settings.exposure).toBe(4);

    const tone = sceneReducer(nonFinite, { type: 'SET_TONE_MAPPING', toneMapping: 'aces' });
    expect(tone.data.settings.toneMapping).toBe('aces');
    const badTone = sceneReducer(tone, { type: 'SET_TONE_MAPPING', toneMapping: 'filmic' as never });
    expect(badTone.data.settings.toneMapping).toBe('aces');
  });

  it('render settings changes never mutate scene geometry or objects', () => {
    const before = initialState();
    const objectsBefore = JSON.stringify(before.data.objects);

    let state = sceneReducer(before, { type: 'SET_RENDER_QUALITY', quality: 'high' });
    state = sceneReducer(state, { type: 'SET_EXPOSURE', exposure: 2 });
    state = sceneReducer(state, { type: 'SET_TONE_MAPPING', toneMapping: 'aces' });
    state = sceneReducer(state, { type: 'APPLY_LIGHTING_PRESET', preset: 'coolDaylight' });
    state = sceneReducer(state, { type: 'SET_CAMERA_PRESET', preset: 'top' });

    expect(JSON.stringify(state.data.objects)).toBe(objectsBefore);
    expect(state.data.room).toEqual(before.data.room);
  });

  it('applies a layout via SET_LAYOUT (validated, replaces objects)', () => {
    const state0 = initialState();
    let counter = 0;
    const objects = createLayoutObjects('living', state0.data.room, () => `layout-${++counter}`);
    const next = sceneReducer(state0, { type: 'SET_LAYOUT', room: state0.data.room, objects });
    expect(next.data.objects.length).toBe(objects.length);
    expect(next.selectedId).toBe(next.data.objects[0].id);
  });

  it('SET_LAYOUT drops invalid objects and never injects a bad one', () => {
    const state0 = initialState();
    const bad = { ...createTableSceneObject('bad'), params: { widthCm: 1, color: 'nope' } };
    const next = sceneReducer(state0, {
      type: 'SET_LAYOUT',
      room: state0.data.room,
      objects: [createTableSceneObject('ok'), bad as never],
    });
    expect(next.data.objects.map((o) => o.id)).toEqual(['ok']);
  });

  it('places the selected object against the nearest wall', () => {
    const state0 = initialState();
    const id = state0.data.objects[0].id;
    const moved = sceneReducer(state0, {
      type: 'UPDATE_TRANSFORM',
      id,
      position: { x: 0, y: 0, z: -240 },
    });
    const placed = sceneReducer(moved, { type: 'PLACE_AGAINST_WALL', id });
    const object = findSceneObject(placed, id);
    // North wall -> rotation 0 and the footprint pushed in from the wall.
    expect(object?.rotation.y).toBe(0);
    expect(object?.position.z).toBeGreaterThan(-state0.data.room.lengthCm / 2);
  });

  it('toggles the room ceiling and stores it only when enabled', () => {
    const state0 = initialState();
    const on = sceneReducer(state0, { type: 'SET_ROOM_CEILING', showCeiling: true });
    expect(on.data.room.showCeiling).toBe(true);
    const off = sceneReducer(on, { type: 'SET_ROOM_CEILING', showCeiling: false });
    expect(off.data.room.showCeiling).toBeUndefined();
  });

  it('adds and removes door/window openings with validation', () => {
    const state0 = initialState();
    const added = sceneReducer(state0, {
      type: 'ADD_ROOM_OPENING',
      opening: {
        id: 'd1',
        kind: 'door',
        wall: 'north',
        offsetCm: 0,
        widthCm: 90,
        heightCm: 200,
        sillCm: 0,
      },
    });
    expect(added.data.room.openings).toHaveLength(1);
    expect(added.data.room.openings?.[0].id).toBe('d1');

    const removed = sceneReducer(added, { type: 'REMOVE_ROOM_OPENING', id: 'd1' });
    expect(removed.data.room.openings).toBeUndefined();
  });

  it('loads and resets scenes', () => {
    const state0 = initialState();
    const loaded = sceneReducer(state0, {
      type: 'LOAD_SCENE',
      scene: {
        schemaVersion: 3,
        room: { widthCm: 300, lengthCm: 300, heightCm: 250 },
        objects: [findSceneObject(state0, state0.selectedId)!],
        settings: createDefaultSettings(),
      },
    });
    expect(loaded.data.room.widthCm).toBe(300);

    const fresh = sceneReducer(loaded, { type: 'NEW_SCENE', id: 'new-1' });
    expect(fresh.data.room).toEqual(ROOM_DEFAULTS);
    expect(fresh.data.objects).toHaveLength(1);
    expect(fresh.data.objects[0].id).toBe('new-1');
    expect(fresh.selectedId).toBe('new-1');
  });
});

describe('scene objects integrate with geometry', () => {
  it('produces table geometry from an object’s params', () => {
    const state = initialState();
    const object = state.data.objects[0];
    const built = buildTable(object.params);
    // Sanity: the reducer stores usable TableParams for the geometry layer.
    expect(built.group.children.length).toBeGreaterThan(0);
    built.dispose();
  });
});
