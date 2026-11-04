/**
 * Stage 3.3/3.4 — the offline intent provider.
 *
 * The project has a server-side provider for the legacy eight-type design
 * contract (`/api/ai/design`), but no server contract for universal definitions,
 * and no API key may live in the frontend. So the shipped provider is
 * deterministic and network-free — the same role `localDesignAdapter` plays for
 * the legacy flow — while `IntentProvider` keeps a server implementation a
 * drop-in later.
 *
 * It understands Uzbek, Russian and English furniture words, parameter words,
 * numbers with `,`/`.` decimals, the units mm/cm/m, and both absolute
 * ("kengligi 180 sm") and relative ("5 sm oshir") edits. An ambiguous type, an
 * unstated unit or a comparison without a number produces a clarification instead
 * of a guess.
 */
import { getFurnitureParameters } from '../../scene/configurator';
import type { SceneSpec } from '../../scene/types';
import { NUMBER } from '../promptParsing';
import {
  DIMENSION_KEYWORDS,
  keywordPattern,
  keywordSource,
  matchDefinition,
  metaFor,
  type DimensionConcept,
} from './catalog';
import { CM_PER_UNIT, parseDecimal, parseLengthUnit, toCentimetres, type LengthUnit } from './units';
import type {
  IntentLanguage,
  IntentPatchValue,
  IntentProvider,
  IntentProviderResult,
} from './types';

const UNIT_TOKEN =
  '(?:mm|мм|sm|cm|см|m|м|metr[a-zа-яё]*|метр[a-zа-яё]*|santimetr[a-zа-яё]*|сантиметр[a-zа-яё]*|centimet[a-zа-яё]*|millimet[a-zа-яё]*|миллиметр[a-zа-яё]*|meter[a-zа-яё]*|metre[a-zа-яё]*|millimeter[a-zа-яё]*)';

const VERB_TOKEN =
  '(?:oshir[a-zа-яё]*|kattalashtir[a-zа-яё]*|qo[‘\']sh[a-zа-яё]*|kamaytir[a-zа-яё]*|kichraytir[a-zа-яё]*|ayir[a-zа-яё]*|увелич[a-zа-яё]*|уменьш[a-zа-яё]*|добав[a-zа-яё]*|отним[a-zа-яё]*|increase[a-zа-яё]*|raise[a-zа-яё]*|add[a-zа-яё]*|decrease[a-zа-яё]*|reduce[a-zа-яё]*|lower[a-zа-яё]*|subtract[a-zа-яё]*)';

const DECREASE_WORDS = [
  'kamaytir',
  'kichraytir',
  'ayir',
  'уменьш',
  'отним',
  'decrease',
  'reduce',
  'lower',
  'subtract',
];

/** Comparative words that state a direction but not a size. */
const COMPARATIVE_BY_CONCEPT: Readonly<Record<DimensionConcept, readonly string[]>> = {
  width: ['wider', 'kengroq', 'шире', 'bigger', 'kattaroq'],
  depth: ['deeper', 'chuqurroq', 'глубже'],
  height: ['taller', 'higher', 'balandroq', 'выше'],
  length: ['longer', 'uzunroq', 'длиннее'],
};


const CONCEPT_ORDER: readonly DimensionConcept[] = ['width', 'depth', 'height', 'length'];

const UZ_WORDS = ['stol', 'stul', 'kreslo', 'divan', 'karavot', 'shkaf', 'uchun', 'bilan', 'kerak', 'yarat'];
const EN_WORDS = ['desk', 'table', 'chair', 'sofa', 'couch', 'cabinet', 'bed', 'with', 'without', 'create', 'make', 'change', 'set'];

export function detectLanguage(text: string): IntentLanguage {
  if (/[а-яё]/i.test(text)) {
    return 'ru';
  }
  const uzScore = UZ_WORDS.filter((word) => keywordPattern(word).test(text)).length;
  const enScore = EN_WORDS.filter((word) => keywordPattern(word).test(text)).length;
  if (enScore > uzScore) {
    return 'en';
  }
  return 'uz';
}

