// @vitest-environment jsdom
/**
 * C8.4 — the parameters panel must show the measured overall size and explain
 * the parameters that are not the overall size.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { FurniturePanel } from './FurniturePanel';
import { type FurnitureType } from '../geometry/furniture/types';
import { furnitureParamsToFieldValues } from '../geometry/furniture/params';
import { createFurnitureSceneObject, type SceneObject } from '../scene/types';

function objectFor(type: FurnitureType): SceneObject {
  return createFurnitureSceneObject(type, `${type}-1`);
}

function renderPanel(type: FurnitureType | null) {
  const object = type ? objectFor(type) : null;
  const values = object
    ? furnitureParamsToFieldValues(object.type, object.params)
    : { color: '#a9744f' };
  render(
    <FurniturePanel
      object={object}
      values={values}
      errors={{}}
      onChange={() => {}}
      onReset={() => {}}
      onAdd={() => {}}
    />,
  );
}

const overallText = () =>
  screen.getByTestId('furniture-overall-value').textContent ?? '';

afterEach(() => {
  cleanup();
});

describe('C8.4 parameters panel — measured overall size', () => {
  it('shows the measured envelope for a table', () => {
    renderPanel('table');
    expect(screen.getByTestId('furniture-overall')).toBeTruthy();
    const text = overallText();
    expect(text).toContain('W 1200');
    expect(text).toContain('H 750');
    expect(text).toContain('D 600');
    expect(text).toMatch(/geometriyadan/i);
  });

  it('shows a taller envelope than the frame height for a bed', () => {
    renderPanel('bed');
    const text = overallText();
    // Frame height is 400 mm; the headboard makes the piece 900 mm tall.
    expect(text).toContain('H 900');
    expect(text).not.toContain('H 400');
  });

  it('shows a deeper envelope than the carcass depth for a dresser', () => {
    renderPanel('dresser');
    const text = overallText();
    // Carcass depth is 450 mm; the drawer fronts add 20 mm.
    expect(text).toContain('D 470');
    expect(text).not.toContain('D 450');
  });

  it('does not invent a size when no piece is selected', () => {
    renderPanel(null);
    expect(screen.queryByTestId('furniture-overall')).toBeNull();
  });
});

describe('C8.4 parameters panel — parameter meaning', () => {
  it('names the dresser depth parameter as carcass depth', () => {
    renderPanel('dresser');
    // The label element carries both the name and the range, so read the one
    // bound to the numeric input rather than matching loose text.
    const label = document.querySelector('label[for="depthCm-number"]');
    expect(label?.textContent ?? '').toContain('Korpus chuqurligi (sm)');
  });

  it('explains that the dresser parameter is not the overall depth', () => {
    renderPanel('dresser');
    const hint = screen.getByTestId('depthCm-hint').textContent ?? '';
    expect(hint).toMatch(/umumiy chuqurlik kattaroq/i);
  });

  it('explains that the bed parameter is the frame height, not the overall height', () => {
    renderPanel('bed');
    const hint = screen.getByTestId('heightCm-hint').textContent ?? '';
    expect(hint).toMatch(/umumiy balandlik kattaroq/i);
    const label = document.querySelector('label[for="heightCm-number"]');
    expect(label?.textContent ?? '').toContain('Karkas balandligi (sm)');
  });

  it('adds no hint noise to a table, whose parameters are the overall size', () => {
    renderPanel('table');
    expect(screen.queryByTestId('heightCm-hint')).toBeNull();
    expect(screen.queryByTestId('depthCm-hint')).toBeNull();
  });
});
