import { useCallback, useMemo, useReducer } from 'react';
import {
  canRedo as canRedoOf,
  canUndo as canUndoOf,
  createHistoryState,
  sceneHistoryReducer,
  type SceneHistoryState,
} from '../scene/sceneHistory';
import type { SceneAction } from '../scene/sceneReducer';
import type { SceneState } from '../scene/types';

export interface SceneHistory {
  /** The live scene state: content, selection and revision. */
  scene: SceneState;
  /**
   * Same signature the app used before W15.6B, so every existing call site is
   * unchanged: a scene action becomes one history step when it really changes
   * the scene.
   */
  dispatch: (action: SceneAction) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * Replaces the scene with an already-computed state as a single history step.
   * `applyDiff` returns exactly such a state, so one AI proposal is one undo —
   * never one undo per field.
   */
  applyEdit: (state: SceneState) => void;
  /** Drops both stacks without touching the current scene (used on reload). */
  clearHistory: () => void;
  /** Undo depth, for diagnostics and tests. */
  undoDepth: number;
  redoDepth: number;
}

/**
 * W15.6B — the scene and its undo/redo timeline.
 *
 * The history lives in the same reducer as the scene, so a mutation and its
 * history entry cannot drift apart, and there is no second state source to keep
 * in sync.
 */
export function useSceneHistory(
  initial: SceneState | (() => SceneState),
): SceneHistory {
  const [history, rawDispatch] = useReducer(sceneHistoryReducer, initial, (value) =>
    createHistoryState(typeof value === 'function' ? (value as () => SceneState)() : value),
  );

  const dispatch = useCallback((action: SceneAction) => {
    rawDispatch({ type: 'SCENE', action });
  }, []);

  const undo = useCallback(() => rawDispatch({ type: 'UNDO' }), []);
  const redo = useCallback(() => rawDispatch({ type: 'REDO' }), []);
  const applyEdit = useCallback((state: SceneState) => {
    rawDispatch({ type: 'APPLY_EDIT', state });
  }, []);
  const clearHistory = useCallback(() => rawDispatch({ type: 'CLEAR_HISTORY' }), []);

  return useMemo(
    () => ({
      scene: history.present,
      dispatch,
      undo,
      redo,
      canUndo: canUndoOf(history),
      canRedo: canRedoOf(history),
      applyEdit,
      clearHistory,
      undoDepth: history.past.length,
      redoDepth: history.future.length,
    }),
    [history, dispatch, undo, redo, applyEdit, clearHistory],
  );
}

export type { SceneHistoryState };
