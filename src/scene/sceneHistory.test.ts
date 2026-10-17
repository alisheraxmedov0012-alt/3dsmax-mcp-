import { describe, expect, it } from 'vitest';
import {
  SCENE_HISTORY_LIMIT,
  canRedo,
  canUndo,
  createHistoryState,
  redoDepth,
  sceneHistoryReducer,
  undoDepth,
  type SceneHistoryAction,
  type SceneHistoryState,
} from './sceneHistory';
import { applyDiff } from './applyDiff';
import { buildDiff } from './buildDiff';
import { createDefaultSettings } from './sceneSettings';
import { sceneReducerWithRevision } from './sceneRevision';
import type { SceneAction } from './sceneReducer';
import {
  INITIAL_SCENE_REVISION,
  ROOM_OBJECT_ID,
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  createTableSceneObject,
  type SceneData,
  type SceneState,
} from './types';

function sceneData(objects = [createTableSceneObject('table-1')]): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects,
    settings: createDefaultSettings(),
  };
}

function initialState(objects = [createTableSceneObject('table-1')]): SceneState {
  const data = sceneData(objects);
  return { data, selectedId: data.objects[0]?.id ?? null, revision: INITIAL_SCENE_REVISION };
}

function start(objects = [createTableSceneObject('table-1')]): SceneHistoryState {
  return createHistoryState(initialState(objects));
}

function run(
  state: SceneHistoryState,
  ...actions: SceneHistoryAction[]
): SceneHistoryState {
  return actions.reduce(sceneHistoryReducer, state);
}

function scene(state: SceneHistoryState, action: SceneAction): SceneHistoryState {
  return sceneHistoryReducer(state, { type: 'SCENE', action });
}

function wardrobe(id = 'wardrobe-1') {
  return createFurnitureSceneObject('wardrobe', id);
}

describe('sceneHistory — undo and redo', () => {
  it('undoes a single edit', () => {
    let history = scene(start(), { type: 'ADD_TABLE', id: 'table-2' });
    expect(history.present.data.objects).toHaveLength(2);
    expect(canUndo(history)).toBe(true);

    history = run(history, { type: 'UNDO' });

    expect(history.present.data.objects).toHaveLength(1);
    expect(undoDepth(history)).toBe(0);
    expect(canRedo(history)).toBe(true);
  });

  it('redoes an undone edit', () => {
    let history = scene(start(), { type: 'ADD_TABLE', id: 'table-2' });
    history = run(history, { type: 'UNDO' }, { type: 'REDO' });

    expect(history.present.data.objects).toHaveLength(2);
    expect(canRedo(history)).toBe(false);
    expect(canUndo(history)).toBe(true);
  });

  it('walks back and forward through several edits', () => {
    let history = start();
    history = scene(history, { type: 'ADD_TABLE', id: 'table-2' });
    history = scene(history, { type: 'RENAME_OBJECT', id: 'table-1', name: 'Birinchi' });
    history = scene(history, { type: 'UPDATE_TRANSFORM', id: 'table-1', position: { x: 10 } });
    expect(undoDepth(history)).toBe(3);

    // Two undos land on the state right after the first edit: the table exists
    // again, but the rename and the move are gone.
    history = run(history, { type: 'UNDO' }, { type: 'UNDO' });
    expect(history.present.data.objects).toHaveLength(2);
    expect(history.present.data.objects[0].name).toBe('Stol');
    expect(history.present.data.objects[0].position.x).toBe(0);

    history = run(history, { type: 'UNDO' });
    expect(history.present.data.objects).toHaveLength(1);
    expect(canUndo(history)).toBe(false);

    history = run(history, { type: 'REDO' }, { type: 'REDO' }, { type: 'REDO' });
    expect(history.present.data.objects).toHaveLength(2);
    expect(history.present.data.objects[0].name).toBe('Birinchi');
    expect(history.present.data.objects[0].position.x).toBe(10);
  });

  it('is a no-op at the ends of the timeline', () => {
    const fresh = start();
    expect(run(fresh, { type: 'UNDO' })).toBe(fresh);
    expect(run(fresh, { type: 'REDO' })).toBe(fresh);
  });
});

