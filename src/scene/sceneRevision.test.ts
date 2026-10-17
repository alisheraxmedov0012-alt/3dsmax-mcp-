import { describe, expect, it } from 'vitest';
import {
  advanceRevision,
  createSceneState,
  isValidRevision,
  revisionAfterHistoryRestore,
  sameSceneData,
  sceneReducerWithRevision,
} from './sceneRevision';
import { sceneReducer } from './sceneReducer';
import { applyDiff } from './applyDiff';
import { buildDiff } from './buildDiff';
import { createDefaultSettings } from './sceneSettings';
import { sceneSignature } from '../projects/unsavedChanges';
import {
  INITIAL_SCENE_REVISION,
  MAX_SCENE_REVISION,
  ROOM_DEFAULTS,
  ROOM_OBJECT_ID,
  SCENE_SCHEMA_VERSION,
  createDefaultSceneState,
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

function state(objects = [createTableSceneObject('table-1')]): SceneState {
  return createSceneState(sceneData(objects));
}

function wardrobe(id = 'wardrobe-1') {
  return createFurnitureSceneObject('wardrobe', id);
}

describe('sceneRevision — constants and validation', () => {
  it('starts at 1, never at 0', () => {
    expect(INITIAL_SCENE_REVISION).toBe(1);
    expect(isValidRevision(INITIAL_SCENE_REVISION)).toBe(true);
    expect(isValidRevision(0)).toBe(false);
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['string', '3'],
    ['null', null],
    ['undefined', undefined],
    ['object', { revision: 1 }],
  ])('rejects an invalid revision: %s', (_label, value) => {
    expect(isValidRevision(value)).toBe(false);
  });

  it('advances by exactly one', () => {
    expect(advanceRevision(1)).toBe(2);
    expect(advanceRevision(41)).toBe(42);
  });

  it('saturates at the integer bound instead of overflowing', () => {
    expect(advanceRevision(MAX_SCENE_REVISION - 1)).toBe(MAX_SCENE_REVISION);
    expect(advanceRevision(MAX_SCENE_REVISION)).toBe(MAX_SCENE_REVISION);
    expect(Number.isSafeInteger(advanceRevision(MAX_SCENE_REVISION))).toBe(true);
  });

  it('throws instead of substituting a value for a corrupt counter', () => {
    // A silent reset to 0 would make every stale diff look current.
    expect(() => advanceRevision(0)).toThrow(RangeError);
    expect(() => advanceRevision(Number.NaN)).toThrow(RangeError);
    expect(() => advanceRevision(-5)).toThrow(RangeError);
  });
});

describe('sceneRevision — sameSceneData', () => {
  it('treats identical scenes as equal', () => {
    expect(sameSceneData(sceneData(), sceneData())).toBe(true);
  });

  it('detects a changed parameter', () => {
    const a = sceneData();
    const b = sceneData([
      createTableSceneObject('table-1', {
        params: { ...createTableSceneObject('table-1').params, widthCm: 140 },
      }),
    ]);
    expect(sameSceneData(a, b)).toBe(false);
  });

  it('detects a changed nested setting', () => {
    const a = sceneData();
    const b = structuredClone(a);
    b.settings.background = '#123456';
    expect(sameSceneData(a, b)).toBe(false);
  });

  it('detects an added optional field', () => {
    const a = sceneData();
    const b = structuredClone(a);
    b.assemblies = [];
    expect(sameSceneData(a, b)).toBe(false);
  });

  it('treats an undefined-valued key as absent', () => {
    const a = sceneData();
    const b = structuredClone(a) as SceneData & { extra?: string };
    b.extra = undefined;
    expect(sameSceneData(a, b)).toBe(true);
  });

  it('compares arrays by content and length', () => {
    expect(sameSceneData(sceneData([wardrobe()]), sceneData([wardrobe()]))).toBe(true);
    expect(sameSceneData(sceneData([wardrobe()]), sceneData([wardrobe(), wardrobe('w2')]))).toBe(
      false,
    );
  });

  it('does not mutate its arguments', () => {
    const a = sceneData();
    const b = sceneData();
    const before = JSON.stringify([a, b]);
    sameSceneData(a, b);
    expect(JSON.stringify([a, b])).toBe(before);
  });
});

describe('sceneRevision — advancing through the reducer', () => {
  it('advances on a real scene mutation', () => {
    const before = state();
    expect(before.revision).toBe(INITIAL_SCENE_REVISION);

    const after = sceneReducerWithRevision(before, { type: 'ADD_TABLE', id: 'table-2' });

    expect(after.revision).toBe(INITIAL_SCENE_REVISION + 1);
    expect(after.data.objects).toHaveLength(2);
  });

  it('advances once per mutation, however many fields it touches', () => {
    let current = state();
    const steps = [
      { type: 'RENAME_OBJECT', id: 'table-1', name: 'Katta stol' },
      { type: 'UPDATE_TRANSFORM', id: 'table-1', position: { x: 10 }, rotation: { y: 90 } },
      { type: 'SET_ROOM', room: { widthCm: 600 } },
    ] as const;

    for (const action of steps) {
      const next = sceneReducerWithRevision(current, action);
      expect(next.revision).toBe(current.revision + 1);
      current = next;
    }
    expect(current.revision).toBe(INITIAL_SCENE_REVISION + steps.length);
  });

  it('does not advance on a selection change', () => {
    const before = state();
    const after = sceneReducerWithRevision(before, { type: 'SELECT', id: ROOM_OBJECT_ID });
    expect(after.selectedId).toBe(ROOM_OBJECT_ID);
    expect(after.revision).toBe(before.revision);
    expect(after.data).toBe(before.data);
  });

  it('does not advance when the reducer returns the same state', () => {
    const before = state([wardrobe()]);
    // SET_VISIBILITY with the current value is a no-op by construction.
    const after = sceneReducerWithRevision(before, {
      type: 'SET_VISIBILITY',
      id: 'wardrobe-1',
      visible: true,
    });
    expect(after).toBe(before);
    expect(after.revision).toBe(before.revision);
  });

  it.each([
    ['SET_ROOM with unchanged dimensions', { type: 'SET_ROOM', room: { ...ROOM_DEFAULTS } }],
    ['SET_BACKGROUND with the same colour', { type: 'SET_BACKGROUND', color: '#1b1f24' }],
    ['RENAME_OBJECT with the same name', { type: 'RENAME_OBJECT', id: 'table-1', name: 'Stol' }],
  ] as const)('does not advance on a no-op that rebuilds data: %s', (_label, action) => {
    const before = state();
    const after = sceneReducerWithRevision(before, action);

    expect(sameSceneData(after.data, before.data)).toBe(true);
    expect(after.revision).toBe(before.revision);
    // The old data reference is kept, so memoised consumers do not re-render.
    expect(after.data).toBe(before.data);
  });

  it('keeps the revision on an unknown object id', () => {
    const before = state();
    const after = sceneReducerWithRevision(before, {
      type: 'RENAME_OBJECT',
      id: 'missing',
      name: 'X',
    });
    expect(after.revision).toBe(before.revision);
  });

  it('advances on LOAD_SCENE, because the whole scene is replaced', () => {
    const before = state();
    const after = sceneReducerWithRevision(before, {
      type: 'LOAD_SCENE',
      scene: sceneData([wardrobe()]),
    });
    expect(after.revision).toBe(before.revision + 1);
  });

  it('advances on NEW_SCENE', () => {
    const before = state();
    const after = sceneReducerWithRevision(before, { type: 'NEW_SCENE', id: 'fresh' });
    expect(after.revision).toBe(before.revision + 1);
    expect(after.data.objects[0].id).toBe('fresh');
  });

  it('never mutates the state it is given', () => {
    const before = state();
    const snapshot = structuredClone(before);
    sceneReducerWithRevision(before, { type: 'ADD_TABLE', id: 'table-2' });
    expect(before).toEqual(snapshot);
  });

  it('is deterministic', () => {
    const before = state();
    const first = sceneReducerWithRevision(before, { type: 'ADD_TABLE', id: 'table-2' });
    const second = sceneReducerWithRevision(before, { type: 'ADD_TABLE', id: 'table-2' });
    expect(first).toEqual(second);
  });
});

describe('sceneRevision — bypass model', () => {
  it('the raw reducer preserves the counter but never advances it', () => {
    // Documented, tested limitation: the raw reducer is a pure content function.
    // Advancing is the wrapper's job, and the app uses only the wrapper.
    const before = state();
    const after = sceneReducer(before, { type: 'ADD_TABLE', id: 'table-2' });
    expect(after.data.objects).toHaveLength(2);
    expect(after.revision).toBe(before.revision);
  });

  it('applyDiff bumps the revision itself, so it is not a bypass', () => {
    const before = state([wardrobe()]);
    const built = buildDiff(
      before.data,
      [{ op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200 } }],
      { baseVersion: before.revision },
    );
    if (!built.ok) {
      throw new Error(built.message);
    }

    const applied = applyDiff(before, built.diff, { currentVersion: before.revision });
    if (!applied.ok) {
      throw new Error(applied.message);
    }
    expect(applied.state.revision).toBe(before.revision + 1);
  });

  it('a diff built before a mutation is refused afterwards', () => {
    const before = state([wardrobe()]);
    const built = buildDiff(
      before.data,
      [{ op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200 } }],
      { baseVersion: before.revision },
    );
    if (!built.ok) {
      throw new Error(built.message);
    }

    const moved = sceneReducerWithRevision(before, { type: 'ADD_TABLE', id: 'table-2' });
    const applied = applyDiff(moved, built.diff, { currentVersion: moved.revision });
    expect(applied.ok).toBe(false);
    if (!applied.ok) {
      expect(applied.code).toBe('stale_version');
    }
  });

  it('refuses a stale diff whose target object changed', () => {
    const before = state([wardrobe()]);
    const built = buildDiff(
      before.data,
      [{ op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200 } }],
      { baseVersion: before.revision },
    );
    if (!built.ok) {
      throw new Error(built.message);
    }

    const moved = sceneReducerWithRevision(before, {
      type: 'UPDATE_PARAMS',
      id: 'wardrobe-1',
      params: { ...wardrobe().params, widthCm: 190 },
    });

    // Honest caller, stale number.
    const honest = applyDiff(moved, built.diff, { currentVersion: moved.revision });
    expect(honest.ok).toBe(false);
    if (!honest.ok) {
      expect(honest.code).toBe('stale_version');
    }

    // Dishonest caller: the diff's version is rewritten to the current one, so
    // the version pair agrees. The content no longer does, and that is the
    // check that actually holds.
    const forged = applyDiff(
      moved,
      { ...built.diff, baseVersion: moved.revision },
      { currentVersion: moved.revision },
    );
    expect(forged.ok).toBe(false);
    if (!forged.ok) {
      expect(forged.code).toBe('stale_content');
    }
  });

  it('still applies a stale diff when its target object is untouched', () => {
    // Documented boundary: the revision is scene-wide, so an unrelated edit
    // moves it. If the diff's own fields still match, applying it is safe —
    // the user approved exactly those values and they are still true. This is
    // why `stale_content` exists: the version alone cannot tell the two cases
    // apart, and content can.
    const before = state([wardrobe()]);
    const built = buildDiff(
      before.data,
      [{ op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200 } }],
      { baseVersion: before.revision },
    );
    if (!built.ok) {
      throw new Error(built.message);
    }

    const moved = sceneReducerWithRevision(before, { type: 'ADD_TABLE', id: 'table-2' });

    const honest = applyDiff(moved, built.diff, { currentVersion: moved.revision });
    expect(honest.ok).toBe(false);
    if (!honest.ok) {
      expect(honest.code).toBe('stale_version');
    }

    const revalidated = applyDiff(
      moved,
      { ...built.diff, baseVersion: moved.revision },
      { currentVersion: moved.revision },
    );
    expect(revalidated.ok).toBe(true);
    if (revalidated.ok) {
      expect(revalidated.state.data.objects[0].params.widthCm).toBe(200);
      expect(revalidated.state.revision).toBe(moved.revision + 1);
    }
  });

  it('rejects a caller whose currentVersion disagrees with the state', () => {
    const scene = state([wardrobe()]); // revision 1
    const built = buildDiff(
      scene.data,
      [{ op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200 } }],
      { baseVersion: 5 },
    );
    if (!built.ok) {
      throw new Error(built.message);
    }

    // The two numbers agree with each other, but not with the scene.
    const mismatch = applyDiff(scene, built.diff, { currentVersion: 5 });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.code).toBe('revision_mismatch');
    }

    // And the scene is untouched by the refusal.
    expect(scene.data.objects[0].params.widthCm).not.toBe(200);
  });
});

