/**
 * Stage 2.2d — `chair.ergonomic` definition.
 *
 * Ergonomic office chair: seat base + cushion, angled backrest with optional
 * lumbar support and headrest, optional height-adjustable armrests, central gas
 * lift, five-star base and optional casters. Static V1: no mechanism moves.
 */
import {
  createComponent,
  createConnection,
  type ComponentConnection,
} from '../../components';
import { registerFurnitureDefinition } from '../registry';
import type {
  DefinitionField,
  FurnitureDefinition,
  FurniturePlanDraft,
  FurnitureSlot,
  ManufacturingMetadata,
  PlanPart,
  SpecParseResult,
} from '../types';
import type { GeometryRecipe, Vec3Tuple } from '../../kernel';

export const ERGONOMIC_CHAIR_DEFINITION_ID = 'chair.ergonomic';

const CUSHION_RADIUS_CM = 2;
const BACKREST_FRAME_MARGIN_CM = 6;
const BACKREST_FRAME_THICKNESS_CM = 3;
const HEADREST_SUPPORT_WIDTH_CM = 8;
const HEADREST_SUPPORT_HEIGHT_CM = 12;
const HEADREST_SUPPORT_DEPTH_CM = 4;
const ARMREST_PAD_THICKNESS_CM = 3;
const ARMREST_SUPPORT_WIDTH_CM = 5;
const ARMREST_SUPPORT_DEPTH_CM = 6;
const GAS_LIFT_RADIUS_CM = 3.5;
const BASE_HUB_RADIUS_CM = 5;
const BASE_HUB_HEIGHT_CM = 6;
const BASE_ARM_WIDTH_CM = 4;
const BASE_ARM_THICKNESS_CM = 3;
const CASTER_HOUSING_WIDTH_CM = 3;
const CASTER_HOUSING_HEIGHT_CM = 4;
const CASTER_HOUSING_DEPTH_CM = 3;
const CASTER_WHEEL_WIDTH_CM = 2.5;
const SCREW_DIAMETERS = {
  shaftDiameter: 0.4,
  length: 3,
  headDiameter: 0.8,
  headHeight: 0.4,
} as const;

const NO_MANUFACTURING_NOTE =
  'manufacturing: boxCm mavjud emas (geometry to‘rtburchak box emas).';

export interface ErgonomicChairSpec {
  readonly seatWidth: number;
  readonly seatDepth: number;
  readonly seatHeight: number;
  readonly seatThickness: number;
  readonly seatCushionThickness: number;

  readonly backrestWidth: number;
  readonly backrestHeight: number;
  readonly backrestThickness: number;
  readonly backrestAngle: number;

  readonly lumbarSupportEnabled: boolean;
  readonly lumbarHeight: number;
  readonly lumbarThickness: number;

  readonly headrestEnabled: boolean;
  readonly headrestWidth: number;
  readonly headrestHeight: number;
  readonly headrestThickness: number;

  readonly armrestsEnabled: boolean;
  readonly armrestHeight: number;
  readonly armrestWidth: number;
  readonly armrestLength: number;
  readonly armrestAdjustable: boolean;

  readonly gasLiftHeight: number;
  readonly baseRadius: number;
  readonly baseLegCount: number;
  readonly casterEnabled: boolean;
  readonly casterDiameter: number;
}

export const DEFAULT_ERGONOMIC_CHAIR_SPEC: Readonly<ErgonomicChairSpec> = {
  seatWidth: 50,
  seatDepth: 48,
  seatHeight: 48,
  seatThickness: 8,
  seatCushionThickness: 5,

  backrestWidth: 46,
  backrestHeight: 58,
  backrestThickness: 5,
  backrestAngle: 10,

  lumbarSupportEnabled: true,
  lumbarHeight: 12,
  lumbarThickness: 5,

  headrestEnabled: true,
  headrestWidth: 28,
  headrestHeight: 14,
  headrestThickness: 6,

  armrestsEnabled: true,
  armrestHeight: 24,
  armrestWidth: 8,
  armrestLength: 28,
  armrestAdjustable: true,

  gasLiftHeight: 42,
  baseRadius: 34,
  baseLegCount: 5,
  casterEnabled: true,
  casterDiameter: 6,
};

export interface ErgonomicChairSpecValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

type NumericKey = {
  [K in keyof ErgonomicChairSpec]: ErgonomicChairSpec[K] extends number ? K : never;
}[keyof ErgonomicChairSpec];

type BooleanKey = {
  [K in keyof ErgonomicChairSpec]: ErgonomicChairSpec[K] extends boolean ? K : never;
}[keyof ErgonomicChairSpec];

type MutableErgonomicChairSpec = {
  -readonly [K in keyof ErgonomicChairSpec]: ErgonomicChairSpec[K];
};

const NUMERIC_KEYS: readonly NumericKey[] = [
  'seatWidth',
  'seatDepth',
  'seatHeight',
  'seatThickness',
  'seatCushionThickness',
  'backrestWidth',
  'backrestHeight',
  'backrestThickness',
  'backrestAngle',
  'lumbarHeight',
  'lumbarThickness',
  'headrestWidth',
  'headrestHeight',
  'headrestThickness',
  'armrestHeight',
  'armrestWidth',
  'armrestLength',
  'gasLiftHeight',
  'baseRadius',
  'baseLegCount',
  'casterDiameter',
];

