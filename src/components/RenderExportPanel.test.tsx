// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { RenderExportPanel } from './RenderExportPanel';

afterEach(cleanup);

function makeProps(overrides: Partial<ComponentProps<typeof RenderExportPanel>> = {}) {
  return {
    preset: 'standard' as const,
    quality: 'standard' as const,
    transparent: false,
    transparentAvailable: true,
    status: 'idle' as const,
    message: '',
    progress: null,
    disabled: false,
    onPresetChange: vi.fn(),
    onQualityChange: vi.fn(),
    onTransparentChange: vi.fn(),
    onExportCurrent: vi.fn(),
    onExportBatch: vi.fn(),
    ...overrides,
  };
}

describe('RenderExportPanel', () => {
  it('offers Standard and UHD resolutions only', () => {
    render(<RenderExportPanel {...makeProps()} />);
    expect(screen.getByRole('button', { name: /Standard \(1920×1080\)/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /UHD \(3840×2160\)/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /1024×576/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /1280×720/ })).toBeNull();
  });

  it('reports a resolution change', () => {
    const onPresetChange = vi.fn();
    render(<RenderExportPanel {...makeProps({ onPresetChange })} />);
    fireEvent.click(screen.getByRole('button', { name: /UHD/ }));
    expect(onPresetChange).toHaveBeenCalledWith('uhd');
  });

  it('reports opaque and transparent background choices', () => {
    const onTransparentChange = vi.fn();
    const { rerender } = render(
      <RenderExportPanel {...makeProps({ onTransparentChange })} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Shaffof fon' }));
    expect(onTransparentChange).toHaveBeenCalledWith(true);

    rerender(
      <RenderExportPanel {...makeProps({ transparent: true, onTransparentChange })} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opaque' }));
    expect(onTransparentChange).toHaveBeenCalledWith(false);
  });

  it('disables the transparent option when the probe failed', () => {
    render(
      <RenderExportPanel {...makeProps({ transparentAvailable: false })} />,
    );
    const button = screen.getByRole('button', { name: 'Shaffof fon' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('title')).toMatch(/shaffof fonni saqlamadi/);
  });

  it('disables both exports while working', () => {
    render(<RenderExportPanel {...makeProps({ status: 'working' })} />);
    expect(
      (screen.getByRole('button', { name: /Joriy rakursni PNG/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: /6 rakursni ZIP/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('shows batch progress as n/6 with the angle label', () => {
    render(
      <RenderExportPanel
        {...makeProps({
          status: 'working',
          progress: { current: 3, total: 6, label: "O'ng yon ko'rinish" },
        })}
      />,
    );
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuemax')).toBe('6');
    expect(screen.getByText("3/6 — O'ng yon ko'rinish")).toBeTruthy();
  });

  it('triggers the current-angle and batch exports', () => {
    const onExportCurrent = vi.fn();
    const onExportBatch = vi.fn();
    render(
      <RenderExportPanel
        {...makeProps({ onExportCurrent, onExportBatch })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Joriy rakursni PNG/ }));
    fireEvent.click(screen.getByRole('button', { name: /6 rakursni ZIP/ }));
    expect(onExportCurrent).toHaveBeenCalledTimes(1);
    expect(onExportBatch).toHaveBeenCalledTimes(1);
  });

  it('announces errors with an alert and success with a status', () => {
    const { rerender } = render(
      <RenderExportPanel
        {...makeProps({ status: 'error', message: 'Render amalga oshmadi.' })}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe('Render amalga oshmadi.');

    rerender(
      <RenderExportPanel
        {...makeProps({ status: 'success', message: 'PNG saqlandi.' })}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('PNG saqlandi.');
  });
});
