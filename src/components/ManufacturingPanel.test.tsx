// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ManufacturingPanel } from './ManufacturingPanel';
import { packageFilename, type PackageOutcome } from '../manufacturing/manufacturingPackage';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createFurnitureSceneObject,
  type SceneData,
  type SceneObject,
} from '../scene/types';
import { createDefaultSettings } from '../scene/sceneSettings';

/**
 * C1 panel tests: the ZIP button, its loading state, its error path and the
 * guarantee that a failed build downloads nothing.
 *
 * The package builder is mocked here on purpose — the real generator is covered
 * end-to-end (including a real inflate of the archive) in
 * `manufacturing/manufacturingPackage.test.ts`. What matters at this level is
 * the wiring: one click, one download, no download on failure.
 */
const buildPackage = vi.fn<() => Promise<PackageOutcome>>();

vi.mock('../manufacturing/manufacturingPackage', async () => {
  const actual = await vi.importActual<typeof import('../manufacturing/manufacturingPackage')>(
    '../manufacturing/manufacturingPackage',
  );
  return {
    ...actual,
    buildManufacturingPackage: (...args: unknown[]) => buildPackage(...(args as [])),
  };
});

const downloaded: Array<{ name: string; type: string; size: number }> = [];

class TestFileReader {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;

  readAsArrayBuffer(blob: Blob): void {
    blob
      .arrayBuffer()
      .then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      })
      .catch((error) => this.onerror?.(error));
  }
}

beforeAll(() => {
  vi.stubGlobal('FileReader', TestFileReader);
  // jsdom has no object-URL implementation; downloads are recorded instead.
  // The real URL constructor is kept (pdf-lib uses `new URL` internally), so the
  // statics are patched in place and restored afterwards rather than replacing
  // the global with a plain object.
  (URL as unknown as { createObjectURL: (blob: Blob) => string }).createObjectURL = (
    blob: Blob,
  ) => {
    downloaded.push({ name: '', type: blob.type, size: blob.size });
    return 'blob:test';
  };
  (URL as unknown as { revokeObjectURL: (url: string) => void }).revokeObjectURL = () => undefined;
  // Intercept the anchor click so nothing navigates.
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    const last = downloaded[downloaded.length - 1];
    if (last) {
      last.name = this.download;
    }
  };
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  downloaded.length = 0;
  buildPackage.mockReset();
});

afterEach(() => cleanup());

function objectOf(): SceneObject {
  return createFurnitureSceneObject('table', 'table-1');
}

function sceneWith(object: SceneObject): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects: [object],
    settings: createDefaultSettings(),
  };
}

function renderPanel(overrides: { object?: SceneObject | null; projectName?: string } = {}) {
  const object = overrides.object === undefined ? objectOf() : overrides.object;
  const scene = sceneWith(object ?? objectOf());
  return render(
    <ManufacturingPanel
      object={object}
      projectName={overrides.projectName ?? 'Stol loyihasi'}
      scene={scene}
    />,
  );
}

function packageButton(): HTMLButtonElement {
  return screen.getByTestId('manufacturing-package') as HTMLButtonElement;
}

/** Derived from the real naming function, so the fixture cannot go stale. */
const ARCHIVE_NAME = packageFilename('Stol loyihasi');

function successOutcome(): PackageOutcome {
  return {
    ok: true,
    package: {
      bytes: new Uint8Array([1, 2, 3, 4]),
      filename: ARCHIVE_NAME,
      mimeType: 'application/zip',
      entries: [
        { name: 'README.txt', bytes: 1 },
        { name: 'BOM.csv', bytes: 1 },
        { name: 'cutlist.csv', bytes: 1 },
        { name: 'drawing.svg', bytes: 1 },
        { name: 'meta.json', bytes: 1 },
        { name: 'model.glb', bytes: 1 },
      ],
      totalParts: 5,
      cutPieces: 1,
    },
  };
}

