import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from './client';
import {
  fetchTextureContent,
  getTextureAsset,
  listTextureAssets,
  uploadTextureAsset,
} from './textureApi';

const RAW = {
  id: 'tex-1',
  version: 1,
  filename: 'oak.png',
  mime_type: 'image/png',
  width: 512,
  height: 256,
  byte_size: 1000,
  content_hash: 'sha256:abc',
  source: { kind: 'bitmap' },
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploadTextureAsset', () => {
  it('posts multipart with credentials and the CSRF header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(RAW, 201));
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadTextureAsset(new Blob(['png']), 'oak.png', 'csrf');

    expect(result.id).toBe('tex-1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/textures');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('requires a CSRF token before touching the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(uploadTextureAsset(new Blob(['png']), 'a.png', null)).rejects.toMatchObject({
      status: 401,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [413, 'payload_too_large', 'juda katta'],
    [422, 'texture_corrupt', 'buzilgan'],
    [503, 'storage_not_persistent', 'doimiy'],
  ])('surfaces a %i API error with its server message', async (status, code, message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: { code, message } }, status)),
    );
    await expect(uploadTextureAsset(new Blob(['png']), 'a.png', 'csrf')).rejects.toMatchObject({
      code,
      status,
    });
  });

  it('keeps Retry-After on a 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ error: { code: 'rate_limited', message: 'wait' } }, 429, {
          'Retry-After': '12',
        }),
      ),
    );
    const error = await uploadTextureAsset(new Blob(['png']), 'a.png', 'csrf').catch(
      (value: unknown) => value,
    );
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).retryAfter).toBe(12);
  });

  it('rejects a non-JSON success response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 201 })));
    await expect(uploadTextureAsset(new Blob(['png']), 'a.png', 'csrf')).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});

describe('texture read endpoints', () => {
  it('lists and resolves metadata', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([RAW]))
      .mockResolvedValueOnce(jsonResponse(RAW));
    vi.stubGlobal('fetch', fetchMock);

    expect(await listTextureAssets()).toHaveLength(1);
    expect((await getTextureAsset('tex-1')).id).toBe('tex-1');
    expect(fetchMock.mock.calls[1][0]).toContain('/api/textures/tex-1');
  });

  it('fetches bytes only when the response really is PNG', async () => {
    const blob = new Blob(['png'], { type: 'image/png' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(blob, { status: 200, headers: { 'Content-Type': 'image/png' } }),
      )
      .mockResolvedValueOnce(
        new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const content = await fetchTextureContent('tex-1');
    expect(content.type).toBe('image/png');
    await expect(fetchTextureContent('tex-1')).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('maps network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(getTextureAsset('tex-1')).rejects.toMatchObject({ code: 'network_error' });
  });
});
