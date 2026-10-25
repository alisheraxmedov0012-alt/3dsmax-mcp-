// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CuttingPlanPanel } from './CuttingPlanPanel';
import { buildBom } from '../manufacturing/bom';
import { buildCutList, type CutListResult, type CutListRow } from '../manufacturing/cutList';
import { buildCuttingPlan } from '../manufacturing/cuttingPlan';
import { createFurnitureParams } from '../geometry/furniture/types';
import type { BomMaterialInfo } from '../manufacturing/sheetMaterial';

const MATERIAL: BomMaterialInfo = {
  materialId: 'ldsp',
  name: 'LDSP',
  thicknessMm: 18,
  unit: 'mm',
  source: 'user',
  geometryThicknessMm: 18,
  thicknessMismatch: false,
  issues: [],
};

function row(
  partId: string,
  lengthMm: number,
  widthMm: number,
  quantity: number,
  material: BomMaterialInfo | null = MATERIAL,
): CutListRow {
  return {
    partId,
    name: `Nomi ${partId}`,
    quantity,
    lengthMm,
    widthMm,
    thicknessMm: 18,
    source: 'bom',
    material,
    notes: [],
  };
}

function list(rows: CutListRow[]): CutListResult {
  return {
    unit: 'mm',
    rows,
    totalPieces: rows.reduce((sum, entry) => sum + entry.quantity, 0),
    panelAreaM2: 0,
    limitations: [],
  };
}

const SIMPLE = list([row('a', 500, 400, 2), row('b', 300, 300, 1)]);

function renderPanel(cutList: CutListResult = SIMPLE) {
  render(<CuttingPlanPanel cutList={cutList} />);
}

const lengthInput = () => screen.getByLabelText('List uzunligi (mm)') as HTMLInputElement;
const widthInput = () => screen.getByLabelText('List kengligi (mm)') as HTMLInputElement;
const kerfInput = () => screen.getByLabelText('Arra kesish eni — kerf (mm)') as HTMLInputElement;
const marginInput = () => screen.getByLabelText('Chekka chegara (mm, ixtiyoriy)') as HTMLInputElement;
const maxSheetsInput = () =>
  screen.getByLabelText('Listlar soni chegarasi (ixtiyoriy)') as HTMLInputElement;
const rotateInput = () =>
  screen.getByLabelText(/aylantirishga ruxsat/i) as HTMLInputElement;
const calculate = () => screen.getByTestId('cutting-generate') as HTMLButtonElement;

