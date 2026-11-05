import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CSRF_TOKEN_STORAGE_KEY } from './csrfStore';

function storageStub(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('csrfStore reload recovery', () => {
  it('persists the issued token and restores it after a module reload', async () => {
    const storage = storageStub();
    vi.stubGlobal('sessionStorage', storage);
    const token = 'csrf-token-1234567890';

    const first = await import('./csrfStore');
    first.setCsrfToken(token);
    expect(storage.getItem(CSRF_TOKEN_STORAGE_KEY)).toBe(token);

    vi.resetModules();
    const restored = await import('./csrfStore');
    expect(restored.getCsrfToken()).toBe(token);
  });

  it('clears the stored token on logout', async () => {
    const storage = storageStub();
    vi.stubGlobal('sessionStorage', storage);
    const store = await import('./csrfStore');

    store.setCsrfToken('csrf-token-1234567890');
    store.setCsrfToken(null);
    expect(storage.getItem(CSRF_TOKEN_STORAGE_KEY)).toBeNull();

    vi.resetModules();
    const restored = await import('./csrfStore');
    expect(restored.getCsrfToken()).toBeNull();
  });

  it.each(['short', '<script>alert(1)</script>', 'x'.repeat(300)])(
    'discards an invalid or malicious stored value: %s',
    async (value) => {
      vi.resetModules();
      const storage = storageStub({ [CSRF_TOKEN_STORAGE_KEY]: value });
      vi.stubGlobal('sessionStorage', storage);
      const store = await import('./csrfStore');
      expect(store.getCsrfToken()).toBeNull();
      expect(storage.getItem(CSRF_TOKEN_STORAGE_KEY)).toBeNull();
    },
  );

  it('falls back to memory when sessionStorage is unavailable or throws', async () => {
    vi.stubGlobal('sessionStorage', undefined);
    let store = await import('./csrfStore');
    store.setCsrfToken('csrf-token-1234567890');
    expect(store.getCsrfToken()).toBe('csrf-token-1234567890');

    vi.resetModules();
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    store = await import('./csrfStore');
    expect(store.getCsrfToken()).toBeNull();
    expect(() => store.setCsrfToken('csrf-token-1234567890')).not.toThrow();
    expect(store.getCsrfToken()).toBe('csrf-token-1234567890');
  });

  it('notifies subscribers when the token changes', async () => {
    vi.stubGlobal('sessionStorage', storageStub());
    const store = await import('./csrfStore');
    const listener = vi.fn();
    const unsubscribe = store.subscribeCsrf(listener);
    store.setCsrfToken('csrf-token-1234567890');
    store.setCsrfToken(null);
    unsubscribe();
    store.setCsrfToken('csrf-token-abcdefghij');
    expect(listener).toHaveBeenNthCalledWith(1, 'csrf-token-1234567890');
    expect(listener).toHaveBeenNthCalledWith(2, null);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