describe('ManufacturingPanel — package button', () => {
  it('renders the download button for the selected piece', () => {
    renderPanel();

    expect(packageButton()).toBeTruthy();
    expect(packageButton().textContent).toContain('ZIP');
    expect(packageButton().disabled).toBe(false);
  });

  it('asks for a piece when nothing is selected', () => {
    renderPanel({ object: null });

    expect(screen.queryByTestId('manufacturing-package')).toBeNull();
    expect(screen.getByText(/mebelni tanlang/i)).toBeTruthy();
  });

  it('downloads one archive on success and reports it', async () => {
    buildPackage.mockResolvedValue(successOutcome());
    renderPanel();

    fireEvent.click(packageButton());

    await waitFor(() => expect(downloaded).toHaveLength(1));
    expect(downloaded[0]).toEqual({
      name: ARCHIVE_NAME,
      type: 'application/zip',
      size: 4,
    });

    await waitFor(() =>
      expect(
        screen.getByText((content) => content.startsWith(`${ARCHIVE_NAME} yuklab olindi`)),
      ).toBeTruthy(),
    );
    expect(screen.getByText(/5 detal, 1 panel/)).toBeTruthy();
  });

  it('shows a loading label and blocks repeat clicks while building', async () => {
    let release: (value: PackageOutcome) => void = () => undefined;
    buildPackage.mockImplementation(
      () =>
        new Promise<PackageOutcome>((resolve) => {
          release = resolve;
        }),
    );
    renderPanel();

    fireEvent.click(packageButton());
    fireEvent.click(packageButton());
    fireEvent.click(packageButton());

    // The button locks immediately, so extra clicks in the same tick are ignored.
    expect(packageButton().disabled).toBe(true);
    expect(packageButton().textContent).toContain('tayyorlanmoqda');
    expect(buildPackage).toHaveBeenCalledTimes(1);

    release(successOutcome());

    await waitFor(() => expect(downloaded).toHaveLength(1));
    // The download is recorded synchronously in the click handler, before React
    // commits the state updates from the same handler, so the re-enable has to be
    // awaited rather than read at this instant.
    await waitFor(() => expect(packageButton().disabled).toBe(false));
    expect(buildPackage).toHaveBeenCalledTimes(1);
  });

  it('downloads nothing when the build fails and explains why', async () => {
    buildPackage.mockResolvedValue({ ok: false, reason: '3D model fayli bosh.' });
    renderPanel();

    fireEvent.click(packageButton());

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('3D model fayli bosh.');
    expect(downloaded).toHaveLength(0);

    // The existing panel stays usable.
    expect(packageButton().disabled).toBe(false);
  });

  it('downloads nothing when the build throws', async () => {
    buildPackage.mockRejectedValue(new Error('boom'));
    renderPanel();

    fireEvent.click(packageButton());

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain("To‘plamni tayyorlab bo‘lmadi");
    expect(downloaded).toHaveLength(0);
  });

  it('does not break the existing single-file exports', async () => {
    renderPanel();

    fireEvent.click(screen.getByText('BOM (CSV)'));

    await waitFor(() => expect(downloaded).toHaveLength(1));
    expect(downloaded[0].type).toBe('text/csv');
    expect(downloaded[0].name).toContain('bom');
    // The package builder is not involved in the single-format path.
    expect(buildPackage).not.toHaveBeenCalled();
  });

  it('forwards the builder filename to the download unchanged', async () => {
    const base = successOutcome();
    if (!base.ok) {
      throw new Error('fixture must succeed');
    }
    // A name the panel cannot possibly reconstruct on its own: it carries the
    // digest of a Cyrillic project name. If the panel rebuilt or re-slugged the
    // filename instead of forwarding it, this assertion would fail.
    const builderName = packageFilename('Kitob javoni');
    buildPackage.mockResolvedValue({
      ok: true,
      package: { ...base.package, filename: builderName },
    });
    renderPanel({ projectName: 'Kitob javoni' });

    fireEvent.click(packageButton());

    await waitFor(() => expect(downloaded).toHaveLength(1));
    expect(downloaded[0].name).toBe(builderName);
    await waitFor(() =>
      expect(
        screen.getByText((content) => content.startsWith(`${builderName} yuklab olindi`)),
      ).toBeTruthy(),
    );
  });

  it('uses the current C1.1 archive naming shape', () => {
    // Guards the fixture itself: a stale literal here would silently stop
    // representing what the builder really returns.
    expect(ARCHIVE_NAME).toMatch(/^stol-loyihasi-[0-9a-f]{12}-package\.zip$/);
  });
});

