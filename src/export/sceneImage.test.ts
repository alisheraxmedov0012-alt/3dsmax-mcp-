import { describe, expect, it, vi } from 'vitest';
import {
  MAX_RENDER_DIMENSION,
  MAX_RENDER_PIXELS,
  PNG_PRESET_LABELS,
  PNG_PRESETS,
  UI_PNG_PRESETS,
  assertPngBlob,
  clampPngSize,
  exportScenePng,
  pngFileName,
  renderPngFilename,
  resolvePngSize,
  validateCaptureSize,
} from './sceneImage';
import { testPngBlob, testPngBytes } from './pngFixture';

describe('resolution presets', () => {
  it('keeps the legacy presets and adds package, standard and uhd', () => {
    expect(PNG_PRESETS.preview).toEqual({ width: 1024, height: 576 });
    expect(PNG_PRESETS.package).toEqual({ width: 1280, height: 720 });
    expect(PNG_PRESETS.high).toEqual({ width: 2560, height: 1440 });
    expect(PNG_PRESETS.standard).toEqual({ width: 1920, height: 1080 });
    expect(PNG_PRESETS.uhd).toEqual({ width: 3840, height: 2160 });
  });

  it('offers only standard and uhd in the render panel', () => {
    expect([...UI_PNG_PRESETS]).toEqual(['standard', 'uhd']);
    expect(PNG_PRESET_LABELS.standard).toContain('1920×1080');
    expect(PNG_PRESET_LABELS.uhd).toContain('3840×2160');
  });

  it('resolves every preset without clamping', () => {
    for (const preset of Object.keys(PNG_PRESETS) as Array<keyof typeof PNG_PRESETS>) {
      expect(resolvePngSize(preset)).toEqual({ ...PNG_PRESETS[preset], clamped: false });
    }
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

  it('accepts 4K UHD exactly', () => {
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

  it('reports an explicit error instead of silently shrinking UHD on a small GPU', () => {
    expect(validateCaptureSize(1920, 1080, 2048)).toEqual({ width: 1920, height: 1080 });
    expect(() => validateCaptureSize(3840, 2160, 2048)).toThrow(/2048px/);
  });
});

describe('filenames', () => {
  it('keeps the legacy preset filename', () => {
    expect(pngFileName('preview')).toBe('3d-studio-ai-render-preview.png');
    expect(pngFileName('uhd')).toBe('3d-studio-ai-render-uhd.png');
  });

  it('builds a safe filename from the project name', () => {
    expect(renderPngFilename('Oshxona shkafi 2', 'standard')).toBe(
      'oshxona-shkafi-2-render-standard.png',
    );
    expect(renderPngFilename('../../etc/passwd', 'uhd')).toBe(
      'etc-passwd-render-uhd.png',
    );
    expect(renderPngFilename('Ошхона', 'standard')).toBe(
      '3d-studio-ai-render-standard.png',
    );
    expect(renderPngFilename('   ', 'standard')).toBe('3d-studio-ai-render-standard.png');
  });
});

describe('assertPngBlob', () => {
  it('accepts a PNG with the expected dimensions', async () => {
    await expect(assertPngBlob(testPngBlob(1920, 1080), { width: 1920, height: 1080 })).resolves.toBe(
      undefined,
    );
  });

  it('rejects a non-PNG blob', async () => {
    const blob = new Blob([new Uint8Array(2048)], { type: 'image/png' });
    await expect(assertPngBlob(blob, { width: 1920, height: 1080 })).rejects.toThrow(
      /haqiqiy PNG/,
    );
  });

  it('rejects a mislabelled MIME type', async () => {
    const blob = new Blob([testPngBytes(1920, 1080)], { type: 'image/jpeg' });
    await expect(assertPngBlob(blob, { width: 1920, height: 1080 })).rejects.toThrow(/PNG emas/);
  });

  it('rejects the wrong pixel size', async () => {
    await expect(assertPngBlob(testPngBlob(1280, 720), { width: 1920, height: 1080 })).rejects.toThrow(
      /1280×720/,
    );
  });

  it('rejects an empty blob', async () => {
    await expect(assertPngBlob(new Blob([]), { width: 1, height: 1 })).rejects.toThrow(/bo'sh/);
  });
});

describe('exportScenePng', () => {
  it('captures at the resolved size and downloads the PNG', async () => {
    const blob = testPngBlob(1920, 1080);
    const capture = vi.fn(async () => blob);
    const download = vi.fn();

    const result = await exportScenePng('standard', { capture, download });

    expect(capture).toHaveBeenCalledWith({ width: 1920, height: 1080 });
    expect(download).toHaveBeenCalledWith(blob, '3d-studio-ai-render-standard.png');
    expect(result).toEqual({
      size: { width: 1920, height: 1080 },
      bytes: blob.size,
      filename: '3d-studio-ai-render-standard.png',
      transparent: false,
    });
  });

  it('exports UHD at exactly 3840x2160', async () => {
    const blob = testPngBlob(3840, 2160);
    const capture = vi.fn(async () => blob);
    const download = vi.fn();

    const result = await exportScenePng('uhd', { capture, download });

    expect(capture).toHaveBeenCalledWith({ width: 3840, height: 2160 });
    expect(result.size).toEqual({ width: 3840, height: 2160 });
  });

  it('requests a transparent capture and uses the project filename', async () => {
    const blob = testPngBlob(1920, 1080);
    const capture = vi.fn(async () => blob);
    const download = vi.fn();

    const result = await exportScenePng(
      'standard',
      { capture, download },
      { transparent: true, filename: 'oshxona-render-standard.png' },
    );

    expect(capture).toHaveBeenCalledWith(
      { width: 1920, height: 1080 },
      { transparent: true },
    );
    expect(download).toHaveBeenCalledWith(blob, 'oshxona-render-standard.png');
    expect(result.transparent).toBe(true);
    expect(result.filename).toBe('oshxona-render-standard.png');
  });

  it('propagates capture failures and does not download', async () => {
    const capture = vi.fn(async () => {
      throw new Error('renderer failed');
    });
    const download = vi.fn();

    await expect(exportScenePng('high', { capture, download })).rejects.toThrow('renderer failed');
    expect(download).not.toHaveBeenCalled();
  });

  it('does not download a mislabelled or wrongly sized bitmap', async () => {
    const capture = vi.fn(async () => testPngBlob(1280, 720));
    const download = vi.fn();

    await expect(exportScenePng('standard', { capture, download })).rejects.toThrow(/1280×720/);
    expect(download).not.toHaveBeenCalled();
  });
});
