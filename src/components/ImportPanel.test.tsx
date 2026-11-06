// @vitest-environment jsdom
/**
 * Phase 6.2.1 — the import panel is the confirmation step.
 *
 * These tests drive the real pipeline (file bytes → parseModelFile → summary) and
 * assert only what the user can see, plus the one lifecycle rule the UI owns: a
 * model that is cancelled or refused must be released.
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ImportPanel } from './ImportPanel';
import type { ParsedImport } from '../import/parseModel';
import { buildGlb, triangleGlb, triangleJsonWith } from '../import/__fixtures__/glbFixtures';
import { ImportError } from '../import/importErrors';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function glbFile(name = 'stul.glb', bytes: ArrayBuffer = triangleGlb()): File {
  return new File([bytes], name, { type: 'model/gltf-binary' });
}

function input(): HTMLInputElement {
  return screen.getByLabelText('GLB faylni tanlash') as HTMLInputElement;
}

describe('ImportPanel', () => {
  it('always states that imported models last only for this session', () => {
    render(<ImportPanel onImport={() => {}} />);
    expect(screen.getByTestId('import-session-note').textContent).toContain('faqat shu sessiyada');
  });

  it('shows a measured summary before anything is added to the scene', async () => {
    const onImport = vi.fn();
    render(<ImportPanel onImport={onImport} />);

    fireEvent.change(input(), { target: { files: [glbFile()] } });

    const summary = await screen.findByTestId('import-summary');
    expect(summary.textContent).toContain('stul.glb');
    expect(summary.textContent).toContain('Uchburchak');
    expect(summary.textContent).toContain('Material');
    // The size is the measured envelope in centimetres (1 m triangle → 100 cm).
    expect(screen.getByTestId('import-size').textContent).toContain('100.0');
    expect(onImport).not.toHaveBeenCalled();
  });

  it('hands the model over only after confirmation', async () => {
    const imported: ParsedImport[] = [];
    render(<ImportPanel onImport={(parsed) => imported.push(parsed)} />);

    fireEvent.change(input(), { target: { files: [glbFile()] } });
    await screen.findByTestId('import-summary');

    fireEvent.click(screen.getByRole('button', { name: 'Import qilish' }));

    await waitFor(() => expect(imported).toHaveLength(1));
    expect(imported[0].meta.fileName).toBe('stul.glb');
    expect(imported[0].root).toBeTruthy();
    expect(screen.queryByTestId('import-summary')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain("qo'shildi");

    imported[0].dispose();
  });

  it('reports a rejection and leaves nothing to confirm', async () => {
    const onImport = vi.fn();
    render(<ImportPanel onImport={onImport} />);

    const broken = buildGlb(triangleJsonWith(() => undefined), null, { magic: 0 });
    fireEvent.change(input(), { target: { files: [glbFile('buzuq.glb', broken)] } });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent?.length).toBeGreaterThan(5);
    expect(onImport).not.toHaveBeenCalled();
    expect(screen.queryByTestId('import-summary')).toBeNull();
    expect((screen.getByRole('button', { name: 'Import qilish' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('releases the parsed model when the user cancels', async () => {
    const disposeSpy = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    render(<ImportPanel onImport={() => {}} />);

    fireEvent.change(input(), { target: { files: [glbFile()] } });
    await screen.findByTestId('import-summary');

    fireEvent.click(screen.getByRole('button', { name: 'Bekor qilish' }));

    expect(screen.queryByTestId('import-summary')).toBeNull();
    expect(disposeSpy).toHaveBeenCalled();
  });

  it('explains an unsupported file with the specific message', async () => {
    render(<ImportPanel onImport={() => {}} />);

    const gltf = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' } }));
    fireEvent.change(input(), {
      target: { files: [new File([gltf], 'stul.gltf', { type: 'model/gltf+json' })] },
    });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('.glb');
  });

  it('refuses to start while another operation owns the renderer', () => {
    render(<ImportPanel blockedReason="Eksport tugaguncha import qilib bo'lmaydi." onImport={() => {}} />);

    expect(input().disabled).toBe(true);
    expect(screen.getByTestId('import-blocked').textContent).toContain('Eksport');
    expect((screen.getByRole('button', { name: 'Import qilish' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('surfaces a failure from the scene update and releases the model', async () => {
    const disposeSpy = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    render(
      <ImportPanel
        onImport={() => {
          throw new ImportError('failed', "Sahnaga qo'shilmadi.");
        }}
      />,
    );

    fireEvent.change(input(), { target: { files: [glbFile()] } });
    await screen.findByTestId('import-summary');
    fireEvent.click(screen.getByRole('button', { name: 'Import qilish' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Sahnaga qo'shilmadi");
    expect(screen.queryByTestId('import-summary')).toBeNull();
    expect(disposeSpy).toHaveBeenCalled();
  });
});