function typeInto(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

afterEach(() => {
  cleanup();
});

describe('CuttingPlanPanel', () => {
  it('shows the settings and no result before calculating', () => {
    renderPanel();
    expect(screen.getByTestId('cutting-plan')).toBeTruthy();
    expect(lengthInput().value).toBe('2440');
    expect(widthInput().value).toBe('1220');
    expect(kerfInput().value).toBe('4');
    expect(rotateInput().checked).toBe(true);
    expect(screen.queryByTestId('cutting-status')).toBeNull();
    expect(screen.getByTestId('cutting-generate').textContent).toContain('hisoblash');
  });

  it('renders a preview and the steps it calculated after clicking', () => {
    renderPanel();
    fireEvent.click(calculate());

    expect(screen.getByTestId('cutting-status')).toBeTruthy();
    const previews = screen.getAllByTestId(/cutting-preview-/);
    expect(previews.length).toBeGreaterThan(0);

    const outcome = buildCuttingPlan({
      cutList: SIMPLE,
      settings: { sheetLengthMm: 2440, sheetWidthMm: 1220, kerfMm: 4, allowRotation: true },
    });
    if (!outcome.ok) throw new Error(outcome.reason);

    // The drawing must carry the same rectangles the algorithm returned.
    const firstSheet = outcome.plan.groups[0].sheets[0];
    const svg = previews[0];
    const rects = svg.querySelectorAll('rect');
    // One outline for the board plus one per piece.
    expect(rects.length).toBe(firstSheet.placements.length + 1);
    for (const [index, placement] of firstSheet.placements.entries()) {
      const rect = rects[index + 1];
      expect(Number(rect.getAttribute('x'))).toBe(placement.xMm);
      expect(Number(rect.getAttribute('y'))).toBe(placement.yMm);
      expect(Number(rect.getAttribute('width'))).toBe(placement.widthMm);
      expect(Number(rect.getAttribute('height'))).toBe(placement.heightMm);
    }
  });

  it('names the parts and their dimensions under each sheet', () => {
    renderPanel();
    fireEvent.click(calculate());

    const outcome = buildCuttingPlan({
      cutList: SIMPLE,
      settings: { sheetLengthMm: 2440, sheetWidthMm: 1220, kerfMm: 4, allowRotation: true },
    });
    if (!outcome.ok) throw new Error(outcome.reason);
    const firstSheet = outcome.plan.groups[0].sheets[0];
    const text = screen.getAllByTestId('cutting-sheet')[0].textContent ?? '';

    expect(text).toContain('Nomi a');
    expect(text).toContain('(a)');
    // The listed size is the size as placed, which may be the rotated one.
    for (const piece of firstSheet.placements) {
      expect(text).toContain(`${piece.widthMm}×${piece.heightMm}`);
      expect(text).toContain(`(${piece.xMm}, ${piece.yMm})`);
    }
  });

  it('reports the material usage summary and waste percentage', () => {
    renderPanel();
    fireEvent.click(calculate());
    const summary = screen.getByTestId('cutting-summary').textContent ?? '';
    expect(summary).toMatch(/Foydalanilgan yuza/);
    expect(summary).toMatch(/Mavjud yuza/);
    expect(summary).toMatch(/Kerf maydoni/);
    expect(summary).toMatch(/Chiqindi/);
    expect(screen.getByTestId('cutting-status').textContent).toMatch(/chiqindi/);
  });

  it('rejects an invalid sheet size with a readable error', () => {
    renderPanel();
    typeInto(lengthInput(), '0');
    fireEvent.click(calculate());
    const error = screen.getByTestId('cutting-error');
    expect(error.textContent).toMatch(/noldan katta/i);
    expect(screen.queryByTestId('cutting-status')).toBeNull();
  });

  it('rejects a negative kerf', () => {
    renderPanel();
    typeInto(kerfInput(), '-3');
    fireEvent.click(calculate());
    expect(screen.getByTestId('cutting-error').textContent).toMatch(/kerf.*manfiy/i);
  });

  it('marks a result stale when a setting changes afterwards', () => {
    renderPanel();
    fireEvent.click(calculate());
    expect(screen.queryByTestId('cutting-stale')).toBeNull();

    typeInto(kerfInput(), '8');
    const stale = screen.getByTestId('cutting-stale');
    expect(stale.textContent).toMatch(/Sozlamalar o‘zgargan/);

    // Recalculating with the new value clears the banner.
    fireEvent.click(calculate());
    expect(screen.queryByTestId('cutting-stale')).toBeNull();
  });

  it('marks a result stale when the rotation choice changes', () => {
    renderPanel();
    fireEvent.click(calculate());
    fireEvent.click(rotateInput());
    expect(screen.getByTestId('cutting-stale')).toBeTruthy();
  });

  it('lists pieces that do not fit, with the reason', () => {
    renderPanel(list([row('huge', 3000, 2000, 1), row('ok', 300, 300, 1)]));
    fireEvent.click(calculate());
    const unplaced = screen.getByTestId('cutting-unplaced').textContent ?? '';
    expect(unplaced).toMatch(/Listga sig‘maydi|Listga sig'maydi/);
    expect(unplaced).toContain('huge');
  });

  it('lists parts with no material instead of quietly skipping them', () => {
    renderPanel(list([row('a', 500, 400, 1), row('nomaterial', 300, 300, 2, null)]));
    fireEvent.click(calculate());
    const unplaced = screen.getByTestId('cutting-unplaced').textContent ?? '';
    expect(unplaced).toMatch(/Material belgilanmagan/);
    expect(unplaced).toContain('nomaterial');
  });

  it('stops at the sheet limit and explains the shortage', () => {
    renderPanel(list([row('a', 1000, 1000, 3)]));
    typeInto(lengthInput(), '1000');
    typeInto(widthInput(), '1000');
    typeInto(kerfInput(), '0');
    typeInto(maxSheetsInput(), '2');
    fireEvent.click(calculate());

    expect(screen.getByTestId('cutting-status').textContent).toMatch(/Qisman/);
    expect(screen.getByTestId('cutting-unplaced').textContent).toMatch(/Listlar soni yetarli emas/);
  });

  it('shows the algorithm limitation note on every result', () => {
    renderPanel();
    fireEvent.click(calculate());
    const limitations = screen.getByTestId('cutting-limitations').textContent ?? '';
    expect(limitations).toMatch(/optimal/i);
    expect(limitations).toMatch(/kerf/i);
  });

  it('separates materials into their own groups', () => {
    const mdf: BomMaterialInfo = { ...MATERIAL, materialId: 'mdf', name: 'MDF' };
    renderPanel(list([row('a', 500, 400, 1), row('b', 500, 400, 1, mdf)]));
    fireEvent.click(calculate());
    const groups = screen.getAllByTestId(/cutting-group-/);
    expect(groups).toHaveLength(2);
  });

  it('applies the optional edge margin and shows it in the summary', () => {
    renderPanel();
    typeInto(lengthInput(), '1000');
    typeInto(widthInput(), '1000');
    typeInto(kerfInput(), '0');
    typeInto(marginInput(), '10');
    fireEvent.click(calculate());

    const summary = screen.getByTestId('cutting-summary').textContent ?? '';
    expect(summary).toMatch(/Chekka 10 mm/);

    // The margin inset is visible in the drawing: the first piece starts at 10,10.
    const svg = screen.getAllByTestId(/cutting-preview-/)[0];
    const firstPiece = svg.querySelectorAll('rect')[1];
    expect(Number(firstPiece.getAttribute('x'))).toBe(10);
    expect(Number(firstPiece.getAttribute('y'))).toBe(10);
  });

  it('rejects a margin that leaves no board to cut from', () => {
    renderPanel();
    typeInto(lengthInput(), '1000');
    typeInto(widthInput(), '1000');
    typeInto(marginInput(), '500');
    fireEvent.click(calculate());
    expect(screen.getByTestId('cutting-error').textContent).toMatch(/joy qolmadi/i);
  });

  it('keeps one column so a narrow panel needs no horizontal scroll', () => {
    renderPanel();
    fireEvent.click(calculate());
    const panel = screen.getByTestId('cutting-plan');
    const preview = panel.querySelector('.cutting-preview');
    expect(preview?.getAttribute('width')).toBeNull();
    expect(preview?.getAttribute('viewBox')).toBe('0 0 2440 1220');
    expect(preview?.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    // The settings block and every sheet group are stacked containers.
    expect(panel.querySelector('.cutting__settings')).toBeTruthy();
    for (const group of panel.querySelectorAll('.cutting__group')) {
      expect(group.className).toContain('cutting__group');
    }
  });

  it('reports the current plan for export and withdraws it when settings change', () => {
    const onPlanChange = vi.fn();
    render(<CuttingPlanPanel cutList={SIMPLE} onPlanChange={onPlanChange} />);

    fireEvent.click(calculate());
    expect(onPlanChange).toHaveBeenCalled();
    const calls = onPlanChange.mock.calls;
    const lastPlan = calls[calls.length - 1]?.[0];
    expect(lastPlan).not.toBeNull();
    expect(lastPlan.summary.sheetCount).toBeGreaterThan(0);

    onPlanChange.mockClear();
    typeInto(kerfInput(), '9');
    // The shown plan is stale, so the parent must not export it any more.
    expect(onPlanChange).toHaveBeenCalledWith(null);

    onPlanChange.mockClear();
    fireEvent.click(calculate());
    const afterRecalculate = onPlanChange.mock.calls;
    expect(afterRecalculate[afterRecalculate.length - 1]?.[0]).not.toBeNull();
  });

  it('withdraws the exportable plan when a calculation fails', () => {
    const onPlanChange = vi.fn();
    render(<CuttingPlanPanel cutList={SIMPLE} onPlanChange={onPlanChange} />);
    fireEvent.click(calculate());
    const calls = onPlanChange.mock.calls;
    expect(calls[calls.length - 1]?.[0]).not.toBeNull();

    onPlanChange.mockClear();
    typeInto(lengthInput(), '0');
    fireEvent.click(calculate());
    expect(onPlanChange).toHaveBeenCalledWith(null);
  });

  it('hides a plan computed from a different cut list', () => {
    const onPlanChange = vi.fn();
    const { rerender } = render(<CuttingPlanPanel cutList={SIMPLE} onPlanChange={onPlanChange} />);
    fireEvent.click(calculate());
    expect(screen.getByTestId('cutting-status')).toBeTruthy();

    const other = list([row('zzz', 200, 200, 1)]);
    rerender(<CuttingPlanPanel cutList={other} onPlanChange={onPlanChange} />);
    expect(screen.queryByTestId('cutting-status')).toBeNull();
    expect(screen.getByTestId('cutting-generate').textContent).toContain('Kesish rejasini hisoblash');
  });

  it('works from a real furniture cut list', () => {
    const bom = buildBom('wardrobe', createFurnitureParams('wardrobe'), [
      { partId: 'wardrobe-side', materialId: 'ldsp', thicknessMm: 18, thicknessSource: 'user' },
      { partId: 'wardrobe-top', materialId: 'ldsp', thicknessMm: 18, thicknessSource: 'user' },
      { partId: 'wardrobe-bottom', materialId: 'ldsp', thicknessMm: 18, thicknessSource: 'user' },
      { partId: 'wardrobe-back', materialId: 'ldsp', thicknessMm: 18, thicknessSource: 'user' },
      { partId: 'wardrobe-shelf', materialId: 'ldsp', thicknessMm: 18, thicknessSource: 'user' },
      { partId: 'wardrobe-door', materialId: 'ldsp', thicknessMm: 18, thicknessSource: 'user' },
    ]);
    if (!bom.ok) throw new Error(bom.reason);
    const cutList = buildCutList(bom.bom);
    renderPanel(cutList);
    fireEvent.click(calculate());

    const status = screen.getByTestId('cutting-status').textContent ?? '';
    expect(status).toMatch(/list/);
    const sheets = screen.getAllByTestId('cutting-sheet');
    expect(sheets.length).toBeGreaterThan(0);
    // Real wardrobe part names reach the sheet listings.
    const allText = sheets.map((sheet) => sheet.textContent ?? '').join(' ');
    expect(allText).toMatch(/wardrobe-/);
  });

  it('names solid parts as excluded when the model has any', () => {
    const bom = buildBom('table', createFurnitureParams('table'), [
      { partId: 'table-top', materialId: 'ldsp', thicknessMm: 18, thicknessSource: 'user' },
    ]);
    if (!bom.ok) throw new Error(bom.reason);
    render(<CuttingPlanPanel cutList={buildCutList(bom.bom)} bom={bom.bom} />);
    fireEvent.click(calculate());
    const excluded = screen.getByTestId('cutting-excluded').textContent ?? '';
    expect(excluded).toMatch(/table-leg/);
  });
});
