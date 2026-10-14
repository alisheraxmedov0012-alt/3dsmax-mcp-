/**
 * W2 parametric furniture vocabulary.
 *
 * `FurnitureType` matches the W1 `DesignSpec.furniture` vocabulary exactly
 * (table, chair, armchair, sofa, bed, wardrobe, shelf, dresser) so the W1 <-> W2
 * contract lines up. `FurnitureParams` is a single, flat, validated record: every
 * type shares the base dimensions and colour, and adds the extra channels only
 * its builder reads. Missing channels resolve to per-type defaults.
 *
 * Free of Three.js so it can be serialized/validated/tested without WebGL.
 */

export type FurnitureType =
  | 'table'
  | 'chair'
  | 'armchair'
  | 'sofa'
  | 'bed'
  | 'wardrobe'
  | 'shelf'
  | 'dresser';

export const FURNITURE_TYPES: readonly FurnitureType[] = [
  'table',
  'chair',
  'armchair',
  'sofa',
  'bed',
  'wardrobe',
  'shelf',
  'dresser',
];

export const FURNITURE_TYPE_LABELS: Record<FurnitureType, string> = {
  table: 'Stol',
  chair: 'Stul',
  armchair: 'Kreslo',
  sofa: 'Divan',
  bed: 'Krovat',
  wardrobe: 'Shkaf',
  shelf: 'Javon',
  dresser: 'Tumba',
};

/** Default object name per type (used when a name is missing). */
export const FURNITURE_DEFAULT_NAMES: Record<FurnitureType, string> = FURNITURE_TYPE_LABELS;

export function isFurnitureType(value: unknown): value is FurnitureType {
  return typeof value === 'string' && (FURNITURE_TYPES as readonly string[]).includes(value);
}

export interface NumericRange {
  min: number;
  max: number;
  step: number;
}

/** All numeric channels any furniture type may use (units: cm). */
export interface FurnitureParams {
  widthCm: number;
  heightCm: number;
  depthCm: number;
  color: string;
  // table
  topThicknessCm?: number;
  legCount?: number;
  // chair / armchair / sofa
  seatHeightCm?: number;
  backHeightCm?: number;
  armHeightCm?: number;
  // wardrobe / shelf
  wallThicknessCm?: number;
  shelfCount?: number;
  // wardrobe / dresser
  doorCount?: number;
  // dresser
  drawerCount?: number;
  legHeightCm?: number;
  // bed
  mattressHeightCm?: number;
  headboardHeightCm?: number;
}

export type FurnitureNumericKey = Exclude<keyof FurnitureParams, 'color'>;

export interface FurnitureFieldSpec {
  key: FurnitureNumericKey;
  label: string;
  range: NumericRange;
  integer?: boolean;
}

const R = (min: number, max: number, step = 1): NumericRange => ({ min, max, step });

