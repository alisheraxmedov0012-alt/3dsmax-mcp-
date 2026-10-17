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

  it('does not apply a spec the build marks as unsupported', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(designResponse({ furniture: 'sofa', supported: false })),
    );

    const outcome = await generateDesignFromCloud('qizil divan');

    expect(outcome.kind).toBe('unsupported');
    if (outcome.kind !== 'unsupported') return;
    expect(outcome.furniture).toBe('sofa');
    expect(outcome.message).toContain('qura olmaydi');
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

  it('applies a wardrobe spec with its own type and details', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        designResponse({
          furniture: 'wardrobe',
          dimensions: { width_cm: 180, height_cm: 200, depth_cm: 60 },
          details: { doorCount: 3, shelfCount: 5 },
        }),
      ),
    );

    const outcome = await generateDesignFromCloud('3 eshikli shkaf');

    expect(outcome.kind).toBe('applied');
    if (outcome.kind !== 'applied') return;
    expect(outcome.furniture).toBe('wardrobe');
    expect(outcome.params.widthCm).toBe(180);
    expect(outcome.params.doorCount).toBe(3);
    expect(outcome.params.shelfCount).toBe(5);
  });

  it('keeps every applied type different from a table', async () => {
    const cases = [
      ['chair', { width_cm: 45, height_cm: 90, depth_cm: 50 }],
      ['armchair', { width_cm: 80, height_cm: 90, depth_cm: 85 }],
      ['sofa', { width_cm: 200, height_cm: 85, depth_cm: 90 }],
      ['bed', { width_cm: 160, height_cm: 40, depth_cm: 200 }],
      ['shelf', { width_cm: 80, height_cm: 180, depth_cm: 30 }],
      ['dresser', { width_cm: 120, height_cm: 80, depth_cm: 45 }],
    ] as const;

    const results = await Promise.all(
      cases.map(async ([furniture, dimensions]) => {
        fetchMock.mockResolvedValueOnce(jsonResponse(designResponse({ furniture, dimensions })));
        return { furniture, dimensions, outcome: await generateDesignFromCloud('mebel') };
      }),
    );

    for (const { furniture, dimensions, outcome } of results) {
      expect(outcome.kind, furniture).toBe('applied');
      if (outcome.kind !== 'applied') continue;
      expect(outcome.furniture).toBe(furniture);
      // A bed's depth stays the Z extent; nothing is remapped to a table shape.
      expect(outcome.params.depthCm).toBe(dimensions.depth_cm);
    }
  });

  it('never applies a spec whose parameters the geometry layer rejects', async () => {
    // A seat at the full height is structurally impossible; the geometry layer
    // rejects the combination, so nothing may be applied.
    fetchMock.mockResolvedValue(
      jsonResponse(
        designResponse({
          furniture: 'sofa',
          dimensions: { width_cm: 200, height_cm: 60, depth_cm: 90 },
          details: { seatHeightCm: 60 },
        }),
      ),
    );

    const outcome = await generateDesignFromCloud('divan');

    expect(outcome.kind).toBe('unsupported');
    if (outcome.kind !== 'unsupported') return;
    expect(outcome.furniture).toBe('sofa');
  });
});