describe('sceneHistory — what is recorded', () => {
  it('does not record a selection change', () => {
    const before = start();
    const after = scene(before, { type: 'SELECT', id: ROOM_OBJECT_ID });

    expect(after.present.selectedId).toBe(ROOM_OBJECT_ID);
    expect(after.past).toHaveLength(0);
    expect(canUndo(after)).toBe(false);
  });

  it('does not record a no-op that rebuilds data', () => {
    const before = start();
    const after = scene(before, { type: 'SET_ROOM', room: { ...ROOM_DEFAULTS } });

    expect(after.past).toHaveLength(0);
    expect(after.present.data).toBe(before.present.data);
  });

  it('does not record an action the reducer ignores', () => {
    const before = start();
    const after = scene(before, { type: 'RENAME_OBJECT', id: 'missing', name: 'X' });
    expect(after).toBe(before);
  });

  it('does not record a repeated visibility value', () => {
    const before = scene(start(), { type: 'SET_VISIBILITY', id: 'table-1', visible: false });
    expect(undoDepth(before)).toBe(1);

    const repeated = scene(before, { type: 'SET_VISIBILITY', id: 'table-1', visible: false });
    expect(repeated).toBe(before);
    expect(undoDepth(repeated)).toBe(1);
  });

  it('records exactly one entry for a multi-field edit', () => {
    const history = scene(start(), {
      type: 'UPDATE_TRANSFORM',
      id: 'table-1',
      position: { x: 10 },
      rotation: { y: 90 },
      scale: { z: 2 },
    });
    expect(undoDepth(history)).toBe(1);
  });

  it('records settings changes, which are part of the scene', () => {
    const history = scene(start(), { type: 'SET_BACKGROUND', color: '#101010' });
    expect(undoDepth(history)).toBe(1);
    expect(run(history, { type: 'UNDO' }).present.data.settings.background).not.toBe('#101010');
  });
});

describe('sceneHistory — redo invalidation', () => {
  it('drops the redo stack after a new edit', () => {
    let history = scene(start(), { type: 'ADD_TABLE', id: 'table-2' });
    history = run(history, { type: 'UNDO' });
    expect(canRedo(history)).toBe(true);

    history = scene(history, { type: 'ADD_TABLE', id: 'table-3' });

    expect(canRedo(history)).toBe(false);
    expect(redoDepth(history)).toBe(0);
    expect(history.present.data.objects.map((object) => object.id)).toEqual(['table-1', 'table-3']);
  });

  it('keeps the redo stack across an undo of an undo', () => {
    let history = scene(start(), { type: 'ADD_TABLE', id: 'table-2' });
    history = run(history, { type: 'UNDO' }, { type: 'UNDO' });
    // Only one entry existed, so the second undo did nothing.
    expect(canRedo(history)).toBe(true);
    history = run(history, { type: 'REDO' });
    expect(history.present.data.objects).toHaveLength(2);
  });
});

describe('sceneHistory — revision monotonicity', () => {
  it('advances the revision on undo instead of restoring the old number', () => {
    const edited = scene(start(), { type: 'ADD_TABLE', id: 'table-2' });
    expect(edited.present.revision).toBe(INITIAL_SCENE_REVISION + 1);

    const undone = run(edited, { type: 'UNDO' });

    expect(undone.present.data).toEqual(edited.past[0]);
    expect(undone.present.revision).toBe(INITIAL_SCENE_REVISION + 2);
    expect(undone.present.revision).toBeGreaterThan(edited.present.revision);
  });

  it('advances the revision on redo too', () => {
    const edited = scene(start(), { type: 'ADD_TABLE', id: 'table-2' });
    const undone = run(edited, { type: 'UNDO' });
    const redone = run(undone, { type: 'REDO' });

    expect(redone.present.data).toEqual(edited.present.data);
    expect(redone.present.revision).toBe(undone.present.revision + 1);
  });

  it('never decreases the revision across a long mixed sequence', () => {
    const actions: SceneHistoryAction[] = [
      { type: 'SCENE', action: { type: 'ADD_TABLE', id: 't2' } },
      { type: 'UNDO' },
      { type: 'REDO' },
      { type: 'SCENE', action: { type: 'ADD_TABLE', id: 't3' } },
      { type: 'UNDO' },
      { type: 'UNDO' },
      { type: 'REDO' },
    ];

    let history = start();
    let previous = history.present.revision;
    for (const action of actions) {
      history = sceneHistoryReducer(history, action);
      expect(history.present.revision).toBeGreaterThanOrEqual(previous);
      previous = history.present.revision;
    }
    expect(history.present.revision).toBeGreaterThan(INITIAL_SCENE_REVISION);
  });
});

