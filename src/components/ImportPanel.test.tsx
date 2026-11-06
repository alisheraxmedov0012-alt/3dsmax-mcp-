// @vitest-environment jsdom
/**
 * Phase 6.2 — the import panel is the confirmation step for all three formats.
 *
 * These drive the real pipeline (file bytes → `prepareImport` → summary) and
 * assert what the user can see, plus the one lifecycle rule the UI owns: a model
 * that is cancelled or refused must be released.
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ImportPanel } from './ImportPanel';
import type { ParsedImport } from '../import/parseModel';
import { buildGlb, triangleGlb, triangleJsonWith } from '../import/__fixtures__/glbFixtures';
import { chairMtl, quadObj, triangleGltf } from '../import/__fixtures__/textFixtures';
import { ImportError } from '../import/importErrors';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function files(...entries: Array<[string, ArrayBuffer | string]>): File[] {
  return entries.map(([name, content]) => {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    return new File([bytes], name);
  });
}

function input(): HTMLInputElement {
  return screen.getByLabelText('Model fayllarini tanlash') as HTMLInputElement;
}

async function select(fileList: File[]): Promise<void> {
  fireEvent.change(input(), { target: { files: fileList } });
  await screen.findByTestId('import-summary');
}

describe('ImportPanel — GLB', () => {
  it('always states that imported models last only for this session', () => {
    render(<ImportPanel onImport={() => {}} />);
    expect(screen.getByTestId('import-session-note').textContent).toContain('faqat shu sessiyada');
  });

  it('shows a measured summary before anything is added to the scene', async () => {
    const onImport = vi.fn();
    render(<ImportPanel onImport={onImport} />);

    await select(files(['stul.glb', triangleGlb()]));

    const summary = screen.getByTestId('import-summary');
    expect(summary.textContent).toContain('GLB');
    expect(summary.textContent).toContain('stul.glb');
    expect(screen.getByTestId('import-triangles').textContent).toBe('1');
    // 1 m triangle → 100 cm after the unit conversion.
    expect(screen.getByTestId('import-size').textContent).toContain('100.0');
    expect(onImport).not.toHaveBeenCalled();
  });

  it('hands the model over only after confirmation', async () => {
    const imported: ParsedImport[] = [];
    render(<ImportPanel onImport={(parsed) => imported.push(parsed)} />);

    await select(files(['stul.glb', triangleGlb()]));
    fireEvent.click(screen.getByRole('button', { name: 'Import qilish' }));

    await waitFor(() => expect(imported).toHaveLength(1));
    expect(imported[0].meta.fileName).toBe('stul.glb');
    expect(screen.queryByTestId('import-summary')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain("qo'shildi");

    imported[0].dispose();
  });

  it('reports a rejection and leaves nothing to confirm', async () => {
    const onImport = vi.fn();
    render(<ImportPanel onImport={onImport} />);

    const broken = buildGlb(triangleJsonWith(() => undefined), null, { magic: 0 });
    fireEvent.change(input(), { target: { files: files(['buzuq.glb', broken]) } });

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

    await select(files(['stul.glb', triangleGlb()]));
    fireEvent.click(screen.getByRole('button', { name: 'Bekor qilish' }));

    expect(screen.queryByTestId('import-summary')).toBeNull();
    expect(disposeSpy).toHaveBeenCalled();
  });

  it('refuses to start while another operation owns the renderer', () => {
    render(<ImportPanel blockedReason="Eksport tugaguncha import qilib bo'lmaydi." onImport={() => {}} />);

    expect(input().disabled).toBe(true);
    expect(screen.getByTestId('import-blocked').textContent).toContain('Eksport');
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

    await select(files(['stul.glb', triangleGlb()]));
    fireEvent.click(screen.getByRole('button', { name: 'Import qilish' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Sahnaga qo'shilmadi");
    expect(screen.queryByTestId('import-summary')).toBeNull();
    expect(disposeSpy).toHaveBeenCalled();
  });
});

describe('ImportPanel — glTF with companions', () => {
  it('lists the selected files and resolves the reference count', async () => {
    const bundle = triangleGltf((json) => {
      delete json.images;
      delete json.textures;
      (json.materials as Array<Record<string, unknown>>)[0] = {
        name: 'Paint',
        pbrMetallicRoughness: { baseColorFactor: [0.4, 0.2, 0.1, 1] },
      };
    });

    render(<ImportPanel onImport={() => {}} />);
    await select(
      files(
        ['chair.gltf', bundle.json],
        ['triangle.bin', bundle.bin.buffer.slice(0, bundle.bin.byteLength) as ArrayBuffer],
      ),
    );

    expect(screen.getByTestId('import-file-list').textContent).toContain('chair.gltf');
    expect(screen.getByTestId('import-file-list').textContent).toContain('triangle.bin');
    expect(screen.getByTestId('import-references').textContent).toContain('1 / 1');
    expect(screen.getByTestId('import-summary').textContent).toContain('glTF');
  });

  it('blocks confirmation until a missing texture is acknowledged', async () => {
    const bundle = triangleGltf();
    render(<ImportPanel onImport={() => {}} />);

    await select(
      files(
        ['chair.gltf', bundle.json],
        ['triangle.bin', bundle.bin.buffer.slice(0, bundle.bin.byteLength) as ArrayBuffer],
      ),
    );

    // wood.png was not selected: the model can still import, but not silently.
    expect(screen.getByTestId('import-warnings').textContent).toContain('wood.png');
    const confirm = screen.getByRole('button', { name: 'Import qilish' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.click(screen.getByTestId('import-acknowledge').querySelector('input') as Element);
    await waitFor(() => expect(confirm.disabled).toBe(false));
  });

  it('rejects a document whose .bin is missing', async () => {
    const bundle = triangleGltf();
    render(<ImportPanel onImport={() => {}} />);

    fireEvent.change(input(), { target: { files: files(['chair.gltf', bundle.json]) } });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('triangle.bin');
  });
});

describe('ImportPanel — OBJ', () => {
  it('offers a unit selector and reports the unit-converted size', async () => {
    render(<ImportPanel onImport={() => {}} />);
    await select(files(['chair.obj', quadObj()], ['chair.mtl', chairMtl()]));

    expect(screen.getByTestId('import-summary').textContent).toContain('OBJ');
    expect(screen.getByLabelText('OBJ o‘lchov birligi')).toBeTruthy();
    expect(screen.getByTestId('import-fidelity-note').textContent).toContain('map_Kd');

    // 1 unit at the default centimetre reading.
    expect(screen.getByTestId('import-size').textContent).toContain('1.0');

    fireEvent.change(screen.getByLabelText('OBJ o‘lchov birligi'), { target: { value: 'm' } });

    await waitFor(() =>
      expect(screen.getByTestId('import-size').textContent).toContain('100.0'),
    );
  });

  it('warns about a missing MTL and requires acknowledgement', async () => {
    render(<ImportPanel onImport={() => {}} />);
    await select(files(['chair.obj', quadObj()]));

    expect(screen.getByTestId('import-warnings').textContent).toContain('chair.mtl');
    const confirm = screen.getByRole('button', { name: 'Import qilish' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it('rejects a malformed OBJ with a specific message', async () => {
    render(<ImportPanel onImport={() => {}} />);
    fireEvent.change(input(), {
      target: { files: files(['broken.obj', ['v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 9'].join('\n')]) },
    });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('indeks');
  });
});
