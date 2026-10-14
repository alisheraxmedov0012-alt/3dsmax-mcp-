import { describe, expect, it } from 'vitest';
import { findSceneObject, sceneReducer } from './sceneReducer';
import { createDefaultSceneState, ROOM_DEFAULTS, ROOM_LIMITS, ROOM_OBJECT_ID } from './types';
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

  it('loads and resets scenes', () => {
    const state0 = initialState();
    const loaded = sceneReducer(state0, {
      type: 'LOAD_SCENE',
      scene: {
        schemaVersion: 2,
        room: { widthCm: 300, lengthCm: 300, heightCm: 250 },
        objects: [findSceneObject(state0, state0.selectedId)!],
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