describe('sceneRevision — persistence and reload', () => {
  it('is not part of the persisted scene', () => {
    const scene = sceneReducerWithRevision(state(), { type: 'ADD_TABLE', id: 'table-2' });
    const saved = JSON.parse(JSON.stringify(scene.data));

    expect(saved.revision).toBeUndefined();
    expect(Object.keys(saved).sort()).toEqual(
      ['objects', 'room', 'schemaVersion', 'settings'].sort(),
    );
  });

  it('does not affect the unsaved-changes signature', () => {
    const scene = state();
    const bumped = sceneReducerWithRevision(scene, { type: 'SELECT', id: ROOM_OBJECT_ID });
    expect(bumped.revision).toBe(scene.revision);
    expect(sceneSignature('p', bumped.data)).toBe(sceneSignature('p', scene.data));
  });

  it('changes the signature when the scene really changed', () => {
    const scene = state();
    const bumped = sceneReducerWithRevision(scene, { type: 'ADD_TABLE', id: 'table-2' });
    expect(sceneSignature('p', bumped.data)).not.toBe(sceneSignature('p', scene.data));
  });

  it('a reloaded scene starts again at the initial revision', () => {
    const saved = sceneReducerWithRevision(state(), { type: 'ADD_TABLE', id: 't2' });
    expect(saved.revision).toBe(2);

    const reloaded = createSceneState(JSON.parse(JSON.stringify(saved.data)));
    expect(reloaded.revision).toBe(INITIAL_SCENE_REVISION);
    // The data survives the round trip; only the counter is runtime-only.
    expect(reloaded.data).toEqual(saved.data);
  });

  it('guards a reloaded scene with content checks instead of version', () => {
    const original = state([wardrobe()]);
    const built = buildDiff(
      original.data,
      [{ op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200 } }],
      { baseVersion: original.revision },
    );
    if (!built.ok) {
      throw new Error(built.message);
    }

    // Change the scene, serialise, reload: the counter is back to 1, so the
    // version check alone would let the old diff through.
    const changed = sceneReducerWithRevision(original, {
      type: 'UPDATE_PARAMS',
      id: 'wardrobe-1',
      params: { ...wardrobe().params, widthCm: 190 },
    });
    const reloaded = createSceneState(JSON.parse(JSON.stringify(changed.data)));
    expect(reloaded.revision).toBe(built.diff.baseVersion);

    const applied = applyDiff(reloaded, built.diff, { currentVersion: reloaded.revision });
    expect(applied.ok).toBe(false);
    if (!applied.ok) {
      // Refused on content, not on the version it could not remember.
      expect(applied.code).toBe('stale_content');
    }
  });
});

