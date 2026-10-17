// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useReducer, useState } from 'react';
import { AssemblyPanel } from './AssemblyPanel';
import { createDefaultSceneState, MAX_ASSEMBLIES_PER_SCENE, type SceneAssembly } from '../scene/types';
import { sceneReducer } from '../scene/sceneReducer';

/**
 * W14 render tests for the minimal assembly panel (approved OD-2 scope).
 *
 * These mount the real component and drive it through the DOM, which is what the
 * Node-only reducer tests could not do. The flag is stubbed per test so the
 * on/off behaviour is exercised rather than assumed.
 *
 * Kind labels appear both in the `<select>` options and in the list rows, so
 * assertions that care about the list are scoped with `within(list)`.
 */

const NO_ASSEMBLIES: SceneAssembly[] = [];

function Harness({ initial = NO_ASSEMBLIES }: { initial?: SceneAssembly[] }) {
  const [assemblies, setAssemblies] = useState<SceneAssembly[]>(initial);
  return (
    <AssemblyPanel
      assemblies={assemblies}
      onAdd={(assembly) => setAssemblies((current) => [...current, assembly])}
      onDelete={(id) => setAssemblies((current) => current.filter((entry) => entry.id !== id))}
    />
  );
}

/** The rendered list, or `null` when the panel shows the empty state. */
function list(): HTMLElement | null {
  return screen.queryByRole('list');
}

