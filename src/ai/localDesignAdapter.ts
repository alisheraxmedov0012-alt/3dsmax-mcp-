/**
 * A3 — the offline design analyzer.
 *
 * The Stage 3 fallback only understood tables, so a wardrobe prompt had to be
 * refused even though the geometry layer could build eight types. This adapter
 * interprets the same eight types the builders support, entirely offline, and
 * still refuses to guess: a prompt with no recognisable furniture word is built
 * as a table only with an explicit warning, and a prompt naming a type this
 * catalogue lacks produces an error rather than a substitute.
 *
 * It is deterministic and network-free by design. That makes it the fallback
 * when the cloud provider is unavailable, and the reference behaviour a real
 * provider's output is validated against.
 */
import {
  FURNITURE_DEFAULTS,
  FURNITURE_FIELDS,
  FURNITURE_TYPE_LABELS,
  createFurnitureParams,
  type FurnitureParams,
  type FurnitureType,
} from '../geometry/furniture/types';
import { validateFurnitureParams } from '../geometry/furniture/params';
import {
  DIMENSION_KEYWORDS,
  LENGTH_KEYWORDS,
  NUMBER,
  findColor,
  findDimension,
  toNumber,
} from './promptParsing';
import {
  AiAdapterError,
  type DesignAdapter,
  type DesignProposal,
  type ModelGenerationRequest,
  type ProposalConfidence,
} from './types';

export const LOCAL_DESIGN_ADAPTER_ID = 'local-rule-based';

/**
 * Furniture words, Uzbek/Russian/English. Every entry maps onto a builder that
 * exists; a word with no builder belongs in {@link UNKNOWN_TYPE_WORDS}.
 */
const TYPE_KEYWORDS: Readonly<Record<FurnitureType, readonly string[]>> = {
  table: ['stol', 'стол', 'table'],
  chair: ['stul', 'kursi', 'стул', 'chair'],
  armchair: ['kreslo', 'кресло', 'armchair'],
  sofa: ['divan', 'диван', 'sofa', 'couch'],
  bed: ['krovat', 'karavot', 'кровать', 'bed'],
  wardrobe: ['shkaf', 'шкаф', 'wardrobe', 'cabinet'],
  shelf: ['javon', 'полка', 'shelf', 'bookshelf'],
  dresser: ['tumba', 'комод', 'dresser', 'chest of drawers'],
};

/**
 * Furniture-ish words this build cannot construct. Naming one must not silently
 * produce a table, so these are detected explicitly.
 */
const UNKNOWN_TYPE_WORDS: readonly string[] = [
  'oshxona',
  'kitchen',
  'кухня',
  'ofis',
  'office',
  'офис',
  'parta',
  'desk',
  'парта',
];

/**
 * Uzbek agglutinates ("stollar", "shkafga"), Russian inflects, English
 * pluralises. Accepting a small, explicit suffix list keeps "stol" from matching
 * "stolovaya" while still reading normal sentences.
 */
const WORD_SUFFIX = String.raw`(?:lar|ler|ning|ga|ka|da|dan|dagi|ni|si|li|i|y|s|es)?`;

const MATERIAL_KEYWORDS: ReadonlyArray<{ kind: string; words: readonly string[] }> = [
  { kind: 'wood', words: ["yog'och", 'yogoch', 'eman', 'wood', 'oak', 'дерево', 'дуб'] },
  { kind: 'metal', words: ['metall', 'metal', 'po\u2019lat', "po'lat", 'steel', 'металл', 'сталь'] },
  { kind: 'fabric', words: ['mato', 'zig\u2019ir', "zig'ir", 'fabric', 'linen', 'ткань', 'лён'] },
  { kind: 'leather', words: ['charm', 'leather', 'кожа'] },
  { kind: 'glass', words: ['shisha', 'glass', 'стекло'] },
  { kind: 'plastic', words: ['plastik', 'plastmassa', 'plastic', 'пластик'] },
  { kind: 'painted', words: ["bo'yalgan", 'boyangan', 'painted', 'крашеный'] },
];

/** Counted details ("3 eshikli", "4 javonli") mapped onto their param key. */
const COUNT_DETAILS: ReadonlyArray<{ field: keyof FurnitureParams; words: readonly string[] }> = [
  { field: 'doorCount', words: ['eshik', 'eshikli', 'двер', 'door'] },
  { field: 'shelfCount', words: ['javon', 'javonli', 'polka', 'polkali', 'shelf', 'полка'] },
  { field: 'drawerCount', words: ['tortma', 'tortmali', 'ящик', 'drawer'] },
  { field: 'legCount', words: ['oyoq', 'oyogli', 'ножк', 'leg'] },
];

export interface LocalDesignParse {
  furniture: FurnitureType;
  params: FurnitureParams;
  materialKind: string | null;
  confidence: ProposalConfidence;
  notes: string[];
  warnings: string[];
}

