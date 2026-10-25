/**
 * A3.3 — the AI request deadline.
 *
 * Before this, `request()` had no deadline at all, so a stalled provider left the
 * panel in its "working" state for ever. These tests drive the real `request`
 * code path with a `fetch` mock that honours the abort signal exactly as the
 * browser's does, and assert on the error the caller receives.
 *
 * What is *not* proven here: that the server or the provider stops working when
 * the client aborts. Aborting a fetch only ends the client's wait.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_TIMEOUT_MS,
  ApiRequestError,
  DEFAULT_AI_TIMEOUT_MS,
  api,
  isAuthError,
  isBusyError,
  isLimitError,
  isServiceDownError,
} from './client';

/** A fetch that never settles until its signal aborts, then rejects like the browser. */
function stallingFetch() {
  return vi.fn((_url: string, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        return; // the caller forgot the deadline; the test would hang and fail
      }
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      signal.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      );
    });
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('A3.3 AI request deadline', () => {
  it('defaults to 30 seconds', () => {
    expect(DEFAULT_AI_TIMEOUT_MS).toBe(30_000);
    expect(AI_TIMEOUT_MS).toBe(30_000);
  });

  it('passes an abort signal to fetch for the AI endpoint', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        jsonResponse({
          provider: 'local',
          spec: {
            furniture: 'table',
            dimensions: { width_cm: 180, height_cm: 75, depth_cm: 60 },
            color: null,
            material_kind: null,
            style: null,
            confidence: 'high',
            notes: [],
            warnings: [],
            supported: true,
          },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await api.aiDesign('stol');

    // The deadline is enforced through an abort signal, so one must reach fetch.
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects with a timeout error instead of waiting for ever', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', stallingFetch());

    const pending = api.aiDesign('stol');
    // Attach the rejection handler before advancing the clock so the rejection is
    // never reported as unhandled.
    const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' });

    await vi.advanceTimersByTimeAsync(AI_TIMEOUT_MS + 1);
    await assertion;
  });

  it('names the deadline and tells the reader what to do', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', stallingFetch());

    const pending = api.aiDesign('stol');
    const assertion = pending.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(AI_TIMEOUT_MS + 1);
    const error = await assertion;

    expect(error).toBeInstanceOf(ApiRequestError);
    const typed = error as ApiRequestError;
    expect(typed.code).toBe('timeout');
    expect(typed.status).toBe(0);
    // 30 seconds, stated in the message the user reads.
    expect(typed.message).toContain('30');
    expect(typed.message).toMatch(/qaytadan urinib/i);
    // A deadline is worth retrying, unlike a validation failure.
    expect(typed.retryable).toBe(true);
    // A timeout is not an auth, limit, busy or outage error.
    expect(isAuthError(typed)).toBe(false);
    expect(isLimitError(typed)).toBe(false);
    expect(isBusyError(typed)).toBe(false);
    expect(isServiceDownError(typed)).toBe(false);
  });

  it('does not report a timeout as a network error', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', stallingFetch());

    const pending = api.aiDesign('stol');
    const assertion = pending.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(AI_TIMEOUT_MS + 1);

    const error = (await assertion) as ApiRequestError;
    expect(error.code).not.toBe('network_error');
    // A genuine transport failure keeps its own message.
    expect(error.message).not.toContain("ulanib bo'lmadi");
  });

  it('reports a caller cancellation separately from a timeout', async () => {
    vi.stubGlobal('fetch', stallingFetch());
    const controller = new AbortController();

    const pending = api.aiDesign('stol', undefined, controller.signal);
    const assertion = pending.catch((error: unknown) => error);
    controller.abort();

    const error = (await assertion) as ApiRequestError;
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.code).toBe('cancelled');
    expect(error.message).toMatch(/bekor qilindi/i);
  });

  it('clears the deadline when the request succeeds', async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          provider: 'local',
          spec: {
            furniture: 'table',
            dimensions: null,
            color: null,
            material_kind: null,
            style: null,
            confidence: 'low',
            notes: [],
            warnings: [],
            supported: true,
          },
        }),
      ),
    );

    await api.aiDesign('stol');
    expect(clearSpy).toHaveBeenCalled();
    // No stray timer keeps running after a fast answer.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps HTTP failures typed, not turned into timeouts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: { code: 'limit_reached', message: 'Limit tugadi.' } }, 402),
      ),
    );

    const error = (await api.aiDesign('stol').catch((caught: unknown) => caught)) as ApiRequestError;
    expect(error.code).toBe('limit_reached');
    expect(error.status).toBe(402);
    expect(isLimitError(error)).toBe(true);
  });
});
