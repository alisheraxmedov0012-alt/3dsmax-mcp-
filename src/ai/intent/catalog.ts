/**
 * Stage 3.3 — multilingual vocabulary for the intent parser.
 *
 * Only *words* live here; parameter keys, types and defaults still come from
 * `getFurnitureParameters()`. Every definition listed below declares its
 * dimension channels explicitly, because "height" is `height` on a desk but
 * `totalHeight` on a bed — the parser must never guess a key name.
 */
import { getFurnitureDefinition } from '../../geometry/universal/registry';
import { escapeKeyword } from '../promptParsing';

export type DimensionConcept = 'width' | 'depth' | 'height' | 'length';

export interface DimensionKeys {
  readonly width?: string;
  readonly depth?: string;
  readonly height?: string;
  readonly length?: string;
}

export interface BooleanPhrase {
  readonly key: string;
  readonly value: boolean;
  readonly phrases: readonly string[];
}

export interface IntentDefinitionMeta {
  readonly definitionId: string;
  readonly keywords: readonly string[];
  readonly dimensionKeys: DimensionKeys;
  readonly booleanPhrases: readonly BooleanPhrase[];
}

export const DIMENSION_KEYWORDS: Readonly<Record<DimensionConcept, readonly string[]>> = {
  width: ['kenglik', 'kengligi', 'keng', 'eni', 'en', 'width', 'wide', 'ширин'],
  depth: ['chuqurlik', 'chuqurligi', 'chuqur', 'depth', 'deep', 'глубин'],
  height: ['balandlik', 'balandligi', 'baland', 'height', 'high', 'высот'],
  length: ['uzunlik', 'uzunligi', 'uzun', 'length', 'long', 'длин'],
};

const DRAWER_PHRASES: readonly BooleanPhrase[] = [
  {
    key: 'drawerEnabled',
    value: true,
    phrases: ['tortma bilan', 'tortmali', 'с ящиком', 'с ящиками', 'with drawer', 'with drawers'],
  },
  {
    key: 'drawerEnabled',
    value: false,
    phrases: ['tortmasiz', 'без ящика', 'без ящиков', 'without drawer', 'without drawers'],
  },
];

const DOOR_PHRASES: readonly BooleanPhrase[] = [
  {
    key: 'doorsEnabled',
    value: true,
    phrases: ['eshikli', 'с дверцами', 'with doors'],
  },
  {
    key: 'doorsEnabled',
    value: false,
    phrases: ['eshiksiz', 'без дверец', 'without doors'],
  },
];

const SHELF_PHRASES: readonly BooleanPhrase[] = [
  { key: 'shelfEnabled', value: true, phrases: ['polkali', 'javonli', 'с полкой', 'with shelf'] },
  { key: 'shelfEnabled', value: false, phrases: ['polkasiz', 'без полки', 'without shelf'] },
];

const ARMREST_PHRASES: readonly BooleanPhrase[] = [
  {
    key: 'armrestsEnabled',
    value: true,
    phrases: ['qo‘l tayanchli', "qo'l tayanchli", 'с подлокотниками', 'with armrests'],
  },
  {
    key: 'armrestsEnabled',
    value: false,
    phrases: ['qo‘l tayanchisiz', "qo'l tayanchisiz", 'без подлокотников', 'without armrests'],
  },
];

const GROMMET_PHRASES: readonly BooleanPhrase[] = [
  {
    key: 'grommetEnabled',
    value: true,
    phrases: ['kabel o‘tkazgich', "kabel o'tkazgich", 'с отверстием для кабеля', 'with grommet'],
  },
];

const CASTER_PHRASES: readonly BooleanPhrase[] = [
  {
    key: 'castersEnabled',
    value: true,
    phrases: ['g‘ildirakli', "g'ildirakli", 'с колёсами', 'с колесами', 'with casters'],
  },
];

