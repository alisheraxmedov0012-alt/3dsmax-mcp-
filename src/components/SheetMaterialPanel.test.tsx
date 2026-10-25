// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SheetMaterialPanel, type SheetMaterialPart } from './SheetMaterialPanel';
import type { SceneObject } from '../scene/types';
import { createFurnitureSceneObject } from '../scene/types';

const PARTS: SheetMaterialPart[] = [
  { partId: 'wardrobe-side', name: 'Yon paneli' },
  { partId: 'wardrobe-door', name: 'Eshik' },
];

function objectWith(sheetMaterials?: SceneObject['sheetMaterials']): SceneObject {
  const object = createFurnitureSceneObject('wardrobe', 'w-1');
  return sheetMaterials ? { ...object, sheetMaterials } : object;
}

function renderPanel(options: {
  object?: SceneObject | null;
  parts?: SheetMaterialPart[];
} = {}) {
  const onAssign = vi.fn();
  const onRemove = vi.fn();
  const object = options.object === undefined ? objectWith() : options.object;
  render(
    <SheetMaterialPanel
      object={object}
      parts={options.parts ?? PARTS}
      onAssign={onAssign}
      onRemove={onRemove}
    />,
  );
  return { onAssign, onRemove };
}

function partSelect(): HTMLSelectElement {
  return screen.getByLabelText('Detal') as HTMLSelectElement;
}
function materialSelect(): HTMLSelectElement {
  return screen.getByLabelText('Material') as HTMLSelectElement;
}
function thickness(): HTMLInputElement {
  return screen.getByLabelText('Nominal qalinlik (mm)') as HTMLInputElement;
}
function save(): HTMLButtonElement {
  return screen.getByRole('button', { name: /Saqlash|Yangilash/ }) as HTMLButtonElement;
}

afterEach(() => {
  cleanup();
});

describe('C3.1 — part selection', () => {
  it('lists the parts the model generates, by name and stable id', () => {
    renderPanel();
    const options = [...partSelect().options].map((option) => option.value);
    expect(options).toEqual(['wardrobe-side', 'wardrobe-door']);
    // The id is visible so it matches the BOM, cut list and PDF.
    expect(screen.getByRole('option', { name: /wardrobe-door/ })).toBeTruthy();
  });

  it('defaults to the first part and shows it has no material', () => {
    renderPanel();
    expect(partSelect().value).toBe('wardrobe-side');
    expect(screen.getByTestId('sheet-material-current').textContent).toContain(
      'material biriktirilmagan',
    );
  });

  it('shows an empty state when the model has no parts', () => {
    renderPanel({ parts: [] });
    const section = screen.getByTestId('sheet-material');
    expect(section.textContent).toContain('detal topilmadi');
    // No controls to assign against nothing.
    expect(screen.queryByLabelText('Detal')).toBeNull();
  });

  it('displays the stored assignment for the selected part', () => {
    renderPanel({
      object: objectWith([
        { partId: 'wardrobe-door', materialId: 'mdf', thicknessMm: 12, thicknessSource: 'user' },
      ]),
    });
    fireEvent.change(partSelect(), { target: { value: 'wardrobe-door' } });

    expect(screen.getByTestId('sheet-material-current').textContent).toContain('MDF');
    expect(screen.getByTestId('sheet-material-current').textContent).toContain('12 mm');
    // The form is pre-filled from storage, not from a default.
    expect(materialSelect().value).toBe('mdf');
    expect(thickness().value).toBe('12');
  });

  it('marks parts that already carry a material', () => {
    renderPanel({
      object: objectWith([
        { partId: 'wardrobe-door', materialId: 'mdf', thicknessMm: 12, thicknessSource: 'user' },
      ]),
    });
    const doorOption = screen.getByRole('option', { name: /wardrobe-door|Eshik/ });
    expect(doorOption.textContent).toContain('material bor');
  });
});

