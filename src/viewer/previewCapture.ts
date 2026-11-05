import type { ProductPreviewView } from './productPreviewViews';

export interface CapturedPreview<T> {
  view: ProductPreviewView;
  value: T;
}

/**
 * Run product preview captures sequentially. Failure policy is fail-fast: a
 * failed shot aborts the remaining set rather than leaving a partially labelled
 * marketplace gallery. The caller surfaces the error and never ships the partial
 * result.
 */
export async function capturePreviewViews<T>(
  views: readonly ProductPreviewView[],
  capture: (view: ProductPreviewView) => Promise<T>,
): Promise<Array<CapturedPreview<T>>> {
  const results: Array<CapturedPreview<T>> = [];
  for (const view of views) {
    // Sequential by design: all shots share one camera and one renderer.
    // eslint-disable-next-line no-await-in-loop
    results.push({ view, value: await capture(view) });
  }
  return results;
}
