// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
