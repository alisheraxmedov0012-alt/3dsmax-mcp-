import { describe, expect, it, vi } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import {
  buildRenderBatchZip,
  exportRenderBatch,
  renderBatchFilename,
  verifyRenderBatchZip,
} from './renderBatch';
import { PRODUCT_PREVIEW_VIEWS, type ProductPreviewView } from '../viewer/productPreviewViews';
import { testPngBlob, testPngBytes } from './pngFixture';
import type { PngSize } from './sceneImage';
import { pngSize } from './pngSize';

const NOW = new Date('2026-11-05T12:00:00Z');

function captureAll(width: number, height: number) {
  return vi.fn(async (_view: ProductPreviewView, _size: PngSize) =>
    testPngBlob(width, height),
  );
}

describe('renderBatchFilename', () => {
  it('derives a safe ZIP name from the project name', () => {
    expect(renderBatchFilename('Oshxona shkafi 2')).toBe(
      'oshxona-shkafi-2-render-6-angles.zip',
    );
    expect(renderBatchFilename('../../etc/passwd')).toBe(
      'etc-passwd-render-6-angles.zip',
    );
    expect(renderBatchFilename('')).toBe('3d-studio-ai-render-6-angles.zip');
  });
});

describe('exportRenderBatch', () => {
  it('captures the six canonical angles sequentially with progress', async () => {
    const capture = captureAll(1920, 1080);
    const progress: Array<{ current: number; total: number; label: string }> = [];
    const download = vi.fn();

    const result = await exportRenderBatch(
      'standard',
      { capture, download, now: NOW },
      {
        projectName: 'Oshxona',
        onProgress: (entry) =>
          progress.push({
            current: entry.current,
            total: entry.total,
            label: entry.view.label,
          }),
      },
    );

    expect(capture).toHaveBeenCalledTimes(PRODUCT_PREVIEW_VIEWS.length);
    expect(capture.mock.calls.map(([view]) => view.filename)).toEqual(
      PRODUCT_PREVIEW_VIEWS.map((view) => view.filename),
    );
    expect(capture.mock.calls.every(([, size]) => size.width === 1920 && size.height === 1080)).toBe(
      true,
    );
    expect(progress).toEqual(
      PRODUCT_PREVIEW_VIEWS.map((view, index) => ({
        current: index + 1,
        total: PRODUCT_PREVIEW_VIEWS.length,
        label: view.label,
      })),
    );
    expect(result.files.map((file) => file.name)).toEqual(
      PRODUCT_PREVIEW_VIEWS.map((view) => view.filename),
    );
    expect(result.filename).toBe('oshxona-render-6-angles.zip');
    expect(download).toHaveBeenCalledTimes(1);
    expect(download.mock.calls[0][1]).toBe(result.filename);
  });

  it('puts exactly six validated PNGs in the ZIP', async () => {
    const download = vi.fn();
    const result = await exportRenderBatch(
      'standard',
      { capture: captureAll(1920, 1080), download, now: NOW },
      { projectName: 'Oshxona' },
    );

    const zip = download.mock.calls[0][0] as Blob;
    const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(
      PRODUCT_PREVIEW_VIEWS.map((view) => view.filename).sort(),
    );
    for (const view of PRODUCT_PREVIEW_VIEWS) {
      expect(files[view.filename]).toBeDefined();
      expect(pngSize(files[view.filename])).toEqual({ widthPx: 1920, heightPx: 1080 });
    }
    expect(result.bytes).toBeGreaterThan(0);
  });

  it('uses the requested UHD size for every frame', async () => {
    const capture = captureAll(3840, 2160);
    const download = vi.fn();

    await exportRenderBatch(
      'uhd',
      { capture, download, now: NOW },
      { projectName: 'UHD' },
    );

    expect(capture).toHaveBeenCalledTimes(6);
    expect(capture.mock.calls.every(([, size]) => size.width === 3840)).toBe(true);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('fails fast and never downloads a partial ZIP', async () => {
    const capture = vi.fn(async (view: { id: string }) => {
      if (view.id === 'side') {
        throw new Error('readback failed');
      }
      return testPngBlob(1920, 1080);
    });
    const download = vi.fn();

    await expect(
      exportRenderBatch(
        'standard',
        { capture, download, now: NOW },
        { projectName: 'Oshxona' },
      ),
    ).rejects.toThrow(/"O'ng yon ko'rinish" kadri olinmadi: readback failed/);

    expect(capture).toHaveBeenCalledTimes(3);
    expect(download).not.toHaveBeenCalled();
  });

  it('rejects a frame whose PNG dimensions do not match', async () => {
    let call = 0;
    const capture = vi.fn(async () => {
      call += 1;
      return call === 2 ? testPngBlob(1024, 576) : testPngBlob(1920, 1080);
    });
    const download = vi.fn();

    await expect(
      exportRenderBatch('standard', { capture, download, now: NOW }),
    ).rejects.toThrow(/1024×576/);
    expect(download).not.toHaveBeenCalled();
  });

  it('rejects a frame that is not a PNG', async () => {
    const capture = vi.fn(async () => new Blob([new Uint8Array(64)], { type: 'image/png' }));
    const download = vi.fn();

    await expect(
      exportRenderBatch('standard', { capture, download, now: NOW }),
    ).rejects.toThrow(/haqiqiy PNG emas/);
    expect(download).not.toHaveBeenCalled();
  });

  it('leaves no state behind: a later batch still succeeds', async () => {
    const failing = vi.fn(async () => {
      throw new Error('readback failed');
    });
    const download = vi.fn();
    await expect(
      exportRenderBatch('standard', { capture: failing, download, now: NOW }),
    ).rejects.toThrow(/kadri olinmadi/);
    expect(download).not.toHaveBeenCalled();

    const success = await exportRenderBatch(
      'standard',
      { capture: captureAll(1920, 1080), download, now: NOW },
      { projectName: 'Oshxona' },
    );
    expect(success.files).toHaveLength(6);
    expect(download).toHaveBeenCalledTimes(1);
  });
});

describe('ZIP verification', () => {
  it('accepts a complete six-frame archive', async () => {
    const result = await exportRenderBatch(
      'standard',
      { capture: captureAll(1920, 1080), download: vi.fn(), now: NOW },
      { projectName: 'Oshxona' },
    );
    const zip = buildRenderBatchZip(
      PRODUCT_PREVIEW_VIEWS.map((view) => ({
        name: view.filename,
        bytes: testPngBytes(1920, 1080),
      })),
      NOW,
    );
    expect(verifyRenderBatchZip(zip, { width: 1920, height: 1080 })).toEqual({
      ok: true,
      problems: [],
    });
    expect(result.bytes).toBeGreaterThan(0);
  });

  it('reports a missing entry', () => {
    const files: Record<string, Uint8Array> = {};
    for (const view of PRODUCT_PREVIEW_VIEWS.slice(0, 5)) {
      files[view.filename] = testPngBytes(1920, 1080);
    }
    const zip = zipSync(files, { mtime: NOW });
    const verification = verifyRenderBatchZip(zip, { width: 1920, height: 1080 });
    expect(verification.ok).toBe(false);
    expect(verification.problems[0]).toMatch(/Arxiv tarkibi/);
  });

  it('reports a corrupt PNG entry', () => {
    const files: Record<string, Uint8Array> = {};
    for (const view of PRODUCT_PREVIEW_VIEWS) {
      files[view.filename] = testPngBytes(1920, 1080);
    }
    files['preview-hero.png'] = new Uint8Array(64);
    const zip = zipSync(files, { mtime: NOW });
    const verification = verifyRenderBatchZip(zip, { width: 1920, height: 1080 });
    expect(verification.ok).toBe(false);
    expect(verification.problems.join(' ')).toMatch(/haqiqiy PNG emas/);
  });

  it('refuses to build a ZIP with the wrong frame count', () => {
    expect(() =>
      buildRenderBatchZip(
        [{ name: 'preview-hero.png', bytes: testPngBytes(1920, 1080) }],
        NOW,
      ),
    ).toThrow(/6 ta kadr/);
  });
});