const CLARIFY = {
  uz: {
    unit: "O‘lchov birligini ko‘rsating (sm, mm yoki m).",
    type: (labels: string) => `Qaysi mebel kerak: ${labels}?`,
    dimension: 'Qaysi o‘lcham? Kenglik, chuqurlik yoki balandlikni ko‘rsating.',
    value: 'Qancha o‘zgartirishni ko‘rsating (masalan, 5 sm yoki 180 sm).',
    otherType: (label: string) =>
      `Siz "${label}" ni tahrirlayapsiz. Boshqa turdagi mebel kerak bo‘lsa, yangi mebel yarating.`,
    unknown:
      "Mebel turini aniqlay olmadim. Masalan: „160 sm kenglikdagi kompyuter stoli“.",
  },
  ru: {
    unit: 'Укажите единицу измерения (см, мм или м).',
    type: (labels: string) => `Какая мебель нужна: ${labels}?`,
    dimension: 'Какой размер? Укажите ширину, глубину или высоту.',
    value: 'Укажите величину изменения (например, 5 см или 180 см).',
    otherType: (label: string) =>
      `Вы редактируете «${label}». Для другого типа мебели создайте новый предмет.`,
    unknown: 'Не удалось определить тип мебели. Например: «компьютерный стол шириной 160 см».',
  },
  en: {
    unit: 'Please specify the unit (cm, mm or m).',
    type: (labels: string) => `Which furniture do you need: ${labels}?`,
    dimension: 'Which dimension is that? Please say width, depth or height.',
    value: 'How much should it change? For example 5 cm or 180 cm.',
    otherType: (label: string) =>
      `You are editing "${label}". Create a new piece for a different furniture type.`,
    unknown: 'I could not recognise the furniture type. For example: "a computer desk 160 cm wide".',
  },
} as const;

function labelFor(definitionId: string): string {
  return getFurnitureParameters(definitionId)?.label ?? definitionId;
}

interface Measurement {
  readonly value: number;
  readonly unit: LengthUnit | null;
}

type ConceptChange =
  | { readonly kind: 'absolute'; readonly value: number; readonly unit: LengthUnit | null }
  | { readonly kind: 'delta'; readonly delta: number; readonly unit: LengthUnit | null }
  | { readonly kind: 'needs-value' };

/** Reads "keyword 160 sm" or "160 sm keyword", allowing inflected keywords. */
function findMeasurement(text: string, keywords: readonly string[]): Measurement | null {
  for (const keyword of keywords) {
    const matched = text.match(keywordPattern(keyword));
    if (matched?.index === undefined) {
      continue;
    }
    const index = matched.index;

    const before = text.slice(Math.max(0, index - 20), index);
    const beforeMatch = before.match(new RegExp(`(${NUMBER})\\s*(${UNIT_TOKEN})?\\s*$`, 'i'));
    if (beforeMatch) {
      return {
        value: parseDecimal(beforeMatch[1]),
        unit: beforeMatch[2] ? parseLengthUnit(beforeMatch[2]) : null,
      };
    }

    const after = text.slice(index, index + 48);
    const afterMatch = after.match(new RegExp(`^[^\\d]{0,20}?(${NUMBER})\\s*(${UNIT_TOKEN})?`, 'i'));
    if (afterMatch) {
      return {
        value: parseDecimal(afterMatch[1]),
        unit: afterMatch[2] ? parseLengthUnit(afterMatch[2]) : null,
      };
    }
  }
  return null;
}

/**
 * Reads an absolute value or a relative change for one dimension concept.
 *
 * Order matters: "5 sm oshir" must be read as a delta before the plain number is
 * taken as an absolute value.
 */
