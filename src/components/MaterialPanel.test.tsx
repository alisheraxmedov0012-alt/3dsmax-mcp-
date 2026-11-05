// @vitest-environment jsdom
import { useReducer } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MaterialPanel } from './MaterialPanel';
import {
  createDefaultSceneState,
  createFurnitureSceneObject,
  type SceneObject,
} from '../scene/types';
import { sceneReducer } from '../scene/sceneReducer';
import { MATERIAL_CATALOG } from '../materials/library';

function objectWith(materialId?: string): SceneObject {
  const object = createFurnitureSceneObject('table', 'obj-1');
  return {
    ...object,
    material: {
      ...object.material,
      ...(materialId === undefined ? {} : { materialId }),
    },
  };
}

function renderPanel(object: SceneObject | null) {
  const onMaterial = vi.fn();
  const onApplyPreset = vi.fn();
  const onMaterialMap = vi.fn();
  const onReset = vi.fn();
  const view = render(
    <MaterialPanel
      object={object}
      onMaterial={onMaterial}
      onApplyPreset={onApplyPreset}
      onMaterialMap={onMaterialMap}
      onReset={onReset}
    />,
  );
  return { ...view, onMaterial, onApplyPreset, onMaterialMap, onReset };
}

function card(id: string): HTMLElement {
  return screen.getByTestId(`material-card-${id}`);
}

afterEach(() => {
  cleanup();
});