/** Per-type editable fields (also the validation/parse schema). */
export const FURNITURE_FIELDS: Record<FurnitureType, readonly FurnitureFieldSpec[]> = {
  table: [
    { key: 'widthCm', label: 'Kenglik (sm)', range: R(40, 240) },
    { key: 'heightCm', label: 'Balandlik (sm)', range: R(40, 120) },
    { key: 'depthCm', label: 'Chuqurlik (sm)', range: R(40, 120) },
    { key: 'topThicknessCm', label: 'Usti qalinligi (sm)', range: R(2, 10, 0.5) },
    { key: 'legCount', label: 'Oyoqlar soni', range: R(4, 6, 2), integer: true },
  ],
  chair: [
    { key: 'widthCm', label: "O'rindiq kengligi (sm)", range: R(30, 70) },
    { key: 'depthCm', label: "O'rindiq chuqurligi (sm)", range: R(30, 70) },
    { key: 'heightCm', label: 'Umumiy balandlik (sm)', range: R(40, 120) },
    { key: 'seatHeightCm', label: "O'rindiq balandligi (sm)", range: R(25, 60) },
    { key: 'backHeightCm', label: 'Suyanchiq balandligi (sm)', range: R(30, 90) },
  ],
  armchair: [
    { key: 'widthCm', label: 'Kenglik (sm)', range: R(50, 120) },
    { key: 'depthCm', label: 'Chuqurlik (sm)', range: R(50, 110) },
    { key: 'heightCm', label: 'Umumiy balandlik (sm)', range: R(60, 130) },
    { key: 'seatHeightCm', label: "O'rindiq balandligi (sm)", range: R(25, 60) },
    { key: 'backHeightCm', label: 'Suyanchiq balandligi (sm)', range: R(40, 100) },
    { key: 'armHeightCm', label: "Qo'l tayanchi balandligi (sm)", range: R(30, 80) },
  ],
  sofa: [
    { key: 'widthCm', label: 'Kenglik (sm)', range: R(100, 300, 5) },
    { key: 'depthCm', label: 'Chuqurlik (sm)', range: R(60, 140) },
    { key: 'heightCm', label: 'Umumiy balandlik (sm)', range: R(60, 130) },
    { key: 'seatHeightCm', label: "O'rindiq balandligi (sm)", range: R(25, 60) },
    { key: 'backHeightCm', label: 'Suyanchiq balandligi (sm)', range: R(40, 100) },
    { key: 'armHeightCm', label: "Qo'l tayanchi balandligi (sm)", range: R(30, 80) },
  ],
  bed: [
    { key: 'widthCm', label: 'Kenglik (sm)', range: R(80, 220, 5) },
    { key: 'depthCm', label: 'Uzunlik (sm)', range: R(150, 220, 5) },
    { key: 'heightCm', label: 'Karkas balandligi (sm)', range: R(20, 60) },
    { key: 'mattressHeightCm', label: 'Matras qalinligi (sm)', range: R(10, 40) },
    { key: 'headboardHeightCm', label: 'Bosh qismi balandligi (sm)', range: R(30, 150) },
  ],
  wardrobe: [
    { key: 'widthCm', label: 'Kenglik (sm)', range: R(60, 300, 5) },
    { key: 'heightCm', label: 'Balandlik (sm)', range: R(100, 260, 5) },
    { key: 'depthCm', label: 'Chuqurlik (sm)', range: R(40, 90) },
    { key: 'wallThicknessCm', label: 'Devor qalinligi (sm)', range: R(1.5, 6, 0.5) },
    { key: 'shelfCount', label: 'Tokchalar soni', range: R(0, 8), integer: true },
    { key: 'doorCount', label: 'Eshiklar soni', range: R(1, 4), integer: true },
  ],
  shelf: [
    { key: 'widthCm', label: 'Kenglik (sm)', range: R(40, 200, 5) },
    { key: 'heightCm', label: 'Balandlik (sm)', range: R(40, 240, 5) },
    { key: 'depthCm', label: 'Chuqurlik (sm)', range: R(20, 80) },
    { key: 'wallThicknessCm', label: 'Devor qalinligi (sm)', range: R(1.5, 5, 0.5) },
    { key: 'shelfCount', label: 'Tokchalar soni', range: R(1, 8), integer: true },
  ],
  dresser: [
    { key: 'widthCm', label: 'Kenglik (sm)', range: R(40, 200, 5) },
    { key: 'heightCm', label: 'Balandlik (sm)', range: R(40, 140, 5) },
    { key: 'depthCm', label: 'Chuqurlik (sm)', range: R(30, 80) },
    { key: 'drawerCount', label: 'Tortmalar soni', range: R(1, 6), integer: true },
    { key: 'doorCount', label: 'Eshiklar soni', range: R(0, 2), integer: true },
    { key: 'legHeightCm', label: 'Oyoq balandligi (sm)', range: R(0, 30) },
  ],
};

const BASE_DEFAULTS = { color: '#a9744f' } as const;

/** Per-type default parameter set (all channels present). */
export const FURNITURE_DEFAULTS: Record<FurnitureType, FurnitureParams> = {
  table: { ...BASE_DEFAULTS, widthCm: 120, heightCm: 75, depthCm: 60, topThicknessCm: 4, legCount: 4 },
  chair: { ...BASE_DEFAULTS, color: '#8b5a2b', widthCm: 45, depthCm: 45, heightCm: 90, seatHeightCm: 45, backHeightCm: 45 },
  armchair: { ...BASE_DEFAULTS, color: '#5b6b73', widthCm: 75, depthCm: 80, heightCm: 85, seatHeightCm: 42, backHeightCm: 48, armHeightCm: 58 },
  sofa: { ...BASE_DEFAULTS, color: '#3f5b73', widthCm: 200, depthCm: 90, heightCm: 85, seatHeightCm: 42, backHeightCm: 45, armHeightCm: 62 },
  bed: { ...BASE_DEFAULTS, color: '#8b5a2b', widthCm: 160, depthCm: 200, heightCm: 40, mattressHeightCm: 22, headboardHeightCm: 90 },
  wardrobe: { ...BASE_DEFAULTS, widthCm: 180, heightCm: 200, depthCm: 60, wallThicknessCm: 2, shelfCount: 4, doorCount: 2 },
  shelf: { ...BASE_DEFAULTS, color: '#8b5a2b', widthCm: 80, heightCm: 180, depthCm: 30, wallThicknessCm: 2, shelfCount: 4 },
  dresser: { ...BASE_DEFAULTS, widthCm: 120, heightCm: 80, depthCm: 45, drawerCount: 3, doorCount: 0, legHeightCm: 10 },
};

/** A fresh, complete parameter set for a type. */
export function createFurnitureParams(type: FurnitureType): FurnitureParams {
  return { ...FURNITURE_DEFAULTS[type] };
}
