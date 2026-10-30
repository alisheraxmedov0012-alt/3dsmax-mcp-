/**
 * Small, dependency-free helpers shared by the offline prompt analyzers.
 *
 * The table-only adapter (Stage 3) and the all-type adapter (A3) must read
 * dimensions and colours identically; if they diverged, the same sentence would
 * mean different numbers depending on which engine answered. Keyword tables and
 * matching live here once so that cannot happen.
 *
 * Everything is deliberately simple and deterministic: no NLP service, no
 * network, no locale-dependent parsing.
 */

export const NUMBER = String.raw`\d+(?:[.,]\d+)?`;

export const DIMENSION_KEYWORDS: Record<'widthCm' | 'heightCm' | 'depthCm', string[]> = {
  widthCm: ['kenglik', 'keng', 'eni', 'en', 'width', 'ширина'],
  heightCm: ['balandlik', 'baland', "bo'yi", 'boyi', 'height', 'высота'],
  depthCm: ['chuqurlik', 'chuqur', 'depth', 'глубина'],
};

/** Bed length is the Z extent in this model; see `backend/app/services/ai/spec.py`. */
export const LENGTH_KEYWORDS = ['uzunlik', 'uzun', 'length', 'длина'];

export const COLOR_KEYWORDS: ReadonlyArray<{ words: readonly string[]; hex: string }> = [
  { words: ['oq', 'white', 'белый'], hex: '#ffffff' },
  { words: ['qora', 'black', 'чёрный', 'черный'], hex: '#1a1a1a' },
  { words: ['kulrang', 'gray', 'grey', 'серый'], hex: '#808080' },
  { words: ['jigarrang', 'brown', 'коричневый'], hex: '#8b5a2b' },
  { words: ["yog'och", 'yogoch', 'wood', 'дерево'], hex: '#a9744f' },
  { words: ['qizil', 'red', 'красный'], hex: '#c0392b' },
  { words: ["ko'k", 'kok', 'blue', 'синий'], hex: '#2f6fb0' },
  { words: ['yashil', 'green', 'зелёный', 'зеленый'], hex: '#2e8b57' },
  { words: ['sariq', 'yellow', 'жёлтый', 'желтый'], hex: '#d4b106' },
];

export function toNumber(token: string): number {
  return Number(token.replace(',', '.'));
}

export function escapeKeyword(keyword: string): string {
  return keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `keyword` appears as a whole word (surrounding letters break it). */
export function containsWord(text: string, keyword: string): boolean {
  const word = escapeKeyword(keyword);
  return new RegExp(`(?<![a-zа-яё'])${word}(?![a-zа-яё'])`, 'i').test(text);
}

/**
 * Find a dimension stated either after its keyword ("kenglik 200") or before it
 * ("200 sm kenglik"). Returns `undefined` when the text does not state it.
 */
export function findDimension(text: string, keywords: readonly string[]): number | undefined {
  for (const keyword of keywords) {
    const word = escapeKeyword(keyword);
    const after = new RegExp(
      `(?<![a-zа-яё'])${word}(?![a-zа-яё])\\s*(?::|=|-|sm|см)?\\s*(${NUMBER})`,
      'i',
    );
    const afterMatch = text.match(after);
    if (afterMatch) {
      return toNumber(afterMatch[1]);
    }

    const before = new RegExp(
      `(${NUMBER})\\s*(?:sm|см)?\\s+(?<![a-zа-яё'])${word}(?![a-zа-яё'])`,
      'i',
    );
    const beforeMatch = text.match(before);
    if (beforeMatch) {
      return toNumber(beforeMatch[1]);
    }
  }
  return undefined;
}

/** Hex colour (`#rgb` / `#rrggbb`) or a colour word, else `undefined`. */
export function findColor(text: string): string | undefined {
  const hex6 = text.match(/#[0-9a-fA-F]{6}/);
  if (hex6) {
    return hex6[0].toLowerCase();
  }
  const hex3 = text.match(/#[0-9a-fA-F]{3}(?![0-9a-fA-F])/);
  if (hex3) {
    const [r, g, b] = hex3[0].slice(1).split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }

  // The colour named first is the one the sentence is about ("qizil yog'och"
  // is a red wood finish), so position decides, not the table order.
  let best: { index: number; hex: string } | null = null;
  for (const { words, hex } of COLOR_KEYWORDS) {
    for (const keyword of words) {
      const index = firstKeywordIndex(text, [keyword]);
      if (index >= 0 && (!best || index < best.index)) {
        best = { index, hex };
      }
    }
  }
  return best?.hex;
}

/** Position of the first keyword in `text`, or -1 when absent (like `String#search`). */
export function firstKeywordIndex(text: string, keywords: readonly string[]): number {
  let first = -1;
  for (const keyword of keywords) {
    const index = text.search(
      new RegExp(`(?<![a-zа-яё'])${escapeKeyword(keyword)}(?![a-zа-яё'])`, 'i'),
    );
    if (index >= 0 && (first < 0 || index < first)) {
      first = index;
    }
  }
  return first;
}
