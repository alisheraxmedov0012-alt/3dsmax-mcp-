/**
 * Phase 6.2.2 — the only place an imported model may find its companion files.
 *
 * A `.gltf` or `.obj` refers to buffers and textures by *name*, and those names
 * come from an untrusted file. Resolution therefore never touches the filesystem
 * or the network: every reference is matched against the exact set of files the
 * user selected, and nothing else can satisfy it.
 *
 * Rules, in order:
 *
 * - a `data:` URI never reaches this module (the loader handles it in memory),
 * - any other scheme (`http:`, `https:`, `file:`, `blob:`…) is refused,
 * - the reference is percent-decoded, then normalised (no `..`, no absolute path,
 *   no drive letter, no backslash, no control character),
 * - an exact path match wins,
 * - otherwise a unique **basename** match is accepted (model files often sit next
 *   to their textures), and two or more candidates are reported as ambiguous
 *   rather than guessed,
 * - otherwise the reference is missing.
 *
 * Ambiguity is a first-class result: "wood.png" with `a/wood.png` and `b/wood.png`
 * selected is an error the user must resolve, never a silent pick.
 */
import {
  MAX_MODEL_BYTES,
  MAX_SELECTED_FILES,
  MAX_TOTAL_INPUT_BYTES,
} from './importLimits';

/** One file as the picker delivered it. */
export interface ImportFile {
  /** Leaf file name (what the picker reports). */
  readonly name: string;
  /**
   * Relative path inside the selection, when the picker provides one
   * (`webkitRelativePath`, or a directory drop). Falls back to `name`.
   */
  readonly path?: string;
  readonly bytes: ArrayBuffer;
}

/** Same bound as `normalizeAssetPath` in the packaging schema. */
const MAX_PATH_LENGTH = 200;

export type PathResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly problem: string };

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Normalises a relative resource path.
 *
 * Based on the packaging schema's `normalizeAssetPath`, with one deliberate
 * difference: spaces inside a segment are allowed. Archive entry names are ours to
 * choose, but model files reference real files on a user's disk, where
 * "wood fine.png" is normal — and glTF escapes it as `wood%20fine.png`. The rules
 * that matter for safety (no traversal, no absolute path, no drive, no backslash,
 * no control characters) are identical.
 */
export function normalizeImportPath(value: string): PathResult {
  const raw = value.normalize('NFC');
  if (raw.length === 0 || raw.length > MAX_PATH_LENGTH) {
    return { ok: false, problem: `Yo‘l uzunligi 1..${MAX_PATH_LENGTH} bo‘lishi kerak.` };
  }
  if (raw.includes('\\')) {
    return { ok: false, problem: `Yo‘lda "\\" bo‘lmasligi kerak: "${raw}".` };
  }
  if (hasControlCharacter(raw)) {
    return { ok: false, problem: 'Yo‘lda boshqaruv belgisi bor.' };
  }
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
    return { ok: false, problem: `Absolyut yo‘l taqiqlangan: "${raw}".` };
  }
  const segments = raw.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      return { ok: false, problem: `Yo‘l traversal yoki bo‘sh segment: "${raw}".` };
    }
    if (/[. ]$/u.test(segment)) {
      return { ok: false, problem: `Segment nuqta yoki bo‘shliq bilan tugaydi: "${segment}".` };
    }
  }
  return { ok: true, path: segments.join('/') };
}

function basename(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

/** Rejects anything that is not a plain relative file reference. */
function decodeReference(uri: string): PathResult {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(uri)) {
    return { ok: false, problem: `Qo‘llab-quvvatlanmaydigan URI sxemasi: "${uri}".` };
  }
  let decoded = uri;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    return { ok: false, problem: `URI dekodlanmadi: "${uri}".` };
  }
  // A percent-encoded "../" must be caught after decoding, not before.
  return normalizeImportPath(decoded);
}

export type ResourceLookup =
  | { readonly ok: true; readonly path: string; readonly bytes: Uint8Array }
  | {
      readonly ok: false;
      readonly reason: 'missing' | 'ambiguous' | 'invalid';
      readonly uri: string;
      readonly candidates: readonly string[];
      readonly problem?: string;
    };

export class ResourceMap {
  private readonly entries: ReadonlyMap<string, Uint8Array>;
  private readonly byBasename = new Map<string, string[]>();
  private readonly byLowercase = new Map<string, string[]>();

  constructor(entries: ReadonlyMap<string, Uint8Array>) {
    this.entries = entries;
    for (const path of entries.keys()) {
      const leaf = basename(path);
      this.byBasename.set(leaf, [...(this.byBasename.get(leaf) ?? []), path]);
      const lower = path.toLowerCase();
      this.byLowercase.set(lower, [...(this.byLowercase.get(lower) ?? []), path]);
    }
  }

  get size(): number {
    return this.entries.size;
  }