const BOOLEAN_KEYS: readonly BooleanKey[] = [
  'lumbarSupportEnabled',
  'headrestEnabled',
  'armrestsEnabled',
  'armrestAdjustable',
  'casterEnabled',
];

const KNOWN_KEYS = new Set<string>([...NUMERIC_KEYS, ...BOOLEAN_KEYS]);

const FIELDS: readonly DefinitionField[] = [
  { key: 'seatWidth', label: 'O‘rindiq kengligi (sm)', kind: 'number' },
  { key: 'seatDepth', label: 'O‘rindiq chuqurligi (sm)', kind: 'number' },
  { key: 'seatHeight', label: 'O‘rindiq balandligi (sm)', kind: 'number' },
  { key: 'seatThickness', label: 'O‘rindiq qalinligi (sm)', kind: 'number' },
  { key: 'seatCushionThickness', label: 'Yostiq qalinligi (sm)', kind: 'number' },
  { key: 'backrestWidth', label: 'Suyanchiq kengligi (sm)', kind: 'number' },
  { key: 'backrestHeight', label: 'Suyanchiq balandligi (sm)', kind: 'number' },
  { key: 'backrestThickness', label: 'Suyanchiq qalinligi (sm)', kind: 'number' },
  { key: 'backrestAngle', label: 'Suyanchiq burchagi (°)', kind: 'number' },
  { key: 'lumbarSupportEnabled', label: 'Bel tayanchi', kind: 'boolean' },
  { key: 'lumbarHeight', label: 'Bel tayanchi balandligi (sm)', kind: 'number' },
  { key: 'lumbarThickness', label: 'Bel tayanchi qalinligi (sm)', kind: 'number' },
  { key: 'headrestEnabled', label: 'Bosh tayanchi', kind: 'boolean' },
  { key: 'headrestWidth', label: 'Bosh tayanchi kengligi (sm)', kind: 'number' },
  { key: 'headrestHeight', label: 'Bosh tayanchi balandligi (sm)', kind: 'number' },
  { key: 'headrestThickness', label: 'Bosh tayanchi qalinligi (sm)', kind: 'number' },
  { key: 'armrestsEnabled', label: 'Qo‘l tayanchlari', kind: 'boolean' },
  { key: 'armrestHeight', label: 'Qo‘l tayanchi balandligi (sm)', kind: 'number' },
  { key: 'armrestWidth', label: 'Qo‘l tayanchi kengligi (sm)', kind: 'number' },
  { key: 'armrestLength', label: 'Qo‘l tayanchi uzunligi (sm)', kind: 'number' },
  { key: 'armrestAdjustable', label: 'Balandlikni sozlash', kind: 'boolean' },
  { key: 'gasLiftHeight', label: 'Gazlift balandligi (sm)', kind: 'number' },
  { key: 'baseRadius', label: 'Beshtarmoq radiusi (sm)', kind: 'number' },
  { key: 'baseLegCount', label: 'Beshtarmoq oyoqlari soni', kind: 'number', integer: true },
  { key: 'casterEnabled', label: 'G‘ildiraklar', kind: 'boolean' },
  { key: 'casterDiameter', label: 'G‘ildirak diametri (sm)', kind: 'number' },
];

const SLOTS: readonly FurnitureSlot[] = [
  {
    id: 'upholstery',
    label: 'Qoplama',
    color: '#3b4652',
    materialId: 'fabric-linen',
    groupName: 'ergonomic-chair-upholstery-group',
  },
  {
    id: 'structure',
    label: 'Konstruksiya',
    color: '#22262b',
    materialId: 'metal-steel',
    groupName: 'ergonomic-chair-structure-group',
  },
  {
    id: 'hardware',
    label: 'Furnitura',
    color: '#9aa3ad',
    materialId: 'metal-steel',
    groupName: 'ergonomic-chair-hardware-group',
  },
];

function checkPositive(
  errors: string[],
  spec: ErgonomicChairSpec,
  key: NumericKey,
  positive = true,
): number | null {
  const value = spec[key];
  if (!Number.isFinite(value)) {
    errors.push(`${key}: chekli son bo'lishi kerak.`);
    return null;
  }
  if (positive && value <= 0) {
    errors.push(`${key}: noldan katta bo'lishi kerak.`);
  }
  if (!positive && value < 0) {
    errors.push(`${key}: manfiy bo'lmasligi kerak.`);
  }
  return value;
}

