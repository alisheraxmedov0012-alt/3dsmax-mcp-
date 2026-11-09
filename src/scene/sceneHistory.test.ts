import { describe, expect, it } from 'vitest';
import { ROOM_STANDARD_DEFINITION_ID } from '../geometry/interior/roomDefinition';
import { DEFAULT_ROOM_SPEC } from '../geometry/interior/roomSpec';
import { buildExportScene } from '../export/sceneExport';
import { canonicalizeFurnitureSpec } from './configurator/canonicalSpec';
import { createRoomInstance } from './roomInstance';
import { sceneReducer } from './sceneReducer';
import {
  MAX_SCENE_HISTORY,
  createDefaultSceneState,
  createUniversalSceneObject,
  type RoomInstance,
  type SceneState,
  type SceneSpec,
} from './types';
import { roomSelectionId } from '../viewer/selection';

function room(id = 'room-a', overrides: Partial<RoomInstance> = {}): RoomInstance {
  return {
    ...createRoomInstance(ROOM_STANDARD_DEFINITION_ID, id, {
      ...DEFAULT_ROOM_SPEC,
      showCeiling: false,
    }),
    ...overrides,
  };
}

function stateWith(options: { rooms?: RoomInstance[]; objectSpec?: boolean } = {}): {
  state: SceneState;
  objectId: string;
} {
  const base = createDefaultSceneState(() => 'base-object');
  const object = createUniversalSceneObject('desk.computer', 'desk-1');
  const objects = options.objectSpec === false ? [] : [object];
  return {
    state: {
      data: {
        ...base.data,
        objects,
        rooms: options.rooms ?? [room()],
      },
      selectedId: roomSelectionId('room-a'),
    },
    objectId: object.id,
  };
}

function canonicalSpec(spec: SceneSpec): SceneSpec {
  const result = canonicalizeFurnitureSpec('desk.computer', {
    ...spec,
    drawerEnabled: false,
  });
  if (!result.ok) {
    throw new Error(JSON.stringify(result.issues));
  }
  return result.spec;
}

