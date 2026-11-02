// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ExportControls, type ExportControlsProps } from './ExportControls';

afterEach(cleanup);

function makeProps(overrides: Partial<ExportControlsProps> = {}): ExportControlsProps {
  return {
    format: 'glb',
    includeRoom: true,
    status: 'idle',
    message: '',
    disabled: false,
    onFormatChange: vi.fn(),
    onIncludeRoomChange: vi.fn(),
    onExport: vi.fn(),
    onImportFile: vi.fn(),
    ...overrides,
  };
}

describe('A2 — GLB texture quality opt-in', () => {
  it('shows the 512 toggle only for GLB and reports the choice', () => {
    const onTextureSizeChange = vi.fn();
    const { rerender } = render(
      <ExportControls {...makeProps({ textureSize: 128, onTextureSizeChange })} />,
    );
    const toggle = screen.getByLabelText('Yuqori sifatli teksturalar (512)') as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    fireEvent.click(toggle);
    expect(onTextureSizeChange).toHaveBeenCalledWith(512);

    rerender(
      <ExportControls
        {...makeProps({ format: 'obj', textureSize: 128, onTextureSizeChange })}
      />,
    );
    expect(screen.queryByLabelText('Yuqori sifatli teksturalar (512)')).toBeNull();
  });

  it('keeps the historical 128 default when the prop is omitted', () => {
    render(<ExportControls {...makeProps({ onTextureSizeChange: vi.fn() })} />);
    const toggle = screen.getByLabelText('Yuqori sifatli teksturalar (512)') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });
});

describe('X-01 — print export scope is explicit', () => {
  it('shows the selected-product scope for STL/3MF and hides the room toggle', () => {
    const onPrintScopeChange = vi.fn();
    render(
      <ExportControls
        {...makeProps({
          format: 'stl',
          printScopeSelected: true,
          selectedObjectName: 'Stol',
          onPrintScopeChange,
        })}
      />,
    );

    expect(screen.getByTestId('print-export-scope')).toBeTruthy();
    const toggle = screen.getByLabelText(
      'Faqat tanlangan obyektni eksport qilish',
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(screen.queryByLabelText("Interyerni qo'shish")).toBeNull();
    expect(screen.getByTestId('print-export-scope').textContent).toMatch(/Xona STL\/3MF/);

    fireEvent.click(toggle);
    expect(onPrintScopeChange).toHaveBeenCalledWith(false);
  });

  it('explains the all-visible fallback when nothing is selected', () => {
    render(<ExportControls {...makeProps({ format: '3mf', selectedObjectName: null })} />);
    expect(screen.getByTestId('print-export-scope').textContent).toMatch(
      /barcha ko'rinadigan mebel/i,
    );
  });

  it('keeps the room toggle for GLB and hides the print scope', () => {
    render(<ExportControls {...makeProps({ format: 'glb', selectedObjectName: 'Stol' })} />);
    expect(screen.getByLabelText("Interyerni qo'shish")).toBeTruthy();
    expect(screen.queryByTestId('print-export-scope')).toBeNull();
  });

  it('offers 3MF and states that it writes geometry only', () => {
    render(<ExportControls {...makeProps({ format: '3mf' })} />);
    const button = screen.getByRole('button', { name: /3MF/ });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/material va tekstura YOZILMAYDI/i)).toBeTruthy();
  });
});
