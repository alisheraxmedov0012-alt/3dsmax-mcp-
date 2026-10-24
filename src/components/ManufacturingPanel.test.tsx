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
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: (blob: Blob) => {
      downloaded.push({ name: '', type: blob.type, size: blob.size });
      return 'blob:test';
    },
    revokeObjectURL: () => undefined,
  });
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
    expect(packageButton().disabled).toBe(false);
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
