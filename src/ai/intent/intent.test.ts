import { describe, expect, it } from 'vitest';
import { INTENT_DEFINITIONS, matchDefinition } from './catalog';
import { parseFurniturePrompt, detectLanguage } from './localProvider';
import { parseFurnitureIntentPayload } from './schema';
import { parseLengthUnit, toCentimetres } from './units';

const BASE_PAYLOAD = {
  definitionId: 'desk.computer',
  patch: { width: 170 },
  language: 'uz',
  clarificationRequired: false,
};

describe('length units', () => {
  it('recognises the unit spellings of three languages', () => {
    expect(parseLengthUnit('sm')).toBe('cm');
    expect(parseLengthUnit('см')).toBe('cm');
    expect(parseLengthUnit('cm')).toBe('cm');
    expect(parseLengthUnit('мм')).toBe('mm');
    expect(parseLengthUnit('mm')).toBe('mm');
    expect(parseLengthUnit('m')).toBe('m');
    expect(parseLengthUnit('метр')).toBe('m');
    expect(parseLengthUnit('meter')).toBe('m');
    expect(parseLengthUnit('kg')).toBeNull();
  });

  it('converts every unit to the scene unit (cm)', () => {
    expect(toCentimetres(160, 'cm')).toBe(160);
    expect(toCentimetres(1600, 'mm')).toBe(160);
    expect(toCentimetres(1.6, 'm')).toBe(160);
    expect(toCentimetres(0.75, 'm')).toBe(75);
  });
});

describe('definition mapping', () => {
  it.each(INTENT_DEFINITIONS.map((entry) => [entry.definitionId, entry.keywords[0]] as const))(
    'maps a %s phrase',
    (definitionId, keyword) => {
      const parsed = parseFurniturePrompt(`${keyword} 160 sm kenglikda`);
      expect(parsed.kind).toBe('intent');
      expect((parsed.payload as { definitionId: string }).definitionId).toBe(definitionId);
    },
  );

  it('supports all thirteen definitions', () => {
    expect(INTENT_DEFINITIONS).toHaveLength(13);
  });

  it('asks which desk is meant for a generic word', () => {
    const parsed = parseFurniturePrompt('stol yarat');
    expect(parsed.kind).toBe('clarification');
    expect(parsed.question).toContain('Kompyuter stoli');
  });

  it('asks which chair is meant for a generic word', () => {
    expect(matchDefinition('стул сделай').kind).toBe('ambiguous');
  });
});

describe('uzbek, russian and english prompts', () => {
  it('reads an Uzbek dimension sentence', () => {
    const parsed = parseFurniturePrompt(
      '160 sm uzunlikda, 70 sm chuqurlikda, 75 sm balandlikda kompyuter stoli yarat',
    );
    expect(parsed.kind).toBe('intent');
    const payload = parsed.payload as { definitionId: string; patch: Record<string, number>; language: string };
    expect(payload.definitionId).toBe('desk.computer');
    expect(payload.patch).toEqual({ width: 160, depth: 70, height: 75 });
    expect(payload.language).toBe('uz');
  });

  it('reads a Russian dimension sentence', () => {
    const parsed = parseFurniturePrompt(
      'Компьютерный стол шириной 160 см, глубиной 70 см, высотой 75 см',
    );
    expect(parsed.kind).toBe('intent');
    const payload = parsed.payload as { definitionId: string; patch: Record<string, number>; language: string };
    expect(payload.definitionId).toBe('desk.computer');
    expect(payload.patch).toEqual({ width: 160, depth: 70, height: 75 });
    expect(payload.language).toBe('ru');
  });

  it('reads an English dimension sentence', () => {
    const parsed = parseFurniturePrompt('Create a computer desk 160 cm wide, 70 cm deep, 75 cm high');
    expect(parsed.kind).toBe('intent');
    const payload = parsed.payload as { definitionId: string; patch: Record<string, number>; language: string };
    expect(payload.definitionId).toBe('desk.computer');
    expect(payload.patch).toEqual({ width: 160, depth: 70, height: 75 });
    expect(payload.language).toBe('en');
  });

  it('detects the language from the words, not a fixed default', () => {
    expect(detectLanguage('сделай шкаф')).toBe('ru');
    expect(detectLanguage('make a wardrobe')).toBe('en');
    expect(detectLanguage('shkaf yarat')).toBe('uz');
  });
});

