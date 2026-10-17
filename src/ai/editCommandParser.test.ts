import { describe, expect, it } from 'vitest';
import { extractRenameTarget, normalizePrompt, parseEditCommand } from './editCommandParser';
import { mockEditProvider, EditProviderError } from './mockEditProvider';
import { createFurnitureSceneObject, type SceneObject } from '../scene/types';
import { buildDiff } from '../scene/buildDiff';

function wardrobe(): SceneObject {
  return createFurnitureSceneObject('wardrobe', 'w-1');
}

function table(): SceneObject {
  return createFurnitureSceneObject('table', 't-1');
}

function parse(text: string, object: SceneObject = wardrobe()) {
  return parseEditCommand(text, object);
}

describe('editCommandParser — normalisation', () => {
  it('lower-cases, collapses spaces and normalises apostrophes', () => {
    expect(normalizePrompt('  SHKAFNI  20  SM  KENGAYTIR ')).toBe('shkafni 20 sm kengaytir');
    expect(normalizePrompt('nomini Kitob javoni deb o’zgartir')).toBe(
      "nomini kitob javoni deb o'zgartir",
    );
  });
});

describe('editCommandParser — dimensions', () => {
  it('widens a wardrobe by a relative amount', () => {
    const result = parse('Shkafni 20 sm kengaytir.');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ops).toEqual([
        { op: 'set_params', objectId: 'w-1', params: { widthCm: 200 } },
      ]);
    }
  });

  it('shrinks a height', () => {
    const result = parse('balandligini 10 sm pasaytir');
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.ops[0]).toMatchObject({ op: 'set_params', params: { heightCm: 190 } });
  });

  it('deepens a depth', () => {
    const result = parse('chuqurligini 5 sm chuqurlashtir');
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.ops[0]).toMatchObject({ op: 'set_params', params: { depthCm: 65 } });
  });

  it('accepts a decimal with a comma', () => {
    const result = parse('kengligini 2,5 sm kengaytir');
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.ops[0]).toMatchObject({ op: 'set_params', params: { widthCm: 182.5 } });
  });

  it('supports an absolute value', () => {
    const result = parse("kengligi 250 sm bo'lsin");
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.ops[0]).toMatchObject({ op: 'set_params', params: { widthCm: 250 } });
  });

  it('rejects a dimension command without a number', () => {
    const result = parse('shkafni kengaytir');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unsupported');
    }
  });

  it('produces a value the validator rejects when out of range', () => {
    // The parser maps intent; `buildDiff` owns range checking. 500 cm is a
    // legal parse and an illegal wardrobe width.
    const parsed = parse('kengligini 500 sm kengaytir');
    if (!parsed.ok) {
      throw new Error(parsed.message);
    }
    const applied = buildDiff(
      {
        schemaVersion: 3,
        room: { widthCm: 400, lengthCm: 500, heightCm: 280 },
        objects: [wardrobe()],
        settings: {
          background: '#1b1f24',
          lights: {},
          lightingPreset: 'studio',
          roomMaterials: { floorColor: '#000000', wallColor: '#ffffff', ceilingColor: '#ffffff' },
          cameraPreset: 'default',
          qualityPreset: 'high',
          exposure: 1,
          toneMapping: 'aces',
        },
      } as never,
      parsed.ops,
      { baseVersion: 1 },
    );
    expect(applied.ok).toBe(false);
    if (!applied.ok) {
      expect(applied.code).toBe('out_of_range');
    }
  });
});

describe('editCommandParser — colour', () => {
  it('changes the colour to white', () => {
    const result = parse('Stol rangini oq rangga o‘zgartir.', table());
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.ops).toEqual([
      { op: 'set_params', objectId: 't-1', params: { color: '#ffffff' } },
    ]);
  });

  it('changes the colour to red', () => {
    const result = parse('rangini qizil qil', table());
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.ops[0]).toMatchObject({ params: { color: '#c0392b' } });
  });

  it('rejects a colour it does not know', () => {
    const result = parse('rangini binafsha qil', table());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unsupported');
      expect(result.message).toContain('Rangni topib bo');
    }
  });

  it('treats a material word as a preset, not a paint colour', () => {
    const result = parse("materialini yog'och qil", table());
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.ops[0]).toEqual({
      op: 'apply_material_preset',
      objectId: 't-1',
      presetId: 'wood-oak',
    });
  });
});

