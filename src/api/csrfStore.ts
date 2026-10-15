/**
 * Tiny session CSRF holder.
 *
 * The CSRF token is issued at login/register and must be echoed on
 * state-changing requests. Several panels need it, but they mount independently,
 * so it is kept in one place instead of being threaded through props. The token
 * is not secret material that outlives the session: it is cleared on logout.
 */

let csrfToken: string | null = null;
const listeners = new Set<(token: string | null) => void>();

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
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
