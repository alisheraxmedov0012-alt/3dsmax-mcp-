// @vitest-environment jsdom
/**
 * Stage 3.4 — editing panel: proposals become a preview, never a scene change.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { AiEditPanel } from './AiEditPanel';
import { getFurnitureParameters, updateFurnitureSpec } from '../scene/configurator';
import { createFurnitureSceneObject, createUniversalSceneObject, type SceneSpec } from '../scene/types';
import type { SpecPreview } from '../scene/preview';
import type { IntentGeneration } from '../ai/intent';

function specOf(patch: Record<string, number | boolean>): SceneSpec {
  const defaults = getFurnitureParameters('desk.computer')?.defaults;
  const result = updateFurnitureSpec('desk.computer', defaults, patch);
  if (!result.ok) throw new Error('unexpected validation failure');
  return result.spec;
}

const noop = () => {};

const object = createUniversalSceneObject('desk.computer', 'u1');
const proposed = specOf({ width: 180 });
const generated: IntentGeneration = {
  kind: 'success',
  intent: {
    definitionId: 'desk.computer',
    patch: { width: 180 },
    language: 'uz',
    clarificationRequired: false,
  },
  spec: proposed,
  source: 'test',
};

interface HarnessProps {
  initialPreview?: SpecPreview | null;
  generate: (options: {
    prompt: string;
    currentDefinitionId?: string;
    currentSpec?: SceneSpec;
  }) => Promise<IntentGeneration>;
  onApply?: (spec: SceneSpec) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

function Harness({
  initialPreview = null,
  generate,
  onApply = noop,
  onUndo = noop,
  onRedo = noop,
  canUndo = false,
  canRedo = false,
}: HarnessProps) {
  const [preview, setPreview] = useState<SpecPreview | null>(initialPreview);
  return (
    <AiEditPanel
      object={object}
      preview={preview}
      canUndo={canUndo}
      canRedo={canRedo}
      onPreview={setPreview}
      onApply={(spec) => {
        setPreview(null);
        onApply(spec);
      }}
      onCancel={() => setPreview(null)}
      onUndo={onUndo}
      onRedo={onRedo}
      generate={generate}
    />
  );
}

afterEach(() => {
  cleanup();
});

describe('AiEditPanel visibility', () => {
  it('renders nothing for a legacy object or no selection', () => {
    const legacy = createFurnitureSceneObject('table', 't1');
    const { container } = render(
      <>
        <AiEditPanel
          object={null}
          preview={null}
          canUndo={false}
          canRedo={false}
          onPreview={() => {}}
          onApply={() => {}}
          onCancel={() => {}}
          onUndo={() => {}}
          onRedo={() => {}}
        />
        <AiEditPanel
          object={legacy}
          preview={null}
          canUndo={false}
          canRedo={false}
          onPreview={() => {}}
          onApply={() => {}}
          onCancel={() => {}}
          onUndo={() => {}}
          onRedo={() => {}}
        />
      </>,
    );

    expect(container.querySelector('.ai-edit')).toBeNull();
  });

  it('shows the selected definition', () => {
    render(<Harness generate={async () => generated} />);
    expect(screen.getByRole('heading', { name: 'AI bilan tahrirlash' })).toBeTruthy();
    expect(screen.getByText(/Kompyuter stoli/)).toBeTruthy();
  });
});

describe('AiEditPanel preview flow', () => {
  it('turns a proposal into a preview with the old and new values', async () => {
    render(<Harness generate={async () => generated} />);

    fireEvent.change(screen.getByLabelText('O‘zgartirish'), {
      target: { value: 'kengligini 180 sm qil' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Taklif qilish' }));

    expect(await screen.findByText('Taklif: Kompyuter stoli')).toBeTruthy();
    expect(screen.getByText('Kenglik (sm)')).toBeTruthy();
    expect(screen.getByText('160 → 180')).toBeTruthy();
    // No scene change yet: the panel only reports the preview.
    expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy();
  });

  it('applies the preview through the callback and clears it', async () => {
    const applied: SceneSpec[] = [];
    render(
      <Harness
        generate={async () => generated}
        onApply={(spec) => applied.push(spec)}
      />,
    );

    fireEvent.change(screen.getByLabelText('O‘zgartirish'), { target: { value: 'wider' } });
    fireEvent.click(screen.getByRole('button', { name: 'Taklif qilish' }));
    await screen.findByRole('button', { name: 'Apply' });

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(applied).toHaveLength(1);
    expect(applied[0].width).toBe(180);
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
  });

  it('cancels the preview without applying anything', async () => {
    const applied: SceneSpec[] = [];
    render(<Harness generate={async () => generated} onApply={(spec) => applied.push(spec)} />);

    fireEvent.change(screen.getByLabelText('O‘zgartirish'), { target: { value: 'wider' } });
    fireEvent.click(screen.getByRole('button', { name: 'Taklif qilish' }));
    await screen.findByRole('button', { name: 'Cancel' });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(applied).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
  });

  it('ignores a preview computed from an older spec', () => {
    const stale: SpecPreview = {
      objectId: object.id,
      definitionId: 'desk.computer',
      baseSpec: specOf({ width: 150 }),
      spec: proposed,
    };

    render(<Harness initialPreview={stale} generate={async () => generated} />);

    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
  });
});

describe('AiEditPanel states', () => {
  it('shows a loading state and ignores a second submit', async () => {
    let resolve: (value: IntentGeneration) => void = () => {};
    let calls = 0;
    render(
      <Harness
        generate={() => {
          calls += 1;
          return new Promise<IntentGeneration>((done) => {
            resolve = done;
          });
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText('O‘zgartirish'), { target: { value: 'wider' } });
    const submit = screen.getByRole('button', { name: 'Taklif qilish' });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(screen.getByRole('status').textContent).toContain('O‘zgarish tayyorlanmoqda');
    resolve(generated);
    await screen.findByRole('button', { name: 'Apply' });
    expect(calls).toBe(1);
  });

  it('shows a validation error', async () => {
    render(
      <Harness
        generate={async () => ({
          kind: 'error',
          message: 'width: legInset va legWidth stol chetidan chiqmasligi kerak.',
          code: 'invalid_spec',
          issues: [],
        })}
      />,
    );

    fireEvent.change(screen.getByLabelText('O‘zgartirish'), { target: { value: '10 sm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Taklif qilish' }));

    expect((await screen.findByRole('alert')).textContent).toContain('width');
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
  });

  it('shows a clarifying question', async () => {
    render(
      <Harness
        generate={async () => ({
          kind: 'clarification',
          question: 'Qancha o‘zgartirishni ko‘rsating?',
          language: 'uz',
          source: 't',
        })}
      />,
    );

    fireEvent.change(screen.getByLabelText('O‘zgartirish'), { target: { value: 'wider' } });
    fireEvent.click(screen.getByRole('button', { name: 'Taklif qilish' }));

    expect(await screen.findByText('Qancha o‘zgartirishni ko‘rsating?')).toBeTruthy();
  });
});

describe('AiEditPanel history controls', () => {
  it('disables undo and redo when there is nothing to restore', () => {
    render(<Harness generate={async () => generated} />);

    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls undo and redo when they are available', () => {
    let undos = 0;
    let redos = 0;
    render(
      <Harness
        generate={async () => generated}
        canUndo
        canRedo
        onUndo={() => {
          undos += 1;
        }}
        onRedo={() => {
          redos += 1;
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));

    expect(undos).toBe(1);
    expect(redos).toBe(1);
  });

  it('regenerates from the last prompt', async () => {
    const prompts: string[] = [];
    render(
      <Harness
        generate={async ({ prompt }) => {
          prompts.push(prompt);
          return generated;
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText('O‘zgartirish'), { target: { value: 'wider' } });
    fireEvent.click(screen.getByRole('button', { name: 'Taklif qilish' }));
    await screen.findByRole('button', { name: 'Apply' });

    fireEvent.click(screen.getByRole('button', { name: 'Qayta' }));
    await screen.findByRole('button', { name: 'Apply' });

    expect(prompts).toEqual(['wider', 'wider']);
  });
});

describe('AiEditPanel - usage warnings', () => {
  it('keeps the preview and warns about a persistence failure', async () => {
    const applied: SceneSpec[] = [];
    render(
      <Harness
        generate={async () => ({ ...generated, usageError: 'usage_persistence_failed' })}
        onApply={(spec) => applied.push(spec)}
      />,
    );

    fireEvent.change(screen.getByLabelText('O‘zgartirish'), { target: { value: 'wider' } });
    fireEvent.click(screen.getByRole('button', { name: 'Taklif qilish' }));

    expect(await screen.findByText(/hisob faqat shu sessiyada qoladi/)).toBeTruthy();
    // Apply is still available: the warning does not become an error.
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }));
    expect(applied).toHaveLength(1);
    expect(applied[0].width).toBe(180);
  });

  it('shows no warning for a clean edit', async () => {
    render(<Harness generate={async () => generated} />);

    fireEvent.change(screen.getByLabelText('O‘zgartirish'), { target: { value: 'wider' } });
    fireEvent.click(screen.getByRole('button', { name: 'Taklif qilish' }));

    await screen.findByRole('button', { name: 'Apply' });
    expect(document.querySelector('.usage-warning')).toBeNull();
  });
});

describe('AiEditPanel - per-object reset', () => {
  it('starts clean when the selected object changes', async () => {
    const other = createUniversalSceneObject('desk.gaming', 'u2');

    function Switching() {
      const [current, setCurrent] = useState(object);
      return (
        <>
          <button type="button" onClick={() => setCurrent(other)}>
            boshqa obyekt
          </button>
          <AiEditPanel
            key={current.id}
            object={current}
            preview={null}
            canUndo={false}
            canRedo={false}
            onPreview={() => {}}
            onApply={() => {}}
            onCancel={() => {}}
            onUndo={() => {}}
            onRedo={() => {}}
            generate={async () => generated}
          />
        </>
      );
    }

    render(<Switching />);

    const prompt = screen.getByLabelText('O‘zgartirish') as HTMLTextAreaElement;
    fireEvent.change(prompt, { target: { value: 'kengligini 180 sm qil' } });
    fireEvent.click(screen.getByRole('button', { name: 'Taklif qilish' }));

    const regenerate = () => screen.getByRole('button', { name: 'Qayta' }) as HTMLButtonElement;
    await waitFor(() => expect(regenerate().disabled).toBe(false));

    fireEvent.click(screen.getByRole('button', { name: 'boshqa obyekt' }));

    const fresh = screen.getByLabelText('O‘zgartirish') as HTMLTextAreaElement;
    expect(fresh.value).toBe('');
    expect(regenerate().disabled).toBe(true);
  });
});
