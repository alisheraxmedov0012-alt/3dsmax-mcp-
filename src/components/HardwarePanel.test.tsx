// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HardwarePanel } from './HardwarePanel';
import { buildBom } from '../manufacturing/bom';
import { buildFurnitureAssemblyPlan } from '../manufacturing/assemblyInstructions';
import { validateManufacturing } from '../manufacturing/validation';
import { createTableSceneObject } from '../scene/types';
import type { HardwareItem } from '../manufacturing/hardware';

afterEach(cleanup);

function planForTable() {
  const object = createTableSceneObject('t1');
  const bom = buildBom(object.type, object.params);
  if (!bom.ok) throw new Error(bom.reason);
  return buildFurnitureAssemblyPlan({
    bom: bom.bom,
    validation: validateManufacturing(object.type, object.params),
  });
}

const NO_HARDWARE: HardwareItem[] = [];

function Harness({ initial = NO_HARDWARE }: { initial?: HardwareItem[] }) {
  const [hardware, setHardware] = useState<HardwareItem[]>(initial);
  return (
    <HardwarePanel hardware={hardware} steps={planForTable().steps} onChange={setHardware} />
  );
}

describe('C6 hardware UI', () => {
  it('adds, edits and deletes a row with a step link', () => {
    render(<Harness />);
    expect(screen.getByTestId('hardware-empty')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Nomi'), { target: { value: 'Konfirmat' } });
    fireEvent.change(screen.getByLabelText('O‘lcham / model (ixtiyoriy)'), {
      target: { value: '4×40 mm' },
    });
    fireEvent.change(screen.getByLabelText('Miqdor (ixtiyoriy)'), { target: { value: '12' } });
    fireEvent.click(screen.getByLabelText('1. Oyoqlar qadamiga bog\'lash'));
    fireEvent.click(screen.getByTestId('hardware-save'));

    const list = screen.getByTestId('hardware-list');
    expect(list.textContent).toContain('Konfirmat');
    expect(list.textContent).toContain('12 pcs');
    expect(list.textContent).toContain('qadamlar: 1. Oyoqlar');

    fireEvent.click(screen.getByText('Tahrirlash'));
    fireEvent.change(screen.getByLabelText('Miqdor (ixtiyoriy)'), { target: { value: '20' } });
    fireEvent.click(screen.getByTestId('hardware-save'));
    expect(screen.getByTestId('hardware-list').textContent).toContain('20 pcs');

    fireEvent.click(screen.getByText('O‘chirish'));
    expect(screen.getByTestId('hardware-empty')).toBeTruthy();
  });

  it('rejects an empty name and a non-positive quantity', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('hardware-save'));
    expect(screen.getByTestId('hardware-error').textContent).toMatch(/nomini kiriting/i);

    fireEvent.change(screen.getByLabelText('Nomi'), { target: { value: 'Vint' } });
    fireEvent.change(screen.getByLabelText('Miqdor (ixtiyoriy)'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('hardware-save'));
    expect(screen.getByTestId('hardware-error').textContent).toMatch(/musbat son/i);
  });

  it('labels an old numeric link as legacy instead of silently remapping it', () => {
    render(
      <Harness
        initial={[
          {
            kind: 'screw',
            name: 'Eski vint',
            quantity: 4,
            unit: 'pcs',
            size: null,
            stepIds: ['step-1'],
          },
        ]}
      />,
    );
    expect(screen.getByTestId('hardware-list').textContent).toMatch(/eski formatdagi qadam/);
    expect(screen.getByTestId('hardware-list').textContent).toMatch(/qayta bog‘lang/);
  });

  it('counts a row once even when it is linked to two steps', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Nomi'), { target: { value: 'Konfirmat' } });
    fireEvent.change(screen.getByLabelText('Miqdor (ixtiyoriy)'), { target: { value: '12' } });
    fireEvent.click(screen.getByLabelText('1. Oyoqlar qadamiga bog\'lash'));
    fireEvent.click(screen.getByLabelText('2. Ustki panel qadamiga bog\'lash'));
    fireEvent.click(screen.getByTestId('hardware-save'));

    const list = screen.getByTestId('hardware-list');
    expect(list.textContent).toContain('qadamlar: 1. Oyoqlar, 2. Ustki panel');
    expect(list.textContent).toContain('12 pcs');
  });
});
