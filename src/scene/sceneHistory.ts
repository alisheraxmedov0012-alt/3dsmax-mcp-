/**
 * W15.6B — undo/redo for the scene.
 *
 * The history keeps whole `SceneData` snapshots. A snapshot is small relative to
 * the rest of the app state and this makes undo exact: replaying inverse actions
 * would have to reconstruct clamping, dropping and validation the reducer
 * already performed, and any mismatch there would corrupt the scene quietly.
 *
 * What is stored is `SceneData` only:
 * - `selectedId` is UI state, not scene content — undo must not move the
 *   selection back to whatever was selected three edits ago;
 * - `revision` is a timeline marker, and restoring an old number would let a
 *   diff from before the undo pass the version check (see
 *   `revisionAfterHistoryRestore`).
 *
 * Only real content changes create an entry. `SELECT`, hover, camera and other
 * view-only actions leave `data` untouched and are filtered by the same
 * structural comparison the revision counter uses.
 */
import type { SceneAction } from './sceneReducer';
import { advanceRevision, sameSceneData, sceneReducerWithRevision } from './sceneRevision';
import { ROOM_OBJECT_ID, type SceneData, type SceneState } from './types';

/** Maximum number of undo steps. */
export const SCENE_HISTORY_LIMIT = 50;

export interface SceneHistoryState {
  /** Older scene contents, oldest first. */
  past: SceneData[];
  /** The live state: content, selection and revision. */
  present: SceneState;
  /** Contents undone most recently last. */
  future: SceneData[];
}

export type SceneHistoryAction =
  /** Any ordinary scene action, forwarded to `sceneReducerWithRevision`. */
  | { type: 'SCENE'; action: SceneAction }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  /** Replace the scene with an already-computed state (used by `applyDiff`). */
  | { type: 'APPLY_EDIT'; state: SceneState }
  | { type: 'CLEAR_HISTORY' };

/** Builds the initial history around an initial scene state. */
export function createHistoryState(initial: SceneState): SceneHistoryState {
  return { past: [], present: initial, future: [] };
}

/**
 * Keeps the selection pointing at something that exists.
 *
 * Undo can restore a scene where the selected object has not been created yet
 * (or redo one where it was deleted). Rather than clearing the selection, fall
 * back to the room, which every scene has.
 */
function repairSelection(data: SceneData, selectedId: string | null): string | null {
  if (selectedId === null || selectedId === ROOM_OBJECT_ID) {
    return selectedId;
  }
  return data.objects.some((object) => object.id === selectedId)
    ? selectedId
    : ROOM_OBJECT_ID;
}

function pushEntry(past: readonly SceneData[], entry: SceneData): SceneData[] {
  const next = [...past, entry];
  return next.length > SCENE_HISTORY_LIMIT ? next.slice(next.length - SCENE_HISTORY_LIMIT) : next;
}

/**
 * Pure history reducer.
 *
 * Recording happens inside the reducer, so one dispatch produces exactly one
 * transition: there is no place where a caller could record a state separately
 * from the update, and re-invoking the reducer with the same input under React
 * StrictMode yields the same result.
 */
export function sceneHistoryReducer(
  state: SceneHistoryState,
  action: SceneHistoryAction,
): SceneHistoryState {
  switch (action.type) {
    case 'SCENE': {
      const next = sceneReducerWithRevision(state.present, action.action);
      if (next === state.present) {
        return state;
      }
      if (sameSceneData(next.data, state.present.data)) {
        // Selection or a rebuilt-but-identical scene: keep the new selection,
        // record nothing.
        return { ...state, present: next };
      }
      return {
        past: pushEntry(state.past, state.present.data),
        present: next,
        future: [],
      };
    }

    case 'APPLY_EDIT': {
      const incoming = action.state;
      if (sameSceneData(incoming.data, state.present.data)) {
        return state;
      }
      // The caller computed this state itself, so its revision is only trusted
      // if it moves the timeline forward. A hand-built or replayed state must
      // not be able to reuse an old number.
      const revision =
        Number.isInteger(incoming.revision) && incoming.revision > state.present.revision
          ? incoming.revision
          : advanceRevision(state.present.revision);

      return {
        past: pushEntry(state.past, state.present.data),
        present: { ...incoming, revision },
        future: [],
      };
    }

    case 'UNDO': {
      const previous = state.past[state.past.length - 1];
      if (previous === undefined) {
        return state;
      }
      return {
        past: state.past.slice(0, -1),
        present: {
          data: previous,
          selectedId: repairSelection(previous, state.present.selectedId),
          // Restoring old content is a new step in the timeline, so a diff built
          // before the undo cannot pass the version check afterwards.
          revision: advanceRevision(state.present.revision),
        },
        future: [...state.future, state.present.data],
      };
    }

    case 'REDO': {
      const next = state.future[state.future.length - 1];
      if (next === undefined) {
        return state;
      }
      return {
        past: pushEntry(state.past, state.present.data),
        present: {
          data: next,
          selectedId: repairSelection(next, state.present.selectedId),
          revision: advanceRevision(state.present.revision),
        },
        future: state.future.slice(0, -1),
      };
    }

    case 'CLEAR_HISTORY':
      return state.past.length === 0 && state.future.length === 0
        ? state
        : { past: [], present: state.present, future: [] };
  }
}

export function canUndo(state: SceneHistoryState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: SceneHistoryState): boolean {
  return state.future.length > 0;
}

/** Number of undo steps currently available, for tests and diagnostics. */
export function undoDepth(state: SceneHistoryState): number {
  return state.past.length;
}

/** Number of redo steps currently available, for tests and diagnostics. */
export function redoDepth(state: SceneHistoryState): number {
  return state.future.length;
}
