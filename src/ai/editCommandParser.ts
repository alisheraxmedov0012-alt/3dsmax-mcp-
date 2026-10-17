/**
 * W15.9 — deterministic edit-command parser (the "mock provider" for AI edits).
 *
 * This is **not** an LLM. It is a rule-based parser that recognises a small,
 * documented set of Uzbek/Russian/English phrasings and turns them into the
 * W15 DSL operators. Anything it does not recognise is reported as unsupported
 * rather than guessed, and it never produces a reducer action or a JSON path —
 * only operators from `sceneDiff.ts`.
 *
 * The parser is deliberately separate from validation: it maps text to intent,
 * and `buildDiff` checks the result against the real scene (ranges, cross-field
 * rules, target existence). A parser "success" can still be refused there.
 */
import {
  FURNITURE_DEFAULTS,
  FURNITURE_TYPE_LABELS,
  type FurnitureType,
} from '../geometry/furniture';
import type { AiEditOp } from '../scene/sceneDiff';
import type { SceneObject } from '../scene/types';

export const MAX_EDIT_PROMPT_LENGTH = 200;

export type EditParseFailureReason =
  | 'empty'
  | 'too_long'
  | 'unsupported'
  | 'ambiguous';

export interface EditParseSuccess {
  ok: true;
  ops: AiEditOp[];
  /** Short, user-facing notes about how the command was understood. */
  notes: string[];
}

export interface EditParseFailure {
  ok: false;
  reason: EditParseFailureReason;
  message: string;
}

export type EditParseResult = EditParseSuccess | EditParseFailure;

const NUMBER = String.raw`(\d+(?:[.,]\d+)?)`;

