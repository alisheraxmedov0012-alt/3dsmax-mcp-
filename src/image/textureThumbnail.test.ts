import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTextureContent } from '../api/textureApi';
import { clearTextureThumbnailCache, loadTextureThumbnail } from './textureThumbnail';

vi.mock('../api/textureApi', () => ({
  fetchTextureContent: vi.fn(),
}));

const fetchMock = vi.mocked(fetchTextureContent);

function stubCanvas() {
  const canvases: Array<{ width: number; height: number }> = [];
  vi.stubGlobal('document', {
    createElement: () => {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
        toBlob: (callback: (blob: Blob | null) => void) =>
          callback(new Blob(['thumb'], { type: 'image/png' })),
      };
      canvases.push(canvas);
      return canvas;
    },
  });
  return canvases;
}

function stubBitmap(width = 1024, height = 512) {
  const close = vi.fn();
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width, height, close })),
  );
  return close;
}

afterEach(() => {
  clearTextureThumbnailCache();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('loadTextureThumbnail', () => {
  it('downscales to 128 px and caches the request', async () => {
    const canvases = stubCanvas();
    const close = stubBitmap();
    fetchMock.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));

    const first = await loadTextureThumbnail('tex-1');
    const second = await loadTextureThumbnail('tex-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(canvases[0]).toMatchObject({ width: 128, height: 64 });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failure, so a retry can succeed', async () => {
    stubCanvas();
    stubBitmap();
    fetchMock
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Blob(['png'], { type: 'image/png' }));

    await expect(loadTextureThumbnail('tex-2')).rejects.toThrow('offline');
    const retry = await loadTextureThumbnail('tex-2');
    expect(retry.type).toBe('image/png');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
