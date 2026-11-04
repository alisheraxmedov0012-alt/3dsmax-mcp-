/**
 * Stage 2.2a — `chair.office` definition.
 *
 * Static office chair: upholstered seat/backrest, two armrests, a central
 * gas-lift representation, a five-star base and casters. No swivel, height
 * adjustment, rolling or other mechanism is simulated.
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

export const OFFICE_CHAIR_DEFINITION_ID = 'chair.office';

const SEAT_CORNER_RADIUS_CM = 2;
const ARMREST_PAD_THICKNESS_CM = 3;
const ARMREST_POST_WIDTH_CM = 4;
const ARMREST_POST_DEPTH_CM = 5;
const GAS_LIFT_RADIUS_CM = 3;
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

export interface OfficeChairSpec {
  readonly seatWidth: number;
  readonly seatDepth: number;
  readonly seatHeight: number;
  readonly seatThickness: number;

  readonly backrestWidth: number;
  readonly backrestHeight: number;
  readonly backrestThickness: number;
  readonly backrestAngle: number;

  readonly armrestsEnabled: boolean;
  readonly armrestHeight: number;
  readonly armrestWidth: number;
  readonly armrestLength: number;

  readonly gasLiftHeight: number;
  readonly baseRadius: number;
  readonly baseLegCount: number;
  readonly castersEnabled: boolean;
  readonly casterDiameter: number;
}

export const DEFAULT_OFFICE_CHAIR_SPEC: Readonly<OfficeChairSpec> = {
  seatWidth: 48,
  seatDepth: 46,
  seatHeight: 48,
  seatThickness: 8,

  backrestWidth: 46,
  backrestHeight: 55,
  backrestThickness: 6,
  backrestAngle: 10,

  armrestsEnabled: true,
  armrestHeight: 22,
  armrestWidth: 5,
  armrestLength: 30,

  gasLiftHeight: 40,
  baseRadius: 32,
  baseLegCount: 5,
  castersEnabled: true,
  casterDiameter: 6,
};

export interface OfficeChairSpecValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

type NumericKey = {
  [K in keyof OfficeChairSpec]: OfficeChairSpec[K] extends number ? K : never;
}[keyof OfficeChairSpec];

type BooleanKey = {
  [K in keyof OfficeChairSpec]: OfficeChairSpec[K] extends boolean ? K : never;
}[keyof OfficeChairSpec];

type MutableOfficeChairSpec = { -readonly [K in keyof OfficeChairSpec]: OfficeChairSpec[K] };

const NUMERIC_KEYS: readonly NumericKey[] = [
  'seatWidth',
  'seatDepth',
  'seatHeight',
  'seatThickness',
  'backrestWidth',
  'backrestHeight',
  'backrestThickness',
  'backrestAngle',
  'armrestHeight',
  'armrestWidth',
  'armrestLength',
  'gasLiftHeight',
  'baseRadius',
  'baseLegCount',
  'casterDiameter',
];

const BOOLEAN_KEYS: readonly BooleanKey[] = ['armrestsEnabled', 'castersEnabled'];

const KNOWN_KEYS = new Set<string>([...NUMERIC_KEYS, ...BOOLEAN_KEYS]);

const FIELDS: readonly DefinitionField[] = [
  { key: 'seatWidth', label: 'O‘rindiq kengligi (sm)', kind: 'number' },
  { key: 'seatDepth', label: 'O‘rindiq chuqurligi (sm)', kind: 'number' },
  { key: 'seatHeight', label: 'O‘rindiq balandligi (sm)', kind: 'number' },
  { key: 'seatThickness', label: 'O‘rindiq qalinligi (sm)', kind: 'number' },
  { key: 'backrestWidth', label: 'Suyanchiq kengligi (sm)', kind: 'number' },
  { key: 'backrestHeight', label: 'Suyanchiq balandligi (sm)', kind: 'number' },
  { key: 'backrestThickness', label: 'Suyanchiq qalinligi (sm)', kind: 'number' },
  { key: 'backrestAngle', label: 'Suyanchiq burchagi (°)', kind: 'number' },
  { key: 'armrestsEnabled', label: 'Qo‘l tayanchlari', kind: 'boolean' },
  { key: 'armrestHeight', label: 'Qo‘l tayanchi balandligi (sm)', kind: 'number' },
  { key: 'armrestWidth', label: 'Qo‘l tayanchi kengligi (sm)', kind: 'number' },
  { key: 'armrestLength', label: 'Qo‘l tayanchi uzunligi (sm)', kind: 'number' },
  { key: 'gasLiftHeight', label: 'Gazlift balandligi (sm)', kind: 'number' },
  { key: 'baseRadius', label: 'Beshtarmoq radiusi (sm)', kind: 'number' },
  { key: 'baseLegCount', label: 'Beshtarmoq oyoqlari soni', kind: 'number', integer: true },
  { key: 'castersEnabled', label: 'G‘ildiraklar', kind: 'boolean' },
  { key: 'casterDiameter', label: 'G‘ildirak diametri (sm)', kind: 'number' },
];

const SLOTS: readonly FurnitureSlot[] = [
  {
    id: 'upholstery',
    label: 'Qoplama',
    color: '#3b4652',
    materialId: 'fabric-linen',
    groupName: 'office-chair-upholstery-group',
  },
  {
    id: 'structure',
    label: 'Konstruksiya',
    color: '#22262b',
    materialId: 'metal-steel',
    groupName: 'office-chair-structure-group',
  },
  {
    id: 'hardware',
    label: 'Furnitura',
    color: '#9aa3ad',
    materialId: 'metal-steel',
    groupName: 'office-chair-hardware-group',
  },
];

function checkPositive(
  errors: string[],
  spec: OfficeChairSpec,
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

export function validateOfficeChairSpec(spec: OfficeChairSpec): OfficeChairSpecValidation {
  const errors: string[] = [];
  const seatWidth = checkPositive(errors, spec, 'seatWidth');
  const seatDepth = checkPositive(errors, spec, 'seatDepth');
  const seatHeight = checkPositive(errors, spec, 'seatHeight');
  const seatThickness = checkPositive(errors, spec, 'seatThickness');
  const backrestWidth = checkPositive(errors, spec, 'backrestWidth');
  const backrestHeight = checkPositive(errors, spec, 'backrestHeight');
  const backrestThickness = checkPositive(errors, spec, 'backrestThickness');
  const backrestAngle = checkPositive(errors, spec, 'backrestAngle', false);
  const armrestHeight = checkPositive(errors, spec, 'armrestHeight', false);
  const armrestWidth = checkPositive(errors, spec, 'armrestWidth', false);
  const armrestLength = checkPositive(errors, spec, 'armrestLength', false);
  const gasLiftHeight = checkPositive(errors, spec, 'gasLiftHeight');
  const baseRadius = checkPositive(errors, spec, 'baseRadius');
  const baseLegCount = checkPositive(errors, spec, 'baseLegCount');
  const casterDiameter = checkPositive(errors, spec, 'casterDiameter', false);

  if (typeof spec.armrestsEnabled !== 'boolean') {
    errors.push('armrestsEnabled: boolean bo‘lishi kerak.');
  }
  if (typeof spec.castersEnabled !== 'boolean') {
    errors.push('castersEnabled: boolean bo‘lishi kerak.');
  }
  if (baseLegCount !== null && (!Number.isInteger(baseLegCount) || baseLegCount !== 5)) {
    errors.push('baseLegCount: V1 uchun aynan 5 bo‘lishi kerak.');
  }
  if (seatHeight !== null && seatThickness !== null && seatThickness >= seatHeight) {
    errors.push('seatThickness: seatHeight dan kichik bo‘lishi kerak.');
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
  if (
    spec.armrestsEnabled &&
    armrestHeight !== null &&
    armrestWidth !== null &&
    armrestLength !== null &&
    seatDepth !== null &&
    seatWidth !== null
  ) {
    if (armrestHeight <= ARMREST_PAD_THICKNESS_CM + 2) {
      errors.push('armrestHeight: pad va tayanch uchun juda past.');
    }
    if (armrestWidth > seatWidth / 2) {
      errors.push('armrestWidth: o‘rindiq kengligiga nisbatan juda katta.');
    }
    if (armrestLength > seatDepth) {
      errors.push('armrestLength: o‘rindiq chuqurligidan oshmasligi kerak.');
    }
  }
  if (seatHeight !== null && seatThickness !== null && gasLiftHeight !== null) {
    if (gasLiftHeight > seatHeight - seatThickness) {
      errors.push('gasLiftHeight: o‘rindiq ostidagi mavjud balandlikdan oshadi.');
    }
  }
  if (baseRadius !== null) {
    if (baseRadius <= BASE_HUB_RADIUS_CM) {
      errors.push('baseRadius: markaziy hub radiusidan katta bo‘lishi kerak.');
    }
    if (spec.castersEnabled && casterDiameter !== null && casterDiameter / 2 >= baseRadius) {
      errors.push('casterDiameter: beshtarmoq radiusiga sig‘maydi.');
    }
  }
  if (spec.castersEnabled && casterDiameter !== null && casterDiameter <= 0) {
    errors.push('casterDiameter: g‘ildiraklar yoqilganda noldan katta bo‘lishi kerak.');
  }

  return { valid: errors.length === 0, errors };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseOfficeChairSpec(input: unknown): SpecParseResult<OfficeChairSpec> {
  if (!isRecord(input)) {
    return { ok: false, errors: ['OfficeChairSpec: obyekt bo‘lishi kerak.'] };
  }

  const errors: string[] = [];
  for (const key of Object.keys(input)) {
    if (!KNOWN_KEYS.has(key)) {
      errors.push(`OfficeChairSpec.${key}: noma'lum maydon.`);
    }
  }

  const spec: MutableOfficeChairSpec = { ...DEFAULT_OFFICE_CHAIR_SPEC };
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

  const validation = validateOfficeChairSpec(spec);
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }
  return { ok: true, spec };
}

export function createOfficeChairSpec(
  overrides: Partial<OfficeChairSpec> = {},
): OfficeChairSpec {
  return { ...DEFAULT_OFFICE_CHAIR_SPEC, ...overrides };
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
    metadata: { componentVersion: screw.componentVersion },
  });
}

function solveOfficeChairPlan(spec: OfficeChairSpec): FurniturePlanDraft {
  const parts: PlanPart[] = [];
  const connections: ComponentConnection[] = [];
  const seatTop = spec.seatHeight;
  const seatBottom = spec.seatHeight - spec.seatThickness;

  parts.push(
    makePart({
      id: 'office-chair-seat',
      type: 'panel',
      role: 'panel',
      materialSlot: 'upholstery',
      geometry: {
        kind: 'roundedBox',
        width: spec.seatWidth,
        height: spec.seatThickness,
        depth: spec.seatDepth,
        radius: SEAT_CORNER_RADIUS_CM,
        segments: 6,
      },
      dimensions: {
        width: spec.seatWidth,
        height: spec.seatThickness,
        depth: spec.seatDepth,
      },
      position: [0, seatBottom + spec.seatThickness / 2, 0],
      metadata: { cushion: true, upholstered: true },
      notes: ['Yumshoq qoplama paneli; qattiq yog‘och detal emas.'],
    }),
  );

  const backrestRadians = (spec.backrestAngle * Math.PI) / 180;
  const backrestPivotZ = -spec.seatDepth / 2 + spec.backrestThickness / 2;
  const backrestHalf = spec.backrestHeight / 2;
  const backrestCentreY = seatTop + backrestHalf * Math.cos(backrestRadians);
  const backrestCentreZ = backrestPivotZ - backrestHalf * Math.sin(backrestRadians);
  parts.push(
    makePart({
      id: 'office-chair-backrest',
      type: 'panel',
      role: 'panel',
      materialSlot: 'upholstery',
      geometry: {
        kind: 'roundedBox',
        width: spec.backrestWidth,
        height: spec.backrestHeight,
        depth: spec.backrestThickness,
        radius: SEAT_CORNER_RADIUS_CM,
        segments: 6,
      },
      dimensions: {
        width: spec.backrestWidth,
        height: spec.backrestHeight,
        depth: spec.backrestThickness,
      },
      position: [0, backrestCentreY, backrestCentreZ],
      rotation: [-spec.backrestAngle, 0, 0],
      metadata: { cushion: true, upholstered: true },
      notes: ['Yumshoq suyanchiq paneli; seat bilan tutashgan.'],
    }),
  );
  connections.push(
    createConnection({
      id: 'office-chair-backrest-seat',
      type: 'fixed',
      componentIds: ['office-chair-backrest', 'office-chair-seat'],
      position: [0, seatTop, backrestPivotZ],
      direction: [0, 1, 0],
    }),
  );

  const backrestScrewX = Math.max(spec.backrestWidth / 2 - 6, 2);
  for (const [index, sign] of [1, -1].entries()) {
    const screw = screwPart(`office-chair-backrest-screw-${index + 1}`, [
      sign * backrestScrewX,
      seatTop - 1,
      backrestPivotZ,
    ]);
    parts.push(screw);
    connections.push(
      createConnection({
        id: `office-chair-backrest-screw-${index + 1}-joint`,
        type: 'screw',
        componentIds: ['office-chair-backrest', 'office-chair-seat'],
        position: screw.position,
        direction: [0, 1, 0],
        hardwareId: screw.id,
      }),
    );
  }

  const armX = spec.seatWidth / 2 + spec.armrestWidth / 2 - 1;
  const postHeight = spec.armrestHeight - ARMREST_PAD_THICKNESS_CM;
  const armPostZ = -10;
  if (spec.armrestsEnabled) {
    for (const [index, sign] of [1, -1].entries()) {
      const postId = `office-chair-arm-post-${index + 1}`;
      const padId = `office-chair-arm-pad-${index + 1}`;
      const post = makePart({
        id: postId,
        type: 'support',
        role: 'support',
        materialSlot: 'structure',
        geometry: {
          kind: 'box',
          width: ARMREST_POST_WIDTH_CM,
          height: postHeight,
          depth: ARMREST_POST_DEPTH_CM,
        },
        dimensions: {
          width: ARMREST_POST_WIDTH_CM,
          height: postHeight,
          depth: ARMREST_POST_DEPTH_CM,
        },
        position: [sign * armX, seatTop + postHeight / 2, armPostZ],
        metadata: { armrest: true, armrestPost: true },
      });
      const pad = makePart({
        id: padId,
        type: 'support',
        role: 'support',
        materialSlot: 'structure',
        geometry: {
          kind: 'roundedBox',
          width: spec.armrestWidth,
          height: ARMREST_PAD_THICKNESS_CM,
          depth: spec.armrestLength,
          radius: 1,
          segments: 4,
        },
        dimensions: {
          width: spec.armrestWidth,
          height: ARMREST_PAD_THICKNESS_CM,
          depth: spec.armrestLength,
        },
        position: [sign * armX, seatTop + spec.armrestHeight - ARMREST_PAD_THICKNESS_CM / 2, 0],
        metadata: { armrest: true, armrestPad: true },
      });
      parts.push(post, pad);
      connections.push(
        createConnection({
          id: `office-chair-arm-post-${index + 1}-seat`,
          type: 'fixed',
          componentIds: [postId, 'office-chair-seat'],
          position: [sign * armX, seatTop, armPostZ],
          direction: [0, 1, 0],
        }),
        createConnection({
          id: `office-chair-arm-pad-${index + 1}-post`,
          type: 'fixed',
          componentIds: [padId, postId],
          position: [sign * armX, seatTop + postHeight, armPostZ],
          direction: [0, 1, 0],
        }),
      );

      const screw = screwPart(`office-chair-arm-screw-${index + 1}`, [
        sign * armX,
        seatTop - 1,
        armPostZ,
      ]);
      parts.push(screw);
      connections.push(
        createConnection({
          id: `office-chair-arm-screw-${index + 1}-joint`,
          type: 'screw',
          componentIds: [postId, 'office-chair-seat'],
          position: screw.position,
          direction: [0, 1, 0],
          hardwareId: screw.id,
        }),
      );
    }
  }

  const gasLiftBottom = seatBottom - spec.gasLiftHeight;
  parts.push(
    makePart({
      id: 'office-chair-gas-lift',
      type: 'support',
      role: 'support',
      materialSlot: 'structure',
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
      position: [0, gasLiftBottom + spec.gasLiftHeight / 2, 0],
      metadata: { gasLift: 'representation' },
      notes: ['Gazlift statik ustun sifatida modellangan; sozlash mexanizmi yo‘q.'],
    }),
  );
  connections.push(
    createConnection({
      id: 'office-chair-gas-lift-seat',
      type: 'fixed',
      componentIds: ['office-chair-gas-lift', 'office-chair-seat'],
      position: [0, seatBottom, 0],
      direction: [0, 1, 0],
    }),
  );

  const baseArmY = spec.castersEnabled ? spec.casterDiameter + 4.5 : 1.5;
  const hubY = spec.castersEnabled ? baseArmY : Math.max(BASE_HUB_HEIGHT_CM / 2, baseArmY);
  parts.push(
    makePart({
      id: 'office-chair-base-hub',
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
      id: 'office-chair-base-hub-gas-lift',
      type: 'fixed',
      componentIds: ['office-chair-base-hub', 'office-chair-gas-lift'],
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
    const armId = `office-chair-base-arm-${index + 1}`;
    const arm = makePart({
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
    });
    parts.push(arm);
    connections.push(
      createConnection({
        id: `office-chair-base-arm-${index + 1}-hub`,
        type: 'fixed',
        componentIds: [armId, 'office-chair-base-hub'],
        position: [0, baseArmY, 0],
        direction: [0, 1, 0],
      }),
    );

    if (spec.castersEnabled) {
      const armEndPosition: Vec3Tuple = [sin * spec.baseRadius, baseArmY, cos * spec.baseRadius];
      const housingId = `office-chair-caster-housing-${index + 1}`;
      const housing = makePart({
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
      });
      const wheelId = `office-chair-caster-wheel-${index + 1}`;
      const wheel = makePart({
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
      });
      parts.push(housing, wheel);
      connections.push(
        createConnection({
          id: `office-chair-caster-housing-${index + 1}-arm`,
          type: 'fixed',
          componentIds: [housingId, armId],
          position: armEndPosition,
          direction: [0, 1, 0],
        }),
        createConnection({
          id: `office-chair-caster-wheel-${index + 1}-housing`,
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

export const officeChairDefinition: FurnitureDefinition<OfficeChairSpec> = {
  id: OFFICE_CHAIR_DEFINITION_ID,
  version: 1,
  family: 'chair',
  label: 'Ofis kreslosi',
  fields: FIELDS,
  defaults: DEFAULT_OFFICE_CHAIR_SPEC,
  slots: SLOTS,
  limits: {
    maxParts: 96,
    maxPartVertices: 50_000,
    maxPartTriangles: 100_000,
    maxTotalVertices: 400_000,
  },
  groupName: 'office-chair-assembly',
  parseSpec: parseOfficeChairSpec,
  solve: solveOfficeChairPlan,
};

registerFurnitureDefinition(officeChairDefinition);