describe('C3.1 — assigning a material', () => {
  it('saves a valid assignment', () => {
    const { onAssign } = renderPanel();
    fireEvent.change(materialSelect(), { target: { value: 'ldsp' } });
    fireEvent.change(thickness(), { target: { value: '18' } });
    fireEvent.click(save());

    expect(onAssign).toHaveBeenCalledWith('wardrobe-side', 'ldsp', 18);
    expect(screen.getByRole('status').textContent).toContain('material saqlandi');
  });

  it('does not invent a thickness when the material is chosen', () => {
    const { onAssign } = renderPanel();
    fireEvent.change(materialSelect(), { target: { value: 'mdf' } });
    // No default thickness appears.
    expect(thickness().value).toBe('');

    fireEvent.click(save());
    expect(onAssign).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Qalinlikni kiriting');
  });

  it('refuses to save without a material', () => {
    const { onAssign } = renderPanel();
    fireEvent.change(thickness(), { target: { value: '18' } });
    fireEvent.click(save());

    expect(onAssign).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Material tanlanmagan');
  });

  it('edits an existing assignment instead of adding a second one', () => {
    const { onAssign } = renderPanel({
      object: objectWith([
        { partId: 'wardrobe-side', materialId: 'ldsp', thicknessMm: 18, thicknessSource: 'user' },
      ]),
    });
    expect(save().textContent).toBe('Yangilash');

    fireEvent.change(thickness(), { target: { value: '20' } });
    fireEvent.click(save());

    expect(onAssign).toHaveBeenCalledWith('wardrobe-side', 'ldsp', 20);
  });

  it('removes an assignment', () => {
    const { onRemove } = renderPanel({
      object: objectWith([
        { partId: 'wardrobe-side', materialId: 'ldsp', thicknessMm: 18, thicknessSource: 'user' },
      ]),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Olib tashlash' }));

    expect(onRemove).toHaveBeenCalledWith('wardrobe-side');
    expect(screen.getByRole('status').textContent).toContain('olib tashlandi');
  });

  it('disables removal when the part has no assignment', () => {
    renderPanel();
    expect(
      (screen.getByRole('button', { name: 'Olib tashlash' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('C3.1 — thickness validation', () => {
  const invalid: Array<[string, string, RegExp]> = [
    ['zero', '0', /noldan katta/i],
    ['negative', '-4', /noldan katta/i],
    ['above the limit', '61', /60 mm dan oshmasligi/i],
    ['empty', '', /kiriting/i],
  ];

  it.each(invalid)('rejects %s', (_label, value, message) => {
    const { onAssign } = renderPanel();
    fireEvent.change(materialSelect(), { target: { value: 'ldsp' } });
    fireEvent.change(thickness(), { target: { value } });
    fireEvent.click(save());

    expect(onAssign).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(message);
  });

  it('rejects a non-numeric value', () => {
    const { onAssign } = renderPanel();
    fireEvent.change(materialSelect(), { target: { value: 'ldsp' } });
    // A number input rejects letters; the empty result must still be refused.
    fireEvent.change(thickness(), { target: { value: 'abc' } });
    fireEvent.click(save());

    expect(onAssign).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('accepts the boundary value 60 mm', () => {
    const { onAssign } = renderPanel();
    fireEvent.change(materialSelect(), { target: { value: 'ldsp' } });
    fireEvent.change(thickness(), { target: { value: '60' } });
    fireEvent.click(save());

    expect(onAssign).toHaveBeenCalledWith('wardrobe-side', 'ldsp', 60);
  });

  it('marks the field invalid only while an error stands', () => {
    renderPanel();
    expect(thickness().getAttribute('aria-invalid')).toBe('false');
    fireEvent.click(save());
    expect(thickness().getAttribute('aria-invalid')).toBe('true');
  });

  it('keeps the stored value when the edit is cancelled', () => {
    renderPanel({
      object: objectWith([
        { partId: 'wardrobe-side', materialId: 'ldsp', thicknessMm: 18, thicknessSource: 'user' },
      ]),
    });
    fireEvent.change(thickness(), { target: { value: '25' } });
    expect(thickness().value).toBe('25');

    fireEvent.click(screen.getByRole('button', { name: 'Bekor qilish' }));
    expect(thickness().value).toBe('18');
    expect(materialSelect().value).toBe('ldsp');
  });

  it('does not carry a draft over when another part is selected', () => {
    renderPanel();
    fireEvent.change(materialSelect(), { target: { value: 'mdf' } });
    fireEvent.change(thickness(), { target: { value: '19' } });

    fireEvent.change(partSelect(), { target: { value: 'wardrobe-door' } });

    // The second part starts from its own (empty) stored state.
    expect(materialSelect().value).toBe('');
    expect(thickness().value).toBe('');
  });
});

describe('C3.1 — stale assignments', () => {
  it('reports an assignment whose part no longer exists', () => {
    renderPanel({
      object: objectWith([
        { partId: 'wardrobe-drawer', materialId: 'mdf', thicknessMm: 12, thicknessSource: 'user' },
      ]),
    });
    const stale = screen.getByTestId('sheet-material-stale');
    expect(stale.textContent).toContain('wardrobe-drawer');
    expect(stale.textContent).toContain('topilmagan');
  });

  it('can remove the stale assignment', () => {
    const { onRemove } = renderPanel({
      object: objectWith([
        { partId: 'wardrobe-drawer', materialId: 'mdf', thicknessMm: 12, thicknessSource: 'user' },
      ]),
    });
    fireEvent.click(screen.getByRole('button', { name: /wardrobe-drawer — olib tashlash/ }));
    expect(onRemove).toHaveBeenCalledWith('wardrobe-drawer');
  });

  it('shows no stale block when everything matches', () => {
    renderPanel({
      object: objectWith([
        { partId: 'wardrobe-side', materialId: 'ldsp', thicknessMm: 18, thicknessSource: 'user' },
      ]),
    });
    expect(screen.queryByTestId('sheet-material-stale')).toBeNull();
  });
});

describe('C3.1 — accessibility', () => {
  it('labels every control and its unit', () => {
    renderPanel();
    expect(screen.getByLabelText('Detal')).toBeTruthy();
    expect(screen.getByLabelText('Material')).toBeTruthy();
    // The unit is part of the accessible name, not just a suffix in the layout.
    expect(screen.getByLabelText('Nominal qalinlik (mm)')).toBeTruthy();
  });

  it('describes the thickness field with its accepted range', () => {
    renderPanel();
    const describedBy = thickness().getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const hint = document.getElementById(describedBy as string);
    expect(hint?.textContent).toContain('60');
  });

  it('announces success without relying on colour', () => {
    renderPanel();
    fireEvent.change(materialSelect(), { target: { value: 'ldsp' } });
    fireEvent.change(thickness(), { target: { value: '18' } });
    fireEvent.click(save());

    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBeTruthy();
  });

  it('exposes errors as alerts next to the controls', () => {
    renderPanel();
    fireEvent.click(save());
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/tanlanmagan|kiriting/i);
  });
});
