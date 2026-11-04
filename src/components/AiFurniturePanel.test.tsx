// @vitest-environment jsdom
/**
 * Stage 3.3 — the AI prompt panel only renders states; validation and object
 * creation stay in the service and the reducer.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AiFurniturePanel } from './AiFurniturePanel';
import { getFurnitureParameters, updateFurnitureSpec } from '../scene/configurator';
import type { IntentGeneration } from '../ai/intent';
import type { SceneSpec } from '../scene/types';

function canonicalSpec(patch: Record<string, number | boolean>): SceneSpec {
  const defaults = getFurnitureParameters('desk.computer')?.defaults;
  const result = updateFurnitureSpec('desk.computer', defaults, patch);
  if (!result.ok) throw new Error('unexpected validation failure');
  return result.spec;
}

const SUCCESS: IntentGeneration = {
  kind: 'success',
  intent: {
    definitionId: 'desk.computer',
    patch: { width: 170 },
    language: 'uz',
    clarificationRequired: false,
  },
  spec: canonicalSpec({ width: 170 }),
  source: 'test-provider',
};

afterEach(() => {
  cleanup();
});

describe('AiFurniturePanel', () => {
  it('disables the submit button until a prompt is typed', () => {
    render(<AiFurniturePanel onCreate={() => {}} generate={async () => SUCCESS} />);

    const submit = screen.getByRole('button', { name: 'Yaratish' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Tavsif'), {
      target: { value: 'kompyuter stoli' },
    });
    expect(submit.disabled).toBe(false);
  });

  it('creates the object from a successful intent', async () => {
    const created: Array<{ definitionId: string; spec: SceneSpec }> = [];
    const prompts: string[] = [];
    render(
      <AiFurniturePanel
        onCreate={(definitionId, spec) => created.push({ definitionId, spec })}
        generate={async ({ prompt }) => {
          prompts.push(prompt);
          return SUCCESS;
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText('Tavsif'), {
      target: { value: '160 sm kenglikdagi kompyuter stoli' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Yaratish' }));

    expect(await screen.findByText('Kompyuter stoli sahnaga qo‘shildi.')).toBeTruthy();
    expect(prompts).toEqual(['160 sm kenglikdagi kompyuter stoli']);
    expect(created).toHaveLength(1);
    expect(created[0].definitionId).toBe('desk.computer');
    expect(created[0].spec.width).toBe(170);
  });

  it('shows a loading state and ignores a second submit', async () => {
    let resolve: (value: IntentGeneration) => void = () => {};
    let calls = 0;
    render(
      <AiFurniturePanel
        onCreate={() => {}}
        generate={() => {
          calls += 1;
          return new Promise<IntentGeneration>((done) => {
            resolve = done;
          });
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText('Tavsif'), { target: { value: 'kompyuter stoli' } });
    const submit = screen.getByRole('button', { name: 'Yaratish' });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(screen.getByRole('status').textContent).toContain('Tavsif tahlil qilinmoqda');
    expect((screen.getByRole('button', { name: 'Yaratilmoqda…' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    resolve(SUCCESS);
    await screen.findByText('Kompyuter stoli sahnaga qo‘shildi.');
    expect(calls).toBe(1);
  });

  it('shows a validation error and creates nothing', async () => {
    const created: unknown[] = [];
    render(
      <AiFurniturePanel
        onCreate={(...args) => created.push(args)}
        generate={async () => ({
          kind: 'error',
          message: 'width: legInset va legWidth stol chetidan chiqmasligi kerak.',
          code: 'invalid_spec',
          issues: [],
        })}
      />,
    );

    fireEvent.change(screen.getByLabelText('Tavsif'), { target: { value: '10 sm stol' } });
    fireEvent.click(screen.getByRole('button', { name: 'Yaratish' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('width');
    expect(created).toHaveLength(0);
  });

  it('asks a clarifying question and sends the answer with the prompt', async () => {
    const prompts: string[] = [];
    render(
      <AiFurniturePanel
        onCreate={() => {}}
        generate={async ({ prompt }) => {
          prompts.push(prompt);
          return prompts.length === 1
            ? { kind: 'clarification', question: 'Qaysi stol kerak?', language: 'uz', source: 't' }
            : SUCCESS;
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText('Tavsif'), { target: { value: 'stol yarat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Yaratish' }));

    expect(await screen.findByText('Qaysi stol kerak?')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Javob'), { target: { value: 'kompyuter stoli' } });
    fireEvent.click(screen.getByRole('button', { name: 'Yuborish' }));

    expect(await screen.findByText('Kompyuter stoli sahnaga qo‘shildi.')).toBeTruthy();
    expect(prompts[1]).toBe('stol yarat kompyuter stoli');
  });

  it('reports an unexpected service failure', async () => {
    render(
      <AiFurniturePanel
        onCreate={() => {}}
        generate={async () => {
          throw new Error('boom');
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText('Tavsif'), { target: { value: 'kompyuter stoli' } });
    fireEvent.click(screen.getByRole('button', { name: 'Yaratish' }));

    expect((await screen.findByRole('alert')).textContent).toContain('kutilmagan xatolik');
  });
});

describe('AiFurniturePanel - usage warnings', () => {
  it('keeps the created piece and warns about unusable usage data', async () => {
    const created: unknown[] = [];
    render(
      <AiFurniturePanel
        onCreate={(...args) => created.push(args)}
        generate={async () => ({ ...SUCCESS, usageError: 'invalid_usage_data' })}
      />,
    );

    fireEvent.change(screen.getByLabelText('Tavsif'), { target: { value: 'kompyuter stoli' } });
    fireEvent.click(screen.getByRole('button', { name: 'Yaratish' }));

    expect(await screen.findByText('Kompyuter stoli sahnaga qo‘shildi.')).toBeTruthy();
    expect(screen.getByText(/haqiqiy sarf 0 bo'lganini anglatmaydi/)).toBeTruthy();
    // The piece is still created: the warning never replaces the result.
    expect(created).toHaveLength(1);
  });

  it('shows no warning for a clean request', async () => {
    render(<AiFurniturePanel onCreate={() => {}} generate={async () => SUCCESS} />);

    fireEvent.change(screen.getByLabelText('Tavsif'), { target: { value: 'kompyuter stoli' } });
    fireEvent.click(screen.getByRole('button', { name: 'Yaratish' }));

    await screen.findByText('Kompyuter stoli sahnaga qo‘shildi.');
    expect(document.querySelector('.usage-warning')).toBeNull();
  });
});