describe('sceneHistory — selection handling', () => {
  it('keeps a selection that still exists after undo', () => {
    let history = scene(start(), { type: 'ADD_TABLE', id: 'table-2' });
    history = scene(history, { type: 'SELECT', id: 'table-1' });
    history = run(history, { type: 'UNDO' });

    expect(history.present.selectedId).toBe('table-1');
  });

  it('falls back to the room when the selected object disappears', () => {
    // Select the second table, then undo the edit that created it.
    let history = scene(start(), { type: 'ADD_TABLE', id: 'table-2' });
    history = scene(history, { type: 'ADD_TABLE', id: 'table-3' });
    history = scene(history, { type: 'SELECT', id: 'table-3' });

    history = run(history, { type: 'UNDO' });
    expect(history.present.selectedId).toBe(ROOM_OBJECT_ID);
  });

  it('does not restore an old selection on undo', () => {
    // Selection is UI state: undoing an edit must not also rewind the cursor.
    let history = scene(start(), { type: 'ADD_TABLE', id: 'table-2' });
    history = scene(history, { type: 'SELECT', id: 'table-2' });
    history = scene(history, { type: 'RENAME_OBJECT', id: 'table-2', name: 'Ikkinchi' });
    history = run(history, { type: 'UNDO' });

    expect(history.present.selectedId).toBe('table-2');
  });
});

describe('sceneHistory — limit', () => {
  it('keeps at most the documented number of undo steps', () => {
    let history = start();
    for (let index = 0; index < SCENE_HISTORY_LIMIT + 5; index += 1) {
      history = scene(history, { type: 'ADD_TABLE', id: `table-${index + 2}` });
    }

    expect(undoDepth(history)).toBe(SCENE_HISTORY_LIMIT);
    expect(history.past).toHaveLength(SCENE_HISTORY_LIMIT);
    // The newest entries are the ones kept: one undo lands on the last snapshot.
    const undone = run(history, { type: 'UNDO' });
    expect(undone.present.data).toEqual(history.past[history.past.length - 1]);
    // The starting scene fell out of the window long ago.
    expect(history.past[0]).not.toEqual(initialState().data);
  });

  it('undoes all the way back to the oldest retained snapshot', () => {
    let history = start();
    for (let index = 0; index < SCENE_HISTORY_LIMIT + 3; index += 1) {
      history = scene(history, { type: 'ADD_TABLE', id: `t-${index}` });
    }
    while (canUndo(history)) {
      history = run(history, { type: 'UNDO' });
    }
    // The original scene was pushed out of the window, so the oldest retained
    // snapshot is not the starting scene.
    expect(history.present.data.objects.length).toBeGreaterThan(1);
    expect(history.present.revision).toBeGreaterThan(INITIAL_SCENE_REVISION);
  });

  it('documents the limit value', () => {
    expect(SCENE_HISTORY_LIMIT).toBe(50);
  });
});