function findConceptChange(text: string, concept: DimensionConcept): ConceptChange | null {
  const keywords = DIMENSION_KEYWORDS[concept];

  // "10 cm deeper" states the direction by comparison; it must be read as a delta
  // before "deep" is treated as a dimension noun with an absolute value.
  for (const comparative of COMPARATIVE_BY_CONCEPT[concept]) {
    const pattern = new RegExp(
      `(${NUMBER})\\s*(${UNIT_TOKEN})?\\s+${keywordSource(comparative)}`,
      'i',
    );
    const matched = text.match(pattern);
    if (matched) {
      return {
        kind: 'delta',
        delta: Math.abs(parseDecimal(matched[1])),
        unit: matched[2] ? parseLengthUnit(matched[2]) : null,
      };
    }
  }

  for (const keyword of keywords) {
    const source = keywordSource(keyword);

    // "Увеличь высоту на 5 см" — the verb comes before the measurement.
    const verbBefore = text.match(
      new RegExp(`(${VERB_TOKEN})[^.;]{0,25}?(?:${source})[^.;]{0,25}?([+-]?${NUMBER})\\s*(${UNIT_TOKEN})?`, 'i'),
    );
    if (verbBefore) {
      const unit = verbBefore[3] ? parseLengthUnit(verbBefore[3]) : null;
      const magnitude = parseDecimal(verbBefore[2]);
      const negative =
        verbBefore[2].startsWith('-') ||
        DECREASE_WORDS.some((word) => verbBefore[1].toLowerCase().startsWith(word));
      return { kind: 'delta', delta: negative ? -Math.abs(magnitude) : Math.abs(magnitude), unit };
    }

    // "Balandligini 5 sm oshir" — the verb follows the measurement.
    const verbAfter = text.match(
      new RegExp(`(?:${source})[^.;]{0,25}?([+-]?${NUMBER})\\s*(${UNIT_TOKEN})?[^.;]{0,25}?(${VERB_TOKEN})`, 'i'),
    );
    if (verbAfter) {
      const unit = verbAfter[2] ? parseLengthUnit(verbAfter[2]) : null;
      const magnitude = parseDecimal(verbAfter[1]);
      const negative =
        verbAfter[1].startsWith('-') ||
        DECREASE_WORDS.some((word) => verbAfter[3].toLowerCase().startsWith(word));
      return { kind: 'delta', delta: negative ? -Math.abs(magnitude) : Math.abs(magnitude), unit };
    }

    const signed = text.match(
      new RegExp(`(?:${source})[^.;]{0,25}?([+-]${NUMBER})\\s*(${UNIT_TOKEN})?`, 'i'),
    );
    if (signed) {
      return {
        kind: 'delta',
        delta: parseDecimal(signed[1]),
        unit: signed[2] ? parseLengthUnit(signed[2]) : null,
      };
    }

    const absolute = findMeasurement(text, [keyword]);
    if (absolute) {
      return { kind: 'absolute', value: absolute.value, unit: absolute.unit };
    }
  }

  const mentioned = keywords.some((keyword) => keywordPattern(keyword).test(text));
  const comparative = COMPARATIVE_BY_CONCEPT[concept].some((word) => keywordPattern(word).test(text));
  if (mentioned || comparative) {
    if (comparative) {
      return { kind: 'needs-value' };
    }
  }
  return null;
}

/** The single unit mentioned anywhere in the prompt, if there is exactly one. */
function globalUnit(text: string): LengthUnit | null {
  const units = new Set<LengthUnit>();
  const pattern = new RegExp(`(?<![a-zа-яё])(${UNIT_TOKEN})(?![a-zа-яё])`, 'gi');
  for (const match of text.matchAll(pattern)) {
    const unit = parseLengthUnit(match[1]);
    if (unit) {
      units.add(unit);
    }
  }
  return units.size === 1 ? [...units][0] : null;
}

interface Triple {
  readonly values: readonly number[];
  readonly unit: LengthUnit | null;
}

/** "160x70x75 sm" — width × depth × height, the common furniture convention. */
function findTriple(text: string): Triple | null {
  const match = text.match(
    new RegExp(`(${NUMBER})\\s*[x×х]\\s*(${NUMBER})(?:\\s*[x×х]\\s*(${NUMBER}))?\\s*(${UNIT_TOKEN})?`, 'i'),
  );
  if (!match) {
    return null;
  }
  const values = [match[1], match[2], match[3]]
    .filter((value): value is string => value !== undefined)
    .map(parseDecimal);
  return { values, unit: match[4] ? parseLengthUnit(match[4]) : null };
}

export interface LocalParseResult {
  readonly kind: 'intent' | 'clarification' | 'error';
  readonly payload?: unknown;
  readonly question?: string;
  readonly message?: string;
}