  get totalBytes(): number {
    let total = 0;
    for (const bytes of this.entries.values()) {
      total += bytes.byteLength;
    }
    return total;
  }

  get paths(): readonly string[] {
    return [...this.entries.keys()];
  }

  has(path: string): boolean {
    return this.entries.has(path);
  }

  bytesOf(path: string): Uint8Array | undefined {
    return this.entries.get(path);
  }

  /** Resolves a reference from a model file against the selected set. */
  lookup(uri: string): ResourceLookup {
    const decoded = decodeReference(uri);
    if (!decoded.ok) {
      return { ok: false, reason: 'invalid', uri, candidates: [], problem: decoded.problem };
    }
    const path = decoded.path;

    const exact = this.entries.get(path);
    if (exact) {
      return { ok: true, path, bytes: exact };
    }

    // A model shipped flat next to its maps references them by name; a unique
    // basename is unambiguous evidence of which file was meant.
    const byName = this.byBasename.get(basename(path)) ?? [];
    if (byName.length === 1) {
      const only = byName[0];
      return { ok: true, path: only, bytes: this.entries.get(only) as Uint8Array };
    }
    if (byName.length > 1) {
      return { ok: false, reason: 'ambiguous', uri, candidates: byName };
    }

    // Case differences are a common cross-platform annoyance; resolve only when
    // exactly one file matches, otherwise report the ambiguity.
    const byCase = this.byLowercase.get(path.toLowerCase()) ?? [];
    if (byCase.length === 1) {
      const only = byCase[0];
      return { ok: true, path: only, bytes: this.entries.get(only) as Uint8Array };
    }
    if (byCase.length > 1) {
      return { ok: false, reason: 'ambiguous', uri, candidates: byCase };
    }

    return { ok: false, reason: 'missing', uri, candidates: [] };
  }
}

export type ResourceMapFailure =
  | { readonly kind: 'too_many_files'; readonly count: number }
  | { readonly kind: 'too_large'; readonly bytes: number }
  | { readonly kind: 'file_too_large'; readonly path: string; readonly bytes: number }
  | { readonly kind: 'invalid_path'; readonly path: string; readonly problem: string }
  | { readonly kind: 'duplicate'; readonly path: string };

export type ResourceMapResult =
  | { readonly ok: true; readonly map: ResourceMap }
  | { readonly ok: false; readonly failure: ResourceMapFailure };

/**
 * Builds the lookup table for one selection.
 *
 * Validation happens here, once, so every later step can assume the map only
 * contains safe relative paths inside the declared budgets.
 */
export function buildResourceMap(files: readonly ImportFile[]): ResourceMapResult {
  if (files.length > MAX_SELECTED_FILES) {
    return { ok: false, failure: { kind: 'too_many_files', count: files.length } };
  }

  const entries = new Map<string, Uint8Array>();
  let total = 0;

  for (const file of files) {
    const normalized = normalizeImportPath(file.path ?? file.name);
    if (!normalized.ok) {
      return {
        ok: false,
        failure: { kind: 'invalid_path', path: file.path ?? file.name, problem: normalized.problem },
      };
    }
    if (entries.has(normalized.path)) {
      // Two selected files cannot share one reference name: whichever we kept
      // would be a guess.
      return { ok: false, failure: { kind: 'duplicate', path: normalized.path } };
    }
    if (file.bytes.byteLength > MAX_MODEL_BYTES) {
      return {
        ok: false,
        failure: { kind: 'file_too_large', path: normalized.path, bytes: file.bytes.byteLength },
      };
    }
    total += file.bytes.byteLength;
    if (total > MAX_TOTAL_INPUT_BYTES) {
      return { ok: false, failure: { kind: 'too_large', bytes: total } };
    }
    entries.set(normalized.path, new Uint8Array(file.bytes));
  }

  return { ok: true, map: new ResourceMap(entries) };
}

/** Human-readable reason for a rejection, used by the panel and by errors. */
export function describeResourceMapFailure(failure: ResourceMapFailure): string {
  switch (failure.kind) {
    case 'too_many_files':
      return `Juda ko‘p fayl tanlandi (${failure.count}); maksimum ${MAX_SELECTED_FILES}.`;
    case 'too_large':
      return (
        `Tanlangan fayllar hajmi ${(failure.bytes / (1024 * 1024)).toFixed(1)} MB; ` +
        `maksimum ${MAX_TOTAL_INPUT_BYTES / (1024 * 1024)} MB.`
      );
    case 'file_too_large':
      return `"${failure.path}" fayli juda katta (${failure.bytes} bayt).`;
    case 'invalid_path':
      return `"${failure.path}" nomi qabul qilinmaydi: ${failure.problem}`;
    case 'duplicate':
      return `"${failure.path}" nomli fayl ikki marta tanlangan.`;
  }
}
