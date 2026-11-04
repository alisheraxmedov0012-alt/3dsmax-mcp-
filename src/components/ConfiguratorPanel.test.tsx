// @vitest-environment jsdom
/**
 * Stage 3.2 — universal configurator UI.
 *
 * The harness wires the panel to the real reducer, so every committed edit goes
 * through updateFurnitureSpec → UPDATE_SPEC exactly like the app does.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useReducer } from 'react';
import { ConfiguratorPanel } from './ConfiguratorPanel';
import { ObjectPanel } from './ObjectPanel';
import { getFurnitureParameters } from '../scene/configurator';
import { registerFurnitureDefinition } from '../geometry/universal';
import { sceneReducer } from '../scene/sceneReducer';
import { createDefaultSettings } from '../scene/sceneSettings';
import {
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  createUniversalSceneObject,
  type SceneObject,
  type SceneSpec,
  type SceneState,
} from '../scene/types';

const DEFINITION_IDS = [
  'desk.computer',
  'desk.gaming',
  'table.dining',
  'desk.writing',
  'chair.office',
  'chair.dining',
  'chair.armchair',
  'chair.ergonomic',
  'sofa.standard',
  'cabinet.standard',
  'bed.standard',
  'kitchen.baseCabinet',
  'stand.tv',
] as const;

function Harness({ initial }: { initial: SceneObject }) {
  const [scene, dispatch] = useReducer(
    sceneReducer,
    {
      data: {
        schemaVersion: SCENE_SCHEMA_VERSION,
        room: { widthCm: 400, lengthCm: 500, heightCm: 280 },
        objects: [initial],
        settings: createDefaultSettings(),
      },
      selectedId: initial.id,
    } satisfies SceneState,
  );

  const object = scene.data.objects[0];
  return (
    <>
      <ConfiguratorPanel
        object={object}
        onApplySpec={(spec: SceneSpec) =>
          dispatch({ type: 'UPDATE_SPEC', id: object.id, spec })
        }
      />
      <output data-testid="spec">{JSON.stringify(object.spec)}</output>
      <output data-testid="params">{JSON.stringify(object.params)}</output>
    </>
  );
}

function storedSpec(): Record<string, string | number | boolean> {
  return JSON.parse(screen.getByTestId('spec').textContent ?? '{}');
}

function renderUniversal(definitionId: string, spec?: unknown): SceneObject {
  const object = createUniversalSceneObject(definitionId, 'u1', spec);
  render(<Harness initial={object} />);
  return object;
}

afterEach(() => {
  cleanup();
});

describe('ConfiguratorPanel visibility', () => {
  it('renders nothing without a universal selection', () => {
    const { container } = render(<ConfiguratorPanel object={null} onApplySpec={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing for a legacy object and leaves the legacy panel working', () => {
    const legacy = createFurnitureSceneObject('table', 'legacy');
    const { container } = render(
      <>
        <ConfiguratorPanel object={legacy} onApplySpec={() => {}} />
        <ObjectPanel
          object={legacy}
          onTransform={() => {}}
          onRename={() => {}}
          onToggleVisibility={() => {}}
          onDelete={() => {}}
          onPlaceAgainstWall={() => {}}
        />
      </>,
    );

    expect(container.querySelector('.configurator')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Obyekt' })).toBeTruthy();
    expect(screen.getByLabelText('Nomi')).toBeTruthy();
  });
});

describe.each(DEFINITION_IDS)('ConfiguratorPanel for %s', (definitionId) => {
  it('renders every declared parameter with the right control', () => {
    renderUniversal(definitionId);
    const parameters = getFurnitureParameters(definitionId);
    if (!parameters) throw new Error(`no parameters for ${definitionId}`);

    const numbers = parameters.parameters.filter((entry) => entry.kind === 'number');
    const toggles = parameters.parameters.filter((entry) => entry.kind === 'boolean');

    expect(screen.getByRole('heading', { name: 'Konfigurator' })).toBeTruthy();
    const meta = document.querySelector('.configurator__meta')?.textContent ?? '';
    expect(meta).toContain(parameters.label);
    expect(meta).toContain(`${parameters.parameters.length} parametr`);
    expect(document.querySelectorAll('input[type="number"]')).toHaveLength(numbers.length);
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(toggles.length);

    for (const parameter of numbers.slice(0, 3)) {
      expect(screen.getByLabelText(parameter.label, { exact: false })).toBeTruthy();
    }
  });
});

describe('ConfiguratorPanel editing', () => {
  it('commits a number on blur through UPDATE_SPEC', () => {
    renderUniversal('desk.computer');
    const before = storedSpec();
    const paramsBefore = screen.getByTestId('params').textContent;

    const width = screen.getByLabelText('Kenglik (sm)');
    fireEvent.change(width, { target: { value: '170' } });
    fireEvent.blur(width);

    const after = storedSpec();
    expect(after.width).toBe(170);
    expect(before.width).toBe(160);
    // Legacy params are untouched — the spec drives the geometry.
    expect(screen.getByTestId('params').textContent).toBe(paramsBefore);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('commits a number with Enter', () => {
    renderUniversal('desk.computer');
    const width = screen.getByLabelText('Kenglik (sm)');

    fireEvent.change(width, { target: { value: '165' } });
    fireEvent.keyDown(width, { key: 'Enter' });

    expect(storedSpec().width).toBe(165);
  });

  it('toggles a boolean parameter immediately', () => {
    renderUniversal('desk.computer');
    expect(storedSpec().drawerEnabled).toBe(true);

    fireEvent.click(screen.getByLabelText('Tortma'));

    expect(storedSpec().drawerEnabled).toBe(false);
  });

  it('keeps the scene untouched and explains an empty value', () => {
    renderUniversal('desk.computer');
    const before = storedSpec();
    const width = screen.getByLabelText('Kenglik (sm)');

    fireEvent.change(width, { target: { value: '' } });
    fireEvent.blur(width);

    expect(storedSpec()).toEqual(before);
    expect(screen.getByRole('alert').textContent).toBe('Qiymat kiriting.');
    expect(width.getAttribute('aria-invalid')).toBe('true');
  });

  it('rejects a decimal where an integer is required', () => {
    renderUniversal('bed.standard');
    const before = storedSpec();
    const slats = screen.getByLabelText('Slatlar soni');

    fireEvent.change(slats, { target: { value: '14.5' } });
    fireEvent.blur(slats);

    expect(storedSpec()).toEqual(before);
    expect(screen.getByRole('alert').textContent).toBe('Butun son kiriting.');
  });

  it('rejects a value the definition parser refuses and keeps the last valid spec', () => {
    renderUniversal('desk.computer');
    const before = storedSpec();
    const width = screen.getByLabelText('Kenglik (sm)');

    // Narrower than the legs require.
    fireEvent.change(width, { target: { value: '10' } });
    fireEvent.blur(width);

    expect(storedSpec()).toEqual(before);
    expect(screen.getByRole('alert').textContent).toContain('width');
  });

  it('recovers after a rejected value', () => {
    renderUniversal('desk.computer');
    const width = screen.getByLabelText('Kenglik (sm)');

    fireEvent.change(width, { target: { value: '10' } });
    fireEvent.blur(width);
    expect(screen.getByRole('alert')).toBeTruthy();

    fireEvent.change(width, { target: { value: '150' } });
    fireEvent.blur(width);

    expect(storedSpec().width).toBe(150);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not resend a value that did not change', () => {
    renderUniversal('desk.computer');
    const before = screen.getByTestId('spec').textContent;
    const width = screen.getByLabelText('Kenglik (sm)');

    fireEvent.change(width, { target: { value: '160' } });
    fireEvent.blur(width);

    expect(screen.getByTestId('spec').textContent).toBe(before);
  });
});

describe('ConfiguratorPanel presets', () => {
  it('applies a preset, validates it and refreshes the inputs', () => {
    renderUniversal('desk.computer');
    expect(screen.getByRole('button', { name: 'Standart' }).getAttribute('aria-pressed')).toBe(
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ixcham' }));

    expect(storedSpec().width).toBe(120);
    expect(storedSpec().depth).toBe(70);
    expect((screen.getByLabelText('Kenglik (sm)') as HTMLInputElement).value).toBe('120');
    expect(screen.getByRole('button', { name: 'Ixcham' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('marks a manual edit as Custom and keeps it when Custom is clicked', () => {
    renderUniversal('desk.computer');
    const width = screen.getByLabelText('Kenglik (sm)');

    fireEvent.change(width, { target: { value: '171' } });
    fireEvent.blur(width);

    expect(screen.getByRole('button', { name: 'Custom' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    const custom = storedSpec();

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));

    expect(storedSpec()).toEqual(custom);
  });

  it('only offers presets of the selected definition', () => {
    renderUniversal('bed.standard');

    expect(screen.getByRole('button', { name: 'Standart' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ixcham' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keng' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Ixcham' }));

    // Bed compact: width 140 and the headboard narrowed with it.
    expect(storedSpec().width).toBe(140);
    expect(storedSpec().headboardWidth).toBe(140);
  });
});

describe('ConfiguratorPanel with a string parameter', () => {
  // Definition metadata is the only source of controls, so a definition with a
  // string channel must render a text input even though the 13 built-ins do not
  // declare one yet.
  registerFurnitureDefinition({
    id: 'test.textField',
    version: 1,
    family: 'table',
    label: 'Test (matn)',
    fields: [
      { key: 'width', label: 'Kenglik (sm)', kind: 'number' },
      { key: 'engraving', label: 'Yozuv', kind: 'string' },
    ],
    defaults: { width: 100, engraving: '' },
    slots: [
      {
        id: 'body',
        label: 'Korpus',
        color: '#a9744f',
        materialId: 'wood-oak',
        groupName: 'text-body',
      },
    ],
    limits: { maxParts: 4, maxPartVertices: 4096, maxPartTriangles: 4096, maxTotalVertices: 8192 },
    parseSpec: (input) => {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return { ok: false, errors: ['Spec obyekt bo‘lishi kerak.'] };
      }
      const record = input as Record<string, unknown>;
      if (typeof record.width !== 'number' || !Number.isFinite(record.width) || record.width <= 0) {
        return { ok: false, errors: ['width: musbat son bo‘lishi kerak.'] };
      }
      if (typeof record.engraving !== 'string' || record.engraving.length > 40) {
        return { ok: false, errors: ['engraving: 40 belgidan oshmasligi kerak.'] };
      }
      return { ok: true, spec: { width: record.width, engraving: record.engraving } };
    },
    solve: (spec) => ({
      parts: [
        {
          id: 'body',
          type: 'panel',
          role: 'panel',
          dimensions: { width: spec.width, height: 2, depth: 60 },
          geometry: { kind: 'box', width: spec.width, height: 2, depth: 60 },
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          materialSlot: 'body',
        },
      ],
      connections: [],
    }),
  });

  it('renders a text input and commits it', () => {
    renderUniversal('test.textField');
    const input = screen.getByLabelText('Yozuv');

    fireEvent.change(input, { target: { value: 'Ali' } });
    fireEvent.blur(input);

    expect(storedSpec().engraving).toBe('Ali');
  });

  it('keeps the scene when the parser refuses the text', () => {
    renderUniversal('test.textField');
    const before = storedSpec();
    const input = screen.getByLabelText('Yozuv');

    fireEvent.change(input, { target: { value: 'x'.repeat(41) } });
    fireEvent.blur(input);

    expect(storedSpec()).toEqual(before);
    expect(screen.getByRole('alert').textContent).toContain('engraving');
  });
});

describe('ConfiguratorPanel mobile ergonomics', () => {
  it('exposes labelled controls with the mobile keyboard hints', () => {
    renderUniversal('desk.computer');

    const root = document.querySelector('.configurator');
    expect(root).not.toBeNull();
    expect(root?.querySelector('.configurator__presets')).not.toBeNull();

    const width = screen.getByLabelText('Kenglik (sm)') as HTMLInputElement;
    expect(width.type).toBe('number');
    expect(width.inputMode).toBe('decimal');
  });

  it('uses the numeric keyboard for integer parameters', () => {
    renderUniversal('bed.standard');
    const slats = screen.getByLabelText('Slatlar soni') as HTMLInputElement;
    expect(slats.inputMode).toBe('numeric');
    expect(slats.step).toBe('1');
  });

  it('keeps every panel button non-submitting', () => {
    renderUniversal('desk.computer');
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.getAttribute('type')).toBe('button');
    }
  });
});
