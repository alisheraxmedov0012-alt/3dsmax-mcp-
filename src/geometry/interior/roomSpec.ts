/**
 * Phase 9A.2.1 — RoomSpec parsing and defaults.
 *
 * Validation follows the repository convention: a typed parse result, no
 * silent clamping of an explicitly supplied bad value. Missing fields take
 * their defaults; present fields must be finite and in range.
 */
import { ROOM_DEFAULTS, ROOM_LIMITS, type NumericRange } from '../../scene/types';
import type { DefinitionField } from '../universal/types';
import {
  ROOM_SIDES,
  type DoorOpeningConfig,
  type RoomOpeningSpec,
  type RoomOpeningType,
  type RoomSide,
  type RoomSpec,
  type RoomSpecParseResult,
  type RoomType,
  type WindowOpeningConfig,
} from './types';

export const ROOM_TYPE_ID = /^[a-z][a-z0-9-]*$/;
export const MAX_ROOM_TYPE_LENGTH = 32;
export const DEFAULT_ROOM_TYPE: RoomType = 'generic';

export const MAX_ROOM_OPENINGS = 12;
export const ROOM_OPENING_EDGE_MARGIN_CM = 10;
export const ROOM_OPENING_MIN_GAP_CM = 10;
export const ROOM_OPENING_MIN_LINTEL_CM = 10;

export const ROOM_OPENING_LIMITS = {
  offsetCm: { min: 0, max: 100_000, step: 5 },
  widthCm: { min: 20, max: 400, step: 5 },
  heightCm: { min: 20, max: 400, step: 5 },
  sillHeightCm: { min: 0, max: 500, step: 5 },
} satisfies Record<'offsetCm' | 'widthCm' | 'heightCm' | 'sillHeightCm', NumericRange>;

/** Documented opening-component defaults; absent configs resolve to these. */
export const DEFAULT_DOOR_FRAME_WIDTH_CM = 6;
export const DEFAULT_DOOR_LEAF_THICKNESS_CM = 4;
export const DEFAULT_DOOR_LEAF_INSET_CM = 0.5;
export const DEFAULT_DOOR_HINGE_SIDE = 'left' as const;
export const DEFAULT_DOOR_SWING_DIRECTION = 'inward' as const;
export const DEFAULT_DOOR_SWING_ANGLE_DEG = 0;
export const DEFAULT_DOOR_HANDLE_HEIGHT_CM = 100;

export const DEFAULT_WINDOW_FRAME_WIDTH_CM = 6;
export const DEFAULT_WINDOW_GLASS_THICKNESS_CM = 1;
export const DEFAULT_WINDOW_SILL_THICKNESS_CM = 4;
export const DEFAULT_WINDOW_MULLION_COUNT = 0;
export const DEFAULT_WINDOW_TRANSOM_COUNT = 0;

export const DEFAULT_DOOR_HINGE_COUNT = 3;

export const DOOR_COMPONENT_LIMITS = {
  frameWidthCm: { min: 2, max: 20, step: 0.5 },
  leafThicknessCm: { min: 1, max: 10, step: 0.5 },
  leafInsetCm: { min: 0, max: 10, step: 0.5 },
  swingAngleDeg: { min: 0, max: 120, step: 1 },
  handleHeightCm: { min: 5, max: 300, step: 1 },
} satisfies Record<
  'frameWidthCm' | 'leafThicknessCm' | 'leafInsetCm' | 'swingAngleDeg' | 'handleHeightCm',
  NumericRange
>;

export const WINDOW_COMPONENT_LIMITS = {
  frameWidthCm: { min: 2, max: 20, step: 0.5 },
  glassThicknessCm: { min: 0.5, max: 10, step: 0.5 },
  sillThicknessCm: { min: 1, max: 20, step: 0.5 },
  mullionCount: { min: 0, max: 4, step: 1 },
  transomCount: { min: 0, max: 4, step: 1 },
} satisfies Record<
  'frameWidthCm' | 'glassThicknessCm' | 'sillThicknessCm' | 'mullionCount' | 'transomCount',
  NumericRange
