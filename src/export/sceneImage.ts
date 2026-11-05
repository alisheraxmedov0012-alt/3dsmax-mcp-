import { slugifyName } from './exportNaming';
import { pngSize } from './pngSize';

export interface PngSize {
  width: number;
  height: number;
}

export const PNG_PRESETS = {
  preview: { width: 1024, height: 576 },
  /** Marketplace package previews keep their original 1280x720 size. */
  package: { width: 1280, height: 720 },
  high: { width: 2560, height: 1440 },
  standard: { width: 1920, height: 1080 },
  uhd: { width: 3840, height: 2160 },
} as const satisfies Record<string, PngSize>;

export type PngPreset = keyof typeof PNG_PRESETS;

/** Presets the render panel offers. Others remain available to export flows. */
export const UI_PNG_PRESETS = ['standard', 'uhd'] as const satisfies readonly PngPreset[];

export const PNG_PRESET_LABELS: Record<PngPreset, string> = {
  preview: `Tezkor (${PNG_PRESETS.preview.width}×${PNG_PRESETS.preview.height})`,
  package: `Paket (${PNG_PRESETS.package.width}×${PNG_PRESETS.package.height})`,
  high: `Yuqori (${PNG_PRESETS.high.width}×${PNG_PRESETS.high.height})`,
  standard: `Standard (${PNG_PRESETS.standard.width}×${PNG_PRESETS.standard.height})`,
  uhd: `UHD (${PNG_PRESETS.uhd.width}×${PNG_PRESETS.uhd.height})`,
};

/** Upper safety bounds for capture targets. 9 MP accommodates 4K UHD. */
export const MAX_RENDER_DIMENSION = 4096;
export const MAX_RENDER_PIXELS = 9_000_000;

export interface ResolvedPngSize extends PngSize {
  /** True when the requested size had to be scaled down to satisfy the caps. */
  clamped: boolean;
}

/**
 * Resolves a preset into a safe pixel size. Presets are validated against the
 * renderer caps; anything larger is scaled down preserving the aspect ratio.
 */
export function resolvePngSize(preset: PngPreset): ResolvedPngSize {
  const requested = PNG_PRESETS[preset];
  return clampPngSize(requested);
}

/**
 * Validate an explicit capture size. Unlike `clampPngSize`, this rejects a
 * request instead of silently shrinking it, so a caller asking for 4K gets
 * either exactly 4K or a clear capability/size error.
 */
export function validateCaptureSize(
  width: number,
  height: number,
  maxTextureSize: number = MAX_RENDER_DIMENSION,
): PngSize {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("Capture o'lchami musbat va chekli bo'lishi kerak.");
  }
  const normalized = {
    width: Math.round(width),
    height: Math.round(height),
  };
  const textureLimit =
    Number.isFinite(maxTextureSize) && maxTextureSize > 0
      ? Math.min(MAX_RENDER_DIMENSION, maxTextureSize)
      : MAX_RENDER_DIMENSION;
  if (normalized.width > textureLimit || normalized.height > textureLimit) {
    throw new Error(
      `Capture ${normalized.width}x${normalized.height} bu qurilma uchun juda katta; maksimal ${textureLimit}px.`,
    );
  }
  const pixels = normalized.width * normalized.height;
  if (pixels > MAX_RENDER_PIXELS) {
    throw new Error(
      `Capture ${normalized.width}x${normalized.height} piksel limitidan oshadi (${MAX_RENDER_PIXELS}).`,
    );
  }
  return normalized;
}

export function clampPngSize(requested: PngSize): ResolvedPngSize {
  const width = Math.max(1, Math.round(requested.width));
  const height = Math.max(1, Math.round(requested.height));

  const dimensionScale = Math.min(1, MAX_RENDER_DIMENSION / width, MAX_RENDER_DIMENSION / height);
  const pixels = width * height;
  const pixelScale = pixels > MAX_RENDER_PIXELS ? Math.sqrt(MAX_RENDER_PIXELS / pixels) : 1;
  const scale = Math.min(dimensionScale, pixelScale);

  if (scale >= 1) {
    return { width, height, clamped: false };
  }
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    clamped: true,
  };
}

export function pngFileName(preset: PngPreset): string {
  return `3d-studio-ai-render-${preset}.png`;
}

/** Safe, human-readable download name derived from the project name. */
export function renderPngFilename(projectName: string, preset: PngPreset): string {
  return `${slugifyName(projectName, '3d-studio-ai')}-render-${preset}.png`;
}

/** Capture-time options the renderer must honour. */
export interface PngCaptureRequest {
  transparent?: boolean;
}

export interface PngExportOptions {
  /** Overrides the default preset-based download name. */
  filename?: string;
  /** Captures with a transparent background instead of the scene background. */
  transparent?: boolean;
}

export interface PngExportDeps {
  /** Renders the current composition at the given size and returns a PNG Blob. */
  capture: (size: PngSize, request?: PngCaptureRequest) => Promise<Blob>;
  /** Triggers a browser download (responsible for releasing its own URLs). */
  download: (blob: Blob, filename: string) => void;
}

export interface PngExportResult {
  size: PngSize;
  bytes: number;
  filename: string;
  transparent: boolean;
}

/**
 * Read the PNG header and verify both the signature and the real pixel size.
 * A capture that silently returns a mislabelled or differently sized bitmap is
 * treated as a failure rather than downloaded.
 */
export async function assertPngBlob(
  blob: Blob,
  expected: PngSize,
  label = 'PNG',
): Promise<void> {
  if (blob.size < 24) {
    throw new Error(`${label} bo'sh yoki juda kichik.`);
  }
  if (blob.type && blob.type !== 'image/png') {
    throw new Error(`${label} PNG emas (${blob.type}).`);
  }
  const header = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
  const size = pngSize(header);
  if (!size) {
    throw new Error(`${label} haqiqiy PNG fayl emas.`);
  }
  if (size.widthPx !== expected.width || size.heightPx !== expected.height) {
    throw new Error(
      `${label} o'lchami kutilgandan farq qiladi: ` +
        `${size.widthPx}×${size.heightPx}, kutilgan ${expected.width}×${expected.height}.`,
    );
  }
}

/**
 * Renders and downloads a PNG for the given preset. The capture and download
 * steps are injected so the orchestration can be tested without WebGL/DOM.
 * Throws on capture/download failure; the caller maps that to a user message.
 */
export async function exportScenePng(
  preset: PngPreset,
  deps: PngExportDeps,
  options: PngExportOptions = {},
): Promise<PngExportResult> {
  const resolved = resolvePngSize(preset);
  const size: PngSize = { width: resolved.width, height: resolved.height };
  const transparent = options.transparent === true;
  const blob = transparent
    ? await deps.capture(size, { transparent: true })
    : await deps.capture(size);
  await assertPngBlob(blob, size);
  const filename = options.filename ?? pngFileName(preset);
  deps.download(blob, filename);
  return {
    size: { width: size.width, height: size.height },
    bytes: blob.size,
    filename,
    transparent,
  };
}