const ALL_BOOLEANS: readonly BooleanPhrase[] = [
  ...DRAWER_PHRASES,
  ...DOOR_PHRASES,
  ...SHELF_PHRASES,
  ...ARMREST_PHRASES,
  ...GROMMET_PHRASES,
  ...CASTER_PHRASES,
];

export const INTENT_DEFINITIONS: readonly IntentDefinitionMeta[] = [
  {
    definitionId: 'desk.computer',
    keywords: ['kompyuter stoli', 'kompyuter stol', 'kompyuter', 'компьютерный стол', 'computer desk'],
    dimensionKeys: { width: 'width', depth: 'depth', height: 'height' },
    booleanPhrases: ALL_BOOLEANS,
  },
  {
    definitionId: 'desk.gaming',
    keywords: ['gaming stoli', 'gaming stol', 'o‘yin stoli', "o'yin stoli", 'игровой стол', 'геймерский стол', 'gaming desk'],
    dimensionKeys: { width: 'width', depth: 'depth', height: 'height' },
    booleanPhrases: ALL_BOOLEANS,
  },
  {
    definitionId: 'desk.writing',
    keywords: ['yozuv stoli', 'yozuv stol', 'письменный стол', 'writing desk'],
    dimensionKeys: { width: 'width', depth: 'depth', height: 'height' },
    booleanPhrases: ALL_BOOLEANS,
  },
  {
    definitionId: 'table.dining',
    keywords: ['ovqat stoli', 'ovqatlanish stoli', 'обеденный стол', 'dining table'],
    dimensionKeys: { width: 'width', depth: 'depth', height: 'height' },
    booleanPhrases: ALL_BOOLEANS,
  },
  {
    definitionId: 'chair.office',
    keywords: ['ofis kreslosi', 'ofis kreslo', 'ofis stuli', 'офисный стул', 'офисное кресло', 'office chair'],
    dimensionKeys: { width: 'seatWidth', depth: 'seatDepth' },
    booleanPhrases: ALL_BOOLEANS,
  },
  {
    definitionId: 'chair.dining',
    keywords: ['ovqat stuli', 'столовый стул', 'dining chair'],
    dimensionKeys: { width: 'seatWidth', depth: 'seatDepth' },
    booleanPhrases: ALL_BOOLEANS,
  },
  {
    definitionId: 'chair.armchair',
    keywords: ['yumshoq kreslo', 'kreslo', 'кресло', 'armchair'],
    dimensionKeys: { width: 'seatWidth', depth: 'seatDepth' },
    booleanPhrases: ALL_BOOLEANS,
  },
  {
    definitionId: 'chair.ergonomic',
    keywords: ['ergonomik kreslo', 'ergonomik kreslosi', 'эргономичное кресло', 'ergonomic chair'],
    dimensionKeys: { width: 'seatWidth', depth: 'seatDepth' },
    booleanPhrases: ALL_BOOLEANS,
  },
  {
    definitionId: 'sofa.standard',
    keywords: ['divan', 'диван', 'sofa', 'couch'],
    dimensionKeys: { width: 'width', depth: 'depth', height: 'totalHeight' },
    booleanPhrases: ALL_BOOLEANS,
  },
  {
    definitionId: 'cabinet.standard',
    keywords: ['shkaf', 'шкаф', 'cabinet', 'cupboard'],
    dimensionKeys: { width: 'width', depth: 'depth', height: 'height' },
    booleanPhrases: ALL_BOOLEANS,
  },
  {
    definitionId: 'bed.standard',
    keywords: ['karavot', 'krovat', 'кровать', 'bed'],
    dimensionKeys: { width: 'width', depth: 'length', height: 'totalHeight' },
    booleanPhrases: ALL_BOOLEANS,
  },
  {
    definitionId: 'kitchen.baseCabinet',
    keywords: ['oshxona shkafi', 'oshxona shkaf', 'кухонный шкаф', 'kitchen cabinet'],
    dimensionKeys: { width: 'width', depth: 'depth', height: 'totalHeight' },
    booleanPhrases: ALL_BOOLEANS,
  },
  {
    definitionId: 'stand.tv',
    keywords: ['tv stand', 'televizor stoli', 'televizor tumbasi', 'тв тумба', 'телевизор тумба', 'tv unit'],
    dimensionKeys: { width: 'width', depth: 'depth', height: 'totalHeight' },
    booleanPhrases: ALL_BOOLEANS,
  },
];

