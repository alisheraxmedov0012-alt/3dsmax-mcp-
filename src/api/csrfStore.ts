/**
 * Tiny session CSRF holder.
 *
 * The CSRF token is issued at login/register and must be echoed on
 * state-changing requests. Several panels need it, but they mount independently,
 * so it is kept in one place instead of being threaded through props.
 *
 * The server stores only a hash of the token, so the raw value cannot be
 * recovered from the session. To keep a page reload usable without forcing a
 * second login, the token is mirrored into `sessionStorage` (tab-scoped, cleared
 * on logout). It is never put in a URL, log or cross-origin storage.
 */
export const CSRF_TOKEN_STORAGE_KEY = '3d-studio-ai.csrf-token';
const MIN_TOKEN_LENGTH = 16;
const MAX_TOKEN_LENGTH = 256;

function readStoredToken(): string | null {
  try {
    if (typeof sessionStorage === 'undefined') {
      return null;
    }
    const value = sessionStorage.getItem(CSRF_TOKEN_STORAGE_KEY);
    if (
      typeof value === 'string' &&
      value.length >= MIN_TOKEN_LENGTH &&
      value.length <= MAX_TOKEN_LENGTH &&
      /^[A-Za-z0-9_-]+$/.test(value)
    ) {
      return value;
    }
    if (value !== null) {
      sessionStorage.removeItem(CSRF_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Storage can be disabled (private mode/quota): fall back to memory only.
  }
  return null;
}

function persistToken(token: string | null): void {
  try {
    if (typeof sessionStorage === 'undefined') {
      return;
    }
    if (token) {
      sessionStorage.setItem(CSRF_TOKEN_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(CSRF_TOKEN_STORAGE_KEY);
    }
  } catch {
    // A storage failure must not make authentication unusable in this tab.
  }
}

let csrfToken: string | null = readStoredToken();
const listeners = new Set<(token: string | null) => void>();

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
  persistToken(token);
  for (const listener of listeners) {
    listener(token);
  }
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

export function subscribeCsrf(listener: (token: string | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