describe('material library panel', () => {
  it('shows an empty state and no controls when no object is selected', () => {
    renderPanel(null);
    expect(screen.getByTestId('material-empty').textContent).toContain('mebelni tanlang');
    expect(screen.queryByLabelText('Qidirish')).toBeNull();
    expect(screen.queryByTestId('material-grid')).toBeNull();
  });

  it('renders the whole built-in catalogue as swatch cards', () => {
    renderPanel(objectWith());
    expect(screen.getAllByTestId(/^material-card-/)).toHaveLength(MATERIAL_CATALOG.length);
    expect(MATERIAL_CATALOG.length).toBeGreaterThanOrEqual(24);
    expect(screen.getByTestId('material-result-count').textContent).toContain(
      String(MATERIAL_CATALOG.length),
    );
  });

  it('shows the selected object\u2019s own preset, not a stale local choice', () => {
    const { rerender, onApplyPreset } = renderPanel(objectWith('wood-oak'));

    expect(screen.getByTestId('material-current').textContent).toContain('eman');
    expect(card('wood-oak').getAttribute('aria-pressed')).toBe('true');
    expect(card('metal-chrome').getAttribute('aria-pressed')).toBe('false');

    rerender(
      <MaterialPanel
        object={objectWith('metal-chrome')}
        onMaterial={vi.fn()}
        onApplyPreset={onApplyPreset}
        onMaterialMap={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(screen.getByTestId('material-current').textContent).toContain('xrom');
    expect(card('metal-chrome').getAttribute('aria-pressed')).toBe('true');
    expect(card('wood-oak').getAttribute('aria-pressed')).toBe('false');
  });

  it('applies the clicked material to the object', () => {
    const { onApplyPreset, onMaterial } = renderPanel(objectWith('wood-oak'));
    fireEvent.click(card('plastic-glossy'));

    expect(onApplyPreset).toHaveBeenCalledWith('plastic-glossy');
    expect(onMaterial).not.toHaveBeenCalled();
  });

  it('filters by category', () => {
    renderPanel(objectWith());
    const group = screen.getByRole('group', { name: 'Material kategoriyalari' });
    fireEvent.click(within(group).getByRole('button', { name: /^Metall/ }));

    const visibleCards = screen.getAllByTestId(/^material-card-/);
    expect(visibleCards).toHaveLength(MATERIAL_CATALOG.filter((e) => e.category === 'metal').length);
    for (const element of visibleCards) {
      expect(element.getAttribute('data-material-id')?.startsWith('metal-')).toBe(true);
    }
    expect(screen.getByTestId('material-result-count').textContent).toContain(
      String(visibleCards.length),
    );
  });

  it('searches by label, id and natural spelling', () => {
    renderPanel(objectWith());
    const search = screen.getByLabelText('Qidirish');

    fireEvent.change(search, { target: { value: 'XROM' } });
    expect(screen.getAllByTestId(/^material-card-/)).toHaveLength(1);
    expect(card('metal-chrome')).toBeTruthy();

    fireEvent.change(search, { target: { value: 'yogoch' } });
    const woodCards = screen.getAllByTestId(/^material-card-/);
    expect(woodCards).toHaveLength(MATERIAL_CATALOG.filter((e) => e.category === 'wood').length);

    fireEvent.change(search, { target: { value: 'carbon-fibre' } });
    expect(screen.queryByTestId('material-grid')).toBeNull();
    expect(screen.getByTestId('material-no-results')).toBeTruthy();
  });

  it('combines search with the active category', () => {
    renderPanel(objectWith());
    const group = screen.getByRole('group', { name: 'Material kategoriyalari' });
    fireEvent.click(within(group).getByRole('button', { name: /^Shisha/ }));
    fireEvent.change(screen.getByLabelText('Qidirish'), { target: { value: 'tusli' } });

    expect(screen.getAllByTestId(/^material-card-/)).toHaveLength(1);
    expect(card('glass-tinted')).toBeTruthy();
  });

  it('keeps the sliders wired to the existing material update path', () => {
    const { onMaterial } = renderPanel(objectWith('wood-oak'));
    fireEvent.change(screen.getByLabelText(/Silliqlik/), { target: { value: '0.4' } });
    expect(onMaterial).toHaveBeenCalledWith({ roughness: 0.4 });
  });

  it('resets the material through the existing callback', () => {
    const { onReset } = renderPanel(objectWith('wood-oak'));
    fireEvent.click(screen.getByRole('button', { name: 'Materialni tiklash' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

describe('material selection updates the real scene object', () => {
  function Harness() {
    const [state, dispatch] = useReducer(sceneReducer, undefined, () =>
      createDefaultSceneState(() => 'obj-1'),
    );
    const object = state.data.objects[0];
    return (
      <>
        <MaterialPanel
          object={object}
          onMaterial={(patch) =>
            dispatch({ type: 'UPDATE_MATERIAL', id: object.id, material: patch })
          }
          onApplyPreset={(presetId) =>
            dispatch({ type: 'APPLY_MATERIAL_PRESET', id: object.id, presetId })
          }
          onMaterialMap={(role, ref) =>
            dispatch({ type: 'SET_MATERIAL_MAP', id: object.id, role, ref })
          }
          onReset={() => dispatch({ type: 'RESET_MATERIAL', id: object.id })}
        />
        <output data-testid="stored-material">{object.material.materialId ?? 'none'}</output>
        <output data-testid="stored-color">{object.params.color}</output>
      </>
    );
  }

  it('stores the chosen preset and reflects it back in the panel', () => {
    render(<Harness />);
    expect(screen.getByTestId('stored-material').textContent).toBe('none');

    fireEvent.click(card('wood-walnut'));

    expect(screen.getByTestId('stored-material').textContent).toBe('wood-walnut');
    expect(screen.getByTestId('stored-color').textContent).toBe('#5a3a28');
    expect(screen.getByTestId('material-current').textContent).toContain('yong');
    expect(card('wood-walnut').getAttribute('aria-pressed')).toBe('true');
  });

  it('moves the highlight when another material is applied', () => {
    render(<Harness />);
    fireEvent.click(card('wood-walnut'));
    fireEvent.click(card('glass-frosted'));

    expect(screen.getByTestId('stored-material').textContent).toBe('glass-frosted');
    expect(card('glass-frosted').getAttribute('aria-pressed')).toBe('true');
    expect(card('wood-walnut').getAttribute('aria-pressed')).toBe('false');
  });
});
