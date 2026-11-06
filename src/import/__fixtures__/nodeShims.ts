/**
 * Test-only shims for browser APIs that Node does not provide.
 *
 * These are not mocks of project code: `FileLoader` (used by `GLTFLoader` to fetch
 * a blob URL) reports progress with `ProgressEvent`, which exists in every browser
 * the app supports and in no Node version. Without it the fetch path throws
 * asynchronously and the loader promise never settles.
 */
import { vi } from 'vitest';

class ProgressEventShim {
  readonly type: string;
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;

  constructor(type: string, init: { lengthComputable?: boolean; loaded?: number; total?: number } = {}) {
    this.type = type;
    this.lengthComputable = init.lengthComputable ?? false;
    this.loaded = init.loaded ?? 0;
    this.total = init.total ?? 0;
  }
}

/** Installs the shims; call from `beforeAll` and `vi.unstubAllGlobals()` after. */
export function installBrowserShims(): void {
  if (typeof (globalThis as { ProgressEvent?: unknown }).ProgressEvent === 'undefined') {
    vi.stubGlobal('ProgressEvent', ProgressEventShim);
  }
}