export interface PromptContext {
  /** Set when editing the selected object; the type then stays fixed. */
  readonly currentDefinitionId?: string;
  readonly currentSpec?: SceneSpec;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Parses a prompt into an intent payload. The payload is returned as untrusted
 * data on purpose: the service validates it with the same strict schema a server
 * provider's JSON would go through.
 */
export function parseFurniturePrompt(prompt: string, context: PromptContext = {}): LocalParseResult {
  const text = prompt.trim().toLowerCase().replace(/ё/g, 'е');
  const language = detectLanguage(text);
  const messages = CLARIFY[language];

  const match = matchDefinition(text);
  let definitionId: string;

  if (context.currentDefinitionId) {
    if (match.kind === 'match' && match.definitionId !== context.currentDefinitionId) {
      return {
        kind: 'clarification',
        question: messages.otherType(labelFor(context.currentDefinitionId)),
      };
    }
    definitionId = context.currentDefinitionId;
  } else {
    if (match.kind === 'none') {
      return { kind: 'error', message: messages.unknown };
    }
    if (match.kind === 'ambiguous') {
      const labels = match.candidates.map(labelFor).join(', ');
      return { kind: 'clarification', question: messages.type(labels) };
    }
    definitionId = match.definitionId;
  }

  const meta = metaFor(definitionId);
  const parameters = getFurnitureParameters(definitionId);
  if (!meta || !parameters) {
    return { kind: 'error', message: messages.unknown };
  }

  const declared = new Set(parameters.parameters.map((parameter) => parameter.key));
  const patch: Record<string, IntentPatchValue> = {};
  const unitFallback = globalUnit(text);
  const pending: Array<{ key: string; change: ConceptChange }> = [];

  for (const concept of CONCEPT_ORDER) {
    const change = findConceptChange(text, concept);
    if (!change) {
      continue;
    }
    const key =
      concept === 'length'
        ? (meta.dimensionKeys.length ?? meta.dimensionKeys.width)
        : meta.dimensionKeys[concept];
    if (!key || !declared.has(key)) {
      continue;
    }
    pending.push({ key, change });
  }

  if (pending.length === 0) {
    const triple = findTriple(text);
    if (triple) {
      const keys = [meta.dimensionKeys.width, meta.dimensionKeys.depth, meta.dimensionKeys.height];
      const unit = triple.unit ?? unitFallback;
      triple.values.forEach((value, index) => {
        const key = keys[index];
        if (key && declared.has(key)) {
          pending.push({ key, change: { kind: 'absolute', value, unit } });
        }
      });
    }
  }

  if (pending.length === 0) {
    // A bare measurement ("160 sm") does not say which side it measures; asking is
    // safer than silently making it the width.
    const bareMeasure = new RegExp(`(${NUMBER})\\s*(${UNIT_TOKEN})`, 'i').test(text);
    if (bareMeasure) {
      return { kind: 'clarification', question: messages.dimension };
    }
  }

  for (const entry of pending) {
    if (entry.change.kind === 'needs-value') {
      return { kind: 'clarification', question: messages.value };
    }
    const unit = entry.change.unit ?? unitFallback;
    if (!unit) {
      return { kind: 'clarification', question: messages.unit };
    }

    if (entry.change.kind === 'delta') {
      const base = context.currentSpec ? Number(context.currentSpec[entry.key]) : Number.NaN;
      if (!Number.isFinite(base)) {
        // No current value to change from — an absolute value is required.
        return { kind: 'clarification', question: messages.value };
      }
      patch[entry.key] = round(base + entry.change.delta * CM_PER_UNIT[unit]);
    } else {
      patch[entry.key] = toCentimetres(entry.change.value, unit);
    }
  }

  for (const rule of meta.booleanPhrases) {
    if (!declared.has(rule.key)) {
      continue;
    }
    const matched = rule.phrases.some((phrase) => keywordPattern(phrase).test(text));
    if (matched) {
      patch[rule.key] = rule.value;
    }
  }

  return {
    kind: 'intent',
    payload: {
      definitionId,
      patch,
      language,
      clarificationRequired: false,
    },
  };
}

/** The default (offline) provider for the intent service. */
export const localIntentProvider: IntentProvider = {
  id: 'local-rule-based',
  // Deterministic text parsing: no tokens, no cost, no paid budget required.
  metered: false,
  async generate({ prompt, currentDefinitionId, currentSpec }): Promise<IntentProviderResult> {
    const parsed = parseFurniturePrompt(prompt, { currentDefinitionId, currentSpec });
    if (parsed.kind === 'intent') {
      return { kind: 'intent', payload: parsed.payload };
    }
    if (parsed.kind === 'clarification') {
      return { kind: 'clarification', question: parsed.question ?? '' };
    }
    return {
      kind: 'error',
      code: 'unknown_definition',
      message: parsed.message ?? 'Mebel turini aniqlay olmadim.',
    };
  },
};