describe('editCommandParser — transform', () => {
  it('moves left by a negative X offset', () => {
    const result = parse('Stolni 10 sm chapga sur.', table());
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.ops[0]).toEqual({
      op: 'set_transform',
      objectId: 't-1',
      position: { x: -10 },
    });
  });

  it('moves right', () => {
    const result = parse("20 sm o'ngga sur", table());
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.ops[0]).toMatchObject({ position: { x: 20 } });
  });

  it('moves back along +Z', () => {
    const result = parse('15 sm orqaga sur', table());
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.ops[0]).toMatchObject({ position: { z: 15 } });
  });

  it('refuses a move below the floor', () => {
    const result = parse('50 sm pastga sur', table());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('pol ostiga');
    }
  });

  it('rejects a move without a direction', () => {
    const result = parse('10 sm sur', table());
    expect(result.ok).toBe(false);
  });

  it('rotates by an absolute angle', () => {
    const result = parse('90 daraja bur', table());
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.ops[0]).toEqual({
      op: 'set_transform',
      objectId: 't-1',
      rotation: { y: 90 },
    });
  });
});

describe('editCommandParser — rename and visibility', () => {
  it('renames to a multi-word name, preserving case', () => {
    const result = parse("Shkaf nomini Kitob javoni deb o'zgartir.", wardrobe());
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.ops[0]).toEqual({
      op: 'rename',
      objectId: 'w-1',
      name: 'Kitob javoni',
    });
  });

  it('extracts the name from several phrasings', () => {
    expect(extractRenameTarget("nomini Kitob javoni deb o'zgartir")).toBe('Kitob javoni');
    expect(extractRenameTarget('nomini Katta shkaf')).toBe('Katta shkaf');
    expect(extractRenameTarget("nomi Ombor bo'lsin")).toBe('Ombor');
    expect(extractRenameTarget('rename to Big shelf')).toBe('Big shelf');
    expect(extractRenameTarget('just some text')).toBeNull();
  });

  it('hides and shows the object', () => {
    const hidden = parse('shkafni yashir');
    if (!hidden.ok) {
      throw new Error(hidden.message);
    }
    expect(hidden.ops[0]).toEqual({ op: 'set_visibility', objectId: 'w-1', visible: false });

    const shown = parse("ko'rsat");
    if (!shown.ok) {
      throw new Error(shown.message);
    }
    expect(shown.ops[0]).toEqual({ op: 'set_visibility', objectId: 'w-1', visible: true });
  });
});

describe('editCommandParser — unsupported input', () => {
  it.each([
    ['empty', ''],
    ['blank', '    '],
  ])('rejects %s text', (_label, text) => {
    const result = parse(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('empty');
    }
  });

  it('rejects text over the length limit', () => {
    const result = parse('a'.repeat(201));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('too_long');
    }
  });

  it.each([
    'menga oshxona dizayni kerak',
    'delete everything',
    'add a chair',
    'assembly yaratib ber',
    'stolni osmonga uchir',
  ])('reports %s as unsupported without guessing', (text) => {
    const result = parse(text, table());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unsupported');
      expect(result.message).toContain("tushunmadim");
    }
  });

  it('asks for the missing angle instead of guessing one', () => {
    const result = parse('stolni oynaga aylantir', table());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unsupported');
      expect(result.message).toContain('burchagini topib bo');
    }
  });

  it('never emits a reducer action or a raw JSON patch', () => {
    const result = parse("nomini Kitob javoni deb o'zgartir");
    if (!result.ok) {
      throw new Error(result.message);
    }
    for (const op of result.ops) {
      expect(Object.keys(op)).not.toContain('type');
      expect(Object.keys(op)).not.toContain('path');
    }
  });
});

describe('mockEditProvider', () => {
  it('resolves with the parsed operators', async () => {
    const proposal = await mockEditProvider.propose({
      prompt: 'Shkafni 20 sm kengaytir',
      object: wardrobe(),
    });
    expect(proposal.ops).toHaveLength(1);
    expect(proposal.providerId).toBe('mock-rule-based');
    expect(proposal.notes).toHaveLength(1);
  });

  it('throws a typed error for unsupported input', async () => {
    await expect(
      mockEditProvider.propose({ prompt: 'salom', object: wardrobe() }),
    ).rejects.toBeInstanceOf(EditProviderError);
  });

  it('throws too_long before parsing', async () => {
    await expect(
      mockEditProvider.propose({ prompt: 'x'.repeat(201), object: wardrobe() }),
    ).rejects.toMatchObject({ reason: 'too_long' });
  });

  it('does not mutate the object it parses against', async () => {
    const object = wardrobe();
    const snapshot = JSON.parse(JSON.stringify(object));
    await mockEditProvider.propose({ prompt: 'Shkafni 20 sm kengaytir', object });
    expect(object).toEqual(snapshot);
  });
});
