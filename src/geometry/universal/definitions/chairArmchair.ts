/**
 * Stage 2.2c — `chair.armchair` definition.
 *
 * Upholstered armchair: cushioned seat on a structural base, a cushioned
 * backrest on a hidden frame, two padded armrests and four wooden legs.
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

export const ARMCHAIR_DEFINITION_ID = 'chair.armchair';

const SEAT_BASE_THICKNESS_CM = 4;
const BACKREST_FRAME_MARGIN_CM = 6;
const BACKREST_FRAME_THICKNESS_CM = 4;
const ARMREST_SUPPORT_WIDTH_CM = 6;
const CUSHION_CORNER_RADIUS_CM = 2;
const SCREW_DIAMETERS = {
  shaftDiameter: 0.4,
  length: 3,
  headDiameter: 0.8,
  headHeight: 0.4,
} as const;

const NO_MANUFACTURING_NOTE =
  'manufacturing: boxCm mavjud emas (geometry to‘rtburchak box emas).';

export interface ArmchairSpec {
  readonly seatWidth: number;
  readonly seatDepth: number;
  readonly seatHeight: number;
  readonly seatThickness: number;
  readonly seatCushionRadius: number;

  readonly backrestWidth: number;
  readonly backrestHeight: number;
  readonly backrestThickness: number;
  readonly backrestAngle: number;

  readonly armrestsEnabled: boolean;
  readonly armrestHeight: number;
  readonly armrestWidth: number;
  readonly armrestLength: number;
  readonly armrestPaddingThickness: number;

  readonly legHeight: number;
  readonly legWidth: number;
  readonly legDepth: number;
  readonly legInset: number;
}

export const DEFAULT_ARMCHAIR_SPEC: Readonly<ArmchairSpec> = {
  seatWidth: 52,
  seatDepth: 50,
  seatHeight: 44,
  seatThickness: 12,
  seatCushionRadius: 2,

  backrestWidth: 50,
  backrestHeight: 48,
  backrestThickness: 10,
  backrestAngle: 10,

  armrestsEnabled: true,
  armrestHeight: 24,
  armrestWidth: 9,
  armrestLength: 42,
  armrestPaddingThickness: 5,

  legHeight: 32,
  legWidth: 6,
  legDepth: 6,
  legInset: 5,
};

export interface ArmchairSpecValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

type NumericKey = {
  [K in keyof ArmchairSpec]: ArmchairSpec[K] extends number ? K : never;
}[keyof ArmchairSpec];

type BooleanKey = {
  [K in keyof ArmchairSpec]: ArmchairSpec[K] extends boolean ? K : never;
}[keyof ArmchairSpec];

type MutableArmchairSpec = { -readonly [K in keyof ArmchairSpec]: ArmchairSpec[K] };

const NUMERIC_KEYS: readonly NumericKey[] = [
  'seatWidth',
  'seatDepth',
  'seatHeight',
  'seatThickness',
  'seatCushionRadius',
  'backrestWidth',
  'backrestHeight',
  'backrestThickness',
  'backrestAngle',
  'armrestHeight',
  'armrestWidth',
  'armrestLength',
  'armrestPaddingThickness',
  'legHeight',
  'legWidth',
  'legDepth',
  'legInset',
];

const BOOLEAN_KEYS: readonly BooleanKey[] = ['armrestsEnabled'];

const KNOWN_KEYS = new Set<string>([...NUMERIC_KEYS, ...BOOLEAN_KEYS]);

const FIELDS: readonly DefinitionField[] = [
  { key: 'seatWidth', label: 'O‘rindiq kengligi (sm)', kind: 'number' },
  { key: 'seatDepth', label: 'O‘rindiq chuqurligi (sm)', kind: 'number' },
  { key: 'seatHeight', label: 'O‘rindiq balandligi (sm)', kind: 'number' },
  { key: 'seatThickness', label: 'O‘rindiq qalinligi (sm)', kind: 'number' },
  { key: 'seatCushionRadius', label: 'Yostiq radiusi (sm)', kind: 'number' },
  { key: 'backrestWidth', label: 'Suyanchiq kengligi (sm)', kind: 'number' },
  { key: 'backrestHeight', label: 'Suyanchiq balandligi (sm)', kind: 'number' },
  { key: 'backrestThickness', label: 'Suyanchiq qalinligi (sm)', kind: 'number' },
  { key: 'backrestAngle', label: 'Suyanchiq burchagi (°)', kind: 'number' },
  { key: 'armrestsEnabled', label: 'Qo‘l tayanchlari', kind: 'boolean' },
  { key: 'armrestHeight', label: 'Qo‘l tayanchi balandligi (sm)', kind: 'number' },
  { key: 'armrestWidth', label: 'Qo‘l tayanchi kengligi (sm)', kind: 'number' },
  { key: 'armrestLength', label: 'Qo‘l tayanchi uzunligi (sm)', kind: 'number' },
  { key: 'armrestPaddingThickness', label: 'Qo‘l tayanchi yostig‘i (sm)', kind: 'number' },
  { key: 'legHeight', label: 'Oyoq balandligi (sm)', kind: 'number' },
  { key: 'legWidth', label: 'Oyoq kengligi (sm)', kind: 'number' },
  { key: 'legDepth', label: 'Oyoq chuqurligi (sm)', kind: 'number' },
  { key: 'legInset', label: 'Oyoq chekinishi (sm)', kind: 'number' },
];

const SLOTS: readonly FurnitureSlot[] = [
  {
    id: 'upholstery',
    label: 'Qoplama',
    color: '#5b6b73',
    materialId: 'fabric-linen',
    groupName: 'armchair-upholstery-group',
  },
  {
    id: 'structure',
    label: 'Konstruksiya',
    color: '#6b4423',
    materialId: 'wood-oak',
    groupName: 'armchair-structure-group',
  },
  {
    id: 'hardware',
    label: 'Furnitura',
    color: '#9aa3ad',
    materialId: 'metal-steel',
    groupName: 'armchair-hardware-group',
  },
];

function checkPositive(
  errors: string[],
  spec: ArmchairSpec,
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

export function validateArmchairSpec(spec: ArmchairSpec): ArmchairSpecValidation {
  const errors: string[] = [];
  const seatWidth = checkPositive(errors, spec, 'seatWidth');
  const seatDepth = checkPositive(errors, spec, 'seatDepth');
  const seatHeight = checkPositive(errors, spec, 'seatHeight');
  const seatThickness = checkPositive(errors, spec, 'seatThickness');
  const seatCushionRadius = checkPositive(errors, spec, 'seatCushionRadius', false);
  const backrestWidth = checkPositive(errors, spec, 'backrestWidth');
  const backrestHeight = checkPositive(errors, spec, 'backrestHeight');
  const backrestThickness = checkPositive(errors, spec, 'backrestThickness');
  const backrestAngle = checkPositive(errors, spec, 'backrestAngle', false);
  const armrestHeight = checkPositive(errors, spec, 'armrestHeight');
  const armrestWidth = checkPositive(errors, spec, 'armrestWidth');
  const armrestLength = checkPositive(errors, spec, 'armrestLength');
  const armrestPaddingThickness = checkPositive(errors, spec, 'armrestPaddingThickness');
  const legHeight = checkPositive(errors, spec, 'legHeight');
  const legWidth = checkPositive(errors, spec, 'legWidth');
  const legDepth = checkPositive(errors, spec, 'legDepth');
  const legInset = checkPositive(errors, spec, 'legInset', false);

  if (typeof spec.armrestsEnabled !== 'boolean') {
    errors.push('armrestsEnabled: boolean bo‘lishi kerak.');
  }

  if (seatThickness !== null && seatThickness <= SEAT_BASE_THICKNESS_CM) {
    errors.push('seatThickness: konstruktiv asos qalinligidan katta bo‘lishi kerak.');
  }
  if (seatHeight !== null && legHeight !== null && seatThickness !== null) {
    if (Math.abs(seatHeight - (legHeight + seatThickness)) > 1e-9) {
      errors.push('seatHeight: legHeight + seatThickness ga teng bo‘lishi kerak.');
    }
  }
  if (seatWidth !== null && seatDepth !== null && seatThickness !== null && seatCushionRadius !== null) {
    const cushionThickness = seatThickness - SEAT_BASE_THICKNESS_CM;
    if (seatCushionRadius >= Math.min(seatWidth, seatDepth, cushionThickness) / 2) {
      errors.push('seatCushionRadius: yostiq o‘lchamining yarmidan kichik bo‘lishi kerak.');
    }
  }
  if (seatWidth !== null && backrestWidth !== null && backrestWidth > seatWidth) {
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
  if (seatWidth !== null && seatDepth !== null && legWidth !== null && legDepth !== null && legInset !== null) {
    if (seatWidth <= 2 * legInset + legWidth) {
      errors.push('seatWidth: legInset va legWidth o‘rindiq chetidan chiqmasligi kerak.');
    }
    if (seatDepth <= 2 * legInset + legDepth) {
      errors.push('seatDepth: legInset va legDepth o‘rindiq chetidan chiqmasligi kerak.');
    }
  }
  if (spec.armrestsEnabled) {
    if (armrestHeight !== null && armrestPaddingThickness !== null) {
      if (armrestHeight <= armrestPaddingThickness + 5) {
        errors.push('armrestHeight: tayanch va padding uchun juda past.');
      }
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

  return { valid: errors.length === 0, errors };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseArmchairSpec(input: unknown): SpecParseResult<ArmchairSpec> {
  if (!isRecord(input)) {
    return { ok: false, errors: ['ArmchairSpec: obyekt bo‘lishi kerak.'] };
  }

  const errors: string[] = [];
  for (const key of Object.keys(input)) {
    if (!KNOWN_KEYS.has(key)) {
      errors.push(`ArmchairSpec.${key}: noma'lum maydon.`);
    }
  }

  const spec: MutableArmchairSpec = { ...DEFAULT_ARMCHAIR_SPEC };
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

  const validation = validateArmchairSpec(spec);
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }
  return { ok: true, spec };
}

export function createArmchairSpec(overrides: Partial<ArmchairSpec> = {}): ArmchairSpec {
  return { ...DEFAULT_ARMCHAIR_SPEC, ...overrides };
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

function solveArmchairPlan(spec: ArmchairSpec): FurniturePlanDraft {
  const parts: PlanPart[] = [];
  const connections: ComponentConnection[] = [];
  const seatBaseBottom = spec.legHeight;
  const cushionThickness = spec.seatThickness - SEAT_BASE_THICKNESS_CM;
  const seatTop = seatBaseBottom + spec.seatThickness;
  const legX = spec.seatWidth / 2 - spec.legInset - spec.legWidth / 2;
  const legZ = spec.seatDepth / 2 - spec.legInset - spec.legDepth / 2;

  parts.push(
    makePart({
      id: 'armchair-seat-base',
      type: 'panel',
      role: 'panel',
      materialSlot: 'structure',
      geometry: {
        kind: 'box',
        width: spec.seatWidth,
        height: SEAT_BASE_THICKNESS_CM,
        depth: spec.seatDepth,
      },
      dimensions: {
        width: spec.seatWidth,
        height: SEAT_BASE_THICKNESS_CM,
        depth: spec.seatDepth,
      },
      position: [0, seatBaseBottom + SEAT_BASE_THICKNESS_CM / 2, 0],
      metadata: { seatBase: true },
    }),
  );

  parts.push(
    makePart({
      id: 'armchair-seat-cushion',
      type: 'panel',
      role: 'panel',
      materialSlot: 'upholstery',
      geometry: {
        kind: 'roundedBox',
        width: spec.seatWidth,
        height: cushionThickness,
        depth: spec.seatDepth,
        radius: spec.seatCushionRadius,
        segments: 6,
      },
      dimensions: {
        width: spec.seatWidth,
        height: cushionThickness,
        depth: spec.seatDepth,
      },
      position: [0, seatBaseBottom + SEAT_BASE_THICKNESS_CM + cushionThickness / 2, 0],
      metadata: { cushion: true, upholstered: true },
      notes: ['Hajmli yumshoq o‘rindiq yostig‘i.'],
    }),
  );
  connections.push(
    createConnection({
      id: 'armchair-seat-cushion-base',
      type: 'fixed',
      componentIds: ['armchair-seat-cushion', 'armchair-seat-base'],
      position: [0, seatBaseBottom + SEAT_BASE_THICKNESS_CM, 0],
      direction: [0, 1, 0],
    }),
  );

  const legPlacements = [
    { id: 'armchair-leg-front-left', x: -legX, z: legZ },
    { id: 'armchair-leg-front-right', x: legX, z: legZ },
    { id: 'armchair-leg-rear-left', x: -legX, z: -legZ },
    { id: 'armchair-leg-rear-right', x: legX, z: -legZ },
  ];
  for (const leg of legPlacements) {
    parts.push(
      makePart({
        id: leg.id,
        type: 'leg',
        role: 'leg',
        materialSlot: 'structure',
        geometry: {
          kind: 'box',
          width: spec.legWidth,
          height: spec.legHeight,
          depth: spec.legDepth,
        },
        dimensions: {
          width: spec.legWidth,
          height: spec.legHeight,
          depth: spec.legDepth,
        },
        position: [leg.x, spec.legHeight / 2, leg.z],
      }),
    );
    connections.push(
      createConnection({
        id: `${leg.id}-seat-base`,
        type: 'fixed',
        componentIds: [leg.id, 'armchair-seat-base'],
        position: [leg.x, seatBaseBottom, leg.z],
        direction: [0, 1, 0],
      }),
    );
  }

  const backrestPivotZ = -spec.seatDepth / 2 + spec.backrestThickness / 2;
  const backrestCushion = rotateX(spec.backrestHeight / 2, 0, spec.backrestAngle);
  parts.push(
    makePart({
      id: 'armchair-backrest-cushion',
      type: 'panel',
      role: 'panel',
      materialSlot: 'upholstery',
      geometry: {
        kind: 'roundedBox',
        width: spec.backrestWidth,
        height: spec.backrestHeight,
        depth: spec.backrestThickness,
        radius: CUSHION_CORNER_RADIUS_CM,
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
      notes: ['Yumshoq orqa suyanchiq yostig‘i.'],
    }),
  );

  const frameWidth = spec.backrestWidth - BACKREST_FRAME_MARGIN_CM;
  const frameHeight = spec.backrestHeight - BACKREST_FRAME_MARGIN_CM;
  const frameLocalZ = -(
    spec.backrestThickness / 2 +
    BACKREST_FRAME_THICKNESS_CM / 2
  );
  const frameCentre = rotateX(frameHeight / 2, frameLocalZ, spec.backrestAngle);
  parts.push(
    makePart({
      id: 'armchair-backrest-frame',
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
      id: 'armchair-backrest-cushion-frame',
      type: 'fixed',
      componentIds: ['armchair-backrest-cushion', 'armchair-backrest-frame'],
      position: [0, seatTop + backrestCushion.y, backrestPivotZ + backrestCushion.z],
      direction: [0, 1, 0],
    }),
    createConnection({
      id: 'armchair-backrest-frame-base',
      type: 'fixed',
      componentIds: ['armchair-backrest-frame', 'armchair-seat-base'],
      position: [0, seatTop, backrestPivotZ],
      direction: [0, 1, 0],
    }),
  );

  const backrestScrewX = Math.max(spec.backrestWidth / 2 - 8, 2);
  for (const [index, sign] of [1, -1].entries()) {
    const screw = screwPart(`armchair-backrest-screw-${index + 1}`, [
      sign * backrestScrewX,
      seatTop - 1,
      backrestPivotZ,
    ]);
    parts.push(screw);
    connections.push(
      createConnection({
        id: `armchair-backrest-screw-${index + 1}-joint`,
        type: 'screw',
        componentIds: ['armchair-backrest-frame', 'armchair-seat-base'],
        position: screw.position,
        direction: [0, 1, 0],
        hardwareId: screw.id,
      }),
    );
  }

  if (spec.armrestsEnabled) {
    const armX = spec.seatWidth / 2 + ARMREST_SUPPORT_WIDTH_CM / 2 - 1;
    const supportHeight = spec.armrestHeight - spec.armrestPaddingThickness;
    for (const [index, sign] of [1, -1].entries()) {
      const side = index === 0 ? 'left' : 'right';
      const supportId = `armchair-armrest-support-${side}`;
      const padId = `armchair-armrest-pad-${side}`;
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
            depth: spec.armrestLength,
          },
          dimensions: {
            width: ARMREST_SUPPORT_WIDTH_CM,
            height: supportHeight,
            depth: spec.armrestLength,
          },
          position: [sign * armX, seatTop + supportHeight / 2, 0],
          metadata: { armrest: true, armrestSupport: true },
        }),
        makePart({
          id: padId,
          type: 'support',
          role: 'support',
          materialSlot: 'upholstery',
          geometry: {
            kind: 'roundedBox',
            width: spec.armrestWidth,
            height: spec.armrestPaddingThickness,
            depth: spec.armrestLength,
            radius: CUSHION_CORNER_RADIUS_CM,
            segments: 4,
          },
          dimensions: {
            width: spec.armrestWidth,
            height: spec.armrestPaddingThickness,
            depth: spec.armrestLength,
          },
          position: [
            sign * armX,
            seatTop + spec.armrestHeight - spec.armrestPaddingThickness / 2,
            0,
          ],
          metadata: { armrest: true, armrestPadding: true },
          notes: ['Yumshoq qo‘l tayanchi yostig‘i.'],
        }),
      );
      connections.push(
        createConnection({
          id: `${supportId}-base`,
          type: 'fixed',
          componentIds: [supportId, 'armchair-seat-base'],
          position: [sign * armX, seatTop, 0],
          direction: [0, 1, 0],
        }),
        createConnection({
          id: `${padId}-support`,
          type: 'fixed',
          componentIds: [padId, supportId],
          position: [sign * armX, seatTop + supportHeight, 0],
          direction: [0, 1, 0],
        }),
      );

      const screw = screwPart(`armchair-armrest-screw-${index + 1}`, [
        sign * armX,
        seatTop - 1,
        0,
      ]);
      parts.push(screw);
      connections.push(
        createConnection({
          id: `armchair-armrest-screw-${index + 1}-joint`,
          type: 'screw',
          componentIds: [supportId, 'armchair-seat-base'],
          position: screw.position,
          direction: [0, 1, 0],
          hardwareId: screw.id,
        }),
      );
    }
  }

  return { parts, connections, warnings: [] };
}

export const armchairDefinition: FurnitureDefinition<ArmchairSpec> = {
  id: ARMCHAIR_DEFINITION_ID,
  version: 1,
  family: 'armchair',
  label: 'Yumshoq kreslo',
  fields: FIELDS,
  defaults: DEFAULT_ARMCHAIR_SPEC,
  slots: SLOTS,
  limits: {
    maxParts: 64,
    maxPartVertices: 50_000,
    maxPartTriangles: 100_000,
    maxTotalVertices: 300_000,
  },
  groupName: 'armchair-assembly',
  parseSpec: parseArmchairSpec,
  solve: solveArmchairPlan,
};

registerFurnitureDefinition(armchairDefinition);