/** Lower-cases and normalises the apostrophes used in Uzbek Latin text. */
export function normalizePrompt(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019\u02BB\u02BC`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function toNumber(token: string): number {
  return Number(token.replace(',', '.'));
}

/** Colour words, longest first so "to'q qizil" wins over "qizil". */
const COLORS: ReadonlyArray<{ words: readonly string[]; hex: string; label: string }> = [
  { words: ['to\'q ko\'k', 'toq kok', 'dark blue'], hex: '#1f3f6b', label: "to'q ko'k" },
  { words: ['och ko\'k', 'light blue'], hex: '#9dc3e6', label: "och ko'k" },
  { words: ['oq', 'white'], hex: '#ffffff', label: 'oq' },
  { words: ['qora', 'black'], hex: '#1a1a1a', label: 'qora' },
  { words: ['kulrang', 'gray', 'grey'], hex: '#808080', label: 'kulrang' },
  { words: ['jigarrang', 'brown'], hex: '#8b5a2b', label: 'jigarrang' },
  { words: ["yog'och", 'yogoch', 'wood'], hex: '#a9744f', label: "yog'och" },
  { words: ['bej', 'beige'], hex: '#d8c9a8', label: 'bej' },
  { words: ['qizil', 'red'], hex: '#c0392b', label: 'qizil' },
  { words: ["ko'k", 'kok', 'blue'], hex: '#2f6fb0', label: "ko'k" },
  { words: ['yashil', 'green'], hex: '#2e8b57', label: 'yashil' },
  { words: ['sariq', 'yellow'], hex: '#d4b106', label: 'sariq' },
];

/** Material presets the DSL already exposes, by common word. */
const MATERIAL_WORDS: ReadonlyArray<{ words: readonly string[]; presetId: string; label: string }> = [
  { words: ["yog'och", 'yogoch', 'eman', 'wood', 'oak'], presetId: 'wood-oak', label: "yog'och" },
  { words: ['metall', 'po\'lat', 'polat', 'metal', 'steel'], presetId: 'metal-steel', label: 'metall' },
  { words: ['mato', 'matо', 'fabric', 'linen', 'zig\'ir'], presetId: 'fabric-linen', label: 'mato' },
  { words: ['charm', 'leather'], presetId: 'leather-brown', label: 'charm' },
  { words: ['shisha', 'glass'], presetId: 'glass-clear', label: 'shisha' },
  { words: ['plastik', 'plastmassa', 'plastic'], presetId: 'plastic-white', label: 'plastik' },
  { words: ['bo\'yalgan', 'boyagan', 'painted'], presetId: 'painted-red', label: "bo'yalgan" },
];

/** Dimension words, in the order they are tried. */
const DIMENSION_WORDS: ReadonlyArray<{
  field: 'widthCm' | 'heightCm' | 'depthCm';
  grow: readonly string[];
  shrink: readonly string[];
  label: string;
}> = [
  {
    field: 'widthCm',
    grow: ['kengaytir', 'kengaytiring', 'eni kattalashtir', 'widen', 'make wider'],
    shrink: ['toraytir', 'toraytiring', 'eni kichraytir', 'narrow'],
    label: 'kenglik',
  },
  {
    field: 'heightCm',
    grow: ['balandlat', 'balandlatiring', 'bo\'yini oshir', 'heighten', 'make taller'],
    shrink: ['pasaytir', 'pasaytiring', 'balandligini kamaytir', 'bo\'yini pasaytir', 'lower'],
    label: 'balandlik',
  },
  {
    field: 'depthCm',
    grow: ['chuqurlashtir', 'chuqurroq qil', 'deepen'],
    shrink: ['sayozlashtir', 'chuqurligini kamaytir', 'make shallower'],
    label: 'chuqurlik',
  },
];

/** Absolute dimension phrasing: "kengligi 200 sm bo'lsin". */
const ABSOLUTE_DIMENSIONS: ReadonlyArray<{ words: readonly string[]; field: 'widthCm' | 'heightCm' | 'depthCm' }> = [
  { words: ['kengligi', 'kenglik', 'eni', 'width'], field: 'widthCm' },
  { words: ['balandligi', 'balandlik', "bo'yi", 'height'], field: 'heightCm' },
  { words: ['chuqurligi', 'chuqurlik', 'depth'], field: 'depthCm' },
];

const MOVE_WORDS = ['sur', 'surish', 'ko\'chir', 'kochir', 'move', 'shift'];
const ROTATE_WORDS = ['bur', 'aylantir', 'rotate', 'turn'];
const RENAME_WORDS = ['nomini', 'nomi', 'rename', 'call it', 'name it'];
const COLOR_WORDS = ['rangini', 'rang', 'color', 'colour'];
const HIDE_WORDS = ['yashir', 'hide'];
const SHOW_WORDS = ['ko\'rsat', 'korsat', 'show'];

/** Direction words and the signed axis they move along. */
const DIRECTIONS: ReadonlyArray<{
  words: readonly string[];
  axis: 'x' | 'y' | 'z';
  sign: 1 | -1;
  label: string;
}> = [
  { words: ['chapga', 'chap', 'left'], axis: 'x', sign: -1, label: 'chapga' },
  { words: ["o'ngga", 'ongga', 'o\'ng', 'right'], axis: 'x', sign: 1, label: "o'ngga" },
  { words: ['oldiga', 'oldinga', 'forward'], axis: 'z', sign: -1, label: 'oldiga' },
  { words: ['orqaga', 'orqa', 'back'], axis: 'z', sign: 1, label: 'orqaga' },
  { words: ['tepaga', 'yuqoriga', 'up'], axis: 'y', sign: 1, label: 'tepaga' },
  { words: ['pastga', 'down'], axis: 'y', sign: -1, label: 'pastga' },
];

function includesAny(text: string, words: readonly string[]): string | null {
  for (const word of words) {
    if (text.includes(word)) {
      return word;
    }
  }
  return null;
}

function findColor(text: string) {
  for (const color of COLORS) {
    if (includesAny(text, color.words)) {
      return color;
    }
  }
  return null;
}

function findMaterial(text: string) {
  for (const material of MATERIAL_WORDS) {
    if (includesAny(text, material.words)) {
      return material;
    }
  }
  return null;
}

function currentParam(object: SceneObject, field: string): number {
  const own = (object.params as unknown as Record<string, unknown>)[field];
  if (typeof own === 'number' && Number.isFinite(own)) {
    return own;
  }
  const fallback = (FURNITURE_DEFAULTS[object.type] as unknown as Record<string, unknown>)[field];
  return typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : 0;
}

function unsupported(message: string): EditParseFailure {
  return { ok: false, reason: 'unsupported', message };
}

/** Distributive omit: `Omit` alone collapses the union into a single shape. */
type EditOpTemplate = AiEditOp extends infer T
  ? T extends AiEditOp
    ? Omit<T, 'objectId'>
    : never
  : never;

function build(
  object: SceneObject,
  op: EditOpTemplate,
  note: string,
): EditParseSuccess {
  return { ok: true, ops: [{ ...op, objectId: object.id } as AiEditOp], notes: [note] };
}

/**
 * Parses one command against the selected object.
 *
 * The object supplies the current values a relative command is based on
 * ("20 sm kengaytir") and the type, which decides which fields exist.
 */
export function parseEditCommand(rawText: string, object: SceneObject): EditParseResult {
  const text = normalizePrompt(rawText);

  if (text === '') {
    return { ok: false, reason: 'empty', message: "Buyruq matnini kiriting." };
  }
  if (rawText.length > MAX_EDIT_PROMPT_LENGTH) {
    return {
      ok: false,
      reason: 'too_long',
      message: `Buyruq ${MAX_EDIT_PROMPT_LENGTH} belgidan oshmasligi kerak.`,
    };
  }

  const typeLabel = FURNITURE_TYPE_LABELS[object.type as FurnitureType] ?? object.type;

  // --- visibility ---------------------------------------------------------
  if (includesAny(text, HIDE_WORDS)) {
    return build(object, { op: 'set_visibility', visible: false }, `${typeLabel} yashiriladi.`);
  }
  if (includesAny(text, SHOW_WORDS)) {
    return build(object, { op: 'set_visibility', visible: true }, `${typeLabel} ko'rsatiladi.`);
  }

  // --- rename -------------------------------------------------------------
  if (includesAny(text, RENAME_WORDS)) {
    const name = extractRenameTarget(rawText);
    if (name === null) {
      return unsupported("Yangi nomni topib bo'lmadi. Masalan: «nomini Kitob javoni deb o'zgartir».");
    }
    return build(object, { op: 'rename', name }, `Yangi nom: «${name}».`);
  }

  // --- colour -------------------------------------------------------------
  if (includesAny(text, COLOR_WORDS)) {
    // A colour word next to a material word means "material", not paint.
    const material = findMaterial(text);
    if (material && !findColor(text)) {
      return build(
        object,
        { op: 'apply_material_preset', presetId: material.presetId },
        `Material: ${material.label}.`,
      );
    }
    const color = findColor(text);
    if (color === null) {
      return unsupported("Rangni topib bo'lmadi. Masalan: «rangini oq rangga o'zgartir».");
    }
    return build(object, { op: 'set_params', params: { color: color.hex } }, `Rang: ${color.label}.`);
  }

  // --- rotation -----------------------------------------------------------
  if (includesAny(text, ROTATE_WORDS)) {
    const degrees = matchNumber(text);
    if (degrees === null) {
      return unsupported("Burilish burchagini topib bo'lmadi. Masalan: «90 daraja bur».");
    }
    return build(
      object,
      { op: 'set_transform', rotation: { y: degrees } },
      `Y o'qi bo'yicha ${degrees}° buriladi.`,
    );
  }

  // --- move ---------------------------------------------------------------
  if (includesAny(text, MOVE_WORDS)) {
    const amount = matchNumber(text);
    const direction = DIRECTIONS.find((entry) => includesAny(text, entry.words) !== null);
    if (amount === null || !direction) {
      return unsupported(
        "Yo'nalish yoki masofani topib bo'lmadi. Masalan: «10 sm chapga sur».",
      );
    }
    const axis = direction.axis;
    const current = object.position[axis];
    const next = current + direction.sign * amount;
    if (axis === 'y' && next < 0) {
      return unsupported("Obyektni pol ostiga tushirib bo'lmaydi.");
    }
    return build(
      object,
      { op: 'set_transform', position: { [axis]: next } },
      `${direction.label} ${amount} sm (${axis}: ${current} → ${next}).`,
    );
  }

  // --- absolute dimension -------------------------------------------------
  const absolute = ABSOLUTE_DIMENSIONS.find((entry) => includesAny(text, entry.words) !== null);
  const absoluteValue = matchNumber(text);
  if (absolute && absoluteValue !== null && /(bo'lsin|qil|make it|=)/.test(text)) {
    return build(
      object,
      { op: 'set_params', params: { [absolute.field]: absoluteValue } },
      `Yangi qiymat: ${absolute.field} = ${absoluteValue} sm.`,
    );
  }

  // --- relative dimension -------------------------------------------------
  for (const dimension of DIMENSION_WORDS) {
    const grow = includesAny(text, dimension.grow);
    const shrink = includesAny(text, dimension.shrink);
    if (grow === null && shrink === null) {
      continue;
    }
    const delta = matchNumber(text);
    if (delta === null) {
      return unsupported(
        `O'lchamni topib bo'lmadi. Masalan: «20 sm kengaytir».`,
      );
    }
    const current = currentParam(object, dimension.field);
    const next = grow !== null ? current + delta : current - delta;
    return build(
      object,
      { op: 'set_params', params: { [dimension.field]: next } },
      `${dimension.label}: ${current} → ${next} sm.`,
    );
  }

  // --- material preset without an explicit colour word --------------------
  const material = findMaterial(text);
  if (material) {
    return build(
      object,
      { op: 'apply_material_preset', presetId: material.presetId },
      `Material: ${material.label}.`,
    );
  }

  return unsupported(
    "Buyruqni tushunmadim. Qo'llab-quvvatlanadigan shakllar: «20 sm kengaytir», " +
      "«rangini oq rangga o'zgartir», «10 sm chapga sur», «nomini Kitob javoni deb o'zgartir», " +
      "«90 daraja bur», «yashir».",
  );
}

function matchNumber(text: string): number | null {
  const match = new RegExp(NUMBER).exec(text);
  if (!match) {
    return null;
  }
  const value = toNumber(match[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Extracts the new name from «nomini X deb o'zgartir» / «rename to X».
 *
 * The name is taken verbatim from the original text (not the lower-cased one),
 * so capitalisation survives.
 */
export function extractRenameTarget(rawText: string): string | null {
  const patterns = [
    /nomini\s+(.+?)\s+(?:deb|de)\s+(?:o'zgartir|ozgartir|qil)/i,
    /nomini\s+(.+?)(?:\s+deb)?\s*$/i,
    /nomi\s+(.+?)\s+(?:bo'lsin|bolsin)/i,
    /rename\s+(?:to\s+)?(.+)$/i,
    /name\s+it\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(rawText.trim());
    if (!match) {
      continue;
    }
    const name = match[1].replace(/["'«»]/g, '').trim();
    if (name !== '') {
      return name;
    }
  }
  return null;
}
