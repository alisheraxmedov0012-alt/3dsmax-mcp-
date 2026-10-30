/**
 * A3 — the fallback policy, tested without a DOM or a network.
 *
 * The distinction that matters: "the service cannot answer right now" may be
 * substituted by the offline analyzer, while "this request was refused" and
 * "this type is unsupported" must surface the reason instead.
 */
import { describe, expect, it, vi } from 'vitest';
import { createFurnitureParams } from '../geometry/furniture/types';
import type { CloudDesignOutcome } from './cloudDesignAdapter';
import { generateDesign } from './generateDesign';
import { localDesignAdapter } from './localDesignAdapter';
import type { DesignAdapter } from './types';

const tableParams = createFurnitureParams('table');

const cloudApplied: CloudDesignOutcome = {
  kind: 'applied',
  furniture: 'table',
  params: tableParams,
  materialPresetId: 'wood-oak',
  confidence: 'high',
  notes: ['cloud note'],
  warnings: ['cloud warning'],
  provider: 'openai',
};

const cloudUnavailable: CloudDesignOutcome = {
  kind: 'unavailable',
  reason: "AI xizmati o'z vaqtida javob bermadi.",
  code: 'timeout',
};

const cloudRejected: CloudDesignOutcome = {
  kind: 'rejected',
  message: 'Tarif limiti tugadi.',
  code: 'limit_reached',
  status: 402,
};

const cloudUnsupported: CloudDesignOutcome = {
  kind: 'unsupported',
  furniture: 'wardrobe',
  message: '"wardrobe" turini bu versiya qura olmaydi.',
};

describe('generateDesign — cloud success', () => {
  it('returns the validated cloud design with its provider and preset', async () => {
    const local = vi.fn(localDesignAdapter.generate);
    const result = await generateDesign('180x60x75 sm stol', {
      cloud: async () => cloudApplied,
      local: { ...localDesignAdapter, generate: local },
    });

    expect(result).toEqual({
      kind: 'applied',
      design: {
        source: 'cloud',
        furniture: 'table',
        params: tableParams,
        materialPresetId: 'wood-oak',
        confidence: 'high',
        notes: ['cloud note'],
        warnings: ['cloud warning'],
        provider: 'openai',
      },
    });
    expect(local).not.toHaveBeenCalled();
  });
});

describe('generateDesign — is the service unavailable?', () => {
  it('falls back to the offline analyzer and keeps the reason', async () => {
    const result = await generateDesign('180x60x75 sm stol', {
      cloud: async () => cloudUnavailable,
    });

    expect(result.kind).toBe('applied');
    if (result.kind !== 'applied') return;
    expect(result.design.source).toBe('local');
    expect(result.design.fallbackReason).toBe(cloudUnavailable.reason);
    expect(result.design.fallbackCode).toBe('timeout');
    expect(result.design.params.widthCm).toBe(180);
  });

  it('builds a wardrobe offline, not a substitute table', async () => {
    const result = await generateDesign('3 eshikli shkaf, 200 sm baland', {
      cloud: async () => cloudUnavailable,
    });

    expect(result.kind).toBe('applied');
    if (result.kind !== 'applied') return;
    expect(result.design.furniture).toBe('wardrobe');
    expect(result.design.params.heightCm).toBe(200);
  });

  it('resolves a local material kind to the shared PBR preset', async () => {
    const result = await generateDesign("yog'och stol", {
      cloud: async () => cloudUnavailable,
    });

    expect(result.kind).toBe('applied');
    if (result.kind !== 'applied') return;
    expect(result.design.materialPresetId).toBe('wood-oak');
  });

  it('refuses a room word instead of pretending a table was built', async () => {
    const result = await generateDesign('oshxona uchun mebel', {
      cloud: async () => cloudUnavailable,
    });

    expect(result.kind).toBe('unsupported');
    if (result.kind !== 'unsupported') return;
    expect(result.furniture).toBeNull();
    // The timeout is still named, so the reader knows why the cloud was skipped.
    expect(result.message).toMatch(/vaqtida javob bermadi/);
    expect(result.message).toMatch(/qo'llab-quvvatlanmaydi/);
  });
});

describe('generateDesign — refusals are not substituted', () => {
  it('returns a rejected cloud refusal without touching the offline analyzer', async () => {
    const local = vi.fn(localDesignAdapter.generate);
    const result = await generateDesign('180x60x75 sm stol', {
      cloud: async () => cloudRejected,
      local: { ...localDesignAdapter, generate: local },
    });

    expect(result).toEqual({
      kind: 'rejected',
      message: 'Tarif limiti tugadi.',
      code: 'limit_reached',
      status: 402,
    });
    expect(local).not.toHaveBeenCalled();
  });

  it('returns an unsupported cloud spec without falling back', async () => {
    const result = await generateDesign('shkaf', { cloud: async () => cloudUnsupported });
    expect(result).toEqual({
      kind: 'unsupported',
      furniture: 'wardrobe',
      message: '"wardrobe" turini bu versiya qura olmaydi.',
    });
  });
});

describe('generateDesign — frontend-only build', () => {
  it('skips the cloud request and labels the result as local', async () => {
    const cloud = vi.fn(async () => cloudApplied);
    const result = await generateDesign('180x60x75 sm stol', {
      backendConfigured: false,
      cloud,
    });

    expect(cloud).not.toHaveBeenCalled();
    expect(result.kind).toBe('applied');
    if (result.kind !== 'applied') return;
    expect(result.design.source).toBe('local');
    expect(result.design.fallbackCode).toBe('backend_missing');
    expect(result.design.fallbackReason).toMatch(/Server AI bu versiyada sozlanmagan/);
  });

  it('builds a wardrobe with no server at all', async () => {
    const result = await generateDesign('3 eshikli shkaf, 200 sm baland', {
      backendConfigured: false,
    });
    expect(result.kind).toBe('applied');
    if (result.kind !== 'applied') return;
    expect(result.design.furniture).toBe('wardrobe');
  });
});

describe('generateDesign — input and unexpected failures', () => {
  it('rejects empty text before calling either engine', async () => {
    const cloud = vi.fn(async () => cloudApplied);
    const result = await generateDesign('   ', { cloud });
    expect(result).toEqual({
      kind: 'rejected',
      message: "Matn bo'sh. Iltimos, mebel tavsifini kiriting.",
      code: 'empty_prompt',
      status: 0,
    });
    expect(cloud).not.toHaveBeenCalled();
  });

  it('propagates an unexpected local failure instead of hiding it', async () => {
    const broken: DesignAdapter = {
      id: 'broken',
      capabilities: { text: true, image: false },
      generate: async () => {
        throw new Error('boom');
      },
    };
    await expect(
      generateDesign('stol', { cloud: async () => cloudUnavailable, local: broken }),
    ).rejects.toThrow('boom');
  });
});
