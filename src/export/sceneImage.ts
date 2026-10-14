export interface PngSize {
  width: number;
  height: number;
}

export const PNG_PRESETS = {
  standard: { width: 1280, height: 720 },
  high: { width: 2560, height: 1440 },
} as const satisfies Record<string, PngSize>;

export type PngPreset = keyof typeof PNG_PRESETS;

/** Upper safety bounds so a high-resolution capture cannot exhaust mobile memory. */
export const MAX_RENDER_DIMENSION = 4096;
export const MAX_RENDER_PIXELS = 8_000_000;

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

export interface PngExportDeps {
  /** Renders the current composition at the given size and returns a PNG Blob. */
  capture: (size: PngSize) => Promise<Blob>;
  /** Triggers a browser download (responsible for releasing its own URLs). */
  download: (blob: Blob, filename: string) => void;
}

export interface PngExportResult {
  size: PngSize;
  bytes: number;
}

/**
 * Renders and downloads a PNG for the given preset. The capture and download
 * steps are injected so the orchestration can be tested without WebGL/DOM.
 * Throws on capture/download failure; the caller maps that to a user message.
 */
export async function exportScenePng(
  preset: PngPreset,
  deps: PngExportDeps,
): Promise<PngExportResult> {
  const size = resolvePngSize(preset);
  const blob = await deps.capture({ width: size.width, height: size.height });
  deps.download(blob, pngFileName(preset));
  return { size: { width: size.width, height: size.height }, bytes: blob.size };
}
