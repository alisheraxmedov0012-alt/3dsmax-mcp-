// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AiEditPanel, describeTarget } from './AiEditPanel';
import { AI_EDIT_FLAG_NAME } from '../ai/editFlag';
import { useSceneHistory } from '../hooks/useSceneHistory';
import { applyDiff } from '../scene/applyDiff';
import { buildDiff } from '../scene/buildDiff';
import { createDefaultSettings } from '../scene/sceneSettings';
import {
  INITIAL_SCENE_REVISION,
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  type SceneData,
  type SceneObject,
  type SceneState,
} from '../scene/types';

/**
 * W15.9 panel tests.
 *
 * These mount the real component on top of the real `useSceneHistory` hook, so
 * the assertions cover the whole chain the panel depends on:
 * parser → buildDiff → applyDiff → applyEdit → undo/redo. Nothing is mocked
 * except the passage of time.
 */

function wardrobe(): SceneObject {
  return createFurnitureSceneObject('wardrobe', 'w-1');
}

function sceneData(): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects: [wardrobe()],
    settings: createDefaultSettings(),
  };
}

function initialScene(): SceneState {
  return { data: sceneData(), selectedId: 'w-1', revision: INITIAL_SCENE_REVISION };
}

function Harness({ selected = wardrobe() as SceneObject | null }: { selected?: SceneObject | null }) {
  const { scene, dispatch, applyEdit, undo, redo, canUndo, canRedo, undoDepth } =
    useSceneHistory(initialScene);

  return (
    <div>
      <button
        data-testid="other-edit"
        onClick={() =>
          dispatch({
            type: 'UPDATE_PARAMS',
            id: 'w-1',
            params: { ...scene.data.objects[0].params, heightCm: 205 },
          })
        }
      >
        other edit
      </button>
      <span data-testid="scene-width">{scene.data.objects[0].params.widthCm}</span>
      <span data-testid="scene-color">{scene.data.objects[0].params.color}</span>
      <span data-testid="scene-name">{scene.data.objects[0].name}</span>
      <span data-testid="scene-visible">{String(scene.data.objects[0].visible)}</span>
      <span data-testid="scene-revision">{scene.revision}</span>
      <span data-testid="undo-depth">{undoDepth}</span>
      <AiEditPanel
        scene={scene}
        selectedObject={selected}
        onApply={applyEdit}
        undo={undo}
        redo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
      />
    </div>
  );
}

beforeEach(() => {
  // W15.10: the panel is behind a flag; these tests exercise the enabled path.
  vi.stubEnv(AI_EDIT_FLAG_NAME, 'true');
  vi.useRealTimers();
});

afterEach(() => {
  vi.unstubAllEnvs();
  cleanup();
});

async function propose(text: string) {
  fireEvent.change(screen.getByTestId('aiedit-target').ownerDocument.querySelector('textarea')!, {
    target: { value: text },
  });
  fireEvent.click(screen.getByTestId('aiedit-propose'));
  await waitFor(() => expect(screen.queryByTestId('aiedit-preview')).not.toBeNull());
}

function textarea(): HTMLTextAreaElement {
  return screen.getByLabelText("Tahrirlash buyrug'i") as HTMLTextAreaElement;
}

