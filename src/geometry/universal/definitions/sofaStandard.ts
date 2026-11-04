/**
 * Stage 2.3 — `sofa.standard` definition.
 *
 * Three-seat sofa: upholstered frame shell, three seat cushions, three back
 * cushions on a structural backrest, two padded armrests and four legs.
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

export const SOFA_STANDARD_DEFINITION_ID = 'sofa.standard';

const SEAT_GAP_CM = 1.5;
const SEAT_FRONT_INSET_CM = 4;
const SIDE_MARGIN_CM = 2;
const ARMREST_PAD_THICKNESS_CM = 5;
const LEG_INSET_CM = 5;
const CUSHION_RADIUS_CM = 2;
const SCREW_DIAMETERS = {
  shaftDiameter: 0.4,
  length: 3,
  headDiameter: 0.8,
  headHeight: 0.4,
} as const;

const NO_MANUFACTURING_NOTE =
  'manufacturing: boxCm mavjud emas (geometry to‘rtburchak box emas).';

export interface SofaStandardSpec {
  readonly width: number;
  readonly depth: number;
  readonly totalHeight: number;
  readonly seatHeight: number;
  readonly frameHeight: number;
  readonly frameThickness: number;

  readonly seatCount: number;
  readonly seatCushionThickness: number;
  readonly seatCushionDepth: number;

  readonly backrestHeight: number;
  readonly backrestThickness: number;

  readonly armrestWidth: number;
  readonly armrestHeight: number;
  readonly armrestLength: number;

  readonly legHeight: number;
  readonly legWidth: number;
  readonly legDepth: number;
  readonly legCount: number;

  readonly backCushionEnabled: boolean;
  readonly armrestsEnabled: boolean;
}

export const DEFAULT_SOFA_STANDARD_SPEC: Readonly<SofaStandardSpec> = {
  width: 210,
  depth: 90,
  totalHeight: 85,
  seatHeight: 45,
  frameHeight: 35,
  frameThickness: 5,

  seatCount: 3,
  seatCushionThickness: 15,
  seatCushionDepth: 58,

  backrestHeight: 40,
  backrestThickness: 12,

  armrestWidth: 18,
  armrestHeight: 25,
  armrestLength: 85,

  legHeight: 10,
  legWidth: 5,
  legDepth: 5,
  legCount: 4,

  backCushionEnabled: true,
  armrestsEnabled: true,
};

export interface SofaStandardSpecValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

type NumericKey = {
  [K in keyof SofaStandardSpec]: SofaStandardSpec[K] extends number ? K : never;
}[keyof SofaStandardSpec];

type BooleanKey = {
  [K in keyof SofaStandardSpec]: SofaStandardSpec[K] extends boolean ? K : never;
}[keyof SofaStandardSpec];

type MutableSofaStandardSpec = {
  -readonly [K in keyof SofaStandardSpec]: SofaStandardSpec[K];
};

const NUMERIC_KEYS: readonly NumericKey[] = [
  'width',
  'depth',
  'totalHeight',
  'seatHeight',
  'frameHeight',
  'frameThickness',
  'seatCount',
  'seatCushionThickness',
  'seatCushionDepth',
  'backrestHeight',
  'backrestThickness',
  'armrestWidth',
  'armrestHeight',
  'armrestLength',
  'legHeight',
  'legWidth',
  'legDepth',
  'legCount',
];

const BOOLEAN_KEYS: readonly BooleanKey[] = ['backCushionEnabled', 'armrestsEnabled'];

const KNOWN_KEYS = new Set<string>([...NUMERIC_KEYS, ...BOOLEAN_KEYS]);

const FIELDS: readonly DefinitionField[] = [
  { key: 'width', label: 'Kenglik (sm)', kind: 'number' },
  { key: 'depth', label: 'Chuqurlik (sm)', kind: 'number' },
  { key: 'totalHeight', label: 'Umumiy balandlik (sm)', kind: 'number' },
  { key: 'seatHeight', label: 'O‘rindiq balandligi (sm)', kind: 'number' },
  { key: 'frameHeight', label: 'Karkas balandligi (sm)', kind: 'number' },
  { key: 'frameThickness', label: 'Karkas qalinligi (sm)', kind: 'number' },
  { key: 'seatCount', label: 'O‘rindiqlar soni', kind: 'number', integer: true },
  { key: 'seatCushionThickness', label: 'O‘rindiq yostig‘i qalinligi (sm)', kind: 'number' },
  { key: 'seatCushionDepth', label: 'O‘rindiq yostig‘i chuqurligi (sm)', kind: 'number' },
  { key: 'backrestHeight', label: 'Suyanchiq balandligi (sm)', kind: 'number' },
  { key: 'backrestThickness', label: 'Suyanchiq qalinligi (sm)', kind: 'number' },
  { key: 'armrestWidth', label: 'Qo‘l tayanchi kengligi (sm)', kind: 'number' },
  { key: 'armrestHeight', label: 'Qo‘l tayanchi balandligi (sm)', kind: 'number' },
  { key: 'armrestLength', label: 'Qo‘l tayanchi uzunligi (sm)', kind: 'number' },
  { key: 'legHeight', label: 'Oyoq balandligi (sm)', kind: 'number' },
  { key: 'legWidth', label: 'Oyoq kengligi (sm)', kind: 'number' },
  { key: 'legDepth', label: 'Oyoq chuqurligi (sm)', kind: 'number' },
  { key: 'legCount', label: 'Oyoqlar soni', kind: 'number', integer: true },
  { key: 'backCushionEnabled', label: 'Orqa yostiqlar', kind: 'boolean' },
  { key: 'armrestsEnabled', label: 'Qo‘l tayanchlari', kind: 'boolean' },
];

const SLOTS: readonly FurnitureSlot[] = [
  {
    id: 'upholstery',
    label: 'Qoplama',
    color: '#3f5b73',
    materialId: 'fabric-linen',
    groupName: 'sofa-upholstery-group',
  },
  {
    id: 'structure',
    label: 'Konstruksiya',
    color: '#6b4423',
    materialId: 'wood-oak',
    groupName: 'sofa-structure-group',
  },
  {
    id: 'hardware',
    label: 'Furnitura',
    color: '#9aa3ad',
    materialId: 'metal-steel',
    groupName: 'sofa-hardware-group',
  },
];

function checkPositive(
  errors: string[],
  spec: SofaStandardSpec,
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

export function validateSofaStandardSpec(
  spec: SofaStandardSpec,
): SofaStandardSpecValidation {
  const errors: string[] = [];
  const width = checkPositive(errors, spec, 'width');
  const depth = checkPositive(errors, spec, 'depth');
  const totalHeight = checkPositive(errors, spec, 'totalHeight');
  const seatHeight = checkPositive(errors, spec, 'seatHeight');
  const frameHeight = checkPositive(errors, spec, 'frameHeight');
  const frameThickness = checkPositive(errors, spec, 'frameThickness');
  const seatCount = checkPositive(errors, spec, 'seatCount');
  const seatCushionThickness = checkPositive(errors, spec, 'seatCushionThickness');
  const seatCushionDepth = checkPositive(errors, spec, 'seatCushionDepth');
  const backrestHeight = checkPositive(errors, spec, 'backrestHeight');
  const backrestThickness = checkPositive(errors, spec, 'backrestThickness');
  const armrestWidth = checkPositive(errors, spec, 'armrestWidth');
  const armrestHeight = checkPositive(errors, spec, 'armrestHeight');
  const armrestLength = checkPositive(errors, spec, 'armrestLength');
  const legHeight = checkPositive(errors, spec, 'legHeight');
  const legWidth = checkPositive(errors, spec, 'legWidth');
  const legDepth = checkPositive(errors, spec, 'legDepth');
  const legCount = checkPositive(errors, spec, 'legCount');

  for (const key of BOOLEAN_KEYS) {
    if (typeof spec[key] !== 'boolean') {
      errors.push(`${key}: boolean bo‘lishi kerak.`);
    }
  }
  if (seatCount !== null && (!Number.isInteger(seatCount) || seatCount !== 3)) {
    errors.push('seatCount: V1 uchun aynan 3 bo‘lishi kerak.');
  }
  if (legCount !== null && (!Number.isInteger(legCount) || legCount !== 4)) {
    errors.push('legCount: V1 uchun aynan 4 bo‘lishi kerak.');
  }
  if (seatHeight !== null && frameHeight !== null && legHeight !== null) {
    if (Math.abs(seatHeight - (legHeight + frameHeight)) > 1e-9) {
      errors.push('seatHeight: legHeight + frameHeight ga teng bo‘lishi kerak.');
    }
  }
  if (totalHeight !== null && seatHeight !== null && backrestHeight !== null) {
    if (Math.abs(totalHeight - (seatHeight + backrestHeight)) > 1e-9) {
      errors.push('totalHeight: seatHeight + backrestHeight ga teng bo‘lishi kerak.');
    }
  }
  if (frameThickness !== null && frameHeight !== null && frameThickness >= frameHeight / 2) {
    errors.push('frameThickness: frameHeight ning yarmidan kichik bo‘lishi kerak.');
  }
  if (backrestHeight !== null && backrestThickness !== null) {
    if (backrestThickness >= backrestHeight / 2) {
      errors.push('backrestThickness: backrestHeight ning yarmidan kichik bo‘lishi kerak.');
    }
  }
  if (
    seatHeight !== null &&
    seatCushionThickness !== null &&
    totalHeight !== null &&
    seatHeight + seatCushionThickness >= totalHeight
  ) {
    errors.push('seatCushionThickness: umumiy balandlikdan chiqib ketadi.');
  }
  if (depth !== null && backrestThickness !== null && seatCushionDepth !== null) {
    const available = depth - backrestThickness - SEAT_FRONT_INSET_CM - 2;
    if (seatCushionDepth > available) {
      errors.push('seatCushionDepth: backrest va old chekka bilan sig‘maydi.');
    }
  }
  if (width !== null && seatCount !== null) {
    const sideMargin = spec.armrestsEnabled ? armrestWidth : SIDE_MARGIN_CM;
    if (sideMargin !== null && sideMargin > 0) {
      const innerWidth = width - 2 * sideMargin;
      const cushionWidth =
        (innerWidth - (seatCount - 1) * SEAT_GAP_CM) / seatCount;
      if (cushionWidth <= 0) {
        errors.push('width: uchta o‘rindiq yostig‘i uchun yetarli emas.');
      }
    }
  }
  if (spec.armrestsEnabled) {
    if (armrestHeight !== null && armrestHeight <= ARMREST_PAD_THICKNESS_CM + 5) {
      errors.push('armrestHeight: tayanch va padding uchun juda past.');
    }
    if (armrestLength !== null && depth !== null && armrestLength > depth) {
      errors.push('armrestLength: depth dan oshmasligi kerak.');
    }
    if (armrestWidth !== null && width !== null && armrestWidth > width / 2) {
      errors.push('armrestWidth: width ga nisbatan juda katta.');
    }
    if (armrestHeight !== null && seatHeight !== null && totalHeight !== null) {
      if (seatHeight + armrestHeight >= totalHeight) {
        errors.push('armrestHeight: umumiy balandlikdan chiqib ketadi.');
      }
    }
  }
  if (width !== null && legWidth !== null) {
    if (width <= 2 * (LEG_INSET_CM + legWidth)) {
      errors.push('width: oyoqlar divan chetidan chiqib ketadi.');
    }
  }
  if (depth !== null && legDepth !== null) {
    if (depth <= 2 * (LEG_INSET_CM + legDepth)) {
      errors.push('depth: oyoqlar divan chetidan chiqib ketadi.');
    }
  }

  return { valid: errors.length === 0, errors };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseSofaStandardSpec(
  input: unknown,
): SpecParseResult<SofaStandardSpec> {
  if (!isRecord(input)) {
    return { ok: false, errors: ['SofaStandardSpec: obyekt bo‘lishi kerak.'] };
  }

  const errors: string[] = [];
  for (const key of Object.keys(input)) {
    if (!KNOWN_KEYS.has(key)) {
      errors.push(`SofaStandardSpec.${key}: noma'lum maydon.`);
    }
  }

  const spec: MutableSofaStandardSpec = { ...DEFAULT_SOFA_STANDARD_SPEC };
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

  const validation = validateSofaStandardSpec(spec);
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }
  return { ok: true, spec };
}

export function createSofaStandardSpec(
  overrides: Partial<SofaStandardSpec> = {},
): SofaStandardSpec {
  return { ...DEFAULT_SOFA_STANDARD_SPEC, ...overrides };
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

function solveSofaStandardPlan(spec: SofaStandardSpec): FurniturePlanDraft {
  const parts: PlanPart[] = [];
  const connections: ComponentConnection[] = [];
  const sideMargin = spec.armrestsEnabled ? spec.armrestWidth : SIDE_MARGIN_CM;
  const innerWidth = spec.width - 2 * sideMargin;
  const cushionWidth =
    (innerWidth - (spec.seatCount - 1) * SEAT_GAP_CM) / spec.seatCount;
  const cushionCentres = Array.from(
    { length: spec.seatCount },
    (_, index) =>
      -innerWidth / 2 + cushionWidth / 2 + index * (cushionWidth + SEAT_GAP_CM),
  );

  const frameBottom = spec.legHeight;
  const frameCentreY = frameBottom + spec.frameHeight / 2;
  const frameSideX = spec.width / 2 - spec.frameThickness / 2;
  const frameEndZ = spec.depth / 2 - spec.frameThickness / 2;

  const frameParts: Array<{ id: string; size: Vec3Tuple; position: Vec3Tuple }> = [
    {
      id: 'sofa-frame-bottom',
      size: [spec.width, spec.frameThickness, spec.depth],
      position: [0, frameBottom + spec.frameThickness / 2, 0],
    },
    {
      id: 'sofa-frame-top',
      size: [spec.width, spec.frameThickness, spec.depth],
      position: [0, spec.seatHeight - spec.frameThickness / 2, 0],
    },
    {
      id: 'sofa-frame-side-left',
      size: [spec.frameThickness, spec.frameHeight, spec.depth],
      position: [-frameSideX, frameCentreY, 0],
    },
    {
      id: 'sofa-frame-side-right',
      size: [spec.frameThickness, spec.frameHeight, spec.depth],
      position: [frameSideX, frameCentreY, 0],
    },
    {
      id: 'sofa-frame-front',
      size: [spec.width, spec.frameHeight, spec.frameThickness],
      position: [0, frameCentreY, frameEndZ],
    },
    {
      id: 'sofa-frame-back',
      size: [spec.width, spec.frameHeight, spec.frameThickness],
      position: [0, frameCentreY, -frameEndZ],
    },
  ];
  for (const frame of frameParts) {
    parts.push(
      makePart({
        id: frame.id,
        type: 'frame',
        role: 'frame',
        materialSlot: 'structure',
        geometry: {
          kind: 'box',
          width: frame.size[0],
          height: frame.size[1],
          depth: frame.size[2],
        },
        dimensions: {
          width: frame.size[0],
          height: frame.size[1],
          depth: frame.size[2],
        },
        position: frame.position,
      }),
    );
  }

  const seatCushionZ = spec.depth / 2 - SEAT_FRONT_INSET_CM - spec.seatCushionDepth / 2;
  const backCushionZ = -spec.depth / 2 + spec.backrestThickness * 1.5;
  for (let index = 0; index < spec.seatCount; index += 1) {
    const x = cushionCentres[index];
    parts.push(
      makePart({
        id: `sofa-seat-cushion-${index + 1}`,
        type: 'panel',
        role: 'panel',
        materialSlot: 'upholstery',
        geometry: {
          kind: 'roundedBox',
          width: cushionWidth,
          height: spec.seatCushionThickness,
          depth: spec.seatCushionDepth,
          radius: CUSHION_RADIUS_CM,
          segments: 6,
        },
        dimensions: {
          width: cushionWidth,
          height: spec.seatCushionThickness,
          depth: spec.seatCushionDepth,
        },
        position: [x, spec.seatHeight + spec.seatCushionThickness / 2, seatCushionZ],
        metadata: { cushion: true, seatCushion: true, cushionIndex: index + 1 },
        notes: ['Alohida yumshoq o‘rindiq yostig‘i.'],
      }),
    );
    connections.push(
      createConnection({
        id: `sofa-seat-cushion-${index + 1}-frame`,
        type: 'fixed',
        componentIds: [`sofa-seat-cushion-${index + 1}`, 'sofa-frame-top'],
        position: [x, spec.seatHeight, seatCushionZ],
        direction: [0, 1, 0],
      }),
    );
  }

  const backrestSupportZ = -spec.depth / 2 + spec.backrestThickness / 2;
  parts.push(
    makePart({
      id: 'sofa-backrest-support',
      type: 'frame',
      role: 'frame',
      materialSlot: 'structure',
      geometry: {
        kind: 'box',
        width: innerWidth,
        height: spec.backrestHeight,
        depth: spec.backrestThickness,
      },
      dimensions: {
        width: innerWidth,
        height: spec.backrestHeight,
        depth: spec.backrestThickness,
      },
      position: [0, spec.seatHeight + spec.backrestHeight / 2, backrestSupportZ],
      metadata: { backrestSupport: true },
    }),
  );
  connections.push(
    createConnection({
      id: 'sofa-backrest-support-frame',
      type: 'fixed',
      componentIds: ['sofa-backrest-support', 'sofa-frame-top'],
      position: [0, spec.seatHeight, backrestSupportZ],
      direction: [0, 1, 0],
    }),
  );

  const backrestScrewX = Math.max(innerWidth / 2 - 8, 2);
  for (const [index, sign] of [1, -1].entries()) {
    const screw = screwPart(`sofa-backrest-screw-${index + 1}`, [
      sign * backrestScrewX,
      spec.seatHeight + 1,
      backrestSupportZ,
    ]);
    parts.push(screw);
    connections.push(
      createConnection({
        id: `sofa-backrest-screw-${index + 1}-joint`,
        type: 'screw',
        componentIds: ['sofa-backrest-support', 'sofa-frame-top'],
        position: screw.position,
        direction: [0, 1, 0],
        hardwareId: screw.id,
      }),
    );
  }

  if (spec.backCushionEnabled) {
    for (let index = 0; index < spec.seatCount; index += 1) {
      const x = cushionCentres[index];
      const id = `sofa-back-cushion-${index + 1}`;
      parts.push(
        makePart({
          id,
          type: 'panel',
          role: 'panel',
          materialSlot: 'upholstery',
          geometry: {
            kind: 'roundedBox',
            width: cushionWidth,
            height: spec.backrestHeight,
            depth: spec.backrestThickness,
            radius: CUSHION_RADIUS_CM,
            segments: 6,
          },
          dimensions: {
            width: cushionWidth,
            height: spec.backrestHeight,
            depth: spec.backrestThickness,
          },
          position: [x, spec.seatHeight + spec.backrestHeight / 2, backCushionZ],
          metadata: { cushion: true, backCushion: true, cushionIndex: index + 1 },
          notes: ['Alohida yumshoq orqa yostig‘i.'],
        }),
      );
      connections.push(
        createConnection({
          id: `${id}-support`,
          type: 'fixed',
          componentIds: [id, 'sofa-backrest-support'],
          position: [x, spec.seatHeight + spec.backrestHeight / 2, backCushionZ],
          direction: [0, 0, -1],
        }),
      );
    }
  }

  if (spec.armrestsEnabled) {
    const armX = spec.width / 2 - spec.armrestWidth / 2;
    const supportHeight = spec.armrestHeight - ARMREST_PAD_THICKNESS_CM;
    for (const [index, sign] of [1, -1].entries()) {
      const side = index === 0 ? 'left' : 'right';
      const supportId = `sofa-armrest-support-${side}`;
      const padId = `sofa-armrest-pad-${side}`;
      parts.push(
        makePart({
          id: supportId,
          type: 'support',
          role: 'support',
          materialSlot: 'structure',
          geometry: {
            kind: 'box',
            width: spec.armrestWidth,
            height: supportHeight,
            depth: spec.armrestLength,
          },
          dimensions: {
            width: spec.armrestWidth,
            height: supportHeight,
            depth: spec.armrestLength,
          },
          position: [sign * armX, spec.seatHeight + supportHeight / 2, 0],
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
            height: ARMREST_PAD_THICKNESS_CM,
            depth: spec.armrestLength,
            radius: CUSHION_RADIUS_CM,
            segments: 4,
          },
          dimensions: {
            width: spec.armrestWidth,
            height: ARMREST_PAD_THICKNESS_CM,
            depth: spec.armrestLength,
          },
          position: [
            sign * armX,
            spec.seatHeight + spec.armrestHeight - ARMREST_PAD_THICKNESS_CM / 2,
            0,
          ],
          metadata: { armrest: true, armrestPadding: true },
          notes: ['Yumshoq qo‘l tayanchi qoplamasi.'],
        }),
      );
      connections.push(
        createConnection({
          id: `${supportId}-frame`,
          type: 'fixed',
          componentIds: [supportId, 'sofa-frame-top'],
          position: [sign * armX, spec.seatHeight, 0],
          direction: [0, 1, 0],
        }),
        createConnection({
          id: `${padId}-support`,
          type: 'fixed',
          componentIds: [padId, supportId],
          position: [sign * armX, spec.seatHeight + supportHeight, 0],
          direction: [0, 1, 0],
        }),
      );

      const screw = screwPart(`sofa-armrest-screw-${index + 1}`, [
        sign * armX,
        spec.seatHeight + 1,
        0,
      ]);
      parts.push(screw);
      connections.push(
        createConnection({
          id: `sofa-armrest-screw-${index + 1}-joint`,
          type: 'screw',
          componentIds: [supportId, 'sofa-frame-top'],
          position: screw.position,
          direction: [0, 1, 0],
          hardwareId: screw.id,
        }),
      );
    }
  }

  const legX = spec.width / 2 - LEG_INSET_CM - spec.legWidth / 2;
  const legZ = spec.depth / 2 - LEG_INSET_CM - spec.legDepth / 2;
  const legPlacements = [
    { id: 'sofa-leg-front-left', x: -legX, z: legZ },
    { id: 'sofa-leg-front-right', x: legX, z: legZ },
    { id: 'sofa-leg-rear-left', x: -legX, z: -legZ },
    { id: 'sofa-leg-rear-right', x: legX, z: -legZ },
  ];
  for (const [index, leg] of legPlacements.entries()) {
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
        id: `${leg.id}-frame`,
        type: 'fixed',
        componentIds: [leg.id, 'sofa-frame-bottom'],
        position: [leg.x, spec.legHeight, leg.z],
        direction: [0, 1, 0],
      }),
    );
    const screw = screwPart(`sofa-leg-screw-${index + 1}`, [
      leg.x,
      spec.legHeight - 1,
      leg.z,
    ]);
    parts.push(screw);
    connections.push(
      createConnection({
        id: `sofa-leg-screw-${index + 1}-joint`,
        type: 'screw',
        componentIds: [leg.id, 'sofa-frame-bottom'],
        position: screw.position,
        direction: [0, 1, 0],
        hardwareId: screw.id,
      }),
    );
  }

  return { parts, connections, warnings: [] };
}

export const sofaStandardDefinition: FurnitureDefinition<SofaStandardSpec> = {
  id: SOFA_STANDARD_DEFINITION_ID,
  version: 1,
  family: 'sofa',
  label: 'Uch o‘rinli divan',
  fields: FIELDS,
  defaults: DEFAULT_SOFA_STANDARD_SPEC,
  slots: SLOTS,
  limits: {
    maxParts: 96,
    maxPartVertices: 50_000,
    maxPartTriangles: 100_000,
    maxTotalVertices: 400_000,
  },
  groupName: 'sofa-standard-assembly',
  parseSpec: parseSofaStandardSpec,
  solve: solveSofaStandardPlan,
};

registerFurnitureDefinition(sofaStandardDefinition);
