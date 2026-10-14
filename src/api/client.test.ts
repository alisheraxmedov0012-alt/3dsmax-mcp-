import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, api, describeError } from './client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api client', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends credentials and CSRF header on state-changing requests', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'ok' }));

    await api.logout('csrf-token-value');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/auth/logout');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers['X-CSRF-Token']).toBe('csrf-token-value');
  });

  it('does not send a CSRF header on GET requests', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ok' }));

    await api.health();

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('GET');
    expect(init.headers['X-CSRF-Token']).toBeUndefined();
  });

  it('maps backend error payloads to ApiRequestError', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'limit_reached', message: 'Tarif limiti tugadi.' } }, 402),
    );

    await expect(api.usage()).rejects.toMatchObject({
      code: 'limit_reached',
      status: 402,
      message: 'Tarif limiti tugadi.',
    });
  });

  it('reports a friendly message when the server is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'));

    await expect(api.me()).rejects.toBeInstanceOf(ApiRequestError);
    try {
      await api.me();
    } catch (error) {
      expect(describeError(error)).toContain('Serverga');
    }
  });

  it('describes known API errors with their server message', () => {
    const error = new ApiRequestError('forbidden', "Ruxsat yo'q.", 403);
    expect(describeError(error)).toBe("Ruxsat yo'q.");
  });

  it('calls the W10 jobs endpoint with the CSRF header', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: 'j1', kind: 'noop', status: 'succeeded' }, 202),
    );

    await api.createJob('noop', 'key-1', 'csrf-token-value');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/jobs');
    expect(init.method).toBe('POST');
    expect(init.headers['X-CSRF-Token']).toBe('csrf-token-value');
    expect(JSON.parse(init.body)).toEqual({
      kind: 'noop',
      idempotency_key: 'key-1',
      payload: {},
    });
  });

  it('reads the public storage status without a CSRF header', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ backend: 'memory', available: true, persistent: false, message: 'x' }),
    );

    const status = await api.storageStatus();

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/files/status');
    expect(init.method).toBe('GET');
    expect(init.headers['X-CSRF-Token']).toBeUndefined();
    expect(status.persistent).toBe(false);
  });

  it('lists server projects and sends the version on updates', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    await api.serverProjects();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/projects');
    expect(init.method).toBe('GET');

    fetchMock.mockResolvedValue(jsonResponse({ id: 'p1', version: 2 }));
    await api.updateServerProject('p1', { scene: {}, expected_version: 1 }, 'csrf');
    const [, patchInit] = fetchMock.mock.calls[1];
    expect(patchInit.method).toBe('PATCH');
    expect(patchInit.headers['X-CSRF-Token']).toBe('csrf');
    expect(JSON.parse(patchInit.body)).toEqual({ scene: {}, expected_version: 1 });
  });
});