function wordIndex(text: string, word: string): number {
  const pattern = new RegExp(
    `(?<![a-zа-яё'])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${WORD_SUFFIX}(?![a-zа-яё'])`,
    'i',
  );
  const match = pattern.exec(text);
  return match ? match.index : -1;
}

interface TypeMatch {
  type: FurnitureType | null;
  word: string | null;
  ignored: Array<{ type: FurnitureType; word: string }>;
}

/** Earliest named furniture type wins; later ones are reported as ignored. */
export function detectFurnitureType(text: string): TypeMatch {
  const lower = text.toLowerCase();
  const matches: Array<{ type: FurnitureType; word: string; index: number }> = [];
  (Object.keys(TYPE_KEYWORDS) as FurnitureType[]).forEach((type) => {
    let best: { word: string; index: number } | null = null;
    for (const word of TYPE_KEYWORDS[type]) {
      const index = wordIndex(lower, word);
      if (index >= 0 && (!best || index < best.index)) {
        best = { word, index };
      }
    }
    if (best) {
      matches.push({ type, ...best });
    }
  });
  matches.sort((a, b) => a.index - b.index);
  if (matches.length === 0) {
    return { type: null, word: null, ignored: [] };
  }
  return {
    type: matches[0].type,
    word: matches[0].word,
    ignored: matches.slice(1).map(({ type, word }) => ({ type, word })),
  };
}

export function detectMaterialKind(text: string): string | null {
  const lower = text.toLowerCase();
  for (const { kind, words } of MATERIAL_KEYWORDS) {
    if (words.some((word) => wordIndex(lower, word) >= 0)) {
      return kind;
    }
  }
  return null;
}

export function unknownTypeWord(text: string): string | null {
  const lower = text.toLowerCase();
  for (const word of UNKNOWN_TYPE_WORDS) {
    if (wordIndex(lower, word) >= 0) {
      return word;
    }
  }
  return null;
}

interface ClampedValue {
  value: number;
  warning?: string;
}

/** Clamp a parsed number into the field's declared range for this type. */
function clampField(type: FurnitureType, field: keyof FurnitureParams, raw: number): ClampedValue | null {
  const spec = FURNITURE_FIELDS[type].find((entry) => entry.key === field);
  if (!spec) {
    return null;
  }
  let value = raw;
  if (spec.integer) {
    value = Math.round(value);
  }
  if (value < spec.range.min || value > spec.range.max) {
    const clamped = Math.min(Math.max(value, spec.range.min), spec.range.max);
    return {
      value: clamped,
      warning: `${spec.label}: ${raw} ruxsat etilgan ${spec.range.min}–${spec.range.max} oralig'iga keltirildi (${clamped}).`,
    };
  }
  return { value };
}

function parseCounts(type: FurnitureType, text: string): {
  values: Partial<Record<keyof FurnitureParams, number>>;
  notes: string[];
  warnings: string[];
} {
  const values: Partial<Record<keyof FurnitureParams, number>> = {};
  const notes: string[] = [];
  const warnings: string[] = [];

  for (const { field, words } of COUNT_DETAILS) {
    if (!FURNITURE_FIELDS[type].some((entry) => entry.key === field)) {
      continue;
    }
    for (const word of words) {
      const pattern = new RegExp(`(${NUMBER})\\s*(?:ta\\s+)?${word}`, 'i');
      const match = pattern.exec(text);
      if (!match) {
        continue;
      }
      const clamped = clampField(type, field, toNumber(match[1]));
      if (!clamped) {
        break;
      }
      values[field] = clamped.value;
      notes.push(`${field}: ${clamped.value}.`);
      if (clamped.warning) {
        warnings.push(clamped.warning);
      }
      break;
    }
  }

  return { values, notes, warnings };
}

/**
 * Interpret a natural-language furniture prompt into validated parameters.
 *
 * Throws {@link AiAdapterError} when the text names nothing this build can build,
 * so a caller never receives a plausible-looking substitute.
 */