describe('9A.2.10 — universal transform history', () => {
  it('undoes and redoes a room move', () => {
    const { state } = stateWith();
    const moved = sceneReducer(state, {
      type: 'UPDATE_ROOM_TRANSFORM',
      id: 'room-a',
      position: { x: 120, y: 5, z: -40 },
      recordHistory: true,
    });
    expect(moved.data.rooms?.[0].position).toEqual({ x: 120, y: 5, z: -40 });
    expect(moved.history?.past).toHaveLength(1);
    expect(moved.history?.past[0]).toMatchObject({
      kind: 'transform',
      entityType: 'room',
      entityId: 'room-a',
    });
    expect(Object.isFrozen(moved.history?.past[0])).toBe(true);

    const undone = sceneReducer(moved, { type: 'UNDO' });
    expect(undone.data.rooms?.[0].position).toEqual({ x: 0, y: 0, z: 0 });
    expect(undone.history?.past).toHaveLength(0);
    expect(undone.history?.future).toHaveLength(1);

    const redone = sceneReducer(undone, { type: 'REDO' });
    expect(redone.data.rooms?.[0].position).toEqual({ x: 120, y: 5, z: -40 });
    expect(redone.history?.past).toHaveLength(1);
    expect(redone.history?.future).toHaveLength(0);
  });

  it('undoes and redoes a room rotation', () => {
    const { state } = stateWith();
    const rotated = sceneReducer(state, {
      type: 'UPDATE_ROOM_TRANSFORM',
      id: 'room-a',
      rotation: { y: -45 },
      recordHistory: true,
    });
    expect(rotated.data.rooms?.[0].rotation.y).toBe(315);
    const undone = sceneReducer(rotated, { type: 'UNDO' });
    expect(undone.data.rooms?.[0].rotation).toEqual({ x: 0, y: 0, z: 0 });
    const redone = sceneReducer(undone, { type: 'REDO' });
    expect(redone.data.rooms?.[0].rotation.y).toBe(315);
  });

  it('undoes and redoes a room scale without leaving the limits', () => {
    const { state } = stateWith();
    const scaled = sceneReducer(state, {
      type: 'UPDATE_ROOM_TRANSFORM',
      id: 'room-a',
      scale: { x: 2, y: 0, z: -1 },
      recordHistory: true,
    });
    expect(scaled.data.rooms?.[0].scale).toEqual({ x: 2, y: 0.1, z: 0.1 });
    const entry = scaled.history?.past[0];
    expect(entry).toMatchObject({ kind: 'transform' });
    const undo = sceneReducer(scaled, { type: 'UNDO' });
    expect(undo.data.rooms?.[0].scale).toEqual({ x: 1, y: 1, z: 1 });
    const redo = sceneReducer(undo, { type: 'REDO' });
    expect(redo.data.rooms?.[0].scale).toEqual({ x: 2, y: 0.1, z: 0.1 });
  });

  it('undoes and redoes furniture move, rotate and scale', () => {
    const { state, objectId } = stateWith();
    const moved = sceneReducer(state, {
      type: 'UPDATE_TRANSFORM',
      id: objectId,
      position: { x: 55, y: 0, z: 20 },
      recordHistory: true,
    });
    expect(moved.data.objects[0].position).toEqual({ x: 55, y: 0, z: 20 });
    expect(moved.history?.past[0]).toMatchObject({
      kind: 'transform',
      entityType: 'object',
      entityId: objectId,
    });
    const undoMove = sceneReducer(moved, { type: 'UNDO' });
    expect(undoMove.data.objects[0].position).toEqual({ x: 0, y: 0, z: 0 });
    expect(sceneReducer(undoMove, { type: 'REDO' }).data.objects[0].position).toEqual({
      x: 55,
      y: 0,
      z: 20,
    });

    const rotated = sceneReducer(state, {
      type: 'UPDATE_TRANSFORM',
      id: objectId,
      rotation: { y: 90 },
      recordHistory: true,
    });
    expect(rotated.data.objects[0].rotation.y).toBe(90);
    expect(
      sceneReducer(sceneReducer(rotated, { type: 'UNDO' }), { type: 'REDO' }).data.objects[0]
        .rotation.y,
    ).toBe(90);

    const scaled = sceneReducer(state, {
      type: 'UPDATE_TRANSFORM',
      id: objectId,
      scale: { x: 1.5, y: 1, z: 1 },
      recordHistory: true,
    });
    expect(scaled.data.objects[0].scale.x).toBe(1.5);
    expect(
      sceneReducer(sceneReducer(scaled, { type: 'UNDO' }), { type: 'REDO' }).data.objects[0]
        .scale.x,
    ).toBe(1.5);
  });

  it('treats one gizmo commit as one command regardless of intermediate events', () => {
    const { state } = stateWith();
    let live = state;
    // Simulate pointer-move updates: the viewer updates the group, and if any
    // non-command update reaches the reducer it must not create history.
    for (let step = 1; step <= 30; step += 1) {
      live = sceneReducer(live, {
        type: 'UPDATE_ROOM_TRANSFORM',
        id: 'room-a',
        position: { x: step },
        recordHistory: false,
      });
    }
    expect(live.history?.past ?? []).toHaveLength(0);

    const committed = sceneReducer(live, {
      type: 'UPDATE_ROOM_TRANSFORM',
      id: 'room-a',
      position: { x: 120 },
      recordHistory: true,
    });
    expect(committed.history?.past).toHaveLength(1);
    expect(committed.history?.past[0]).toMatchObject({
      entityType: 'room',
      before: { position: { x: 30, y: 0, z: 0 } },
      after: { position: { x: 120, y: 0, z: 0 } },
    });
  });

  it('does not record an unchanged transform or a second commit', () => {
    const { state } = stateWith();
    const unchanged = sceneReducer(state, {
      type: 'UPDATE_ROOM_TRANSFORM',
      id: 'room-a',
      position: { x: 0, y: 0, z: 0 },
      recordHistory: true,
    });
    expect(unchanged.history).toBeUndefined();

    const first = sceneReducer(state, {
      type: 'UPDATE_ROOM_TRANSFORM',
      id: 'room-a',
      position: { x: 10 },
      recordHistory: true,
    });
    const second = sceneReducer(first, {
      type: 'UPDATE_ROOM_TRANSFORM',
      id: 'room-a',
      position: { x: 20 },
      recordHistory: true,
    });
    expect(second.history?.past).toHaveLength(2);
  });

  it('orders spec and room-transform commands in one stack', () => {
    const { state, objectId } = stateWith();
    const object = state.data.objects[0];
    if (!object.spec) throw new Error('missing spec');
    const edited = sceneReducer(state, {
      type: 'UPDATE_SPEC',
      id: objectId,
      spec: canonicalSpec(object.spec),
    });
    const moved = sceneReducer(edited, {
      type: 'UPDATE_ROOM_TRANSFORM',
      id: 'room-a',
      position: { x: 80 },
      recordHistory: true,
    });
    expect(moved.history?.past.map((entry) => entry.kind)).toEqual(['spec', 'transform']);

    const undoTransform = sceneReducer(moved, { type: 'UNDO' });
    expect(undoTransform.data.rooms?.[0].position).toEqual({ x: 0, y: 0, z: 0 });
    expect(undoTransform.data.objects[0].spec?.drawerEnabled).toBe(false);

    const undoSpec = sceneReducer(undoTransform, { type: 'UNDO' });
    expect(undoSpec.data.objects[0].spec?.drawerEnabled).toBe(true);
    expect(undoSpec.data.rooms?.[0].position).toEqual({ x: 0, y: 0, z: 0 });

    const redoSpec = sceneReducer(undoSpec, { type: 'REDO' });
    expect(redoSpec.data.objects[0].spec?.drawerEnabled).toBe(false);
    const redoTransform = sceneReducer(redoSpec, { type: 'REDO' });
    expect(redoTransform.data.rooms?.[0].position).toEqual({ x: 80, y: 0, z: 0 });
  });

  it('orders room and furniture transform commands in one stack', () => {
    const { state, objectId } = stateWith();
    const movedRoom = sceneReducer(state, {
      type: 'UPDATE_ROOM_TRANSFORM',
      id: 'room-a',
      position: { x: 70 },
      recordHistory: true,
    });
    const movedObject = sceneReducer(movedRoom, {
      type: 'UPDATE_TRANSFORM',
      id: objectId,
      position: { x: 30 },
      recordHistory: true,
    });
    expect(
      movedObject.history?.past.map((entry) =>
        entry.kind === 'transform' ? entry.entityType : entry.kind,
      ),
    ).toEqual(['room', 'object']);
    const undoObject = sceneReducer(movedObject, { type: 'UNDO' });
    expect(undoObject.data.objects[0].position.x).toBe(0);
    expect(undoObject.data.rooms?.[0].position.x).toBe(70);
    const undoRoom = sceneReducer(undoObject, { type: 'UNDO' });
    expect(undoRoom.data.rooms?.[0].position.x).toBe(0);
  });

  it('clears the redo branch when a new command is recorded', () => {
    const { state } = stateWith();
    const first = sceneReducer(state, {
      type: 'UPDATE_ROOM_TRANSFORM',
      id: 'room-a',
      position: { x: 10 },
      recordHistory: true,
    });
    const undone = sceneReducer(first, { type: 'UNDO' });
    expect(undone.history?.future).toHaveLength(1);
    const replacement = sceneReducer(undone, {
      type: 'UPDATE_ROOM_TRANSFORM',
      id: 'room-a',
      position: { x: 25 },
      recordHistory: true,
    });
    expect(replacement.history?.future).toHaveLength(0);
    expect(replacement.history?.past).toHaveLength(1);
  });

  it('bounds the history and drops the oldest command', () => {
    const { state } = stateWith();
    let live = state;
    for (let index = 1; index <= MAX_SCENE_HISTORY + 5; index += 1) {
      live = sceneReducer(live, {
        type: 'UPDATE_ROOM_TRANSFORM',
        id: 'room-a',
        position: { x: index },
        recordHistory: true,
      });
    }
    expect(live.history?.past).toHaveLength(MAX_SCENE_HISTORY);
    const oldest = live.history?.past[0];
    expect(oldest).toMatchObject({
      kind: 'transform',
      before: { position: { x: 5, y: 0, z: 0 } },
      after: { position: { x: 6, y: 0, z: 0 } },
    });
  });

  it('returns the same state for empty undo/redo and unknown entities', () => {
    const { state } = stateWith();
    expect(sceneReducer(state, { type: 'UNDO' })).toBe(state);
    expect(sceneReducer(state, { type: 'REDO' })).toBe(state);

    const moved = sceneReducer(state, {
      type: 'UPDATE_ROOM_TRANSFORM',
      id: 'room-a',
      position: { x: 10 },
      recordHistory: true,
    });
    const removed = {
      ...moved,
      data: { ...moved.data, rooms: [] },
    };
    const undone = sceneReducer(removed, { type: 'UNDO' });
    expect(undone.data.rooms).toEqual([]);
    expect(undone.history?.past).toHaveLength(0);
    expect(sceneReducer(undone, { type: 'REDO' })).toBe(undone);
  });

  it('keeps unknown-object transform actions inert', () => {
    const { state } = stateWith();
    expect(
      sceneReducer(state, {
        type: 'UPDATE_TRANSFORM',
        id: 'missing',
        position: { x: 10 },
        recordHistory: true,
      }),
    ).toBe(state);
    expect(
      sceneReducer(state, {
        type: 'UPDATE_ROOM_TRANSFORM',
        id: 'missing',
        position: { x: 10 },
        recordHistory: true,
      }),
    ).toBe(state);
  });

  it('clears history when the scene is replaced or reset', () => {
    const { state } = stateWith();
    const moved = sceneReducer(state, {
      type: 'UPDATE_ROOM_TRANSFORM',
      id: 'room-a',
      position: { x: 10 },
      recordHistory: true,
    });
    const loaded = sceneReducer(moved, { type: 'LOAD_SCENE', scene: state.data });
    expect(loaded.history).toBeUndefined();
    const reset = sceneReducer(moved, { type: 'NEW_SCENE', id: 'new-object' });
    expect(reset.history).toBeUndefined();
  });

  it('keeps panel transform edits out of history and invalidates redo', () => {
    const { state } = stateWith();
    const moved = sceneReducer(state, {
      type: 'UPDATE_ROOM_TRANSFORM',
      id: 'room-a',
      position: { x: 10 },
      recordHistory: true,
    });
    const undone = sceneReducer(moved, { type: 'UNDO' });
    expect(undone.history?.future).toHaveLength(1);
    const panelEdit = sceneReducer(undone, {
      type: 'UPDATE_TRANSFORM',
      id: undone.data.objects[0].id,
      position: { x: 5 },
      recordHistory: false,
    });
    expect(panelEdit.history?.future ?? []).toHaveLength(0);
    expect(panelEdit.history?.past ?? []).toHaveLength(0);
  });

  it('feeds the undone and redone state to the export pipeline', () => {
    const { state } = stateWith();
    const moved = sceneReducer(state, {
      type: 'UPDATE_ROOM_TRANSFORM',
      id: 'room-a',
      position: { x: 120 },
      recordHistory: true,
    });
    const undone = sceneReducer(moved, { type: 'UNDO' });
    const redone = sceneReducer(undone, { type: 'REDO' });

    const undoneScene = buildExportScene(undone.data);
    try {
      expect(undoneScene.scene.getObjectByName('room:room-a')?.position.x).toBe(0);
    } finally {
      undoneScene.dispose();
    }
    const redoneScene = buildExportScene(redone.data);
    try {
      expect(redoneScene.scene.getObjectByName('room:room-a')?.position.x).toBe(120);
    } finally {
      redoneScene.dispose();
    }
  });

  it('drops history for a deleted object', () => {
    const { state, objectId } = stateWith();
    const moved = sceneReducer(state, {
      type: 'UPDATE_TRANSFORM',
      id: objectId,
      position: { x: 10 },
      recordHistory: true,
    });
    const deleted = sceneReducer(moved, { type: 'DELETE_OBJECT', id: objectId });
    expect(deleted.history?.past ?? []).toHaveLength(0);
    expect(deleted.history?.future ?? []).toHaveLength(0);
  });
});
