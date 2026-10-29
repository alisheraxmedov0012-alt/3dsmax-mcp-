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