export function parseDesignPrompt(input: string): LocalDesignParse {
  const text = input.toLowerCase();

  const unknown = unknownTypeWord(text);
  const match = detectFurnitureType(text);
  if (match.type === null && unknown) {
    throw new AiAdapterError(
      `"${unknown}" bu versiyada qo'llab-quvvatlanmaydi — model yaratilmadi. ` +
        "Mavjud turlar: stol, stul, kreslo, divan, krovat, shkaf, javon, tumba.",
    );
  }

  const params = createFurnitureParams(match.type ?? 'table');
  const notes: string[] = [];
  const warnings: string[] = [];

  if (match.type) {
    notes.push(`Mebel turi: ${FURNITURE_TYPE_LABELS[match.type]} (${match.type}).`);
  } else {
    notes.push(
      "Mebel turi aniqlanmadi — stol sifatida qurildi. Boshqa tur kerak bo'lsa, uni nomlang.",
    );
    warnings.push("Tur aniqlanmadi: standart tur — stol.");
  }
  for (const ignored of match.ignored) {
    warnings.push(
      `Matnda yana "${ignored.word}" (${FURNITURE_TYPE_LABELS[ignored.type]}) ham bor — ` +
        `bitta obyekt uchun "${match.word}" tanlandi.`,
    );
  }

  const rawDimensions: Partial<Record<'widthCm' | 'heightCm' | 'depthCm', number>> = {};

  const triple = text.match(
    new RegExp(`(${NUMBER})\\s*[x×*]\\s*(${NUMBER})\\s*[x×*]\\s*(${NUMBER})`),
  );
  if (triple) {
    rawDimensions.widthCm = toNumber(triple[1]);
    rawDimensions.depthCm = toNumber(triple[2]);
    rawDimensions.heightCm = toNumber(triple[3]);
    notes.push(
      `O'lcham (kenglik × chuqurlik × balandlik): ${rawDimensions.widthCm} × ${rawDimensions.depthCm} × ${rawDimensions.heightCm} sm.`,
    );
  }

  (['widthCm', 'heightCm', 'depthCm'] as const).forEach((field) => {
    const value = findDimension(text, DIMENSION_KEYWORDS[field]);
    if (value !== undefined) {
      rawDimensions[field] = value;
    }
  });

  // A bed's head-to-foot extent is its Z extent in this model; only a bed gets
  // the "length" synonym, matching the backend's documented semantics.
  if (match.type === 'bed' && rawDimensions.depthCm === undefined) {
    const length = findDimension(text, LENGTH_KEYWORDS);
    if (length !== undefined) {
      rawDimensions.depthCm = length;
      notes.push(`Krovat uzunligi chuqurlik (Z) o'qi sifatida qabul qilindi: ${length} sm.`);
    }
  }

  let dimensionsFound = 0;
  (['widthCm', 'heightCm', 'depthCm'] as const).forEach((field) => {
    const raw = rawDimensions[field];
    const spec = FURNITURE_FIELDS[match.type ?? 'table'].find((entry) => entry.key === field);
    const label = spec?.label ?? field;
    if (raw === undefined) {
      const fallback = FURNITURE_DEFAULTS[match.type ?? 'table'][field] as number;
      notes.push(`${label}: aniqlanmadi, standart qiymat (${fallback}).`);
      return;
    }
    const clamped = clampField(match.type ?? 'table', field, raw);
    if (!clamped) {
      return;
    }
    params[field] = clamped.value;
    dimensionsFound += 1;
    notes.push(`${label}: ${clamped.value}.`);
    if (clamped.warning) {
      warnings.push(clamped.warning);
    }
  });

  const counts = parseCounts(match.type ?? 'table', text);
  Object.assign(params, counts.values);
  notes.push(...counts.notes);
  warnings.push(...counts.warnings);

  const color = findColor(text);
  if (color) {
    params.color = color;
    notes.push(`Rang: ${color}.`);
  } else {
    notes.push(`Rang: aniqlanmadi, standart rang (${params.color}).`);
  }

  const materialKind = detectMaterialKind(text);
  if (materialKind) {
    notes.push(`Material: ${materialKind}.`);
  }

  const validated = validateFurnitureParams(match.type ?? 'table', params);
  if (!validated) {
    throw new AiAdapterError(
      "Mahalliy tahlil natijasi tekshiruvdan o'tmadi — model yaratilmadi.",
    );
  }

  const confidence: ProposalConfidence =
    dimensionsFound === 3 ? 'high' : dimensionsFound >= 1 || counts.notes.length > 0 ? 'medium' : 'low';

  return {
    furniture: match.type ?? 'table',
    params: validated,
    materialKind,
    confidence,
    notes,
    warnings,
  };
}

export const localDesignAdapter: DesignAdapter = {
  id: LOCAL_DESIGN_ADAPTER_ID,
  capabilities: { text: true, image: false },

  async generate(request: ModelGenerationRequest): Promise<DesignProposal> {
    if (request.imageFileName) {
      throw new AiAdapterError(
        "Rasm orqali yaratish hozircha qo'llab-quvvatlanmaydi: AI xizmati hali tanlanmagan. " +
          'Iltimos, matn tavsifidan foydalaning.',
      );
    }

    const trimmed = request.text.trim();
    if (trimmed === '') {
      throw new AiAdapterError("Matn bo'sh. Iltimos, mebel tavsifini kiriting.");
    }

    const parsed = parseDesignPrompt(trimmed);
    return {
      adapterId: LOCAL_DESIGN_ADAPTER_ID,
      furniture: parsed.furniture,
      params: parsed.params,
      materialKind: parsed.materialKind,
      confidence: parsed.confidence,
      notes: parsed.notes,
      warnings: parsed.warnings,
    };
  },
};
