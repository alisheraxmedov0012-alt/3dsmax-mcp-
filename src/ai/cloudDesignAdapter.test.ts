import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiDesignSpec } from '../api/client';
import { generateDesignFromCloud } from './cloudDesignAdapter';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function designResponse(specOverrides: Partial<AiDesignSpec> = {}) {
  const spec: AiDesignSpec = {
    furniture: 'table',
    dimensions: { width_cm: 180, height_cm: 75, depth_cm: 60 },
    color: '#a9744f',
    material_kind: null,
    style: null,
    confidence: 'high',
    notes: [],
    warnings: [],
    supported: true,
    ...specOverrides,
  };
  return { provider: 'local', spec };
}

describe('generateDesignFromCloud', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts to the design endpoint with credentials and no CSRF header', async () => {
    fetchMock.mockResolvedValue(jsonResponse(designResponse()));

    await generateDesignFromCloud('yog\'och stol');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/ai/design');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers['X-CSRF-Token']).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ text: "yog'och stol", image_filename: null });
  });

  it('applies a supported spec and clamps outliers into the table ranges', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(designResponse({ dimensions: { width_cm: 999, height_cm: 75, depth_cm: 60 } })),
    );

    const outcome = await generateDesignFromCloud('juda keng stol');

    expect(outcome.kind).toBe('applied');
    if (outcome.kind !== 'applied') return;
    expect(outcome.params.widthCm).toBe(240); // clamped to the table maximum
    expect(outcome.params.heightCm).toBe(75);
    expect(outcome.provider).toBe('local');
    expect(outcome.warnings.join(' ')).toContain('Kenglik');
  });

  it('does not apply a recognised but unsupported furniture type', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(designResponse({ furniture: 'sofa', supported: false })),
    );

    const outcome = await generateDesignFromCloud('qizil divan');

    expect(outcome.kind).toBe('unsupported');
    if (outcome.kind !== 'unsupported') return;
    expect(outcome.furniture).toBe('sofa');
    expect(outcome.message).toContain("qo'llab-quvvatlanmaydi");
  });

  it('treats a not-signed-in / unconfigured response as unavailable (fallback)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: 'ai_unconfigured', message: "AI xizmati sozlanmagan." } },
        503,
      ),
    );

    const outcome = await generateDesignFromCloud('stol');

    expect(outcome.kind).toBe('unavailable');
  });

  it('treats an unreachable server as unavailable (fallback)', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'));

    const outcome = await generateDesignFromCloud('stol');

    expect(outcome.kind).toBe('unavailable');
  });

  it('does not leak an invalid-output error into applied state', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'ai_invalid_output', message: 'bad' } }, 422),
    );

    const outcome = await generateDesignFromCloud('nonsense');

    expect(outcome.kind).toBe('unavailable');
  });
});
