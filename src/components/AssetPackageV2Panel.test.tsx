// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { createDefaultSettings } from '../scene/sceneSettings';
import { createTableSceneObject, SCENE_SCHEMA_VERSION, type SceneData } from '../scene/types';
import { AssetPackageV2Panel } from './AssetPackageV2Panel';
import { buildAssetPackageV2 } from '../export/assetPackageV2';
import { downloadBlob } from '../export/downloadFile';

vi.mock('../export/downloadFile', () => ({
  downloadBlob: vi.fn(),
}));

vi.mock('../export/assetPackageV2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../export/assetPackageV2')>();
  return {
    ...actual,
    buildAssetPackageV2: vi.fn(),
  };
});

const buildMock = vi.mocked(buildAssetPackageV2);
const downloadMock = vi.mocked(downloadBlob);

function scene(): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { widthCm: 400, lengthCm: 500, heightCm: 280 },
    objects: [createTableSceneObject('table-1')],
    settings: createDefaultSettings(),
  };
}

function assetResult() {
  return {
    ok: true as const,
    asset: {
      bytes: new Uint8Array(1024),
      filename: 'oak-001-asset-v2.zip',
      mimeType: 'application/zip' as const,
      metadata: { models: [{}, {}, {}, {}] },
      entries: [{ path: 'README.txt', bytes: 10 }, { path: 'metadata.json', bytes: 10 }],
    },
  };
}

function renderPanel(overrides: Partial<ComponentProps<typeof AssetPackageV2Panel>> = {}) {
  const data = scene();
  return render(
    <AssetPackageV2Panel
      scene={data}
      object={data.objects[0]}
      projectName="Eman stol"
      {...overrides}
    />,
  );
}

beforeEach(() => {
  buildMock.mockReset();
  downloadMock.mockReset();
  buildMock.mockResolvedValue(assetResult() as never);
});

afterEach(cleanup);

