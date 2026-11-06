// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ExportControls, type ExportControlsProps } from './ExportControls';
import { QUALITY_PROFILES, createCustomProfile } from '../export/quality/profiles';
import type { QualityPreflightResult } from '../export/quality/types';

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

describe('Phase 4.7 — export feedback and repeat-click guard', () => {
  it('disables the button and shows progress while exporting', () => {
    const onExport = vi.fn();
    render(
      <ExportControls
        {...makeProps({ status: 'exporting', message: 'Eksport qilinmoqda…', onExport })}
      />,
    );
    const button = screen.getByRole('button', { name: 'Eksport qilinmoqda…' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('Eksport qilinmoqda');
    fireEvent.click(button);
    expect(onExport).not.toHaveBeenCalled();
  });

  it('announces a failure as an alert and keeps the editor usable', () => {
    render(
      <ExportControls
        {...makeProps({
          status: 'error',
          message: '"Stol" Normal teksturasi (tex-normal@1) yuklanmadi.',
        })}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Normal teksturasi');
    expect((screen.getByRole('button', { name: /Eksport qilish/ }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('reports a successful export', () => {
    render(
      <ExportControls
        {...makeProps({ status: 'success', message: 'Sahna "model.glb" sifatida yuklab olindi.' })}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('model.glb');
  });
});

describe('quality profile UI', () => {
  function preflight(status: 'PASS' | 'WARNING' | 'BLOCK'): QualityPreflightResult {
    return {
      profile: { id: 'standard', label: 'Standart', budgetSeverity: 'WARNING' },
      limits: QUALITY_PROFILES.standard.limits,
      format: 'glb',
      checks: [
        {
          id: 'geometry.triangles',
          label: 'Uchburchaklar soni',
          category: 'geometry',
          status,
          actual: 10,
          limit: 1,
          message: 'Uchburchaklar limitdan oshdi.',
          remediation: 'Detallarni soddalashtiring.',
          certainty: 'exact',
        },
      ],
      status,
      summary: { pass: 0, warning: status === 'WARNING' ? 1 : 0, block: status === 'BLOCK' ? 1 : 0, total: 1 },
      metrics: {} as QualityPreflightResult['metrics'],
      message: status === 'BLOCK' ? 'Eksport bloklandi.' : 'Eksport mumkin.',
      estimated: true,
    };
  }

  it('selects a profile and runs preflight', () => {
    const onQualityProfileChange = vi.fn();
    const onRunQualityPreflight = vi.fn();
    render(
      <ExportControls
        {...makeProps({
          qualityProfileId: 'standard',
          qualityProfile: QUALITY_PROFILES.standard,
          qualityPreflight: preflight('WARNING'),
          qualityPreflightStatus: 'idle',
          onQualityProfileChange,
          onRunQualityPreflight,
        })}
      />,
    );

    expect(screen.getByTestId('quality-profile').textContent).toContain('Standart');
    expect(screen.getByTestId('quality-summary').textContent).toContain('WARNING');
    expect(screen.getByTestId('quality-summary').textContent).toContain('Uchburchaklar');
    fireEvent.click(screen.getByRole('button', { name: 'Yuqori sifat' }));
    expect(onQualityProfileChange).toHaveBeenCalledWith('high');
    fireEvent.click(screen.getByTestId('quality-preflight-button'));
    expect(onRunQualityPreflight).toHaveBeenCalledTimes(1);
  });

  it('exposes editable limits for the custom profile', () => {
    const onCustomLimitsChange = vi.fn();
    render(
      <ExportControls
        {...makeProps({
          qualityProfileId: 'custom',
          qualityProfile: createCustomProfile(),
          customLimits: {},
          onQualityProfileChange: vi.fn(),
          onCustomLimitsChange,
        })}
      />,
    );
    expect(screen.getByTestId('quality-custom-limits')).toBeTruthy();
    const triangleInput = screen.getByLabelText('Uchburchaklar') as HTMLInputElement;
    fireEvent.change(triangleInput, { target: { value: '42' } });
    expect(onCustomLimitsChange).toHaveBeenCalledWith({
      geometry: { maxTriangles: 42 },
    });
  });

  it('shows the blocking reason when preflight blocks', () => {
    render(
      <ExportControls
        {...makeProps({
          qualityProfileId: 'high',
          qualityProfile: QUALITY_PROFILES.high,
          qualityPreflight: preflight('BLOCK'),
          qualityMessage: 'Eksport bloklandi.',
          onQualityProfileChange: vi.fn(),
        })}
      />,
    );
    expect(screen.getByTestId('quality-summary').textContent).toContain('BLOCK');
    expect(screen.getByText('Eksport bloklandi.')).toBeTruthy();
  });
});
