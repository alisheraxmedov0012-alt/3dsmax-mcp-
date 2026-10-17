// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useSceneHistory } from './useSceneHistory';
import { useSceneHistoryShortcuts } from './useSceneHistoryShortcuts';
import { applyDiff } from '../scene/applyDiff';
import { buildDiff } from '../scene/buildDiff';
import {
  INITIAL_SCENE_REVISION,
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  type SceneData,
  type SceneState,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';

/**
 * Mounts the real hook and drives it through React, so the tests cover the
 * integration the pure reducer tests cannot: that `dispatch` still behaves like
 * the old reducer call, that `undo`/`redo` re-render the scene, and that the
 * keyboard shortcuts reach the hook.
 */

function sceneData(): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects: [createFurnitureSceneObject('wardrobe', 'wardrobe-1')],
    settings: createDefaultSettings(),
  };
}

function initial(): SceneState {
  const data = sceneData();
  return { data, selectedId: 'wardrobe-1', revision: INITIAL_SCENE_REVISION };
}

function Harness({ withShortcuts = false }: { withShortcuts?: boolean }) {
  const { scene, dispatch, undo, redo, canUndo, canRedo, applyEdit, undoDepth } =
    useSceneHistory(initial);
  useSceneHistoryShortcuts(undo, redo, withShortcuts);

  return (
    <div>
      <span data-testid="width">{scene.data.objects[0].params.widthCm}</span>
      <span data-testid="name">{scene.data.objects[0].name}</span>
      <span data-testid="count">{scene.data.objects.length}</span>
      <span data-testid="revision">{scene.revision}</span>
      <span data-testid="canUndo">{String(canUndo)}</span>
      <span data-testid="canRedo">{String(canRedo)}</span>
      <span data-testid="depth">{undoDepth}</span>
      <button data-testid="widen" onClick={() => dispatch({
        type: 'UPDATE_PARAMS',
        id: 'wardrobe-1',
        params: { ...scene.data.objects[0].params, widthCm: 200 },
      })}>
        widen
      </button>
      <button data-testid="noop" onClick={() => dispatch({ type: 'SELECT', id: 'wardrobe-1' })}>
        select
      </button>
      <button data-testid="undo" onClick={undo}>
        undo
      </button>
      <button data-testid="redo" onClick={redo}>
        redo
      </button>
      <button
        data-testid="ai-edit"
        onClick={() => {
          const built = buildDiff(
            scene.data,
            [
              { op: 'set_params', objectId: 'wardrobe-1', params: { widthCm: 210 } },
              { op: 'rename', objectId: 'wardrobe-1', name: 'AI shkaf' },
            ],
            { baseVersion: scene.revision },
          );
          if (!built.ok) {
            throw new Error(built.message);
          }
          const applied = applyDiff(scene, built.diff, { currentVersion: scene.revision });
          if (!applied.ok) {
            throw new Error(applied.message);
          }
          applyEdit(applied.state);
        }}
      >
        ai
      </button>
      <input data-testid="field" />
    </div>
  );
}

afterEach(() => cleanup());

describe('useSceneHistory — integration through React', () => {
  it('renders the initial scene and an empty timeline', () => {
    render(<Harness />);
    expect(screen.getByTestId('width').textContent).toBe('180');
    expect(screen.getByTestId('canUndo').textContent).toBe('false');
    expect(screen.getByTestId('canRedo').textContent).toBe('false');
  });

  it('applies a dispatch, then undoes and redoes it', () => {
    render(<Harness />);

    act(() => screen.getByTestId('widen').click());
    expect(screen.getByTestId('width').textContent).toBe('200');
    expect(screen.getByTestId('canUndo').textContent).toBe('true');
    expect(screen.getByTestId('revision').textContent).toBe('2');

    act(() => screen.getByTestId('undo').click());
    expect(screen.getByTestId('width').textContent).toBe('180');
    expect(screen.getByTestId('canRedo').textContent).toBe('true');
    // Undo advanced the revision instead of restoring 1.
    expect(screen.getByTestId('revision').textContent).toBe('3');

    act(() => screen.getByTestId('redo').click());
    expect(screen.getByTestId('width').textContent).toBe('200');
    expect(screen.getByTestId('revision').textContent).toBe('4');
  });

  it('does not record a UI-only action', () => {
    render(<Harness />);
    act(() => screen.getByTestId('noop').click());
    expect(screen.getByTestId('canUndo').textContent).toBe('false');
    expect(screen.getByTestId('depth').textContent).toBe('0');
  });

  it('records one entry for an AI edit and undoes it in one step', () => {
    render(<Harness />);

    act(() => screen.getByTestId('ai-edit').click());
    expect(screen.getByTestId('width').textContent).toBe('210');
    expect(screen.getByTestId('name').textContent).toBe('AI shkaf');
    expect(screen.getByTestId('depth').textContent).toBe('1');

    act(() => screen.getByTestId('undo').click());
    expect(screen.getByTestId('width').textContent).toBe('180');
    expect(screen.getByTestId('name').textContent).toBe('Shkaf');
  });

  it('triggers undo and redo from the keyboard', () => {
    render(<Harness withShortcuts />);

    act(() => screen.getByTestId('widen').click());
    expect(screen.getByTestId('width').textContent).toBe('200');

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(screen.getByTestId('width').textContent).toBe('180');

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(screen.getByTestId('width').textContent).toBe('200');

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    expect(screen.getByTestId('width').textContent).toBe('200');
  });

  it('ignores the shortcut while typing in a field', () => {
    render(<Harness withShortcuts />);

    act(() => screen.getByTestId('widen').click());
    fireEvent.keyDown(screen.getByTestId('field'), { key: 'z', ctrlKey: true });

    // The scene is untouched: the keystroke belongs to the input.
    expect(screen.getByTestId('width').textContent).toBe('200');
  });

  it('ignores the shortcut when it is disabled', () => {
    render(<Harness />);
    act(() => screen.getByTestId('widen').click());
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(screen.getByTestId('width').textContent).toBe('200');
  });
});