describe('AssetPackageV2Panel', () => {
  it('shows product, license and format controls with safe defaults', () => {
    renderPanel();
    expect((screen.getByTestId('asset-v2-title') as HTMLInputElement).value).toBe('Eman stol');
    expect((screen.getByTestId('asset-v2-include-previews') as HTMLInputElement).checked).toBe(
      true,
    );
    for (const format of ['glb', 'obj', 'stl', '3mf'] as const) {
      expect((screen.getByTestId(`asset-v2-format-${format}`) as HTMLInputElement).checked).toBe(
        true,
      );
    }
    expect(screen.getByTestId('asset-v2-license-name')).toBeTruthy();
    expect(screen.getByTestId('asset-v2-license-spdx')).toBeTruthy();
    expect(screen.getByTestId('asset-v2-license-text')).toBeTruthy();
  });

  it('validates title, SKU, formats and license text', async () => {
    renderPanel();
    fireEvent.change(screen.getByTestId('asset-v2-title'), { target: { value: '  ' } });
    fireEvent.click(screen.getByTestId('asset-v2-download'));
    expect(screen.getByTestId('asset-v2-error').textContent).toMatch(/nomi majburiy/);
    expect(buildMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('asset-v2-title'), { target: { value: 'Stol' } });
    fireEvent.change(screen.getByTestId('asset-v2-sku'), { target: { value: 'bad sku' } });
    fireEvent.click(screen.getByTestId('asset-v2-download'));
    expect(screen.getByTestId('asset-v2-error').textContent).toMatch(/SKU/);

    fireEvent.change(screen.getByTestId('asset-v2-sku'), { target: { value: '' } });
    for (const format of ['glb', 'obj', 'stl', '3mf'] as const) {
      fireEvent.click(screen.getByTestId(`asset-v2-format-${format}`));
    }
    fireEvent.click(screen.getByTestId('asset-v2-download'));
    expect(screen.getByTestId('asset-v2-error').textContent).toMatch(/formatini tanlang/);

    fireEvent.click(screen.getByTestId('asset-v2-format-glb'));
    fireEvent.change(screen.getByTestId('asset-v2-license-text'), {
      target: { value: 'Custom license' },
    });
    fireEvent.click(screen.getByTestId('asset-v2-download'));
    expect(screen.getByTestId('asset-v2-error').textContent).toMatch(/litsenziya nomi/);
  });

  it('builds the selected formats under the SKU folder and downloads the ZIP', async () => {
    const previews = vi.fn(async () => [
      { name: 'preview-hero.png', bytes: new Uint8Array([1, 2, 3]) },
    ]);
    renderPanel({ onCaptureProductPreviews: previews });
    fireEvent.change(screen.getByTestId('asset-v2-sku'), { target: { value: 'OAK-001' } });
    fireEvent.change(screen.getByTestId('asset-v2-description'), {
      target: { value: 'Solid oak table' },
    });
    fireEvent.change(screen.getByTestId('asset-v2-author'), { target: { value: 'Studio' } });
    fireEvent.change(screen.getByTestId('asset-v2-license-name'), {
      target: { value: 'CC BY 4.0' },
    });
    fireEvent.change(screen.getByTestId('asset-v2-license-spdx'), {
      target: { value: 'CC-BY-4.0' },
    });
    fireEvent.change(screen.getByTestId('asset-v2-license-text'), {
      target: { value: 'Custom license text' },
    });
    fireEvent.click(screen.getByTestId('asset-v2-format-stl'));
    fireEvent.click(screen.getByTestId('asset-v2-format-3mf'));
    fireEvent.click(screen.getByTestId('asset-v2-download'));

    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    expect(previews).toHaveBeenCalledTimes(1);
    expect(buildMock).toHaveBeenCalledTimes(1);
    const [input, , options] = buildMock.mock.calls[0];
    expect(input.product).toMatchObject({
      title: 'Eman stol',
      sku: 'OAK-001',
      description: 'Solid oak table',
      author: 'Studio',
      license: { name: 'CC BY 4.0', spdx: 'CC-BY-4.0', text: 'Custom license text' },
    });
    expect(options?.formats).toEqual(['glb', 'obj']);
    expect(options?.archiveRoot).toBe('OAK-001');
    expect(downloadMock.mock.calls[0][1]).toBe('oak-001-asset-v2.zip');
    expect(screen.getByTestId('asset-v2-message').textContent).toMatch(/ZIP tayyor/);
  });

  it('can exclude previews without calling the capture handler', async () => {
    const previews = vi.fn(async () => []);
    renderPanel({ onCaptureProductPreviews: previews });
    fireEvent.click(screen.getByTestId('asset-v2-include-previews'));
    fireEvent.click(screen.getByTestId('asset-v2-download'));

    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    expect(previews).not.toHaveBeenCalled();
    const [input] = buildMock.mock.calls[0];
    expect(input.previews).toBeUndefined();
  });

  it('prevents duplicate package generation while a build is pending', async () => {
    let resolveBuild: (value: unknown) => void = () => undefined;
    buildMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBuild = resolve;
        }) as never,
    );
    renderPanel();
    fireEvent.click(screen.getByTestId('asset-v2-include-previews'));
    fireEvent.click(screen.getByTestId('asset-v2-download'));
    fireEvent.click(screen.getByTestId('asset-v2-download'));
    expect(buildMock).toHaveBeenCalledTimes(1);
    resolveBuild(assetResult());
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
  });

  it('surfaces builder and capture errors instead of downloading', async () => {
    buildMock.mockResolvedValue({ ok: false, reason: 'exporter failed' } as never);
    renderPanel();
    // No preview handler: exclude previews so the builder is reached.
    fireEvent.click(screen.getByTestId('asset-v2-include-previews'));
    fireEvent.click(screen.getByTestId('asset-v2-download'));
    await waitFor(() =>
      expect(screen.getByTestId('asset-v2-error').textContent).toMatch(/exporter failed/),
    );
    expect(downloadMock).not.toHaveBeenCalled();

    cleanup();
    buildMock.mockClear();
    renderPanel({
      onCaptureProductPreviews: async () => {
        throw new Error('capture failed');
      },
    });
    fireEvent.click(screen.getByTestId('asset-v2-download'));
    await waitFor(() =>
      expect(screen.getByTestId('asset-v2-error').textContent).toMatch(/capture failed/),
    );
    expect(buildMock).not.toHaveBeenCalled();
  });

  it('honours the pending-AI-preview block', async () => {
    const previews = vi.fn(async () => []);
    renderPanel({
      captureBlockedReason: 'Apply yoki Cancel qiling.',
      onCaptureProductPreviews: previews,
    });
    fireEvent.click(screen.getByTestId('asset-v2-download'));
    expect(screen.getByTestId('asset-v2-error').textContent).toMatch(/Apply yoki Cancel/);
    expect(previews).not.toHaveBeenCalled();
    expect(buildMock).not.toHaveBeenCalled();
  });
});