>;

/** Resolve a door config, deriving the frame depth from the wall thickness. */
export function resolveDoorConfig(
  opening: RoomOpeningSpec,
  wallThicknessCm: number,
): DoorOpeningConfig {
  const config = opening.door;
  return {
    frameWidthCm: config?.frameWidthCm ?? DEFAULT_DOOR_FRAME_WIDTH_CM,
    frameDepthCm: config?.frameDepthCm ?? wallThicknessCm,
    leafThicknessCm: config?.leafThicknessCm ?? DEFAULT_DOOR_LEAF_THICKNESS_CM,
    leafInsetCm: config?.leafInsetCm ?? DEFAULT_DOOR_LEAF_INSET_CM,
    hingeSide: config?.hingeSide ?? DEFAULT_DOOR_HINGE_SIDE,
    swingDirection: config?.swingDirection ?? DEFAULT_DOOR_SWING_DIRECTION,
    swingAngleDeg: config?.swingAngleDeg ?? DEFAULT_DOOR_SWING_ANGLE_DEG,
    handleHeightCm: config?.handleHeightCm ?? DEFAULT_DOOR_HANDLE_HEIGHT_CM,
  };
}

/** Resolve a window config, deriving the frame depth from the wall thickness. */
export function resolveWindowConfig(
  opening: RoomOpeningSpec,
  wallThicknessCm: number,
): WindowOpeningConfig {
  const config = opening.window;
  return {
    frameWidthCm: config?.frameWidthCm ?? DEFAULT_WINDOW_FRAME_WIDTH_CM,
    frameDepthCm: config?.frameDepthCm ?? wallThicknessCm,
    glassThicknessCm: config?.glassThicknessCm ?? DEFAULT_WINDOW_GLASS_THICKNESS_CM,
    sillThicknessCm: config?.sillThicknessCm ?? DEFAULT_WINDOW_SILL_THICKNESS_CM,
    mullionCount: config?.mullionCount ?? DEFAULT_WINDOW_MULLION_COUNT,
    transomCount: config?.transomCount ?? DEFAULT_WINDOW_TRANSOM_COUNT,
  };
}

/** Legacy `buildRoom` uses 4 cm for every structural slab. */
export const DEFAULT_WALL_THICKNESS_CM = 4;
export const DEFAULT_FLOOR_THICKNESS_CM = 4;
export const DEFAULT_CEILING_THICKNESS_CM = 4;

/**
 * Thickness ranges are intentionally independent from the room dimension
 * ranges: a slab is a structural thickness, not a room extent. The cross-field
 * rules below keep a thick wall/slab from consuming the whole interior.
 */
export const ROOM_THICKNESS_LIMITS = {
  wallThicknessCm: { min: 1, max: 100, step: 0.5 },
  floorThicknessCm: { min: 1, max: 100, step: 0.5 },
  ceilingThicknessCm: { min: 1, max: 100, step: 0.5 },
} satisfies Record<'wallThicknessCm' | 'floorThicknessCm' | 'ceilingThicknessCm', NumericRange>;

/** Canonical defaults. The legacy room defaults are reused for the extents. */
export const DEFAULT_ROOM_SPEC: Readonly<RoomSpec> = Object.freeze({
  widthCm: ROOM_DEFAULTS.widthCm,
  lengthCm: ROOM_DEFAULTS.lengthCm,
  heightCm: ROOM_DEFAULTS.heightCm,
  wallThicknessCm: DEFAULT_WALL_THICKNESS_CM,
  floorThicknessCm: DEFAULT_FLOOR_THICKNESS_CM,
  ceilingThicknessCm: DEFAULT_CEILING_THICKNESS_CM,
  showCeiling: false,
  roomType: DEFAULT_ROOM_TYPE,
  openings: Object.freeze([]),
});

const ROOM_SPEC_KEYS = new Set<string>([
  'widthCm',
  'lengthCm',
  'heightCm',
  'wallThicknessCm',
  'floorThicknessCm',
  'ceilingThicknessCm',
  'showCeiling',
  'roomType',
  'openings',
]);

