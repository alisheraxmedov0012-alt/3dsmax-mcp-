import { normalizeProposal, type RawTableProposal } from './normalizeProposal';
import {
  AiAdapterError,
  type AiModelAdapter,
  type ModelGenerationRequest,
  type ModelProposal,
  type ProposalConfidence,
} from './types';

export const LOCAL_TABLE_ADAPTER_ID = 'local-rule-based-table';

const NUMBER = String.raw`\d+(?:[.,]\d+)?`;

const DIMENSION_KEYWORDS: Record<'widthCm' | 'heightCm' | 'depthCm', string[]> = {
  widthCm: ['kenglik', 'keng', 'eni', 'en', 'width'],
  heightCm: ['balandlik', 'baland', "bo'yi", 'boyi', 'height'],
  depthCm: ['chuqurlik', 'chuqur', 'depth'],
};

const COLOR_KEYWORDS: Array<{ words: string[]; hex: string }> = [
  { words: ['oq', 'white'], hex: '#ffffff' },
  { words: ['qora', 'black'], hex: '#1a1a1a' },
  { words: ['kulrang', 'gray', 'grey'], hex: '#808080' },
  { words: ['jigarrang', 'brown'], hex: '#8b5a2b' },
  { words: ["yog'och", 'yogoch', 'wood'], hex: '#a9744f' },
  { words: ['qizil', 'red'], hex: '#c0392b' },
  { words: ["ko'k", 'kok', 'blue'], hex: '#2f6fb0' },
  { words: ['yashil', 'green'], hex: '#2e8b57' },
  { words: ['sariq', 'yellow'], hex: '#d4b106' },
];

/** Furniture words that Stage 3 does not support yet (only the table exists). */
const UNSUPPORTED_OBJECTS = [
  'shkaf',
  'javon',
  'divan',
  'stul',
  'karavot',
  'oshxona',
  'kursi',
  'wardrobe',
  'cabinet',
  'sofa',
  'chair',
  'bed',
];

interface ParsedPrompt {
  raw: RawTableProposal;
  confidence: ProposalConfidence;
  notes: string[];
  warnings: string[];
}

function toNumber(token: string): number {
  return Number(token.replace(',', '.'));
}

function escapeKeyword(keyword: string): string {
  return keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findDimension(text: string, keywords: string[]): number | undefined {
  for (const keyword of keywords) {
    const word = escapeKeyword(keyword);
    const after = new RegExp(
      `(?<![a-z'])${word}(?![a-z'])\\s*(?::|=|-|sm)?\\s*(${NUMBER})`,
      'i',
    );
    const afterMatch = text.match(after);
    if (afterMatch) {
      return toNumber(afterMatch[1]);
    }

    const before = new RegExp(`(${NUMBER})\\s*(?:sm)?\\s+(?<![a-z'])${word}(?![a-z'])`, 'i');
    const beforeMatch = text.match(before);
    if (beforeMatch) {
      return toNumber(beforeMatch[1]);
    }
  }
  return undefined;
}

function findColor(text: string): string | undefined {
  const hex6 = text.match(/#[0-9a-fA-F]{6}/);
  if (hex6) {
    return hex6[0].toLowerCase();
  }
  const hex3 = text.match(/#[0-9a-fA-F]{3}(?![0-9a-fA-F])/);
  if (hex3) {
    const [r, g, b] = hex3[0].slice(1).split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }

  for (const { words, hex } of COLOR_KEYWORDS) {
    for (const keyword of words) {
      const word = escapeKeyword(keyword);
      const pattern = new RegExp(`(?<![a-z'])${word}(?![a-z'])`, 'i');
      if (pattern.test(text)) {
        return hex;
      }
    }
  }
  return undefined;
}

/**
 * Furniture words in `text` that this offline analyzer cannot build.
 *
 * The analyzer only knows tables. Exported so a caller can refuse to substitute a
 * table for, say, a wardrobe prompt: warning about it and then applying a table
 * anyway reads as success for a request that was not answered.
 */
export function unsupportedObjectsIn(text: string): string[] {
  return findUnsupportedObjects(text.toLowerCase());
}

function findUnsupportedObjects(text: string): string[] {
  return UNSUPPORTED_OBJECTS.filter((keyword) => {
    const word = escapeKeyword(keyword);
    return new RegExp(`(?<![a-z'])${word}(?![a-z'])`, 'i').test(text);
  });
}

/**
 * Deterministic, offline interpretation of a natural-language table prompt.
 * Extracts dimensions and colour into a raw proposal and reports what it
 * understood (notes) and what it could not (warnings). No network is used.
 */
export function parseTablePrompt(input: string): ParsedPrompt {
  const text = input.toLowerCase();
  const notes: string[] = [];
  const warnings: string[] = [];

  const raw: RawTableProposal = {};

  const triple = text.match(new RegExp(`(${NUMBER})\\s*[x×]\\s*(${NUMBER})\\s*[x×]\\s*(${NUMBER})`));
  if (triple) {
    raw.widthCm = toNumber(triple[1]);
    raw.depthCm = toNumber(triple[2]);
    raw.heightCm = toNumber(triple[3]);
    notes.push(
      `O'lcham (kenglik × chuqurlik × balandlik): ${raw.widthCm} × ${raw.depthCm} × ${raw.heightCm} sm.`,
    );
  }

  (['widthCm', 'heightCm', 'depthCm'] as const).forEach((field) => {
    const value = findDimension(text, DIMENSION_KEYWORDS[field]);
    if (value !== undefined) {
      raw[field] = value;
    }
  });

  let dimensionsFound = 0;
  (['widthCm', 'heightCm', 'depthCm'] as const).forEach((field) => {
    if (raw[field] !== undefined) {
      dimensionsFound += 1;
      const label = { widthCm: 'Kenglik', heightCm: 'Balandlik', depthCm: 'Chuqurlik' }[field];
      notes.push(`${label}: ${raw[field]} sm.`);
    }
  });

  const color = findColor(text);
  if (color) {
    raw.color = color;
    notes.push(`Rang: ${color}.`);
  }

  findUnsupportedObjects(text).forEach((object) => {
    warnings.push(
      `"${object}" hozircha qo'llab-quvvatlanmaydi — Stage 3 faqat stol bilan ishlaydi. Stol yaratildi.`,
    );
  });

  const confidence: ProposalConfidence =
    dimensionsFound === 3 ? 'high' : dimensionsFound >= 1 ? 'medium' : 'low';

  return { raw, confidence, notes, warnings };
}

export const localTableAdapter: AiModelAdapter = {
  id: LOCAL_TABLE_ADAPTER_ID,
  capabilities: { text: true, image: false },

  async generate(request: ModelGenerationRequest): Promise<ModelProposal> {
    if (request.imageFileName) {
      throw new AiAdapterError(
        "Rasm orqali yaratish hozircha qo'llab-quvvatlanmaydi: AI xizmati hali tanlanmagan. Iltimos, matn tavsifidan foydalaning.",
      );
    }

    const trimmed = request.text.trim();
    if (trimmed === '') {
      throw new AiAdapterError("Matn bo'sh. Iltimos, stol tavsifini kiriting.");
    }

    const parsed = parseTablePrompt(trimmed);
    const normalized = normalizeProposal(parsed.raw);

    return {
      adapterId: LOCAL_TABLE_ADAPTER_ID,
      params: normalized.params,
      confidence: parsed.confidence,
      notes: [...parsed.notes, ...normalized.notes],
      warnings: [...parsed.warnings, ...normalized.warnings],
    };
  },
};
