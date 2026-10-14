import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadArrayBuffer, downloadBlob } from './downloadFile';

interface FakeAnchor {
  href: string;
  download: string;
  rel: string;
  style: Record<string, string>;
  click: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

describe('downloadArrayBuffer', () => {
  let anchor: FakeAnchor;
  let appendChild: ReturnType<typeof vi.fn>;
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    anchor = { href: '', download: '', rel: '', style: {}, click: vi.fn(), remove: vi.fn() };
    appendChild = vi.fn();
    createObjectURL = vi.fn(() => 'blob:test-url');
    revokeObjectURL = vi.fn();

    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: { appendChild },
    });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a download link with the given filename and clicks it', () => {
    downloadArrayBuffer(new ArrayBuffer(8), '3d-studio-ai-table.glb');

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.download).toBe('3d-studio-ai-table.glb');
    expect(anchor.href).toBe('blob:test-url');
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
  });

  it('revokes the temporary object URL once the download has started', () => {
    vi.useFakeTimers();
    try {
      downloadArrayBuffer(new ArrayBuffer(8), 'x.glb');
      expect(revokeObjectURL).not.toHaveBeenCalled();

      vi.runAllTimers();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('downloadBlob', () => {
  let anchor: FakeAnchor;
  let appendChild: ReturnType<typeof vi.fn>;
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    anchor = { href: '', download: '', rel: '', style: {}, click: vi.fn(), remove: vi.fn() };
    appendChild = vi.fn();
    createObjectURL = vi.fn(() => 'blob:png-url');
    revokeObjectURL = vi.fn();

    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: { appendChild },
    });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('wraps a Blob in an object URL and downloads it with the given filename', () => {
    vi.useFakeTimers();
    try {
      const blob = new Blob([new Uint8Array(4)], { type: 'image/png' });
      downloadBlob(blob, '3d-studio-ai-render-standard.png');

      expect(createObjectURL).toHaveBeenCalledWith(blob);
      expect(anchor.download).toBe('3d-studio-ai-render-standard.png');
      expect(anchor.href).toBe('blob:png-url');
      expect(anchor.click).toHaveBeenCalledOnce();
      expect(anchor.remove).toHaveBeenCalledOnce();

      vi.runAllTimers();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:png-url');
    } finally {
      vi.useRealTimers();
    }
  });
});
