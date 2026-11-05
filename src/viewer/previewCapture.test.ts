import { describe, expect, it, vi } from 'vitest';
import { PRODUCT_PREVIEW_VIEWS } from './productPreviewViews';
import { capturePreviewViews } from './previewCapture';

describe('capturePreviewViews', () => {
  it('captures the full default gallery in order', async () => {
    const capture = vi.fn(async (view: { id: string }) => `bytes:${view.id}`);
    const result = await capturePreviewViews(PRODUCT_PREVIEW_VIEWS, capture);

    expect(capture).toHaveBeenCalledTimes(PRODUCT_PREVIEW_VIEWS.length);
    expect(result.map((entry) => entry.view.id)).toEqual(
      PRODUCT_PREVIEW_VIEWS.map((view) => view.id),
    );
    expect(result.map((entry) => entry.value)).toEqual(
      PRODUCT_PREVIEW_VIEWS.map((view) => `bytes:${view.id}`),
    );
    expect(new Set(result.map((entry) => entry.view.filename)).size).toBe(
      PRODUCT_PREVIEW_VIEWS.length,
    );
  });

  it('stops at the first failure and does not silently continue', async () => {
    const capture = vi.fn(async (view: { id: string }) => {
      if (view.id === 'side') {
        throw new Error('readback failed');
      }
      return view.id;
    });

    await expect(capturePreviewViews(PRODUCT_PREVIEW_VIEWS, capture)).rejects.toThrow(
      'readback failed',
    );
    expect(capture).toHaveBeenCalledTimes(3);
    expect(capture.mock.calls.map(([view]) => view.id)).toEqual(['hero', 'front', 'side']);
  });
});
