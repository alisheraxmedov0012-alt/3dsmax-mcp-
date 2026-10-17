import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASSEMBLY_FLAG_NAME, assembliesEnabled } from './flag';

describe('W14 assembly flag (AC-13)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is off by default, so the feature is invisible after merge', () => {
    // `import.meta.env.VITE_ASSEMBLY_ENABLED` is undefined in the default build.
    expect(assembliesEnabled()).toBe(false);
  });

  it('turns on only for the exact value true (case and space tolerant)', () => {
    for (const value of ['true', 'TRUE', ' True ']) {
      vi.stubEnv(ASSEMBLY_FLAG_NAME, value);
      expect(assembliesEnabled(), value).toBe(true);
    }
  });

  it('stays off for any other value', () => {
    for (const value of ['false', '1', 'yes', '', 'on']) {
      vi.stubEnv(ASSEMBLY_FLAG_NAME, value);
      expect(assembliesEnabled(), value).toBe(false);
    }
  });
});
