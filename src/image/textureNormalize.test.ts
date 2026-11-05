import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultTextureTargetSize,
  normalizeTextureForUpload,
  TextureNormalizeError,
  TEXTURE_TARGET_DESKTOP,
  TEXTURE_TARGET_MOBILE,
} from './textureNormalize';

interface CanvasStub {
  width: number;
  height: number;
  getContext: (id: string) => { drawImage: ReturnType<typeof vi.fn> } | null;
  toBlob: (callback: (blob: Blob | null) => void, type?: string) => void;
}

const canvases: CanvasStub[] = [];

function setupCanvas() {
  canvases.length = 0;
  const createElement = () => {
    const canvas: CanvasStub = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (callback, type) => callback(new Blob(['png'], { type: type ?? 'image/png' })),
    };
    canvases.push(canvas);
    return canvas;
  };
  vi.stubGlobal('document', { createElement });
  return createElement;
}

function setupBitmap(width = 100, height = 100) {
  const close = vi.fn();
  const create = vi.fn(async () => ({ width, height, close }));
  vi.stubGlobal('createImageBitmap', create);
  return { create, close };
}

afterEach(() => {
  vi.unstubAllGlobals();
  canvases.length = 0;
});

describe('normalizeTextureForUpload', () => {
  it('downscales to 2048 on desktop by default and encodes PNG', async () => {
    setupCanvas();
    const bitmap = setupBitmap();
    const file = new Blob(['source'], { type: 'image/jpeg' });

    const result = await normalizeTextureForUpload(file, { width: 4000, height: 2000 });

    expect(result.width).toBe(2048);
    expect(result.height).toBe(1024);
    expect(result.blob.type).toBe('image/png');
    expect(result.thumbnailBlob.type).toBe('image/png');
    expect(canvases[0]).toMatchObject({ width: 2048, height: 1024 });
    expect(canvases[1]).toMatchObject({ width: 128, height: 64 });
    expect(bitmap.create).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ resizeWidth: 2048, resizeHeight: 1024 }),
    );
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('honours the 1024 mobile/preview target and never upscales', async () => {
    setupCanvas();
    setupBitmap();
    const result = await normalizeTextureForUpload(
      new Blob(['source'], { type: 'image/png' }),
      { width: 600, height: 300 },
      { maxDimension: TEXTURE_TARGET_MOBILE },
    );
    expect(result.width).toBe(600);
    expect(result.height).toBe(300);
    expect(defaultTextureTargetSize()).toBe(TEXTURE_TARGET_DESKTOP);
  });

  it('reports a decode failure and closes nothing that was never decoded', async () => {
    setupCanvas();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('bad image');
      }),
    );
    await expect(
      normalizeTextureForUpload(new Blob(['source']), { width: 100, height: 100 }),
    ).rejects.toMatchObject<Partial<TextureNormalizeError>>({
      code: 'decode_failed',
    });
  });

  it('fails when the canvas backend is unavailable', async () => {
    vi.stubGlobal('document', undefined);
    setupBitmap();
    await expect(
      normalizeTextureForUpload(new Blob(['source']), { width: 100, height: 100 }),
    ).rejects.toMatchObject<Partial<TextureNormalizeError>>({
      code: 'canvas_unavailable',
    });
  });
});
