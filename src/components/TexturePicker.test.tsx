// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TexturePicker } from './TexturePicker';
import { ApiRequestError } from '../api/client';
import { setCsrfToken, getCsrfToken } from '../api/csrfStore';
import type { TextureAssetRef } from '../materials/asset';
import { setTextureResolutionStatus, clearTextureResolutionStatus } from '../materials/textureStatus';
import { listTextureAssets, uploadTextureAsset } from '../api/textureApi';

vi.mock('../api/textureApi', () => ({
  listTextureAssets: vi.fn(),
  uploadTextureAsset: vi.fn(),
}));

vi.mock('../image/textureThumbnail', () => ({
  loadTextureThumbnail: vi.fn(async () => new Blob(['thumb'], { type: 'image/png' })),
}));

vi.mock('../image/textureNormalize', () => ({
  defaultTextureTargetSize: () => 2048,
  normalizeTextureForUpload: vi.fn(async () => ({
    blob: new Blob(['normalized'], { type: 'image/png' }),
    width: 100,
    height: 100,
    thumbnailBlob: new Blob(['thumb'], { type: 'image/png' }),
  })),
  TEXTURE_TARGET_DESKTOP: 2048,
  TEXTURE_TARGET_MOBILE: 1024,
  TEXTURE_THUMBNAIL_SIZE: 128,
}));

const listMock = vi.mocked(listTextureAssets);
const uploadMock = vi.mocked(uploadTextureAsset);

const REF: TextureAssetRef = {
  id: 'tex-1',
  version: 1,
  role: 'baseColor',
  colorSpace: 'srgb',
  wrap: 'repeat',
};

function raw(id: string, filename = `${id}.png`) {
  return {
    id,
    version: 1,
    filename,
    mime_type: 'image/png',
    width: 512,
    height: 256,
    byte_size: 1000,
    content_hash: 'sha256:abc',
    source: { kind: 'bitmap' as const, generator: null },
  };
}

function pngFile(width = 100, height = 50, name = 'oak.png'): File {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  const file = new File([bytes], name, { type: 'image/png' });
  // jsdom's File does not implement Blob.arrayBuffer (browsers do).
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => bytes.buffer.slice(0) as ArrayBuffer,
  });
  return file;
}

function renderPicker(options: {
  currentRef?: TextureAssetRef | null;
  onApply?: (ref: TextureAssetRef) => void;
  onRemove?: () => void;
} = {}) {
  const onApply = options.onApply ?? vi.fn();
  const onRemove = options.onRemove ?? vi.fn();
  render(
    <TexturePicker
      objectId="obj-1"
      currentRef={options.currentRef ?? null}
      onApply={onApply}
      onRemove={onRemove}
      backendConfigured
    />,
  );
  return { onApply, onRemove };
}

beforeEach(() => {
  setCsrfToken('csrf-token');
  listMock.mockReset();
  uploadMock.mockReset();
  listMock.mockResolvedValue([]);
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:texture'),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  setCsrfToken(null);
  clearTextureResolutionStatus('obj-1');
  vi.unstubAllGlobals();
});

