import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_EDIT_FLAG_NAME, aiEditEnabled, parseFlagValue } from './editFlag';

describe('W15.10 AI edit flag', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is off by default, so the feature is invisible after merge', () => {
    // `import.meta.env.VITE_AI_EDIT_ENABLED` is undefined in the default build.
    expect(aiEditEnabled()).toBe(false);
  });

  it('turns on only for the exact value true, ignoring case and spaces', () => {
    for (const value of ['true', 'TRUE', ' True ', 'tRuE']) {
      vi.stubEnv(AI_EDIT_FLAG_NAME, value);
      expect(aiEditEnabled(), value).toBe(true);
      vi.unstubAllEnvs();
    }
  });

  it.each(['false', 'FALSE', '0', '1', 'yes', 'on', 'no', '', '   ', 'enabled', 'truthy'])(
    'stays off for %j',
    (value) => {
      vi.stubEnv(AI_EDIT_FLAG_NAME, value);
      expect(aiEditEnabled()).toBe(false);
    },
  );

  it('never enables through Boolean() coercion', () => {
    // `Boolean('false') === true`; the flag must not behave that way.
    expect(Boolean('false')).toBe(true);
    vi.stubEnv(AI_EDIT_FLAG_NAME, 'false');
    expect(aiEditEnabled()).toBe(false);
  });

  it.each([
    ['undefined', undefined, false],
    ['null', null, false],
    ['boolean true', true, false],
    ['number 1', 1, false],
    ['object', {}, false],
    ['exact true', 'true', true],
  ])('parseFlagValue handles %s', (_label, raw, expected) => {
    expect(parseFlagValue(raw)).toBe(expected);
  });

  it('does not throw when the env object is absent', () => {
    expect(() => parseFlagValue(undefined)).not.toThrow();
  });

  it('exposes the documented variable name', () => {
    expect(AI_EDIT_FLAG_NAME).toBe('VITE_AI_EDIT_ENABLED');
  });
});