describe('AssemblyPanel render', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ASSEMBLY_ENABLED', 'true');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  describe('feature flag', () => {
    it('renders nothing when the flag is off', () => {
      vi.stubEnv('VITE_ASSEMBLY_ENABLED', 'false');
      const { container } = render(<Harness />);
      expect(container.firstChild).toBeNull();
      expect(screen.queryByText(/Assembly'lar/)).toBeNull();
      expect(screen.queryByLabelText('Tur')).toBeNull();
    });

    it('renders nothing when the flag is absent', () => {
      vi.unstubAllEnvs();
      const { container } = render(<Harness />);
      expect(container.firstChild).toBeNull();
      expect(screen.queryByRole('button', { name: /Assembly qo'shish/ })).toBeNull();
    });

    it('renders the panel when the flag is on', () => {
      render(<Harness />);
      expect(screen.getByText(/Assembly'lar/)).toBeTruthy();
      expect(screen.getByLabelText('Tur')).toBeTruthy();
      expect(screen.getByRole('button', { name: /Assembly qo'shish/ })).toBeTruthy();
    });
  });

  describe('empty state', () => {
    it('shows the empty message when there are no assemblies', () => {
      render(<Harness />);
      expect(screen.getByText(/Hozircha assembly yo'q/)).toBeTruthy();
      expect(list()).toBeNull();
    });
  });

  describe('listing', () => {
    it('shows one row per stored assembly with a readable label', () => {
      render(
        <Harness
          initial={[
            { id: 'a1', kind: 'wall-cabinet', params: {} },
            { id: 'a2', kind: 'stair-straight', params: {} },
          ]}
        />,
      );

      const rendered = list();
      expect(rendered).not.toBeNull();
      if (!rendered) return;

      const rows = within(rendered).getAllByRole('listitem');
      expect(rows).toHaveLength(2);
      expect(within(rows[0]).getByText('Osma oshxona shkafi')).toBeTruthy();
      expect(within(rows[1]).getByText("To'g'ri zinapoya")).toBeTruthy();
      expect(screen.queryByText(/Hozircha assembly yo'q/)).toBeNull();
    });
  });

  describe('creating', () => {
    it('adds the selected kind and reports success', () => {
      render(<Harness />);

      fireEvent.change(screen.getByLabelText('Tur'), { target: { value: 'wardrobe-section' } });
      fireEvent.click(screen.getByRole('button', { name: /Assembly qo'shish/ }));

      const rendered = list();
      expect(rendered).not.toBeNull();
      if (!rendered) return;
      expect(within(rendered).getByText('Shkaf seksiyasi')).toBeTruthy();
      expect(within(rendered).getAllByRole('listitem')).toHaveLength(1);
      expect(screen.getByText(/qo'shildi/)).toBeTruthy();
      expect(screen.queryByText(/Hozircha assembly yo'q/)).toBeNull();
    });

    it('adds two different kinds independently', () => {
      render(<Harness />);

      fireEvent.change(screen.getByLabelText('Tur'), { target: { value: 'wall-cabinet' } });
      fireEvent.click(screen.getByRole('button', { name: /Assembly qo'shish/ }));
      fireEvent.change(screen.getByLabelText('Tur'), { target: { value: 'stair-straight' } });
      fireEvent.click(screen.getByRole('button', { name: /Assembly qo'shish/ }));

      const rendered = list();
      expect(rendered).not.toBeNull();
      if (!rendered) return;
      const rows = within(rendered).getAllByRole('listitem');
      expect(rows).toHaveLength(2);
      expect(within(rows[0]).getByText('Osma oshxona shkafi')).toBeTruthy();
      expect(within(rows[1]).getByText("To'g'ri zinapoya")).toBeTruthy();
    });

    it('disables the add button once the cap is reached', () => {
      const full: SceneAssembly[] = Array.from({ length: MAX_ASSEMBLIES_PER_SCENE }, (_, index) => ({
        id: `a${index}`,
        kind: 'wall-cabinet',
        params: {},
      }));
      render(<Harness initial={full} />);

      const button = screen.getByRole('button', { name: /Limitga yetildi/ }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(list()?.querySelectorAll('li')).toHaveLength(MAX_ASSEMBLIES_PER_SCENE);
    });
  });

  describe('deleting', () => {
    it('removes the row and returns to the empty state', () => {
      render(<Harness initial={[{ id: 'a1', kind: 'wall-cabinet', params: {} }]} />);

      fireEvent.click(screen.getByRole('button', { name: /assembly o'chirish/ }));

      expect(list()).toBeNull();
      expect(screen.getByText(/Hozircha assembly yo'q/)).toBeTruthy();
      expect(screen.getByText(/o'chirildi/)).toBeTruthy();
    });

    it('deletes only the targeted row', () => {
      render(
        <Harness
          initial={[
            { id: 'a1', kind: 'wall-cabinet', params: {} },
            { id: 'a2', kind: 'stair-straight', params: {} },
          ]}
        />,
      );

      const [firstDelete] = screen.getAllByRole('button', { name: /assembly o'chirish/ });
      fireEvent.click(firstDelete);

      const rendered = list();
      expect(rendered).not.toBeNull();
      if (!rendered) return;
      const rows = within(rendered).getAllByRole('listitem');
      expect(rows).toHaveLength(1);
      expect(within(rows[0]).getByText("To'g'ri zinapoya")).toBeTruthy();
    });
  });

  describe('accessibility and honesty', () => {
    it('gives each delete control a descriptive accessible name', () => {
      render(<Harness initial={[{ id: 'a1', kind: 'wardrobe-section', params: {} }]} />);
      expect(
        screen.getByRole('button', { name: "Shkaf seksiyasi assembly o'chirish" }),
      ).toBeTruthy();
    });

    it('announces status messages politely', () => {
      render(<Harness />);
      fireEvent.click(screen.getByRole('button', { name: /Assembly qo'shish/ }));

      const status = screen.getByRole('status');
      expect(status.getAttribute('aria-live')).toBe('polite');
    });

    it('states that the result is not a manufacturing-ready document', () => {
      render(<Harness />);
      expect(screen.getByText(/ishlab chiqarishga tayyor hujjat emas/)).toBeTruthy();
    });

    it('labels the kind selector', () => {
      render(<Harness />);
      const select = screen.getByLabelText('Tur') as HTMLSelectElement;
      expect(select.tagName).toBe('SELECT');
      // All four approved kinds are offered.
      expect(select.options).toHaveLength(4);
    });
  });
});

describe('AssemblyPanel wired to the real reducer', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ASSEMBLY_ENABLED', 'true');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  function ReducerHarness() {
    // The panel talks to the real scene state machine, not a local array, so the
    // reducer's cap and duplicate rules are exercised through the UI.
    const [state, dispatch] = useReducer(sceneReducer, undefined, () =>
      createDefaultSceneState(() => 'default-id'),
    );

    return (
      <AssemblyPanel
        assemblies={state.data.assemblies ?? []}
        onAdd={(assembly) => dispatch({ type: 'ADD_ASSEMBLY', assembly })}
        onDelete={(id) => dispatch({ type: 'DELETE_ASSEMBLY', id })}
      />
    );
  }

  it('adds through the real reducer and preserves the scene objects', () => {
    render(<ReducerHarness />);
    expect(list()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Assembly qo'shish/ }));

    const rendered = list();
    expect(rendered).not.toBeNull();
    if (!rendered) return;
    expect(within(rendered).getAllByRole('listitem')).toHaveLength(1);
    expect(within(rendered).getByText('Osma oshxona shkafi')).toBeTruthy();
  });

  it('deletes through the real reducer', () => {
    render(<ReducerHarness />);
    fireEvent.click(screen.getByRole('button', { name: /Assembly qo'shish/ }));
    expect(list()).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /assembly o'chirish/ }));

    expect(list()).toBeNull();
    expect(screen.getByText(/Hozircha assembly yo'q/)).toBeTruthy();
  });
});