describe('TexturePicker', () => {
  it('lists textures with dimensions and applies one', async () => {
    listMock.mockResolvedValue([raw('tex-1', 'oak.png'), raw('tex-2', 'metal.png')]);
    const { onApply } = renderPicker();

    const first = await screen.findByTestId('texture-item-tex-1');
    expect(screen.getByText('oak.png')).toBeTruthy();
    expect(screen.getAllByText('512×256').length).toBeGreaterThan(0);

    fireEvent.click(first);
    expect(onApply).toHaveBeenCalledWith(REF);
    expect(screen.getByTestId('texture-item-tex-1').getAttribute('aria-pressed')).toBe('false');
  });

  it('marks the current texture and removes it', async () => {
    listMock.mockResolvedValue([raw('tex-1')]);
    const { onRemove } = renderPicker({ currentRef: REF });

    await screen.findByTestId('texture-item-tex-1');
    expect(screen.getByTestId('texture-current').textContent).toContain('tex-1.png');
    expect(screen.getByTestId('texture-item-tex-1').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Olib tashlash' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('warns when the stored current texture is no longer in the library', async () => {
    listMock.mockResolvedValue([]);
    renderPicker({ currentRef: REF });
    await screen.findByTestId('texture-empty');
    expect(screen.queryByText(/topilmadi/)).toBeTruthy();
  });

  it('uploads a valid PNG, stores the server id and applies it', async () => {
    uploadMock.mockResolvedValue(raw('tex-9', 'new.png'));
    const { onApply } = renderPicker();
    await screen.findByTestId('texture-empty');

    fireEvent.change(screen.getByLabelText('Tekstura fayli'), {
      target: { files: [pngFile()] },
    });

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    expect(uploadMock.mock.calls[0][1]).toBe('oak.png');
    expect(onApply).toHaveBeenCalledWith({ ...REF, id: 'tex-9' });
    expect(await screen.findByTestId('texture-item-tex-9')).toBeTruthy();
    expect(screen.getByTestId('texture-message').textContent).toContain('yuklandi');
  });

  it('reuses the existing id when the server reports a duplicate upload', async () => {
    listMock.mockResolvedValue([raw('tex-1')]);
    uploadMock.mockResolvedValue(raw('tex-1', 'first.png'));
    const { onApply } = renderPicker();
    await screen.findByTestId('texture-item-tex-1');

    fireEvent.change(screen.getByLabelText('Tekstura fayli'), {
      target: { files: [pngFile()] },
    });

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    expect(screen.getAllByTestId(/^texture-item-/)).toHaveLength(1);
    expect(onApply).toHaveBeenCalledWith(REF);
  });

  it('rejects an oversized dimension before calling the API', async () => {
    renderPicker();
    await screen.findByTestId('texture-empty');

    fireEvent.change(screen.getByLabelText('Tekstura fayli'), {
      target: { files: [pngFile(5000, 50)] },
    });

    await waitFor(() =>
      expect(screen.getByTestId('texture-message').textContent).toContain('4096'),
    );
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('shows upload errors from the server', async () => {
    uploadMock.mockRejectedValue(new ApiRequestError('payload_too_large', 'Fayl juda katta.', 413));
    renderPicker();
    await screen.findByTestId('texture-empty');

    fireEvent.change(screen.getByLabelText('Tekstura fayli'), {
      target: { files: [pngFile()] },
    });

    await waitFor(() =>
      expect(screen.getByTestId('texture-message').textContent).toContain('Fayl juda katta'),
    );
  });

  it('disables upload when there is no CSRF session', async () => {
    setCsrfToken(null);
    renderPicker();
    await screen.findByTestId('texture-empty');
    const upload = screen.getByRole('button', { name: 'Tekstura yuklash' }) as HTMLButtonElement;
    expect(upload.disabled).toBe(true);
    expect(screen.getByText(/tizimga kiring/)).toBeTruthy();
  });

  it('shows authentication failures from the list API and clears the stale token', async () => {
    listMock.mockRejectedValue(new ApiRequestError('not_authenticated', 'auth', 401));
    renderPicker();
    expect(await screen.findByText(/Teksturalar ro'yxati uchun tizimga kiring/)).toBeTruthy();
    expect(getCsrfToken()).toBeNull();
  });

  it('clears the token when the upload session has expired', async () => {
    uploadMock.mockRejectedValue(new ApiRequestError('not_authenticated', 'auth', 401));
    renderPicker();
    await screen.findByTestId('texture-empty');

    fireEvent.change(screen.getByLabelText('Tekstura fayli'), {
      target: { files: [pngFile()] },
    });

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getCsrfToken()).toBeNull());
    expect(screen.getByTestId('texture-message').textContent).toContain('Tizimga kiring');
    const upload = screen.getByRole('button', { name: 'Tekstura yuklash' }) as HTMLButtonElement;
    await waitFor(() => expect(upload.disabled).toBe(true));
  });

  it('clears the token when the server rejects the CSRF token', async () => {
    uploadMock.mockRejectedValue(new ApiRequestError('csrf_failed', 'CSRF', 403));
    renderPicker();
    await screen.findByTestId('texture-empty');

    fireEvent.change(screen.getByLabelText('Tekstura fayli'), {
      target: { files: [pngFile()] },
    });

    await waitFor(() => expect(getCsrfToken()).toBeNull());
    expect(screen.getByTestId('texture-message').textContent).toContain('CSRF');
  });

  it('surfaces a viewport texture failure warning', async () => {
    listMock.mockResolvedValue([raw('tex-1')]);
    setTextureResolutionStatus('obj-1', { state: 'error', message: '404' });
    renderPicker({ currentRef: REF });
    expect(await screen.findByRole('alert')).toBeTruthy();
    setTextureResolutionStatus('obj-1', { state: 'ready' });
  });
});