describe('sceneRevision — undo/redo contract', () => {
  it('keeps moving forward when an earlier scene is restored', () => {
    const initial = state();
    const edited = sceneReducerWithRevision(initial, { type: 'ADD_TABLE', id: 'table-2' });

    // A future undo restores `initial.data`, but not its revision.
    const restored: SceneState = {
      data: initial.data,
      selectedId: initial.selectedId,
      revision: revisionAfterHistoryRestore(edited.revision),
    };

    expect(restored.data).toEqual(initial.data);
    expect(restored.revision).toBe(edited.revision + 1);
    expect(restored.revision).toBeGreaterThan(edited.revision);
  });

  it('an undo does not resurrect a diff that was already superseded', () => {
    const initial = state([wardrobe()]);
    const built = buildDiff(
      initial.data,
      [{ op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 200 } }],
      { baseVersion: initial.revision },
    );
    if (!built.ok) {
      throw new Error(built.message);
    }

    const edited = sceneReducerWithRevision(initial, { type: 'ADD_TABLE', id: 'table-2' });
    const undone: SceneState = {
      data: initial.data,
      selectedId: initial.selectedId,
      revision: revisionAfterHistoryRestore(edited.revision),
    };

    // Content matches the pre-edit scene again, but the revision moved, so the
    // old diff must still be refused rather than silently re-applied.
    const applied = applyDiff(undone, built.diff, { currentVersion: undone.revision });
    expect(applied.ok).toBe(false);
  });

  it('refuses to restore a revision backwards', () => {
    expect(() => revisionAfterHistoryRestore(0)).toThrow(RangeError);
  });
});

describe('sceneRevision — default state', () => {
  it('a default scene starts at the initial revision', () => {
    let counter = 0;
    const created = createDefaultSceneState(() => `id-${++counter}`);
    expect(created.revision).toBe(INITIAL_SCENE_REVISION);
  });

  it('a hand-built state keeps the revision it was given', () => {
    const created = createSceneState(sceneData(), ROOM_OBJECT_ID);
    expect(created.selectedId).toBe(ROOM_OBJECT_ID);
    expect(created.revision).toBe(INITIAL_SCENE_REVISION);
  });
});
