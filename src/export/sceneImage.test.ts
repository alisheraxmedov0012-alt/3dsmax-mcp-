import { describe, expect, it, vi } from 'vitest';
import {
  MAX_RENDER_DIMENSION,
  MAX_RENDER_PIXELS,
  PNG_PRESETS,
  clampPngSize,
  exportScenePng,
  pngFileName,
  resolvePngSize,
  validateCaptureSize,
} from './sceneImage';

describe('resolvePngSize', () => {
  it('returns the documented preset sizes', () => {
    expect(resolvePngSize('preview')).toEqual({
      width: PNG_PRESETS.preview.width,
      height: PNG_PRESETS.preview.height,
      clamped: false,
    });
    expect(resolvePngSize('standard')).toEqual({
      width: PNG_PRESETS.standard.width,
      height: PNG_PRESETS.standard.height,
      clamped: false,
    });
    expect(resolvePngSize('high')).toEqual({
      width: PNG_PRESETS.high.width,
      height: PNG_PRESETS.high.height,
      clamped: false,
    });
  });

  it('keeps presets within the renderer safety caps', () => {
    Object.values(PNG_PRESETS).forEach(({ width, height }) => {
      expect(width).toBeLessThanOrEqual(MAX_RENDER_DIMENSION);
      expect(height).toBeLessThanOrEqual(MAX_RENDER_DIMENSION);
      expect(width * height).toBeLessThanOrEqual(MAX_RENDER_PIXELS);
    });
  });
});

describe('clampPngSize', () => {
  it('scales down an oversized request preserving the aspect ratio', () => {
    const result = clampPngSize({ width: 9000, height: 9000 });
    expect(result.clamped).toBe(true);
    expect(result.width).toBeLessThanOrEqual(MAX_RENDER_DIMENSION);
    expect(result.height).toBeLessThanOrEqual(MAX_RENDER_DIMENSION);
    expect(result.width * result.height).toBeLessThanOrEqual(MAX_RENDER_PIXELS);
    expect(result.width).toBe(result.height);
  });

  it('never returns a zero or negative dimension', () => {
    const result = clampPngSize({ width: 0, height: -10 });
    expect(result.width).toBeGreaterThanOrEqual(1);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });

  it('leaves a valid size unchanged', () => {
    expect(clampPngSize({ width: 800, height: 600 })).toEqual({
      width: 800,
      height: 600,
      clamped: false,
    });
  });

  it('accepts 4K UHD within the revised pixel cap', () => {
    expect(MAX_RENDER_PIXELS).toBeGreaterThanOrEqual(3840 * 2160);
    expect(clampPngSize({ width: 3840, height: 2160 })).toEqual({
      width: 3840,
      height: 2160,
      clamped: false,
    });
  });
});
describe('validateCaptureSize', () => {
  it('accepts Full HD and 4K UHD exactly', () => {
    expect(validateCaptureSize(1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(validateCaptureSize(3840, 2160, 4096)).toEqual({ width: 3840, height: 2160 });
  });

  it('rejects invalid dimensions and oversized requests', () => {
    expect(() => validateCaptureSize(0, 1080)).toThrow(/musbat/);
    expect(() => validateCaptureSize(Number.NaN, 1080)).toThrow(/musbat/);
    expect(() => validateCaptureSize(5000, 1080)).toThrow(/juda katta/);
    expect(() => validateCaptureSize(4096, 3000)).toThrow(/piksel limitidan/);
  });

  it('honours a lower GPU texture-size capability', () => {
    expect(validateCaptureSize(1920, 1080, 2048)).toEqual({ width: 1920, height: 1080 });
    expect(() => validateCaptureSize(3840, 2160, 2048)).toThrow(/2048px/);
  });
});

describe('pngFileName', () => {
  it('produces a clear per-preset filename', () => {
    expect(pngFileName('preview')).toBe('3d-studio-ai-render-preview.png');
    expect(pngFileName('standard')).toBe('3d-studio-ai-render-standard.png');
    expect(pngFileName('high')).toBe('3d-studio-ai-render-high.png');
  });
});

describe('exportScenePng', () => {
  it('captures at the resolved size and downloads the PNG', async () => {
    const blob = new Blob([new Uint8Array(2048)], { type: 'image/png' });
    const capture = vi.fn(async () => blob);
    const download = vi.fn();

    const result = await exportScenePng('standard', { capture, download });

    expect(capture).toHaveBeenCalledWith({
      width: PNG_PRESETS.standard.width,
      height: PNG_PRESETS.standard.height,
    });
    expect(download).toHaveBeenCalledWith(blob, '3d-studio-ai-render-standard.png');
    expect(result.size).toEqual({
      width: PNG_PRESETS.standard.width,
      height: PNG_PRESETS.standard.height,
    });
    expect(result.bytes).toBe(blob.size);
  });

  it('propagates capture failures and does not download', async () => {
    const capture = vi.fn(async () => {
      throw new Error('renderer failed');
    });
    const download = vi.fn();

    await expect(exportScenePng('high', { capture, download })).rejects.toThrow('renderer failed');
    expect(download).not.toHaveBeenCalled();
  });

  it('exports a preview PNG at the preview size', async () => {
    const blob = new Blob([new Uint8Array(512)], { type: 'image/png' });
    const capture = vi.fn(async () => blob);
    const download = vi.fn();

    const result = await exportScenePng('preview', { capture, download });

    expect(capture).toHaveBeenCalledWith({
      width: PNG_PRESETS.preview.width,
      height: PNG_PRESETS.preview.height,
    });
    expect(download).toHaveBeenCalledWith(blob, '3d-studio-ai-render-preview.png');
    expect(result.size).toEqual({
      width: PNG_PRESETS.preview.width,
      height: PNG_PRESETS.preview.height,
    });
  });
});
