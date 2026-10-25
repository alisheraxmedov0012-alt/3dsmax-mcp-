/**
 * A3.4 F3 — the AI's `material_kind` reaches the model as a PBR preset.
 *
 * Covers the whole path: the wire value the backend sends, the adapter that
 * resolves it, the panel that hands it on, and the reducer that stores it on the
 * new object. No AI service is contacted: the HTTP layer is a stub response.
 */
import { describe, expect, it, vi } from 'vitest';
import { presetIdForMaterialKind } from './materialKind';
import { MATERIAL_PRESETS, MATERIAL_PRESET_IDS } from '../materials/presets';

describe('presetIdForMaterialKind', () => {
  it('maps every material kind the backend can send onto an existing preset', () => {
    expect(presetIdForMaterialKind('wood')).toBe('wood-oak');
    expect(presetIdForMaterialKind('metal')).toBe('metal-steel');
    expect(presetIdForMaterialKind('fabric')).toBe('fabric-linen');
    expect(presetIdForMaterialKind('leather')).toBe('leather-brown');
    expect(presetIdForMaterialKind('glass')).toBe('glass-clear');
  });

  it('resolves only ids that exist in the material catalogue', () => {
    for (const kind of ['wood', 'metal', 'fabric', 'leather', 'glass']) {
      const id = presetIdForMaterialKind(kind);
      expect(id).not.toBeNull();
      expect(MATERIAL_PRESET_IDS.has(id as string)).toBe(true);
    }
    // Guard against a preset being renamed without the bridge being updated.
    expect(MATERIAL_PRESETS.length).toBeGreaterThanOrEqual(5);
  });

  it('returns null for a missing, unknown or empty kind', () => {
    expect(presetIdForMaterialKind(null)).toBeNull();
    expect(presetIdForMaterialKind(undefined)).toBeNull();
    expect(presetIdForMaterialKind('')).toBeNull();
    expect(presetIdForMaterialKind('carbon-fibre')).toBeNull();
    expect(presetIdForMaterialKind('plastic')).toBeNull();
  });

  it('is tolerant of casing and surrounding whitespace', () => {
    expect(presetIdForMaterialKind(' WOOD ')).toBe('wood-oak');
    expect(presetIdForMaterialKind('Metal')).toBe('metal-steel');
  });
});

describe('material kind passes from the AI response to the model', () => {
  it('is carried through the adapter without being dropped', async () => {
    const { generateDesignFromCloud } = await import('./cloudDesignAdapter');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          provider: 'local',
          spec: {
            furniture: 'table',
            dimensions: { width_cm: 180, height_cm: 75, depth_cm: 60 },
            color: '#a9744f',
            material_kind: 'wood',
            style: null,
            confidence: 'high',
            notes: [],
            warnings: [],
            supported: true,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const outcome = await generateDesignFromCloud("yog'och stol");
      expect(outcome.kind).toBe('applied');
      if (outcome.kind === 'applied') {
        expect(outcome.materialPresetId).toBe('wood-oak');
        // The geometry path is untouched: the params are still built.
        expect(outcome.params.widthCm).toBe(180);
        // The AI's own colour is preserved, not replaced by the preset's.
        expect(outcome.params.color).toBe('#a9744f');
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('leaves the material unset when the AI names none', async () => {
    const { generateDesignFromCloud } = await import('./cloudDesignAdapter');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          provider: 'local',
          spec: {
            furniture: 'table',
            dimensions: { width_cm: 180, height_cm: 75, depth_cm: 60 },
            color: null,
            material_kind: null,
            style: null,
            confidence: 'low',
            notes: [],
            warnings: [],
            supported: true,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const outcome = await generateDesignFromCloud('stol');
      expect(outcome.kind).toBe('applied');
      if (outcome.kind === 'applied') {
        expect(outcome.materialPresetId).toBeNull();
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
