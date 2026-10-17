/**
 * W15.6 — the scene revision counter.
 *
 * A revision is a monotonic number that identifies "this exact scene content".
 * AI edits quote the revision they were computed against; an edit that no longer
 * matches is refused before it can touch the scene.
 *
 * ## Why it lives on `SceneState` and not on `SceneData`
 *
 * `SceneData` is the persisted/exported/transported representation: it is what
 * `localProjectRepository` writes to storage, what `exportSceneToFormat` reads,
 * and what `backend/app/services/scene_payload.py` validates. Putting a counter
 * there would change the storage schema, make every saved project look "dirty"
 * (its signature includes the scene), and require a server contract change — all
 * out of scope for W15. `SceneState` is runtime-only, so the counter never
 * reaches storage.
 *
 * ## Relationship to `Project.version`
 *
 * | | `Project.version` | `SceneState.revision` |
 * |---|---|---|
 * | Owner | backend (`backend/app/models.py`) | the client runtime |
 * | Scope | one saved project row | one in-memory scene |
 * | Advances on | a successful project PATCH | a real change to `SceneState.data` |
 * | Persisted | yes | no — resets to `INITIAL_SCENE_REVISION` on reload |
 * | Guards | concurrent writes to the same project | a stale AI diff |
 *
 * They are different domains and are deliberately not synchronised here. The
 * server contract is unchanged by this step.
 *
 * ## How it is centralised
 *
 * Every scene mutation in the app goes through the single `useReducer` in
 * `App.tsx`. Replacing that reducer with {@link sceneReducerWithRevision} makes
 * the counter advance on every real change without touching any of the 36
 * dispatch sites. This works because all dispatches share one reducer.
 */
import { sceneReducer, type SceneAction } from './sceneReducer';
import { INITIAL_SCENE_REVISION, MAX_SCENE_REVISION, type SceneData, type SceneState } from './types';

/** True for values that can be used as a revision. */
export function isValidRevision(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= INITIAL_SCENE_REVISION &&
    value <= MAX_SCENE_REVISION
  );
}

/**
 * Returns the next revision.
 *
 * Throws on an invalid input rather than substituting `0`: a silently reset
 * counter would make every stale diff look current, which is the exact failure
 * this module exists to prevent. Callers only ever pass a revision that came out
 * of this module or `createDefaultSceneState`, so a throw means a hand-built
 * state, not a runtime condition to recover from.
 */
export function advanceRevision(current: number): number {
  if (!isValidRevision(current)) {
    throw new RangeError(`Noto'g'ri scene revision: ${String(current)}`);
  }
  if (current >= MAX_SCENE_REVISION) {
    // Saturating is safe: two states share a revision, but `applyDiff` still
    // compares every `before` value, so a stale diff is refused on content.
    return MAX_SCENE_REVISION;
  }
  return current + 1;
}

/**
 * Structural equality for scene data.
 *
 * Reference equality is not enough: several reducer actions rebuild `data` even
 * when the resulting values are identical (`SET_ROOM` with unchanged
 * dimensions, `UPDATE_LIGHTS` with the same lights). Treating those as changes
 * would inflate the revision and make a *valid* diff look stale.
 *
 * Keys holding `undefined` compare as absent, matching how the validators drop
 * optional fields.
 */
export function sameSceneData(a: SceneData, b: SceneData): boolean {
  return sameValue(a, b);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    // NaN never appears in validated scene data, but two NaNs should not be
    // reported as a change if a caller built the scene by hand.
    return Number.isNaN(a) && Number.isNaN(b);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    for (let index = 0; index < a.length; index += 1) {
      if (!sameValue(a[index], b[index])) {
        return false;
      }
    }
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    const leftValue = left[key];
    const rightValue = right[key];
    if (leftValue === undefined && rightValue === undefined) {
      continue;
    }
    if (!sameValue(leftValue, rightValue)) {
      return false;
    }
  }
  return true;
}

/**
 * The reducer the app actually uses.
 *
 * Advances `revision` only when the scene content really changed:
 * - a selection-only action leaves `data` untouched (same reference) — no bump;
 * - an action that rebuilds `data` with identical values — no bump;
 * - a real change — bumped by exactly one, however many fields it touched.
 *
 * The raw `sceneReducer` deliberately never advances the counter; see the
 * "bypass" note in `W15_6` test coverage.
 */
export function sceneReducerWithRevision(state: SceneState, action: SceneAction): SceneState {
  const next = sceneReducer(state, action);

  if (next === state) {
    return state;
  }
  if (next.data === state.data) {
    return next;
  }
  if (sameSceneData(next.data, state.data)) {
    // Content is identical; keep the counter, but keep the reducer's `data`
    // reference so downstream memoisation sees a stable object.
    return { data: state.data, selectedId: next.selectedId, revision: state.revision };
  }
  return { data: next.data, selectedId: next.selectedId, revision: advanceRevision(state.revision) };
}

/**
 * Builds the runtime state for a scene that does not carry a revision yet — a
 * freshly created scene, or one restored from storage. A restored scene always
 * starts again at {@link INITIAL_SCENE_REVISION}: the counter is not persisted,
 * so a diff from a previous session cannot be matched by version alone. Such a
 * diff is still refused by `applyDiff`'s `before`-value comparison.
 */
export function createSceneState(
  data: SceneData,
  selectedId: string | null = data.objects[0]?.id ?? null,
): SceneState {
  return { data, selectedId, revision: INITIAL_SCENE_REVISION };
}

/**
 * Revision contract for undo/redo (implemented in a later step).
 *
 * Restoring an earlier `SceneData` is a new change in the timeline, so the
 * counter must keep moving forward — it must not be restored to the value the
 * old content had. Reusing an old revision would let a diff that was built
 * against the pre-undo scene pass the version check after the undo.
 */
export function revisionAfterHistoryRestore(current: number): number {
  return advanceRevision(current);
}