export function validateErgonomicChairSpec(
  spec: ErgonomicChairSpec,
): ErgonomicChairSpecValidation {
  const errors: string[] = [];
  const seatWidth = checkPositive(errors, spec, 'seatWidth');
  const seatDepth = checkPositive(errors, spec, 'seatDepth');
  const seatHeight = checkPositive(errors, spec, 'seatHeight');
  const seatThickness = checkPositive(errors, spec, 'seatThickness');
  const seatCushionThickness = checkPositive(errors, spec, 'seatCushionThickness');
  const backrestWidth = checkPositive(errors, spec, 'backrestWidth');
  const backrestHeight = checkPositive(errors, spec, 'backrestHeight');
  const backrestThickness = checkPositive(errors, spec, 'backrestThickness');
  const backrestAngle = checkPositive(errors, spec, 'backrestAngle', false);
  const lumbarHeight = checkPositive(errors, spec, 'lumbarHeight', false);
  const lumbarThickness = checkPositive(errors, spec, 'lumbarThickness', false);
  const headrestWidth = checkPositive(errors, spec, 'headrestWidth', false);
  const headrestHeight = checkPositive(errors, spec, 'headrestHeight', false);
  const headrestThickness = checkPositive(errors, spec, 'headrestThickness', false);
  const armrestHeight = checkPositive(errors, spec, 'armrestHeight', false);
  const armrestWidth = checkPositive(errors, spec, 'armrestWidth', false);
  const armrestLength = checkPositive(errors, spec, 'armrestLength', false);
  const gasLiftHeight = checkPositive(errors, spec, 'gasLiftHeight');
  const baseRadius = checkPositive(errors, spec, 'baseRadius');
  const baseLegCount = checkPositive(errors, spec, 'baseLegCount');
  const casterDiameter = checkPositive(errors, spec, 'casterDiameter', false);

  for (const key of BOOLEAN_KEYS) {
    if (typeof spec[key] !== 'boolean') {
      errors.push(`${key}: boolean bo‘lishi kerak.`);
    }
  }

  if (seatThickness !== null && seatCushionThickness !== null) {
    if (seatCushionThickness >= seatThickness) {
      errors.push('seatCushionThickness: seatThickness dan kichik bo‘lishi kerak.');
    } else if (seatCushionThickness <= CUSHION_RADIUS_CM * 2) {
      errors.push('seatCushionThickness: cushion radiusi uchun juda yupqa.');
    }
  }
  if (
    seatHeight !== null &&
    seatThickness !== null &&
    seatCushionThickness !== null &&
    gasLiftHeight !== null
  ) {
    if (gasLiftHeight > seatHeight - seatCushionThickness) {
      errors.push('gasLiftHeight: o‘rindiq asosidan yuqoriga chiqadi.');
    }
  }
  if (backrestWidth !== null && seatWidth !== null && backrestWidth > seatWidth) {
    errors.push('backrestWidth: seatWidth dan oshmasligi kerak.');
  }
  if (backrestHeight !== null && backrestThickness !== null) {
    if (backrestThickness >= backrestHeight / 2) {
      errors.push('backrestThickness: backrestHeight ning yarmidan kichik bo‘lishi kerak.');
    }
  }
  if (backrestAngle !== null && backrestAngle > 30) {
    errors.push('backrestAngle: 0–30° oralig‘ida bo‘lishi kerak.');
  }
  if (spec.lumbarSupportEnabled) {
    if (lumbarHeight !== null && lumbarHeight <= 0) {
      errors.push('lumbarHeight: bel tayanchi yoqilganda noldan katta bo‘lishi kerak.');
    }
    if (lumbarThickness !== null && lumbarThickness <= 0) {
      errors.push('lumbarThickness: bel tayanchi yoqilganda noldan katta bo‘lishi kerak.');
    }
    if (lumbarHeight !== null && backrestHeight !== null && lumbarHeight > backrestHeight) {
      errors.push('lumbarHeight: backrestHeight dan oshmasligi kerak.');
    }
  }
  if (spec.headrestEnabled) {
    if (headrestWidth !== null && headrestWidth <= 0) {
      errors.push('headrestWidth: bosh tayanchi yoqilganda noldan katta bo‘lishi kerak.');
    }
    if (headrestHeight !== null && headrestHeight <= 0) {
      errors.push('headrestHeight: bosh tayanchi yoqilganda noldan katta bo‘lishi kerak.');
    }
    if (headrestThickness !== null && headrestThickness <= 0) {
      errors.push('headrestThickness: bosh tayanchi yoqilganda noldan katta bo‘lishi kerak.');
    }
    if (headrestWidth !== null && backrestWidth !== null && headrestWidth > backrestWidth) {
      errors.push('headrestWidth: backrestWidth dan oshmasligi kerak.');
    }
    if (headrestThickness !== null && headrestHeight !== null) {
      if (headrestThickness >= headrestHeight / 2) {
        errors.push('headrestThickness: headrestHeight ning yarmidan kichik bo‘lishi kerak.');
      }
    }
  }
  if (spec.armrestsEnabled) {
    if (armrestHeight !== null && armrestHeight <= ARMREST_PAD_THICKNESS_CM + 5) {
      errors.push('armrestHeight: tayanch va padding uchun juda past.');
    }
    if (armrestWidth !== null && seatWidth !== null && armrestWidth > seatWidth / 2) {
      errors.push('armrestWidth: o‘rindiq kengligiga nisbatan juda katta.');
    }
    if (armrestLength !== null && seatDepth !== null && armrestLength > seatDepth) {
      errors.push('armrestLength: o‘rindiq chuqurligidan oshmasligi kerak.');
    }
    if (armrestWidth !== null && armrestWidth < ARMREST_SUPPORT_WIDTH_CM) {
      errors.push('armrestWidth: konstruktiv tayanchdan ingichka bo‘lmasligi kerak.');
    }
  }
  if (baseLegCount !== null && (!Number.isInteger(baseLegCount) || baseLegCount !== 5)) {
    errors.push('baseLegCount: V1 uchun aynan 5 bo‘lishi kerak.');
  }
  if (baseRadius !== null) {
    if (baseRadius <= BASE_HUB_RADIUS_CM) {
      errors.push('baseRadius: hub radiusidan katta bo‘lishi kerak.');
    }
    if (spec.casterEnabled && casterDiameter !== null && casterDiameter / 2 >= baseRadius) {
      errors.push('casterDiameter: beshtarmoq radiusiga sig‘maydi.');
    }
  }
  if (spec.casterEnabled && casterDiameter !== null && casterDiameter <= 0) {
    errors.push('casterDiameter: g‘ildiraklar yoqilganda noldan katta bo‘lishi kerak.');
  }

  return { valid: errors.length === 0, errors };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseErgonomicChairSpec(
  input: unknown,
): SpecParseResult<ErgonomicChairSpec> {
  if (!isRecord(input)) {
    return { ok: false, errors: ['ErgonomicChairSpec: obyekt bo‘lishi kerak.'] };
  }

  const errors: string[] = [];
  for (const key of Object.keys(input)) {
    if (!KNOWN_KEYS.has(key)) {
      errors.push(`ErgonomicChairSpec.${key}: noma'lum maydon.`);
    }
  }

  const spec: MutableErgonomicChairSpec = { ...DEFAULT_ERGONOMIC_CHAIR_SPEC };
  for (const key of NUMERIC_KEYS) {
    const raw = input[key];
    if (raw === undefined) {
      continue;
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      errors.push(`${key}: chekli son bo'lishi kerak.`);
      continue;
    }
    spec[key] = raw;
  }
  for (const key of BOOLEAN_KEYS) {
    const raw = input[key];
    if (raw === undefined) {
      continue;
    }
    if (typeof raw !== 'boolean') {
      errors.push(`${key}: boolean bo'lishi kerak.`);
      continue;
    }
    spec[key] = raw;
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const validation = validateErgonomicChairSpec(spec);
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }
  return { ok: true, spec };
}

export function createErgonomicChairSpec(
  overrides: Partial<ErgonomicChairSpec> = {},
): ErgonomicChairSpec {
  return { ...DEFAULT_ERGONOMIC_CHAIR_SPEC, ...overrides };
}

function manufacturingForGeometry(geometry: GeometryRecipe): ManufacturingMetadata | undefined {
  if (geometry.kind !== 'box') {
    return undefined;
  }
  return {
    boxCm: [geometry.width, geometry.height, geometry.depth],
    cutFromSheet: false,
  };
}

interface PartInput {
  readonly id: string;
  readonly type: PlanPart['type'];
  readonly role: PlanPart['role'];
  readonly materialSlot: string;
  readonly geometry: GeometryRecipe;
  readonly dimensions: PlanPart['dimensions'];
  readonly position: Vec3Tuple;
  readonly rotation?: Vec3Tuple;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly notes?: readonly string[];
}

function makePart(input: PartInput): PlanPart {
  const manufacturing = manufacturingForGeometry(input.geometry);
  const notes = [...(input.notes ?? []), ...(manufacturing ? [] : [NO_MANUFACTURING_NOTE])];
  return {
    id: input.id,
    type: input.type,
    role: input.role,
    dimensions: input.dimensions,
    geometry: input.geometry,
    position: input.position,
    rotation: input.rotation ?? [0, 0, 0],
    materialSlot: input.materialSlot,
    metadata: { ...input.metadata },
    ...(manufacturing ? { manufacturing } : {}),
    ...(notes.length > 0 ? { notes } : {}),
  };
}

function screwPart(id: string, position: Vec3Tuple): PlanPart {
  const screw = createComponent('screw', id, SCREW_DIAMETERS, {
    position,
    materialSlot: 'hardware',
  });
  return makePart({
    id: screw.id,
    type: screw.type,
    role: screw.role,
    materialSlot: 'hardware',
    geometry: screw.geometry,
    dimensions: screw.dimensions,
    position: screw.position,
    rotation: screw.rotation,
  });
}

function rotateX(localY: number, localZ: number, angleDeg: number): { y: number; z: number } {
  const theta = (-angleDeg * Math.PI) / 180;
  return {
    y: localY * Math.cos(theta) - localZ * Math.sin(theta),
    z: localY * Math.sin(theta) + localZ * Math.cos(theta),
  };
}

function solveErgonomicChairPlan(spec: ErgonomicChairSpec): FurniturePlanDraft {
  const parts: PlanPart[] = [];
  const connections: ComponentConnection[] = [];
  const seatBaseThickness = spec.seatThickness - spec.seatCushionThickness;
  const seatBaseBottom = spec.seatHeight - spec.seatThickness;
  const seatTop = spec.seatHeight;

  parts.push(
    makePart({
      id: 'ergonomic-chair-seat-base',
      type: 'panel',
      role: 'panel',
      materialSlot: 'structure',
      geometry: {
        kind: 'box',
        width: spec.seatWidth,
        height: seatBaseThickness,
        depth: spec.seatDepth,
      },
      dimensions: { width: spec.seatWidth, height: seatBaseThickness, depth: spec.seatDepth },
      position: [0, seatBaseBottom + seatBaseThickness / 2, 0],
      metadata: { seatBase: true },
    }),
    makePart({
      id: 'ergonomic-chair-seat-cushion',
      type: 'panel',
      role: 'panel',
      materialSlot: 'upholstery',
      geometry: {
        kind: 'roundedBox',
        width: spec.seatWidth,
        height: spec.seatCushionThickness,
        depth: spec.seatDepth,
        radius: CUSHION_RADIUS_CM,
        segments: 6,
      },
      dimensions: {
        width: spec.seatWidth,
        height: spec.seatCushionThickness,
        depth: spec.seatDepth,
      },
      position: [0, seatBaseBottom + seatBaseThickness + spec.seatCushionThickness / 2, 0],
      metadata: { cushion: true, upholstered: true },
      notes: ['Ergonomik yumshoq o‘rindiq yostig‘i.'],
    }),
  );
  connections.push(
    createConnection({
      id: 'ergonomic-chair-seat-cushion-base',
      type: 'fixed',
      componentIds: ['ergonomic-chair-seat-cushion', 'ergonomic-chair-seat-base'],
      position: [0, seatBaseBottom + seatBaseThickness, 0],
      direction: [0, 1, 0],
    }),
  );

  const backrestPivotZ = -spec.seatDepth / 2 + spec.backrestThickness / 2;
  const backrestCushion = rotateX(spec.backrestHeight / 2, 0, spec.backrestAngle);
  parts.push(
    makePart({
      id: 'ergonomic-chair-backrest-cushion',
      type: 'panel',
      role: 'panel',
      materialSlot: 'upholstery',
      geometry: {
        kind: 'roundedBox',
        width: spec.backrestWidth,
        height: spec.backrestHeight,
        depth: spec.backrestThickness,
        radius: CUSHION_RADIUS_CM,
        segments: 6,
      },
      dimensions: {
        width: spec.backrestWidth,
        height: spec.backrestHeight,
        depth: spec.backrestThickness,
      },
      position: [0, seatTop + backrestCushion.y, backrestPivotZ + backrestCushion.z],
      rotation: [-spec.backrestAngle, 0, 0],
      metadata: { cushion: true, upholstered: true },
      notes: ['Ergonomik suyanchiq yostig‘i.'],
    }),
  );

  const frameWidth = spec.backrestWidth - BACKREST_FRAME_MARGIN_CM;
  const frameHeight = spec.backrestHeight - BACKREST_FRAME_MARGIN_CM;
  const frameLocalZ = -(spec.backrestThickness / 2 + BACKREST_FRAME_THICKNESS_CM / 2);
  const frameCentre = rotateX(frameHeight / 2, frameLocalZ, spec.backrestAngle);
  parts.push(
    makePart({
      id: 'ergonomic-chair-backrest-frame',
      type: 'panel',
      role: 'panel',
      materialSlot: 'structure',
      geometry: {
        kind: 'box',
        width: frameWidth,
        height: frameHeight,
        depth: BACKREST_FRAME_THICKNESS_CM,
      },
      dimensions: {
        width: frameWidth,
        height: frameHeight,
        depth: BACKREST_FRAME_THICKNESS_CM,
      },
      position: [0, seatTop + frameCentre.y, backrestPivotZ + frameCentre.z],
      rotation: [-spec.backrestAngle, 0, 0],
      metadata: { backrestFrame: true },
    }),
  );
  connections.push(
    createConnection({
      id: 'ergonomic-chair-backrest-cushion-frame',
      type: 'fixed',
      componentIds: ['ergonomic-chair-backrest-cushion', 'ergonomic-chair-backrest-frame'],
      position: [0, seatTop + backrestCushion.y, backrestPivotZ + backrestCushion.z],
      direction: [0, 1, 0],
    }),
    createConnection({
      id: 'ergonomic-chair-backrest-frame-seat',
      type: 'fixed',
      componentIds: ['ergonomic-chair-backrest-frame', 'ergonomic-chair-seat-base'],
      position: [0, seatTop, backrestPivotZ],
      direction: [0, 1, 0],
    }),
  );

  const backrestScrewX = Math.max(spec.backrestWidth / 2 - 8, 2);
  for (const [index, sign] of [1, -1].entries()) {
    const screw = screwPart(`ergonomic-chair-backrest-screw-${index + 1}`, [
      sign * backrestScrewX,
      seatTop - 1,
      backrestPivotZ,
    ]);
    parts.push(screw);
    connections.push(
      createConnection({
        id: `ergonomic-chair-backrest-screw-${index + 1}-joint`,
        type: 'screw',
        componentIds: ['ergonomic-chair-backrest-frame', 'ergonomic-chair-seat-base'],
        position: screw.position,
        direction: [0, 1, 0],
        hardwareId: screw.id,
      }),
    );
  }

  if (spec.lumbarSupportEnabled) {
    const lumbarWidth = Math.max(spec.backrestWidth - 14, 10);
    const lumbarLocalZ = spec.backrestThickness / 2 + spec.lumbarThickness / 2;
    const lumbarCentre = rotateX(spec.lumbarHeight / 2, lumbarLocalZ, spec.backrestAngle);
    parts.push(
      makePart({
        id: 'ergonomic-chair-lumbar-support',
        type: 'panel',
        role: 'panel',
        materialSlot: 'upholstery',
        geometry: {
          kind: 'roundedBox',
          width: lumbarWidth,
          height: spec.lumbarHeight,
          depth: spec.lumbarThickness,
          radius: 1.5,
          segments: 4,
        },
        dimensions: {
          width: lumbarWidth,
          height: spec.lumbarHeight,
          depth: spec.lumbarThickness,
        },
        position: [0, seatTop + lumbarCentre.y, backrestPivotZ + lumbarCentre.z],
        rotation: [-spec.backrestAngle, 0, 0],
        metadata: { cushion: true, lumbarSupport: true },
        notes: ['Bel tayanchi yostig‘i.'],
      }),
    );
    connections.push(
      createConnection({
        id: 'ergonomic-chair-lumbar-backrest',
        type: 'fixed',
        componentIds: ['ergonomic-chair-lumbar-support', 'ergonomic-chair-backrest-cushion'],
        position: [0, seatTop + lumbarCentre.y, backrestPivotZ + lumbarCentre.z],
        direction: [0, 1, 0],
      }),
    );
  }

  if (spec.headrestEnabled) {
    const supportLocalZ = -3;
    const supportCentre = rotateX(spec.backrestHeight, supportLocalZ, spec.backrestAngle);
    parts.push(
      makePart({
        id: 'ergonomic-chair-headrest-support',
        type: 'support',
        role: 'support',
        materialSlot: 'structure',
        geometry: {
          kind: 'box',
          width: HEADREST_SUPPORT_WIDTH_CM,
          height: HEADREST_SUPPORT_HEIGHT_CM,
          depth: HEADREST_SUPPORT_DEPTH_CM,
        },
        dimensions: {
          width: HEADREST_SUPPORT_WIDTH_CM,
          height: HEADREST_SUPPORT_HEIGHT_CM,
          depth: HEADREST_SUPPORT_DEPTH_CM,
        },
        position: [0, seatTop + supportCentre.y, backrestPivotZ + supportCentre.z],
        rotation: [-spec.backrestAngle, 0, 0],
        metadata: { headrestSupport: true },
      }),
    );

    const headrestCentre = rotateX(
      spec.backrestHeight + spec.headrestHeight / 2,
      0,
      spec.backrestAngle,
    );
    parts.push(
      makePart({
        id: 'ergonomic-chair-headrest-cushion',
        type: 'panel',
        role: 'panel',
        materialSlot: 'upholstery',
        geometry: {
          kind: 'roundedBox',
          width: spec.headrestWidth,
          height: spec.headrestHeight,
          depth: spec.headrestThickness,
          radius: CUSHION_RADIUS_CM,
          segments: 4,
        },
        dimensions: {
          width: spec.headrestWidth,
          height: spec.headrestHeight,
          depth: spec.headrestThickness,
        },
        position: [0, seatTop + headrestCentre.y, backrestPivotZ + headrestCentre.z],
        rotation: [-spec.backrestAngle, 0, 0],
        metadata: { cushion: true, headrest: true },
        notes: ['Bosh tayanchi yostig‘i.'],
      }),
    );
    connections.push(
      createConnection({
        id: 'ergonomic-chair-headrest-support-frame',
        type: 'fixed',
        componentIds: ['ergonomic-chair-headrest-support', 'ergonomic-chair-backrest-frame'],
        position: [0, seatTop + supportCentre.y, backrestPivotZ + supportCentre.z],
        direction: [0, 1, 0],
      }),
      createConnection({
        id: 'ergonomic-chair-headrest-cushion-support',
        type: 'fixed',
        componentIds: ['ergonomic-chair-headrest-cushion', 'ergonomic-chair-headrest-support'],
        position: [0, seatTop + headrestCentre.y, backrestPivotZ + headrestCentre.z],
        direction: [0, 1, 0],
      }),
    );
  }

  if (spec.armrestsEnabled) {
    const armX = spec.seatWidth / 2 + spec.armrestWidth / 2 - 1;
    const supportHeight = spec.armrestHeight - ARMREST_PAD_THICKNESS_CM;
    const armrestMetadata = {
      armrest: true,
      adjustable: spec.armrestAdjustable,
      adjustment: spec.armrestAdjustable ? 'static-height-slider' : 'fixed',
    };
    for (const [index, sign] of [1, -1].entries()) {
      const side = index === 0 ? 'left' : 'right';
      const supportId = `ergonomic-chair-armrest-support-${side}`;
      const padId = `ergonomic-chair-armrest-pad-${side}`;
      parts.push(
        makePart({
          id: supportId,
          type: 'support',
          role: 'support',
          materialSlot: 'structure',
          geometry: {
            kind: 'box',
            width: ARMREST_SUPPORT_WIDTH_CM,
            height: supportHeight,
            depth: ARMREST_SUPPORT_DEPTH_CM,
          },
          dimensions: {
            width: ARMREST_SUPPORT_WIDTH_CM,
            height: supportHeight,
            depth: ARMREST_SUPPORT_DEPTH_CM,
          },
          position: [sign * armX, seatTop + supportHeight / 2, -5],
          metadata: { ...armrestMetadata, armrestSupport: true },
          notes: [
            spec.armrestAdjustable
              ? 'Balandligi sozlanadigan tayanch statik holatda ifodalangan.'
              : 'Ruxsat etilgan balandlikdagi qo‘l tayanchi.',
          ],
        }),
        makePart({
          id: padId,
          type: 'support',
          role: 'support',
          materialSlot: 'upholstery',
          geometry: {
            kind: 'roundedBox',
            width: spec.armrestWidth,
            height: ARMREST_PAD_THICKNESS_CM,
            depth: spec.armrestLength,
            radius: 1.5,
            segments: 4,
          },
          dimensions: {
            width: spec.armrestWidth,
            height: ARMREST_PAD_THICKNESS_CM,
            depth: spec.armrestLength,
          },
          position: [sign * armX, seatTop + spec.armrestHeight - ARMREST_PAD_THICKNESS_CM / 2, 0],
          metadata: { ...armrestMetadata, armrestPadding: true },
        }),
      );
      connections.push(
        createConnection({
          id: `${supportId}-seat`,
          type: 'fixed',
          componentIds: [supportId, 'ergonomic-chair-seat-base'],
          position: [sign * armX, seatTop, -5],
          direction: [0, 1, 0],
        }),
        createConnection({
          id: `${padId}-support`,
          type: 'fixed',
          componentIds: [padId, supportId],
          position: [sign * armX, seatTop + supportHeight, -5],
          direction: [0, 1, 0],
        }),
      );

      const screw = screwPart(`ergonomic-chair-armrest-screw-${index + 1}`, [
        sign * armX,
        seatTop - 1,
        -5,
      ]);
      parts.push(screw);
      connections.push(
        createConnection({
          id: `ergonomic-chair-armrest-screw-${index + 1}-joint`,
          type: 'screw',
          componentIds: [supportId, 'ergonomic-chair-seat-base'],
          position: screw.position,
          direction: [0, 1, 0],
          hardwareId: screw.id,
        }),
      );
    }
  }

  parts.push(
    makePart({
      id: 'ergonomic-chair-gas-lift',
      type: 'support',
      role: 'support',
      materialSlot: 'hardware',
      geometry: {
        kind: 'cylinder',
        radiusTop: GAS_LIFT_RADIUS_CM,
        radiusBottom: GAS_LIFT_RADIUS_CM,
        height: spec.gasLiftHeight,
        radialSegments: 24,
      },
      dimensions: {
        width: GAS_LIFT_RADIUS_CM * 2,
        height: spec.gasLiftHeight,
        depth: GAS_LIFT_RADIUS_CM * 2,
      },
      position: [0, spec.gasLiftHeight / 2, 0],
      metadata: { gasLift: 'representation' },
      notes: ['Gazlift statik ustun sifatida modellangan; sozlash mexanizmi yo‘q.'],
    }),
  );
  connections.push(
    createConnection({
      id: 'ergonomic-chair-gas-lift-seat',
      type: 'fixed',
      componentIds: ['ergonomic-chair-gas-lift', 'ergonomic-chair-seat-base'],
      position: [0, seatBaseBottom, 0],
      direction: [0, 1, 0],
    }),
  );

  const baseArmY = spec.casterEnabled ? spec.casterDiameter + 4.5 : 1.5;
  const hubY = spec.casterEnabled ? baseArmY : Math.max(BASE_HUB_HEIGHT_CM / 2, baseArmY);
  parts.push(
    makePart({
      id: 'ergonomic-chair-base-hub',
      type: 'support',
      role: 'support',
      materialSlot: 'structure',
      geometry: {
        kind: 'cylinder',
        radiusTop: BASE_HUB_RADIUS_CM,
        radiusBottom: BASE_HUB_RADIUS_CM,
        height: BASE_HUB_HEIGHT_CM,
        radialSegments: 24,
      },
      dimensions: {
        width: BASE_HUB_RADIUS_CM * 2,
        height: BASE_HUB_HEIGHT_CM,
        depth: BASE_HUB_RADIUS_CM * 2,
      },
      position: [0, hubY, 0],
      metadata: { baseHub: true },
    }),
  );
  connections.push(
    createConnection({
      id: 'ergonomic-chair-base-hub-gas-lift',
      type: 'fixed',
      componentIds: ['ergonomic-chair-base-hub', 'ergonomic-chair-gas-lift'],
      position: [0, baseArmY, 0],
      direction: [0, 1, 0],
    }),
  );

  const casterHousingY = spec.casterDiameter + 1.5;
  const casterWheelY = spec.casterDiameter / 2;
  for (let index = 0; index < spec.baseLegCount; index += 1) {
    const angleDeg = index * 72;
    const angleRad = (angleDeg * Math.PI) / 180;
    const sin = Math.sin(angleRad);
    const cos = Math.cos(angleRad);
    const armId = `ergonomic-chair-base-arm-${index + 1}`;
    parts.push(
      makePart({
        id: armId,
        type: 'leg',
        role: 'leg',
        materialSlot: 'structure',
        geometry: {
          kind: 'box',
          width: BASE_ARM_WIDTH_CM,
          height: BASE_ARM_THICKNESS_CM,
          depth: spec.baseRadius,
        },
        dimensions: {
          width: BASE_ARM_WIDTH_CM,
          height: BASE_ARM_THICKNESS_CM,
          depth: spec.baseRadius,
        },
        position: [sin * (spec.baseRadius / 2), baseArmY, cos * (spec.baseRadius / 2)],
        rotation: [0, angleDeg, 0],
        metadata: { baseArm: true, starAngleDeg: angleDeg },
      }),
    );
    connections.push(
      createConnection({
        id: `ergonomic-chair-base-arm-${index + 1}-hub`,
        type: 'fixed',
        componentIds: [armId, 'ergonomic-chair-base-hub'],
        position: [0, baseArmY, 0],
        direction: [0, 1, 0],
      }),
    );

    if (spec.casterEnabled) {
      const housingId = `ergonomic-chair-caster-housing-${index + 1}`;
      const wheelId = `ergonomic-chair-caster-wheel-${index + 1}`;
      parts.push(
        makePart({
          id: housingId,
          type: 'support',
          role: 'support',
          materialSlot: 'hardware',
          geometry: {
            kind: 'box',
            width: CASTER_HOUSING_WIDTH_CM,
            height: CASTER_HOUSING_HEIGHT_CM,
            depth: CASTER_HOUSING_DEPTH_CM,
          },
          dimensions: {
            width: CASTER_HOUSING_WIDTH_CM,
            height: CASTER_HOUSING_HEIGHT_CM,
            depth: CASTER_HOUSING_DEPTH_CM,
          },
          position: [sin * spec.baseRadius, casterHousingY, cos * spec.baseRadius],
          metadata: { caster: true, casterHousing: true },
          notes: ['Statik g‘ildirak korpusi; aylanish mexanizmi yo‘q.'],
        }),
        makePart({
          id: wheelId,
          type: 'foot',
          role: 'foot',
          materialSlot: 'hardware',
          geometry: {
            kind: 'cylinder',
            radiusTop: spec.casterDiameter / 2,
            radiusBottom: spec.casterDiameter / 2,
            height: CASTER_WHEEL_WIDTH_CM,
            radialSegments: 20,
          },
          dimensions: {
            width: spec.casterDiameter,
            height: CASTER_WHEEL_WIDTH_CM,
            depth: spec.casterDiameter,
          },
          position: [sin * spec.baseRadius, casterWheelY, cos * spec.baseRadius],
          rotation: [0, 0, 90],
          metadata: { caster: true, casterWheel: true },
          notes: ['Statik g‘ildirak; dumalash mexanizmi yo‘q.'],
        }),
      );
      connections.push(
        createConnection({
          id: `ergonomic-chair-caster-housing-${index + 1}-arm`,
          type: 'fixed',
          componentIds: [housingId, armId],
          position: [sin * spec.baseRadius, baseArmY, cos * spec.baseRadius],
          direction: [0, 1, 0],
        }),
        createConnection({
          id: `ergonomic-chair-caster-wheel-${index + 1}-housing`,
          type: 'fixed',
          componentIds: [wheelId, housingId],
          position: [sin * spec.baseRadius, casterWheelY, cos * spec.baseRadius],
          direction: [0, 1, 0],
        }),
      );
    }
  }

  return { parts, connections, warnings: [] };
}

export const ergonomicChairDefinition: FurnitureDefinition<ErgonomicChairSpec> = {
  id: ERGONOMIC_CHAIR_DEFINITION_ID,
  version: 1,
  family: 'chair',
  label: 'Ergonomik kreslo',
  fields: FIELDS,
  defaults: DEFAULT_ERGONOMIC_CHAIR_SPEC,
  slots: SLOTS,
  limits: {
    maxParts: 96,
    maxPartVertices: 50_000,
    maxPartTriangles: 100_000,
    maxTotalVertices: 400_000,
  },
  groupName: 'ergonomic-chair-assembly',
  parseSpec: parseErgonomicChairSpec,
  solve: solveErgonomicChairPlan,
};

registerFurnitureDefinition(ergonomicChairDefinition);