describe('AiEditPanel — rendering and input', () => {
  it('renders the panel with the selected object', () => {
    render(<Harness />);
    expect(screen.getByText('AI bilan tahrirlash')).toBeTruthy();
    expect(screen.getByTestId('aiedit-target').textContent).toContain('Shkaf');
    expect(screen.getByTestId('aiedit-target').textContent).toContain('wardrobe');
  });

  it('explains that no object is selected', () => {
    render(<Harness selected={null} />);
    expect(screen.getByTestId('aiedit-target').textContent).toContain('tanlanmagan');
    expect((screen.getByTestId('aiedit-propose') as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables the propose button for empty input', () => {
    render(<Harness />);
    const button = screen.getByTestId('aiedit-propose') as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.change(textarea(), { target: { value: '   ' } });
    expect(button.disabled).toBe(true);

    fireEvent.change(textarea(), { target: { value: 'kengaytir' } });
    expect(button.disabled).toBe(false);
  });
});

describe('AiEditPanel — proposal', () => {
  it('builds a preview and does not touch the scene', async () => {
    render(<Harness />);
    await propose('Shkafni 20 sm kengaytir');

    // Scene unchanged: the preview is only a proposal.
    expect(screen.getByTestId('scene-width').textContent).toBe('180');
    expect(screen.getByTestId('undo-depth').textContent).toBe('0');

    const preview = screen.getByTestId('aiedit-preview');
    expect(within(preview).getByText('Kenglik (sm)')).toBeTruthy();
    expect(within(preview).getByText('180 sm')).toBeTruthy();
    expect(within(preview).getByText('200 sm')).toBeTruthy();
  });

  it('shows a colour change with both values', async () => {
    render(<Harness />);
    fireEvent.change(textarea(), { target: { value: "rangini oq rangga o'zgartir" } });
    fireEvent.click(screen.getByTestId('aiedit-propose'));

    await waitFor(() => expect(screen.queryByTestId('aiedit-preview')).not.toBeNull());
    const preview = screen.getByTestId('aiedit-preview');
    expect(within(preview).getByText('#a9744f')).toBeTruthy();
    expect(within(preview).getByText('#ffffff')).toBeTruthy();
  });

  it('reports an unsupported command without creating a preview', async () => {
    render(<Harness />);
    fireEvent.change(textarea(), { target: { value: 'menga oshxona kerak' } });
    fireEvent.click(screen.getByTestId('aiedit-propose'));

    await waitFor(() =>
      expect(screen.getByTestId('aiedit-message').textContent).toContain('tushunmadim'),
    );
    expect(screen.queryByTestId('aiedit-preview')).toBeNull();
    expect(screen.getByTestId('scene-width').textContent).toBe('180');
  });

  it('reports a no-op command instead of offering to apply it', async () => {
    render(<Harness />);
    fireEvent.change(textarea(), { target: { value: 'kengligi 180 sm bo‘lsin' } });
    fireEvent.click(screen.getByTestId('aiedit-propose'));

    await waitFor(() =>
      expect(screen.getByTestId('aiedit-message').textContent).toContain("o'zgartirmaydi"),
    );
    expect(screen.queryByTestId('aiedit-preview')).toBeNull();
  });

  it('reports an out-of-range value from the validator', async () => {
    render(<Harness />);
    fireEvent.change(textarea(), { target: { value: 'kengligini 500 sm kengaytir' } });
    fireEvent.click(screen.getByTestId('aiedit-propose'));

    await waitFor(() =>
      expect(screen.getByTestId('aiedit-message').textContent).toContain('oraliqdan tashqarida'),
    );
    expect(screen.queryByTestId('aiedit-preview')).toBeNull();
  });

  it('blocks a second submit while a proposal is being prepared', async () => {
    render(<Harness />);
    fireEvent.change(textarea(), { target: { value: 'Shkafni 20 sm kengaytir' } });

    const button = screen.getByTestId('aiedit-propose') as HTMLButtonElement;
    fireEvent.click(button);
    // Same tick: the panel is already in its working state.
    expect(button.disabled).toBe(true);
    fireEvent.click(button);

    await waitFor(() => expect(screen.queryByTestId('aiedit-preview')).not.toBeNull());
    expect(screen.getByTestId('undo-depth').textContent).toBe('0');
  });
});

describe('AiEditPanel — apply and reject', () => {
  it('applies only after confirmation', async () => {
    render(<Harness />);
    await propose('Shkafni 20 sm kengaytir');

    expect(screen.getByTestId('scene-width').textContent).toBe('180');

    fireEvent.click(screen.getByTestId('aiedit-apply'));

    expect(screen.getByTestId('scene-width').textContent).toBe('200');
    expect(screen.getByTestId('aiedit-message').textContent).toContain("Qo'llanildi");
    expect(screen.queryByTestId('aiedit-preview')).toBeNull();
  });

  it('records one undo step for a multi-field proposal', async () => {
    render(<Harness />);
    await propose('Shkafni 20 sm kengaytir');
    fireEvent.click(screen.getByTestId('aiedit-apply'));

    expect(screen.getByTestId('undo-depth').textContent).toBe('1');

    fireEvent.click(screen.getByTestId('aiedit-undo'));
    expect(screen.getByTestId('scene-width').textContent).toBe('180');
    // Undo advances the revision, it never restores the old number.
    expect(screen.getByTestId('scene-revision').textContent).toBe('3');
  });

  it('rejects without changing the scene or the history', async () => {
    render(<Harness />);
    await propose('Shkafni 20 sm kengaytir');

    fireEvent.click(screen.getByTestId('aiedit-reject'));

    expect(screen.queryByTestId('aiedit-preview')).toBeNull();
    expect(screen.getByTestId('scene-width').textContent).toBe('180');
    expect(screen.getByTestId('undo-depth').textContent).toBe('0');
    expect(screen.getByTestId('aiedit-message').textContent).toContain('rad etildi');
  });

  it('applies a rename as one step', async () => {
    render(<Harness />);
    fireEvent.change(textarea(), {
      target: { value: "Shkaf nomini Kitob javoni deb o'zgartir" },
    });
    fireEvent.click(screen.getByTestId('aiedit-propose'));
    await waitFor(() => expect(screen.queryByTestId('aiedit-preview')).not.toBeNull());

    fireEvent.click(screen.getByTestId('aiedit-apply'));

    expect(screen.getByTestId('scene-name').textContent).toBe('Kitob javoni');
    expect(screen.getByTestId('undo-depth').textContent).toBe('1');
  });

  it('does not apply twice when the apply button is clicked again', async () => {
    render(<Harness />);
    await propose('Shkafni 20 sm kengaytir');

    const apply = screen.getByTestId('aiedit-apply') as HTMLButtonElement;
    fireEvent.click(apply);
    // The preview is gone, so the second click cannot reach an apply.
    expect(screen.queryByTestId('aiedit-apply')).toBeNull();
    fireEvent.click(apply);

    expect(screen.getByTestId('scene-width').textContent).toBe('200');
    expect(screen.getByTestId('undo-depth').textContent).toBe('1');
  });
});

describe('AiEditPanel — history integration', () => {
  it('undoes and redoes an applied proposal', async () => {
    render(<Harness />);
    await propose('Shkafni 20 sm kengaytir');
    fireEvent.click(screen.getByTestId('aiedit-apply'));

    fireEvent.click(screen.getByTestId('aiedit-undo'));
    expect(screen.getByTestId('scene-width').textContent).toBe('180');

    fireEvent.click(screen.getByTestId('aiedit-redo'));
    expect(screen.getByTestId('scene-width').textContent).toBe('200');
  });

  it('disables the history buttons at the ends of the timeline', () => {
    render(<Harness />);
    expect((screen.getByTestId('aiedit-undo') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('aiedit-redo') as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the revision monotonic across apply, undo and redo', async () => {
    render(<Harness />);
    await propose('Shkafni 20 sm kengaytir');
    fireEvent.click(screen.getByTestId('aiedit-apply'));
    const afterApply = Number(screen.getByTestId('scene-revision').textContent);

    fireEvent.click(screen.getByTestId('aiedit-undo'));
    const afterUndo = Number(screen.getByTestId('scene-revision').textContent);

    fireEvent.click(screen.getByTestId('aiedit-redo'));
    const afterRedo = Number(screen.getByTestId('scene-revision').textContent);

    expect(afterUndo).toBeGreaterThan(afterApply);
    expect(afterRedo).toBeGreaterThan(afterUndo);
  });
});

describe('AiEditPanel — stale proposals', () => {
  it('marks a proposal stale when the scene changes underneath it', async () => {
    render(<Harness />);
    await propose('Shkafni 20 sm kengaytir');

    // Another edit moves the scene on while the preview is open.
    fireEvent.click(screen.getByTestId('other-edit'));
    expect(screen.getByTestId('scene-revision').textContent).not.toBe('1');

    await waitFor(() => expect(screen.queryByTestId('aiedit-stale')).not.toBeNull());
    expect((screen.getByTestId('aiedit-apply') as HTMLButtonElement).disabled).toBe(true);
  });

  it('refuses a proposal whose target no longer exists', () => {
    const scene = initialScene();
    const built = buildDiff(
      scene.data,
      [{ op: 'set_params', objectId: 'w-1', params: { widthCm: 200 } }],
      { baseVersion: scene.revision },
    );
    if (!built.ok) {
      throw new Error(built.message);
    }

    // The object is gone by the time the proposal is applied.
    const emptied: SceneState = {
      data: { ...scene.data, objects: [] },
      selectedId: null,
      revision: scene.revision,
    };
    const applied = applyDiff(emptied, built.diff, { currentVersion: emptied.revision });
    expect(applied.ok).toBe(false);
    if (!applied.ok) {
      expect(applied.code).toBe('unknown_object');
    }
  });

  it('drops the preview when the selection changes', async () => {
    const { rerender } = render(<Harness />);
    await propose('Shkafni 20 sm kengaytir');
    expect(screen.queryByTestId('aiedit-preview')).not.toBeNull();

    rerender(<Harness selected={createFurnitureSceneObject('table', 't-1')} />);

    await waitFor(() => expect(screen.queryByTestId('aiedit-preview')).toBeNull());
  });
});

describe('AiEditPanel — accessibility and layout', () => {
  it('labels the textarea and the apply button', async () => {
    render(<Harness />);
    expect(textarea().getAttribute('aria-label')).toBe("Tahrirlash buyrug'i");
    expect(textarea().getAttribute('maxlength')).toBe('200');

    await propose('Shkafni 20 sm kengaytir');
    expect(screen.getByTestId('aiedit-apply').textContent).toBe('Qo‘llash');
    expect(screen.getByTestId('aiedit-reject').textContent).toBe('Rad etish');
  });

  it('announces errors with role=alert', async () => {
    render(<Harness />);
    fireEvent.change(textarea(), { target: { value: 'salom' } });
    fireEvent.click(screen.getByTestId('aiedit-propose'));

    await waitFor(() => expect(screen.getByTestId('aiedit-message').getAttribute('role')).toBe('alert'));
  });

  it('renders inside the existing panel styling hooks', () => {
    const { container } = render(<Harness />);
    // The responsive rules in App.css target these class names.
    expect(container.querySelector('.aiedit')).not.toBeNull();
    expect(container.querySelector('.aiedit__button')).not.toBeNull();
  });
});

describe('AiEditPanel — W15.10 feature flag', () => {
  it('renders nothing when the flag is absent', () => {
    vi.unstubAllEnvs();
    const { container } = render(<Harness />);
    expect(container.querySelector('.aiedit')).toBeNull();
    // The surrounding app keeps working: the scene is still rendered.
    expect(screen.getByTestId('scene-width').textContent).toBe('180');
  });

  it.each(['false', '0', 'yes', 'on'])('renders nothing when the flag is %j', (value) => {
    vi.stubEnv(AI_EDIT_FLAG_NAME, value);
    const { container } = render(<Harness />);
    expect(container.querySelector('.aiedit')).toBeNull();
  });

  it('renders the panel when the flag is true', () => {
    vi.stubEnv(AI_EDIT_FLAG_NAME, 'true');
    render(<Harness />);
    expect(screen.getByText('AI bilan tahrirlash')).toBeTruthy();
  });

  it('does not change the scene or the history while disabled', () => {
    vi.stubEnv(AI_EDIT_FLAG_NAME, 'false');
    render(<Harness />);
    expect(screen.getByTestId('scene-width').textContent).toBe('180');
    expect(screen.getByTestId('undo-depth').textContent).toBe('0');
    expect(screen.getByTestId('scene-revision').textContent).toBe('1');
  });

  it('keeps the AI flow working once enabled', async () => {
    vi.stubEnv(AI_EDIT_FLAG_NAME, 'true');
    render(<Harness />);
    await propose('Shkafni 20 sm kengaytir');
    fireEvent.click(screen.getByTestId('aiedit-apply'));

    expect(screen.getByTestId('scene-width').textContent).toBe('200');
    expect(screen.getByTestId('undo-depth').textContent).toBe('1');
  });
});

describe('describeTarget — friendly preview label', () => {
  it('uses the object name', () => {
    expect(describeTarget(wardrobe(), 'w-1')).toBe('Shkaf');
  });

  it('falls back to the type label when the name is blank', () => {
    const unnamed = { ...wardrobe(), name: '   ' };
    expect(describeTarget(unnamed, 'w-1')).toBe('Shkaf');
  });

  it('falls back to a safe label for another object', () => {
    expect(describeTarget(wardrobe(), 'other-id')).toBe('Tanlangan obyekt');
  });

  it('falls back when nothing is selected', () => {
    expect(describeTarget(null, 'w-1')).toBe('Tanlangan obyekt');
  });

  it('shows the name in the preview heading instead of the id', async () => {
    render(<Harness />);
    await propose('Shkafni 20 sm kengaytir');

    const preview = screen.getByTestId('aiedit-preview');
    expect(within(preview).getByText('Taklif: Shkaf')).toBeTruthy();
    expect(within(preview).queryByText(/Taklif: w-1/)).toBeNull();
  });
});