describe('sceneHistory — AI diff integration', () => {
  function buildFor(source: SceneState, ops: unknown[]) {
    const built = buildDiff(source.data, ops, { baseVersion: source.revision });
    if (!built.ok) {
      throw new Error(built.message);
    }
    return built.diff;
  }

  it('records one entry for a multi-change AI edit', () => {
    const source = initialState([wardrobe()]);
    const history = createHistoryState(source);
    const diff = buildFor(source, [
      { op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200, heightCm: 210 } },
      { op: 'rename', objectId: 'wardrobe-1', name: 'Katta shkaf' },
      { op: 'set_visibility', objectId: 'wardrobe-1', visible: false },
    ]);

    const applied = applyDiff(source, diff, { currentVersion: source.revision });
    if (!applied.ok) {
      throw new Error(applied.message);
    }

    const after = sceneHistoryReducer(history, { type: 'APPLY_EDIT', state: applied.state });

    expect(after.past).toHaveLength(1);
    expect(after.present.data.objects[0].params.widthCm).toBe(200);
    expect(after.present.data.objects[0].name).toBe('Katta shkaf');
    expect(after.present.data.objects[0].visible).toBe(false);

    // One undo reverts the whole proposal, not one field of it.
    const undone = sceneHistoryReducer(after, { type: 'UNDO' });
    expect(undone.present.data).toEqual(source.data);
  });

  it('leaves history untouched when a diff is rejected', () => {
    const source = initialState([wardrobe()]);
    const history = createHistoryState(source);
    const diff = buildFor(source, [
      { op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200 } },
    ]);

    const rejected = applyDiff(source, diff, { currentVersion: source.revision + 1 });
    expect(rejected.ok).toBe(false);
    // Nothing to feed the history — a rejected diff produces no state.
    expect(history.past).toHaveLength(0);
    expect(canUndo(history)).toBe(false);
  });

  it('refuses an old diff after an undo', () => {
    const source = initialState([wardrobe()]);
    const diff = buildFor(source, [
      { op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200 } },
    ]);

    const applied = applyDiff(source, diff, { currentVersion: source.revision });
    if (!applied.ok) {
      throw new Error(applied.message);
    }
    const afterApply = sceneHistoryReducer(createHistoryState(source), {
      type: 'APPLY_EDIT',
      state: applied.state,
    });
    const undone = sceneHistoryReducer(afterApply, { type: 'UNDO' });

    // The scene content is back to what the diff was built against, but the
    // revision moved, so the diff is still refused.
    expect(undone.present.data).toEqual(source.data);
    const replay = applyDiff(undone.present, diff, {
      currentVersion: undone.present.revision,
    });
    expect(replay.ok).toBe(false);
    if (!replay.ok) {
      expect(replay.code).toBe('stale_version');
    }
  });

  it('does not record an APPLY_EDIT that changes nothing', () => {
    const source = initialState([wardrobe()]);
    const history = createHistoryState(source);
    const same = sceneHistoryReducer(history, { type: 'APPLY_EDIT', state: source });
    expect(same).toBe(history);
  });

  it('never moves the revision backwards on APPLY_EDIT', () => {
    const source = initialState([wardrobe()]);
    const history = createHistoryState(source);
    const edited = scene(sceneHistoryReducer(history, { type: 'APPLY_EDIT', state: source }), {
      type: 'ADD_TABLE',
      id: 'table-2',
    });

    // A caller hands in a state whose revision is older than the timeline.
    const stale: SceneState = {
      ...edited.present,
      data: sceneData([wardrobe(), createTableSceneObject('table-9')]),
      revision: 1,
    };
    const after = sceneHistoryReducer(edited, { type: 'APPLY_EDIT', state: stale });

    expect(after.present.revision).toBeGreaterThan(edited.present.revision);
  });
});

describe('sceneHistory — purity', () => {
  it('does not mutate the state it receives', () => {
    const before = scene(start(), { type: 'ADD_TABLE', id: 'table-2' });
    const snapshot = structuredClone(before);

    sceneHistoryReducer(before, { type: 'UNDO' });
    sceneHistoryReducer(before, { type: 'REDO' });
    sceneHistoryReducer(before, { type: 'ADD_TABLE', id: 'x' } as unknown as SceneHistoryAction);

    expect(before).toEqual(snapshot);
  });

  it('does not mutate the snapshots it stores', () => {
    const before = start();
    const original = structuredClone(before.present.data);

    const after = scene(before, { type: 'RENAME_OBJECT', id: 'table-1', name: 'Yangi' });
    sceneHistoryReducer(after, { type: 'UNDO' });

    expect(before.present.data).toEqual(original);
  });

  it('is deterministic', () => {
    const base = scene(start(), { type: 'ADD_TABLE', id: 'table-2' });
    expect(sceneHistoryReducer(base, { type: 'UNDO' })).toEqual(
      sceneHistoryReducer(base, { type: 'UNDO' }),
    );
  });

  it('clearHistory drops both stacks and keeps the scene', () => {
    let history = scene(start(), { type: 'ADD_TABLE', id: 'table-2' });
    history = run(history, { type: 'UNDO' });

    const cleared = run(history, { type: 'CLEAR_HISTORY' });

    expect(cleared.present).toBe(history.present);
    expect(canUndo(cleared)).toBe(false);
    expect(canRedo(cleared)).toBe(false);
  });
});

describe('sceneHistory — consistency with the revision wrapper', () => {
  it('records the same data the wrapper would produce', () => {
    const before = start();
    const direct = sceneReducerWithRevision(before.present, { type: 'ADD_TABLE', id: 't2' });
    const viaHistory = scene(before, { type: 'ADD_TABLE', id: 't2' });

    expect(viaHistory.present).toEqual(direct);
  });
});