describe('C4 — validation report in the panel', () => {
  it('shows the check summary and what was not checked', () => {
    renderPanel();
    const section = screen.getByTestId('manufacturing-validation');
    expect(section.textContent).toContain('Tekshiruv');
    // The limitations are always visible, so a clean count cannot be read as a pass.
    expect(section.textContent).toContain('sertifikat');
  });

  it('lists a warning with its severity label and explanation', () => {
    renderPanel();
    const section = screen.getByTestId('manufacturing-validation');
    // The default table model has no material assigned, which is a warning.
    expect(section.textContent).toContain('Ogohlantirish');
    expect(section.textContent).toContain('Material tanlanmagan');
  });

  it('labels severity in text, not only by colour', () => {
    renderPanel();
    const items = document.querySelectorAll('.manufacturing__validation-item');
    expect(items.length).toBeGreaterThan(0);
    const first = items[0] as HTMLElement;
    expect(first.textContent).toMatch(/^(Xatolik|Ogohlantirish|Ma'lumot)/);
  });

  it('reflects C3 material data in the panel instead of ignoring it', () => {
    // Before C4 the panel called buildBom without the object's assignments.
    const withMaterial = {
      ...objectOf(),
      sheetMaterials: [
        { partId: 'table-top', materialId: 'mdf' as const, thicknessMm: 40, thicknessSource: 'user' as const },
      ],
    };
    renderPanel({ object: withMaterial });

    // MDF now appears in the parts list, which is built from the BOM rows.
    expect(screen.getByText(/MDF/)).toBeTruthy();
  });

  it('shows a material error as an error in the panel', () => {
    const broken = {
      ...objectOf(),
      sheetMaterials: [
        { partId: 'table-top', materialId: 'mdf' as const, thicknessMm: 0, thicknessSource: 'user' as const },
      ],
    };
    renderPanel({ object: broken });

    const section = screen.getByTestId('manufacturing-validation');
    expect(section.textContent).toContain('Xatolik');
    expect(section.textContent).toMatch(/noldan katta/i);
  });
});

describe('C5 — PDF export action', () => {
  function pdfButton(): HTMLButtonElement {
    return screen.getByTestId('manufacturing-pdf') as HTMLButtonElement;
  }

  it('offers a PDF action next to the existing exports', () => {
    renderPanel();
    expect(pdfButton()).toBeTruthy();
    expect(pdfButton().textContent).toContain('PDF');
    expect(pdfButton().disabled).toBe(false);
    // The C1 ZIP action is still there.
    expect(screen.getByTestId('manufacturing-package')).toBeTruthy();
  });

  it('downloads a real PDF with the application/pdf type', async () => {
    renderPanel({ projectName: 'Stol loyihasi' });

    fireEvent.click(pdfButton());

    await waitFor(() => expect(downloaded).toHaveLength(1), { timeout: 15000 });
    expect(downloaded[0].type).toBe('application/pdf');
    expect(downloaded[0].name).toMatch(/^stol-loyihasi-[0-9a-f]{12}-hujjatlar\.pdf$/);
    // A real document, not an empty blob.
    expect(downloaded[0].size).toBeGreaterThan(1000);
  }, 20000);

  it('reports success only after the document was produced', async () => {
    renderPanel();

    fireEvent.click(pdfButton());

    await waitFor(() => expect(downloaded).toHaveLength(1), { timeout: 15000 });
    await waitFor(() => expect(screen.getByText(/hujjatlar\.pdf yuklab olindi/)).toBeTruthy());
    expect(screen.getByText(/sahifa/)).toBeTruthy();
  }, 20000);

  it('shows a busy state while generating and blocks duplicate clicks', async () => {
    renderPanel();

    fireEvent.click(pdfButton());
    // The label switches immediately; a second click is swallowed by the lock.
    expect(pdfButton().disabled).toBe(true);
    fireEvent.click(pdfButton());
    fireEvent.click(pdfButton());

    await waitFor(() => expect(downloaded).toHaveLength(1), { timeout: 15000 });
    expect(downloaded).toHaveLength(1);
    await waitFor(() => expect(pdfButton().disabled).toBe(false));
  }, 20000);

  it('does not download anything when the model cannot be measured', async () => {
    renderPanel({ object: { ...objectOf(), params: { ...objectOf().params, widthCm: Number.NaN } } });

    // The panel cannot even build the BOM, so the export controls are not shown.
    expect(screen.queryByTestId('manufacturing-pdf')).toBeNull();
    expect(downloaded).toHaveLength(0);
  });

  it('keeps the existing single-format exports working', async () => {
    renderPanel();
    fireEvent.click(screen.getByText('BOM (CSV)'));
    await waitFor(() => expect(downloaded).toHaveLength(1));
    expect(downloaded[0].type).toBe('text/csv');
    // No PDF was produced by the CSV path.
    expect(downloaded[0].name).not.toContain('.pdf');
  });
});
