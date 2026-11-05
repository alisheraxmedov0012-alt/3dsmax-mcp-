/**
 * Phase 5.7 — six-angle render batch.
 *
 * Kept renderer-free: the caller supplies a capture function, so ordering,
 * progress, per-frame validation, fail-fast and ZIP integrity can be tested
 * without a WebGL context. Entry names come from the canonical product preview
 * list that the asset package already uses.
 */
import { unzipSync, zipSync } from 'fflate';
import { slugifyName } from './exportNaming';
import { pngSize } from './pngSize';
import { resolvePngSize, type PngPreset, type PngSize } from './sceneImage';
import {
  PRODUCT_PREVIEW_VIEWS,
  type ProductPreviewView,
} from '../viewer/productPreviewViews';

export interface RenderBatchProgress {
  /** 1-based index of the frame being captured. */
  current: number;
  total: number;
  view: ProductPreviewView;
}

export interface RenderBatchFile {
  name: string;
  bytes: Uint8Array;
}

export interface RenderBatchDeps {
  capture: (view: ProductPreviewView, size: PngSize) => Promise<Blob>;
  download: (blob: Blob, filename: string) => void;
  /** Injectable for deterministic ZIP timestamps in tests. */
  now?: Date;
}

export interface RenderBatchOptions {
  onProgress?: (progress: RenderBatchProgress) => void;
  /** Used for the ZIP download name; sanitized before use. */
  projectName?: string;
}

export interface RenderBatchResult {
  size: PngSize;
  filename: string;
  bytes: number;
  files: Array<{ name: string; bytes: number }>;
}

export class RenderBatchError extends Error {
  readonly cause?: unknown;

  constructor(
    message: string,
    readonly view: ProductPreviewView | null = null,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = 'RenderBatchError';
    this.cause = options?.cause;
  }
}

export function renderBatchFilename(projectName: string): string {
  return `${slugifyName(projectName, '3d-studio-ai')}-render-6-angles.zip`;
}

/** Validate one captured frame against the requested size. */
export function validateBatchPng(
  bytes: Uint8Array,
  expected: PngSize,
  name: string,
): void {
  const size = pngSize(bytes);
  if (!size) {
    throw new RenderBatchError(`"${name}" haqiqiy PNG emas.`);
  }
  if (size.widthPx !== expected.width || size.heightPx !== expected.height) {
    throw new RenderBatchError(
      `"${name}" o'lchami kutilgandan farq qiladi: ` +
        `${size.widthPx}×${size.heightPx}, kutilgan ${expected.width}×${expected.height}.`,
    );
  }
}

export function buildRenderBatchZip(
  files: readonly RenderBatchFile[],
  generatedAt: Date = new Date(),
): Uint8Array<ArrayBuffer> {
  if (files.length !== PRODUCT_PREVIEW_VIEWS.length) {
    throw new RenderBatchError(
      `Batch ${PRODUCT_PREVIEW_VIEWS.length} ta kadr bo'lishi kerak, ${files.length} ta topildi.`,
    );
  }
  const archive: Record<string, Uint8Array> = {};
  for (const file of files) {
    if (archive[file.name]) {
      throw new RenderBatchError(`"${file.name}" nomi takrorlangan.`);
    }
    archive[file.name] = file.bytes;
  }
  return zipSync(archive, { level: 6, mtime: generatedAt }) as Uint8Array<ArrayBuffer>;
}

/** Re-open the archive and verify names, count and every PNG header. */
export function verifyRenderBatchZip(
  bytes: Uint8Array,
  expected: PngSize,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (error) {
    return {
      ok: false,
      problems: [
        error instanceof Error ? `Arxiv ochilmadi: ${error.message}` : 'Arxiv ochilmadi.',
      ],
    };
  }
  const names = Object.keys(files).sort();
  const expectedNames = PRODUCT_PREVIEW_VIEWS.map((view) => view.filename).sort();
  if (names.join('|') !== expectedNames.join('|')) {
    problems.push(`Arxiv tarkibi kutilgandan farq qiladi: ${names.join(', ')}.`);
  }
  for (const name of expectedNames) {
    const entry = files[name];
    if (!entry) {
      continue;
    }
    try {
      validateBatchPng(entry, expected, name);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : `"${name}" tekshirilmadi.`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Capture every canonical angle sequentially and download one ZIP.
 *
 * Fail-fast is deliberate: a partially labelled gallery is worse than a clear
 * error, so the download call is skipped entirely when any frame fails.
 */
export async function exportRenderBatch(
  preset: PngPreset,
  deps: RenderBatchDeps,
  options: RenderBatchOptions = {},
): Promise<RenderBatchResult> {
  const resolved = resolvePngSize(preset);
  const size: PngSize = { width: resolved.width, height: resolved.height };
  const files: RenderBatchFile[] = [];
  const total = PRODUCT_PREVIEW_VIEWS.length;

  for (let index = 0; index < PRODUCT_PREVIEW_VIEWS.length; index += 1) {
    const view = PRODUCT_PREVIEW_VIEWS[index];
    options.onProgress?.({ current: index + 1, total, view });
    let blob: Blob;
    try {
      // Sequential by design: every frame shares one camera and one renderer.
      // eslint-disable-next-line no-await-in-loop
      blob = await deps.capture(view, size);
    } catch (error) {
      throw new RenderBatchError(
        `"${view.label}" kadri olinmadi: ` +
          (error instanceof Error ? error.message : "noma'lum xato."),
        view,
        { cause: error },
      );
    }
    // eslint-disable-next-line no-await-in-loop
    const bytes = new Uint8Array(await blob.arrayBuffer());
    try {
      validateBatchPng(bytes, size, view.filename);
    } catch (error) {
      throw new RenderBatchError(
        error instanceof Error ? error.message : `"${view.filename}" tekshirilmadi.`,
        view,
        { cause: error },
      );
    }
    files.push({ name: view.filename, bytes });
  }

  const zipBytes = buildRenderBatchZip(files, deps.now);
  const verification = verifyRenderBatchZip(zipBytes, size);
  if (!verification.ok) {
    throw new RenderBatchError(`ZIP tekshiruvdan o'tmadi: ${verification.problems[0]}`);
  }

  const filename = renderBatchFilename(options.projectName ?? '');
  deps.download(new Blob([zipBytes], { type: 'application/zip' }), filename);
  return {
    size,
    filename,
    bytes: zipBytes.byteLength,
    files: files.map((file) => ({ name: file.name, bytes: file.bytes.byteLength })),
  };
}