export const ROOM_SPEC_FIELDS: readonly DefinitionField[] = [
  { key: 'widthCm', label: 'Xona kengligi (sm)', kind: 'number', range: ROOM_LIMITS.widthCm },
  { key: 'lengthCm', label: 'Xona uzunligi (sm)', kind: 'number', range: ROOM_LIMITS.lengthCm },
  { key: 'heightCm', label: 'Xona balandligi (sm)', kind: 'number', range: ROOM_LIMITS.heightCm },
  {
    key: 'wallThicknessCm',
    label: 'Devor qalinligi (sm)',
    kind: 'number',
    range: ROOM_THICKNESS_LIMITS.wallThicknessCm,
  },
  {
    key: 'floorThicknessCm',
    label: 'Pol qalinligi (sm)',
    kind: 'number',
    range: ROOM_THICKNESS_LIMITS.floorThicknessCm,
  },
  {
    key: 'ceilingThicknessCm',
    label: 'Shift qalinligi (sm)',
    kind: 'number',
    range: ROOM_THICKNESS_LIMITS.ceilingThicknessCm,
  },
  { key: 'showCeiling', label: 'Shiftni ko‘rsatish', kind: 'boolean' },
  {
    key: 'roomType',
    label: 'Xona turi',
    kind: 'string',
    hint: 'Kichik lotin harflari, raqamlar va chiziqchadan iborat slug.',
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNumber(
  record: Record<string, unknown>,
  key: string,
  range: NumericRange,
  fallback: number,
  errors: string[],
): number {
  const raw = record[key];
  if (raw === undefined) {
    return fallback;
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    errors.push(`${key}: chekli son bo'lishi kerak.`);
    return fallback;
  }
  if (raw < range.min || raw > range.max) {
    errors.push(`${key}: ${range.min}–${range.max} oralig'ida bo'lishi kerak.`);
    return fallback;
  }
  return raw;
}

const OPENING_KEYS = new Set<string>([
  'id',
  'type',
  'wallId',
  'offsetCm',
  'widthCm',
  'heightCm',
  'sillHeightCm',
  'door',
  'window',
]);

const MAX_ROOM_OPENING_ID_LENGTH = 64;

/** Wall run length used by openings and geometry. North/south own the corners. */
export function roomWallRunLength(
  widthCm: number,
  lengthCm: number,
  wallThicknessCm: number,
  side: RoomSide,
): number {
  return side === 'north' || side === 'south'
    ? widthCm + 2 * wallThicknessCm
    : lengthCm;
}

function readOpeningNumber(
  record: Record<string, unknown>,
  key: string,
  range: NumericRange,
  prefix: string,
  errors: string[],
): number | undefined {
  const raw = record[key];
  if (raw === undefined) {
    errors.push(`${prefix}.${key}: majburiy maydon.`);
    return undefined;
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    errors.push(`${prefix}.${key}: chekli son bo'lishi kerak.`);
    return undefined;
  }
  if (raw < range.min || raw > range.max) {
    errors.push(`${prefix}.${key}: ${range.min}–${range.max} oralig'ida bo'lishi kerak.`);
    return undefined;
  }
  return raw;
}

/**
 * Parse and cross-validate optional openings.
 *
 * Offsets are measured from the wall's start point and are validated against
 * the actual wall run (north/south include the corner thickness; east/west do
 * not). A shared edge margin, lintel and inter-opening gap keep the wall
 * structurally continuous.
 */
const DOOR_CONFIG_KEYS = new Set<string>([
  'frameWidthCm',
  'frameDepthCm',
  'leafThicknessCm',
  'leafInsetCm',
  'hingeSide',
  'swingDirection',
  'swingAngleDeg',
  'handleHeightCm',
]);

const WINDOW_CONFIG_KEYS = new Set<string>([
  'frameWidthCm',
  'frameDepthCm',
  'glassThicknessCm',
  'sillThicknessCm',
  'mullionCount',
  'transomCount',
]);

function readConfigNumber(
  record: Record<string, unknown>,
  key: string,
  range: NumericRange,
  fallback: number,
  prefix: string,
  errors: string[],
  integer = false,
): number {
  const raw = record[key];
  if (raw === undefined) {
    return fallback;
  }
  if (
    typeof raw !== 'number' ||
    !Number.isFinite(raw) ||
    (integer && !Number.isInteger(raw))
  ) {
    errors.push(`${prefix}.${key}: ${integer ? 'butun son' : 'chekli son'} bo'lishi kerak.`);
    return fallback;
  }
  if (raw < range.min || raw > range.max) {
    errors.push(`${prefix}.${key}: ${range.min}–${range.max} oralig'ida bo'lishi kerak.`);
    return fallback;
  }
  return raw;
}

function parseDoorConfig(
  raw: unknown,
  wallThicknessCm: number,
  widthCm: number,
  heightCm: number,
  sillHeightCm: number,
  prefix: string,
  errors: string[],
): DoorOpeningConfig | undefined {
  if (raw === undefined) {
    raw = {};
  }
  if (!isRecord(raw)) {
    errors.push(`${prefix}.door: obyekt bo'lishi kerak.`);
    return undefined;
  }
  for (const key of Object.keys(raw)) {
    if (!DOOR_CONFIG_KEYS.has(key)) {
      errors.push(`${prefix}.door.${key}: noma'lum maydon.`);
    }
  }

  const frameWidthCm = readConfigNumber(
    raw,
    'frameWidthCm',
    DOOR_COMPONENT_LIMITS.frameWidthCm,
    DEFAULT_DOOR_FRAME_WIDTH_CM,
    `${prefix}.door`,
    errors,
  );
  const frameDepthCm = readConfigNumber(
    raw,
    'frameDepthCm',
    { min: 1, max: wallThicknessCm, step: 0.5 },
    wallThicknessCm,
    `${prefix}.door`,
    errors,
  );
  const leafThicknessCm = readConfigNumber(
    raw,
    'leafThicknessCm',
    DOOR_COMPONENT_LIMITS.leafThicknessCm,
    DEFAULT_DOOR_LEAF_THICKNESS_CM,
    `${prefix}.door`,
    errors,
  );
  const leafInsetCm = readConfigNumber(
    raw,
    'leafInsetCm',
    DOOR_COMPONENT_LIMITS.leafInsetCm,
    DEFAULT_DOOR_LEAF_INSET_CM,
    `${prefix}.door`,
    errors,
  );
  const swingAngleDeg = readConfigNumber(
    raw,
    'swingAngleDeg',
    DOOR_COMPONENT_LIMITS.swingAngleDeg,
    DEFAULT_DOOR_SWING_ANGLE_DEG,
    `${prefix}.door`,
    errors,
  );
  const handleHeightCm = readConfigNumber(
    raw,
    'handleHeightCm',
    DOOR_COMPONENT_LIMITS.handleHeightCm,
    DEFAULT_DOOR_HANDLE_HEIGHT_CM,
    `${prefix}.door`,
    errors,
  );

  const rawHingeSide = raw.hingeSide;
  const hingeSide: 'left' | 'right' =
    rawHingeSide === 'left' || rawHingeSide === 'right'
      ? rawHingeSide
      : DEFAULT_DOOR_HINGE_SIDE;
  if (rawHingeSide !== undefined && hingeSide !== rawHingeSide) {
    errors.push(`${prefix}.door.hingeSide: left yoki right bo'lishi kerak.`);
  }
  const rawSwingDirection = raw.swingDirection;
  const swingDirection: 'inward' | 'outward' =
    rawSwingDirection === 'inward' || rawSwingDirection === 'outward'
      ? rawSwingDirection
      : DEFAULT_DOOR_SWING_DIRECTION;
  if (rawSwingDirection !== undefined && swingDirection !== rawSwingDirection) {
    errors.push(`${prefix}.door.swingDirection: inward yoki outward bo'lishi kerak.`);
  }

  if (frameWidthCm * 2 >= widthCm || frameWidthCm * 2 >= heightCm) {
    errors.push(`${prefix}.door.frameWidthCm: opening o'lchamlariga sig'maydi.`);
  }
  if (leafThicknessCm > frameDepthCm) {
    errors.push(`${prefix}.door.leafThicknessCm: frameDepthCm dan katta bo'lmasligi kerak.`);
  }
  const leafWidth = widthCm - 2 * frameWidthCm - 2 * leafInsetCm;
  const leafHeight = heightCm - frameWidthCm - 2 * leafInsetCm;
  if (leafWidth <= 1 || leafHeight <= 1) {
    errors.push(`${prefix}.door: leaf uchun bo'sh o'lcham qolmadi.`);
  }
  const leafBottom = sillHeightCm + leafInsetCm;
  const leafTop = leafBottom + leafHeight;
  if (handleHeightCm <= leafBottom || handleHeightCm >= leafTop) {
    errors.push(`${prefix}.door.handleHeightCm: leaf balandligi ichida bo'lishi kerak.`);
  }

  return {
    frameWidthCm,
    frameDepthCm,
    leafThicknessCm,
    leafInsetCm,
    hingeSide,
    swingDirection,
    swingAngleDeg,
    handleHeightCm,
  };
}

function parseWindowConfig(
  raw: unknown,
  wallThicknessCm: number,
  widthCm: number,
  heightCm: number,
  prefix: string,
  errors: string[],
): WindowOpeningConfig | undefined {
  if (raw === undefined) {
    raw = {};
  }
  if (!isRecord(raw)) {
    errors.push(`${prefix}.window: obyekt bo'lishi kerak.`);
    return undefined;
  }
  for (const key of Object.keys(raw)) {
    if (!WINDOW_CONFIG_KEYS.has(key)) {
      errors.push(`${prefix}.window.${key}: noma'lum maydon.`);
    }
  }

  const frameWidthCm = readConfigNumber(
    raw,
    'frameWidthCm',
    WINDOW_COMPONENT_LIMITS.frameWidthCm,
    DEFAULT_WINDOW_FRAME_WIDTH_CM,
    `${prefix}.window`,
    errors,
  );
  const frameDepthCm = readConfigNumber(
    raw,
    'frameDepthCm',
    { min: 1, max: wallThicknessCm, step: 0.5 },
    wallThicknessCm,
    `${prefix}.window`,
    errors,
  );
  const glassThicknessCm = readConfigNumber(
    raw,
    'glassThicknessCm',
    WINDOW_COMPONENT_LIMITS.glassThicknessCm,
    DEFAULT_WINDOW_GLASS_THICKNESS_CM,
    `${prefix}.window`,
    errors,
  );
  const sillThicknessCm = readConfigNumber(
    raw,
    'sillThicknessCm',
    WINDOW_COMPONENT_LIMITS.sillThicknessCm,
    DEFAULT_WINDOW_SILL_THICKNESS_CM,
    `${prefix}.window`,
    errors,
  );
  const mullionCount = readConfigNumber(
    raw,
    'mullionCount',
    WINDOW_COMPONENT_LIMITS.mullionCount,
    DEFAULT_WINDOW_MULLION_COUNT,
    `${prefix}.window`,
    errors,
    true,
  );
  const transomCount = readConfigNumber(
    raw,
    'transomCount',
    WINDOW_COMPONENT_LIMITS.transomCount,
    DEFAULT_WINDOW_TRANSOM_COUNT,
    `${prefix}.window`,
    errors,
    true,
  );

  if (frameWidthCm * 2 >= widthCm || frameWidthCm * 2 >= heightCm) {
    errors.push(`${prefix}.window.frameWidthCm: opening o'lchamlariga sig'maydi.`);
  }
  if (glassThicknessCm > frameDepthCm) {
    errors.push(`${prefix}.window.glassThicknessCm: frameDepthCm dan katta bo'lmasligi kerak.`);
  }
  const clearWidth = widthCm - 2 * frameWidthCm;
  const clearHeight = heightCm - sillThicknessCm - 2 * frameWidthCm;
  if (clearWidth <= 1 || clearHeight <= 1) {
    errors.push(`${prefix}.window: glass uchun bo'sh o'lcham qolmadi.`);
  }
  const barWidth = Math.max(2, frameWidthCm / 2);
  if (mullionCount > 0 && (clearWidth - mullionCount * barWidth) / (mullionCount + 1) <= 1) {
    errors.push(`${prefix}.window.mullionCount: glass panel juda tor.`);
  }
  if (transomCount > 0 && (clearHeight - transomCount * barWidth) / (transomCount + 1) <= 1) {
    errors.push(`${prefix}.window.transomCount: glass panel juda past.`);
  }

  return {
    frameWidthCm,
    frameDepthCm,
    glassThicknessCm,
    sillThicknessCm,
    mullionCount,
    transomCount,
  };
}

function parseRoomOpenings(
  raw: unknown,
  widthCm: number,
  lengthCm: number,
  heightCm: number,
  wallThicknessCm: number,
  errors: string[],
): readonly RoomOpeningSpec[] | undefined {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    errors.push('openings: ro‘yxat bo‘lishi kerak.');
    return undefined;
  }
  if (raw.length > MAX_ROOM_OPENINGS) {
    errors.push(`openings: ko‘pi bilan ${MAX_ROOM_OPENINGS} ta bo‘lishi mumkin.`);
    return undefined;
  }

  const openings: RoomOpeningSpec[] = [];
  const seenIds = new Set<string>();
  for (const [index, entry] of raw.entries()) {
    const prefix = `openings[${index}]`;
    if (!isRecord(entry)) {
      errors.push(`${prefix}: obyekt bo‘lishi kerak.`);
      continue;
    }
    for (const key of Object.keys(entry)) {
      if (!OPENING_KEYS.has(key)) {
        errors.push(`${prefix}.${key}: noma'lum maydon.`);
      }
    }

    const rawId = entry.id;
    let id = '';
    if (typeof rawId !== 'string' || rawId.trim() === '') {
      errors.push(`${prefix}.id: bo‘sh bo‘lmagan matn bo‘lishi kerak.`);
    } else {
      id = rawId.trim();
      if (id.length > MAX_ROOM_OPENING_ID_LENGTH) {
        errors.push(`${prefix}.id: juda uzun.`);
      }
      if (seenIds.has(id)) {
        errors.push(`${prefix}.id: takroriy "${id}".`);
      } else {
        seenIds.add(id);
      }
    }

    const rawType = entry.type;
    let type: RoomOpeningType | undefined;
    if (rawType !== 'door' && rawType !== 'window') {
      errors.push(`${prefix}.type: door yoki window bo‘lishi kerak.`);
    } else {
      type = rawType;
    }

    const rawWall = entry.wallId;
    let wallId: RoomSide | undefined;
    if (typeof rawWall !== 'string' || !(ROOM_SIDES as readonly string[]).includes(rawWall)) {
      errors.push(`${prefix}.wallId: noma’lum devor.`);
    } else {
      wallId = rawWall as RoomSide;
    }

    const offsetCm = readOpeningNumber(
      entry,
      'offsetCm',
      ROOM_OPENING_LIMITS.offsetCm,
      prefix,
      errors,
    );
    const widthCmLine = readOpeningNumber(
      entry,
      'widthCm',
      ROOM_OPENING_LIMITS.widthCm,
      prefix,
      errors,
    );
    const heightCmLine = readOpeningNumber(
      entry,
      'heightCm',
      ROOM_OPENING_LIMITS.heightCm,
      prefix,
      errors,
    );
    const sillHeightCm = readOpeningNumber(
      entry,
      'sillHeightCm',
      ROOM_OPENING_LIMITS.sillHeightCm,
      prefix,
      errors,
    );

    if (type === 'door' && sillHeightCm !== undefined && sillHeightCm !== 0) {
      errors.push(`${prefix}.sillHeightCm: door uchun 0 bo‘lishi kerak.`);
    }

    let doorConfig: DoorOpeningConfig | undefined;
    let windowConfig: WindowOpeningConfig | undefined;
    if (
      type === 'door' &&
      widthCmLine !== undefined &&
      heightCmLine !== undefined &&
      sillHeightCm !== undefined
    ) {
      if (entry.window !== undefined) {
        errors.push(`${prefix}.window: door opening uchun ishlatilmaydi.`);
      }
      doorConfig = parseDoorConfig(
        entry.door === undefined ? {} : entry.door,
        wallThicknessCm,
        widthCmLine,
        heightCmLine,
        sillHeightCm,
        prefix,
        errors,
      );
      if (entry.door === undefined) {
        doorConfig = undefined;
      }
    } else if (
      type === 'window' &&
      widthCmLine !== undefined &&
      heightCmLine !== undefined &&
      sillHeightCm !== undefined
    ) {
      if (entry.door !== undefined) {
        errors.push(`${prefix}.door: window opening uchun ishlatilmaydi.`);
      }
      windowConfig = parseWindowConfig(
        entry.window === undefined ? {} : entry.window,
        wallThicknessCm,
        widthCmLine,
        heightCmLine,
        prefix,
        errors,
      );
      if (entry.window === undefined) {
        windowConfig = undefined;
      }
    }

    if (
      id === '' ||
      type === undefined ||
      wallId === undefined ||
      offsetCm === undefined ||
      widthCmLine === undefined ||
      heightCmLine === undefined ||
      sillHeightCm === undefined
    ) {
      continue;
    }

    openings.push({
      id,
      type,
      wallId,
      offsetCm,
      widthCm: widthCmLine,
      heightCm: heightCmLine,
      sillHeightCm,
      ...(doorConfig ? { door: doorConfig } : {}),
      ...(windowConfig ? { window: windowConfig } : {}),
    });
  }

  if (errors.length > 0) {
    return openings;
  }

  for (const opening of openings) {
    const wallLength = roomWallRunLength(
      widthCm,
      lengthCm,
      wallThicknessCm,
      opening.wallId,
    );
    if (
      opening.offsetCm < ROOM_OPENING_EDGE_MARGIN_CM ||
      opening.offsetCm + opening.widthCm >
        wallLength - ROOM_OPENING_EDGE_MARGIN_CM
    ) {
      errors.push(
        `openings.${opening.id}: devor chetidan ${ROOM_OPENING_EDGE_MARGIN_CM} sm chegara buzilgan.`,
      );
    }
    if (
      opening.sillHeightCm + opening.heightCm >
      heightCm - ROOM_OPENING_MIN_LINTEL_CM
    ) {
      errors.push(
        `openings.${opening.id}: yuqorida kamida ${ROOM_OPENING_MIN_LINTEL_CM} sm lintel qolishi kerak.`,
      );
    }
  }

  if (errors.length > 0) {
    return openings;
  }

  for (const side of ROOM_SIDES) {
    const wallOpenings = openings
      .filter((opening) => opening.wallId === side)
      .slice()
      .sort((left, right) => left.offsetCm - right.offsetCm);
    for (let index = 1; index < wallOpenings.length; index += 1) {
      const previous = wallOpenings[index - 1];
      const current = wallOpenings[index];
      if (
        previous.offsetCm + previous.widthCm + ROOM_OPENING_MIN_GAP_CM >
        current.offsetCm
      ) {
        errors.push(
          `openings.${current.id}: oldingi opening bilan kamida ${ROOM_OPENING_MIN_GAP_CM} sm oraliq kerak.`,
        );
      }
    }
  }

  return openings;
}

/**
 * Parse untrusted input into a complete, canonical RoomSpec.
 *
 * Unknown keys are rejected rather than ignored, matching the universal
 * definition parsers. The returned object always has the same key order, so
 * two equivalent inputs serialize identically.
 */
export function parseRoomSpec(input: unknown): RoomSpecParseResult {
  if (!isRecord(input)) {
    return { ok: false, errors: ['RoomSpec: obyekt bo‘lishi kerak.'] };
  }

  const errors: string[] = [];
  for (const key of Object.keys(input)) {
    if (!ROOM_SPEC_KEYS.has(key)) {
      errors.push(`RoomSpec.${key}: noma'lum maydon.`);
    }
  }

  const widthCm = readNumber(
    input,
    'widthCm',
    ROOM_LIMITS.widthCm,
    DEFAULT_ROOM_SPEC.widthCm,
    errors,
  );
  const lengthCm = readNumber(
    input,
    'lengthCm',
    ROOM_LIMITS.lengthCm,
    DEFAULT_ROOM_SPEC.lengthCm,
    errors,
  );
  const heightCm = readNumber(
    input,
    'heightCm',
    ROOM_LIMITS.heightCm,
    DEFAULT_ROOM_SPEC.heightCm,
    errors,
  );
  const wallThicknessCm = readNumber(
    input,
    'wallThicknessCm',
    ROOM_THICKNESS_LIMITS.wallThicknessCm,
    DEFAULT_ROOM_SPEC.wallThicknessCm,
    errors,
  );
  const floorThicknessCm = readNumber(
    input,
    'floorThicknessCm',
    ROOM_THICKNESS_LIMITS.floorThicknessCm,
    DEFAULT_ROOM_SPEC.floorThicknessCm,
    errors,
  );
  const ceilingThicknessCm = readNumber(
    input,
    'ceilingThicknessCm',
    ROOM_THICKNESS_LIMITS.ceilingThicknessCm,
    DEFAULT_ROOM_SPEC.ceilingThicknessCm,
    errors,
  );

  const rawShowCeiling = input.showCeiling;
  let showCeiling = DEFAULT_ROOM_SPEC.showCeiling;
  if (rawShowCeiling !== undefined) {
    if (typeof rawShowCeiling !== 'boolean') {
      errors.push('showCeiling: boolean bo‘lishi kerak.');
    } else {
      showCeiling = rawShowCeiling;
    }
  }

  const rawRoomType = input.roomType;
  let roomType = DEFAULT_ROOM_SPEC.roomType;
  if (rawRoomType !== undefined) {
    if (typeof rawRoomType !== 'string') {
      errors.push('roomType: matn bo‘lishi kerak.');
    } else {
      const trimmed = rawRoomType.trim();
      if (
        trimmed.length === 0 ||
        trimmed.length > MAX_ROOM_TYPE_LENGTH ||
        !ROOM_TYPE_ID.test(trimmed)
      ) {
        errors.push(
          `roomType: "${rawRoomType}" qo'llab-quvvatlanmaydi (kichik lotin slug kutilgan).`,
        );
      } else {
        roomType = trimmed;
      }
    }
  }

  // Cross-field checks only run after every value is individually valid, so a
  // single bad field does not produce misleading secondary errors.
  if (errors.length === 0) {
    if (wallThicknessCm * 2 >= Math.min(widthCm, lengthCm)) {
      errors.push('wallThicknessCm: devorlar xona ichki bo‘shlig‘ini yopib qo‘ymasligi kerak.');
    }
    if (floorThicknessCm >= heightCm) {
      errors.push('floorThicknessCm: xona balandligidan kichik bo‘lishi kerak.');
    }
    if (ceilingThicknessCm >= heightCm) {
      errors.push('ceilingThicknessCm: xona balandligidan kichik bo‘lishi kerak.');
    }
  }

  let openings: readonly RoomOpeningSpec[] | undefined;
  if (errors.length === 0) {
    openings = parseRoomOpenings(
      input.openings,
      widthCm,
      lengthCm,
      heightCm,
      wallThicknessCm,
      errors,
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    spec: {
      widthCm,
      lengthCm,
      heightCm,
      wallThicknessCm,
      floorThicknessCm,
      ceilingThicknessCm,
      showCeiling,
      roomType,
      ...(openings !== undefined ? { openings } : {}),
    },
  };
}