describe('units in prompts', () => {
  it('converts metres and millimetres', () => {
    const metres = parseFurniturePrompt('kompyuter stoli 1.6 m kenglikda');
    expect((metres.payload as { patch: Record<string, number> }).patch.width).toBe(160);

    const millimetres = parseFurniturePrompt('kompyuter stoli 1600 mm kenglikda');
    expect((millimetres.payload as { patch: Record<string, number> }).patch.width).toBe(160);
  });

  it('accepts a comma decimal separator', () => {
    const parsed = parseFurniturePrompt('kompyuter stoli 160,5 sm kenglikda');
    expect((parsed.payload as { patch: Record<string, number> }).patch.width).toBe(160.5);
  });

  it('reads a WxDxH triple', () => {
    const parsed = parseFurniturePrompt('160x70x75 sm kompyuter stoli');
    expect((parsed.payload as { patch: Record<string, number> }).patch).toEqual({
      width: 160,
      depth: 70,
      height: 75,
    });
  });

  it('asks for a unit instead of assuming centimetres', () => {
    const parsed = parseFurniturePrompt('kompyuter stoli 160 kenglikda');
    expect(parsed.kind).toBe('clarification');
    expect(parsed.question).toContain('sm');
  });

  it('asks which dimension a bare measurement means', () => {
    const parsed = parseFurniturePrompt('kompyuter stoli 160 sm');
    expect(parsed.kind).toBe('clarification');
    expect(parsed.question).toContain('Kenglik');
  });
});

describe('boolean intents', () => {
  it('applies a drawer phrase in Uzbek and Russian', () => {
    const uz = parseFurniturePrompt('yozuv stoli 140 sm kenglikda tortma bilan');
    expect((uz.payload as { patch: Record<string, unknown> }).patch.drawerEnabled).toBe(true);

    const ru = parseFurniturePrompt('шкаф 120x45x100 см с дверцами');
    expect((ru.payload as { patch: Record<string, unknown> }).patch.doorsEnabled).toBe(true);
  });
});

describe('intent payload schema', () => {
  it('accepts a well-formed payload', () => {
    const result = parseFurnitureIntentPayload(BASE_PAYLOAD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intent.definitionId).toBe('desk.computer');
    expect(result.intent.patch).toEqual({ width: 170 });
  });

  it('rejects an unknown top-level field', () => {
    const result = parseFurnitureIntentPayload({ ...BASE_PAYLOAD, scene: {} });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe('invalid_payload');
  });

  it('rejects an unknown definition', () => {
    const result = parseFurnitureIntentPayload({ ...BASE_PAYLOAD, definitionId: 'desk.missing' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe('unknown_definition');
  });

  it('rejects an undeclared parameter', () => {
    const result = parseFurnitureIntentPayload({ ...BASE_PAYLOAD, patch: { nope: 1 } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe('unknown_parameter');
    expect(result.issues[0].keys).toEqual(['nope']);
  });

  it.each([
    ['nested object', { width: { value: 1 } }],
    ['array', { width: [1] }],
    ['null', { width: null }],
    ['NaN', { width: Number.NaN }],
    ['Infinity', { width: Number.POSITIVE_INFINITY }],
  ])('rejects a %s value', (_label, patch) => {
    const result = parseFurnitureIntentPayload({ ...BASE_PAYLOAD, patch });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe('invalid_value');
  });

  it('rejects a missing language and a broken clarification flag', () => {
    expect(parseFurnitureIntentPayload({ ...BASE_PAYLOAD, language: 'de' }).ok).toBe(false);
    expect(parseFurnitureIntentPayload({ ...BASE_PAYLOAD, clarificationRequired: 'no' }).ok).toBe(
      false,
    );
  });

  it('requires a question when clarification is requested', () => {
    const result = parseFurnitureIntentPayload({
      ...BASE_PAYLOAD,
      clarificationRequired: true,
    });
    expect(result.ok).toBe(false);

    const withQuestion = parseFurnitureIntentPayload({
      ...BASE_PAYLOAD,
      patch: {},
      clarificationRequired: true,
      clarificationQuestion: 'Qaysi stol kerak?',
    });
    expect(withQuestion.ok).toBe(true);
  });

  it('rejects an oversized patch', () => {
    const patch = Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [`key${index}`, index]),
    );
    expect(parseFurnitureIntentPayload({ ...BASE_PAYLOAD, patch }).ok).toBe(false);
  });
});