/** Words that name a furniture *family* rather than one definition. */
export const GENERIC_FURNITURE_WORDS: ReadonlyArray<{
  readonly words: readonly string[];
  readonly candidates: readonly string[];
}> = [
  {
    words: ['stol', 'стол', 'table'],
    candidates: ['desk.computer', 'desk.gaming', 'desk.writing', 'table.dining'],
  },
  {
    words: ['stul', 'стул', 'chair'],
    candidates: ['chair.office', 'chair.dining', 'chair.ergonomic'],
  },
];

/**
 * Keyword matcher tolerant of inflection: Uzbek `stol → stoli`, Russian
 * `стол → столы`, English plurals. Two extra letters only, so `bed` cannot match
 * `bedroom`.
 */
/** Same matcher as a source string, for composing longer patterns. */
export function keywordSource(keyword: string): string {
  const words = keyword.split(/\s+/).filter((word) => word !== '').map(escapeKeyword);
  const last = words.pop() ?? '';
  const prefix = words.length > 0 ? `${words.join('\\s+')}\\s+` : '';
  return `(?<![a-zа-яё0-9])${prefix}${last}[a-zа-яё]{0,2}(?![a-zа-яё0-9])`;
}

export function keywordPattern(keyword: string): RegExp {
  return new RegExp(keywordSource(keyword), 'i');
}

export interface KeywordHit {
  readonly definitionId: string;
  readonly index: number;
  readonly length: number;
}

/** All definition keyword hits, longest keyword first, no overlapping matches. */
export function findDefinitionHits(text: string): KeywordHit[] {
  const found: Array<KeywordHit & { keyword: string }> = [];
  for (const definition of INTENT_DEFINITIONS) {
    for (const keyword of definition.keywords) {
      const match = text.match(keywordPattern(keyword));
      if (match?.index !== undefined) {
        found.push({
          definitionId: definition.definitionId,
          index: match.index,
          length: match[0].length,
          keyword,
        });
      }
    }
  }

  found.sort((left, right) => right.keyword.length - left.keyword.length);
  const kept: KeywordHit[] = [];
  for (const hit of found) {
    const overlaps = kept.some(
      (entry) => hit.index < entry.index + entry.length && entry.index < hit.index + hit.length,
    );
    if (!overlaps) {
      kept.push({ definitionId: hit.definitionId, index: hit.index, length: hit.length });
    }
  }
  return kept;
}

export type DefinitionMatch =
  | { readonly kind: 'match'; readonly definitionId: string }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly string[] }
  | { readonly kind: 'none' };

export function matchDefinition(text: string): DefinitionMatch {
  const hits = findDefinitionHits(text);
  const candidates = [...new Set(hits.map((hit) => hit.definitionId))];
  if (candidates.length === 1) {
    return { kind: 'match', definitionId: candidates[0] };
  }
  if (candidates.length > 1) {
    return { kind: 'ambiguous', candidates };
  }

  for (const generic of GENERIC_FURNITURE_WORDS) {
    for (const word of generic.words) {
      if (keywordPattern(word).test(text)) {
        return { kind: 'ambiguous', candidates: generic.candidates };
      }
    }
  }
  return { kind: 'none' };
}

/** Drops rows whose definition is not registered (defensive, tests only). */
export function isRegisteredDefinition(definitionId: string): boolean {
  return getFurnitureDefinition(definitionId) !== undefined;
}

export function metaFor(definitionId: string): IntentDefinitionMeta | undefined {
  return INTENT_DEFINITIONS.find((entry) => entry.definitionId === definitionId);
}
