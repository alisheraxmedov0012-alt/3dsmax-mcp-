// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PrintReadinessPanel } from './PrintReadinessPanel';
import { createTableSceneObject } from '../scene/types';

afterEach(cleanup);

describe('B1/B3 — print readiness panel', () => {
  it('reports a closed table and keeps unverified checks visible', () => {
    render(<PrintReadinessPanel object={createTableSceneObject('t1')} />);
    expect(screen.getByTestId('print-watertight').textContent).toMatch(/tekshiruvidan o'tdi/i);
    expect(screen.getByTestId('print-metrics').textContent).toMatch(/1200 × 750 × 600 mm/);
    expect(screen.getByTestId('print-limitations').textContent).toMatch(/devor qalinligi/i);
    expect(screen.getByTestId('print-limitations').textContent).toMatch(/slicer/i);
  });

  it('asks for a selection when there is no object', () => {
    render(<PrintReadinessPanel object={null} />);
    expect(screen.getByTestId('print-readiness').textContent).toMatch(/mebelni tanlang/i);
  });
});

describe('B3 panel — profile and actionable checks', () => {
  function wallInput(): HTMLInputElement {
    return screen.getByLabelText('Minimal devor (mm)') as HTMLInputElement;
  }

  function volumeInputs(): HTMLInputElement[] {
    return [
      screen.getByLabelText('Build volume X (mm)') as HTMLInputElement,
      screen.getByLabelText('Build volume Y (mm)') as HTMLInputElement,
      screen.getByLabelText('Build volume Z (mm)') as HTMLInputElement,
    ];
  }

  it('starts with wall and build-volume checks NOT_CHECKED, not PASS', () => {
    render(<PrintReadinessPanel object={createTableSceneObject('t1')} />);
    expect(screen.getByTestId('print-check-wall_thickness').textContent).toMatch(/Tekshirilmadi/);
    expect(screen.getByTestId('print-check-build_volume').textContent).toMatch(/Tekshirilmadi/);
    expect(screen.getByTestId('print-check-self_intersection').textContent).toMatch(
      /Tekshirilmadi/,
    );
    expect(screen.getByTestId('print-check-slicer').textContent).toMatch(/Tekshirilmadi/);
  });

  it('turns the wall check into an error for a target above the measured wall', async () => {
    render(<PrintReadinessPanel object={createTableSceneObject('t1')} />);
    fireEvent.change(wallInput(), { target: { value: '50' } });
    await waitFor(() =>
      expect(screen.getByTestId('print-check-wall_thickness').textContent).toMatch(/Xato/),
    );
    expect(screen.getByTestId('print-check-wall_thickness').textContent).toMatch(
      /wall_below|yupqa/i,
    );
    expect(screen.getByTestId('print-status').textContent).toMatch(/Xato/);
  });

  it('passes the wall check for a target below the measured wall', async () => {
    render(<PrintReadinessPanel object={createTableSceneObject('t1')} />);
    fireEvent.change(wallInput(), { target: { value: '10' } });
    await waitFor(() =>
      expect(screen.getByTestId('print-check-wall_thickness').textContent).toMatch(/O'tdi/),
    );
  });

  it('reports which build-volume axis is exceeded', async () => {
    render(<PrintReadinessPanel object={createTableSceneObject('t1')} />);
    const [x, y, z] = volumeInputs();
    fireEvent.change(x, { target: { value: '220' } });
    fireEvent.change(y, { target: { value: '220' } });
    fireEvent.change(z, { target: { value: '250' } });
    await waitFor(() =>
      expect(screen.getByTestId('print-check-build_volume').textContent).toMatch(/Xato/),
    );
    const text = screen.getByTestId('print-check-build_volume').textContent ?? '';
    expect(text).toMatch(/X \(1200 > 220\)/);
    expect(text).toMatch(/Y \(750 > 220\)/);
    expect(text).toMatch(/Z \(600 > 250\)/);
  });

  it('requires all three axes and says so', async () => {
    render(<PrintReadinessPanel object={createTableSceneObject('t1')} />);
    const [x] = volumeInputs();
    fireEvent.change(x, { target: { value: '220' } });
    await waitFor(() => expect(screen.getByTestId('print-profile-error')).toBeTruthy());
    expect(screen.getByTestId('print-profile-error').textContent).toMatch(/to'liq kiritilishi/);
    expect(screen.getByTestId('print-check-build_volume').textContent).toMatch(/Tekshirilmadi/);
  });

  it('rejects a non-positive wall target instead of using it', async () => {
    render(<PrintReadinessPanel object={createTableSceneObject('t1')} />);
    fireEvent.change(wallInput(), { target: { value: '0' } });
    await waitFor(() => expect(screen.getByTestId('print-profile-error')).toBeTruthy());
    expect(screen.getByTestId('print-check-wall_thickness').textContent).toMatch(/Tekshirilmadi/);
  });

  it('recomputes the report when the object changes', async () => {
    const object = createTableSceneObject('t1');
    const { rerender } = render(<PrintReadinessPanel object={object} />);
    expect(screen.getByTestId('print-metrics').textContent).toMatch(/1200 × 750 × 600 mm/);

    const wider = createTableSceneObject('t1', {
      params: { ...object.params, widthCm: 180 },
    });
    rerender(<PrintReadinessPanel object={wider} />);
    await waitFor(() =>
      expect(screen.getByTestId('print-metrics').textContent).toMatch(/1800 × 750 × 600 mm/),
    );
  });

  it('never claims a print guarantee', () => {
    render(<PrintReadinessPanel object={createTableSceneObject('t1')} />);
    const limitations = screen.getByTestId('print-limitations').textContent ?? '';
    expect(limitations).toMatch(/kafolati.*emas/i);
    expect(limitations).toMatch(/slicer/i);
  });
});
