/**
 * Stage 2.2b — `chair.dining` definition.
 *
 * A wooden dining chair: four legs, seat, optional support rails, optional
 * backrest and optional armrests. No gas lift, no star base, no casters.
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

export const DINING_CHAIR_DEFINITION_ID = 'chair.dining';

const RAIL_THICKNESS_CM = 2.5;
const RAIL_HEIGHT_CM = 3;
const ARMREST_PAD_THICKNESS_CM = 3;
const ARMREST_POST_WIDTH_CM = 4;
const ARMREST_POST_DEPTH_CM = 5;
const SCREW_DIAMETERS = {
  shaftDiameter: 0.4,
  length: 3,
  headDiameter: 0.8,
  headHeight: 0.4,
} as const;

const NO_MANUFACTURING_NOTE =
  'manufacturing: boxCm mavjud emas (geometry to‘rtburchak box emas).';

export interface DiningChairSpec {
  readonly seatWidth: number;
  readonly seatDepth: number;
  readonly seatHeight: number;
  readonly seatThickness: number;

  readonly legWidth: number;
  readonly legDepth: number;
  readonly legInset: number;

  readonly backrestWidth: number;
  readonly backrestHeight: number;
  readonly backrestThickness: number;
  readonly backrestAngle: number;
  readonly backrestEnabled: boolean;

  readonly armrestsEnabled: boolean;
  readonly armrestHeight: number;
  readonly armrestWidth: number;
  readonly armrestLength: number;

  readonly supportRailsEnabled: boolean;
  readonly cornerRadius: number;
}

export const DEFAULT_DINING_CHAIR_SPEC: Readonly<DiningChairSpec> = {
  seatWidth: 45,
  seatDepth: 42,
  seatHeight: 46,
  seatThickness: 3,

  legWidth: 4,
  legDepth: 4,
  legInset: 4,

  backrestWidth: 43,
  backrestHeight: 38,
  backrestThickness: 3,
  backrestAngle: 5,
  backrestEnabled: true,

  armrestsEnabled: false,
  armrestHeight: 20,
  armrestWidth: 4,
  armrestLength: 30,

  supportRailsEnabled: true,
  cornerRadius: 0.8,
};

export interface DiningChairSpecValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

type NumericKey = {
  [K in keyof DiningChairSpec]: DiningChairSpec[K] extends number ? K : never;
}[keyof DiningChairSpec];

type BooleanKey = {
  [K in keyof DiningChairSpec]: DiningChairSpec[K] extends boolean ? K : never;
}[keyof DiningChairSpec];

type MutableDiningChairSpec = { -readonly [K in keyof DiningChairSpec]: DiningChairSpec[K] };

const NUMERIC_KEYS: readonly NumericKey[] = [
  'seatWidth',
  'seatDepth',
  'seatHeight',
  'seatThickness',
  'legWidth',
  'legDepth',
  'legInset',
  'backrestWidth',
  'backrestHeight',
  'backrestThickness',
  'backrestAngle',
  'armrestHeight',
  'armrestWidth',
  'armrestLength',
  'cornerRadius',
];

const BOOLEAN_KEYS: readonly BooleanKey[] = [
  'backrestEnabled',
  'armrestsEnabled',
  'supportRailsEnabled',
];

const KNOWN_KEYS = new Set<string>([...NUMERIC_KEYS, ...BOOLEAN_KEYS]);

const FIELDS: readonly DefinitionField[] = [
  { key: 'seatWidth', label: 'O‘rindiq kengligi (sm)', kind: 'number' },
  { key: 'seatDepth', label: 'O‘rindiq chuqurligi (sm)', kind: 'number' },
  { key: 'seatHeight', label: 'O‘rindiq balandligi (sm)', kind: 'number' },
  { key: 'seatThickness', label: 'O‘rindiq qalinligi (sm)', kind: 'number' },
  { key: 'legWidth', label: 'Oyoq kengligi (sm)', kind: 'number' },
  { key: 'legDepth', label: 'Oyoq chuqurligi (sm)', kind: 'number' },
  { key: 'legInset', label: 'Oyoq chekinishi (sm)', kind: 'number' },
  { key: 'backrestWidth', label: 'Suyanchiq kengligi (sm)', kind: 'number' },
  { key: 'backrestHeight', label: 'Suyanchiq balandligi (sm)', kind: 'number' },
  { key: 'backrestThickness', label: 'Suyanchiq qalinligi (sm)', kind: 'number' },
  { key: 'backrestAngle', label: 'Suyanchiq burchagi (°)', kind: 'number' },
  { key: 'backrestEnabled', label: 'Suyanchiq', kind: 'boolean' },
  { key: 'armrestsEnabled', label: 'Qo‘l tayanchlari', kind: 'boolean' },
  { key: 'armrestHeight', label: 'Qo‘l tayanchi balandligi (sm)', kind: 'number' },
  { key: 'armrestWidth', label: 'Qo‘l tayanchi kengligi (sm)', kind: 'number' },
  { key: 'armrestLength', label: 'Qo‘l tayanchi uzunligi (sm)', kind: 'number' },
  { key: 'supportRailsEnabled', label: 'Bog‘lovchi reykalar', kind: 'boolean' },
  { key: 'cornerRadius', label: 'Burchak radiusi (sm)', kind: 'number' },
];

const SLOTS: readonly FurnitureSlot[] = [
  {
    id: 'structure',
    label: 'Yog‘och konstruksiya',
    color: '#8b5a2b',
    materialId: 'wood-oak',
    groupName: 'dining-chair-structure-group',
  },
  {
    id: 'hardware',
    label: 'Furnitura',
    color: '#9aa3ad',
    materialId: 'metal-steel',
    groupName: 'dining-chair-hardware-group',
  },
];

function checkPositive(
  errors: string[],
  spec: DiningChairSpec,
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

export function validateDiningChairSpec(spec: DiningChairSpec): DiningChairSpecValidation {
  const errors: string[] = [];
  const seatWidth = checkPositive(errors, spec, 'seatWidth');
  const seatDepth = checkPositive(errors, spec, 'seatDepth');
  const seatHeight = checkPositive(errors, spec, 'seatHeight');
  const seatThickness = checkPositive(errors, spec, 'seatThickness');
  const legWidth = checkPositive(errors, spec, 'legWidth');
  const legDepth = checkPositive(errors, spec, 'legDepth');
  const legInset = checkPositive(errors, spec, 'legInset', false);
  const backrestWidth = checkPositive(errors, spec, 'backrestWidth', false);
  const backrestHeight = checkPositive(errors, spec, 'backrestHeight', false);
  const backrestThickness = checkPositive(errors, spec, 'backrestThickness', false);
  const backrestAngle = checkPositive(errors, spec, 'backrestAngle', false);
  const armrestHeight = checkPositive(errors, spec, 'armrestHeight', false);
  const armrestWidth = checkPositive(errors, spec, 'armrestWidth', false);
  const armrestLength = checkPositive(errors, spec, 'armrestLength', false);
  const cornerRadius = checkPositive(errors, spec, 'cornerRadius', false);

  for (const key of BOOLEAN_KEYS) {
    if (typeof spec[key] !== 'boolean') {
      errors.push(`${key}: boolean bo‘lishi kerak.`);
    }
  }

  if (seatThickness !== null && seatHeight !== null && seatThickness >= seatHeight) {
    errors.push('seatThickness: seatHeight dan kichik bo‘lishi kerak.');
  }
  if (widthPairInvalid(seatWidth, legWidth, legInset)) {
    errors.push('width: legInset va legWidth o‘rindiq chetidan chiqmasligi kerak.');
  }
  if (widthPairInvalid(seatDepth, legDepth, legInset)) {
    errors.push('depth: legInset va legDepth o‘rindiq chetidan chiqmasligi kerak.');
  }
  if (seatWidth !== null && seatDepth !== null && seatThickness !== null && cornerRadius !== null) {
    if (cornerRadius >= Math.min(seatWidth, seatDepth, seatThickness) / 2) {
      errors.push('cornerRadius: o‘rindiq o‘lchamining yarmidan kichik bo‘lishi kerak.');
    }
  }

  if (spec.backrestEnabled) {
    if (backrestWidth !== null && backrestWidth <= 0) {
      errors.push('backrestWidth: suyanchiq yoqilganda noldan katta bo‘lishi kerak.');
    }
    if (backrestHeight !== null && backrestHeight <= 0) {
      errors.push('backrestHeight: suyanchiq yoqilganda noldan katta bo‘lishi kerak.');
    }
    if (backrestThickness !== null && backrestThickness <= 0) {
      errors.push('backrestThickness: suyanchiq yoqilganda noldan katta bo‘lishi kerak.');
    }
    if (backrestWidth !== null && seatWidth !== null && backrestWidth > seatWidth) {
      errors.push('backrestWidth: seatWidth dan oshmasligi kerak.');
    }
    if (
      backrestHeight !== null &&
      backrestThickness !== null &&
      backrestThickness >= backrestHeight / 2
    ) {
      errors.push('backrestThickness: backrestHeight ning yarmidan kichik bo‘lishi kerak.');
    }
    if (backrestAngle !== null && backrestAngle > 30) {
      errors.push('backrestAngle: 0–30° oralig‘ida bo‘lishi kerak.');
    }
  }

  if (spec.armrestsEnabled) {
    if (armrestHeight !== null && armrestHeight <= ARMREST_PAD_THICKNESS_CM + 2) {
      errors.push('armrestHeight: pad va tayanch uchun juda past.');
    }
    if (armrestWidth !== null && seatWidth !== null && armrestWidth > seatWidth / 2) {
      errors.push('armrestWidth: o‘rindiq kengligiga nisbatan juda katta.');
    }
    if (armrestLength !== null && seatDepth !== null && armrestLength > seatDepth) {
      errors.push('armrestLength: o‘rindiq chuqurligidan oshmasligi kerak.');
    }
  }

  return { valid: errors.length === 0, errors };
}

function widthPairInvalid(
  outer: number | null,
  inner: number | null,
  inset: number | null,
): boolean {
  return outer !== null && inner !== null && inset !== null && outer <= 2 * inset + inner;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseDiningChairSpec(input: unknown): SpecParseResult<DiningChairSpec> {
  if (!isRecord(input)) {
    return { ok: false, errors: ['DiningChairSpec: obyekt bo‘lishi kerak.'] };
  }

  const errors: string[] = [];
  for (const key of Object.keys(input)) {
    if (!KNOWN_KEYS.has(key)) {
      errors.push(`DiningChairSpec.${key}: noma'lum maydon.`);
    }
  }

  const spec: MutableDiningChairSpec = { ...DEFAULT_DINING_CHAIR_SPEC };
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

  const validation = validateDiningChairSpec(spec);
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }
  return { ok: true, spec };
}

export function createDiningChairSpec(
  overrides: Partial<DiningChairSpec> = {},
): DiningChairSpec {
  return { ...DEFAULT_DINING_CHAIR_SPEC, ...overrides };
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

function solveDiningChairPlan(spec: DiningChairSpec): FurniturePlanDraft {
  const parts: PlanPart[] = [];
  const connections: ComponentConnection[] = [];
  const seatBottom = spec.seatHeight - spec.seatThickness;
  const seatTop = spec.seatHeight;
  const legHeight = seatBottom;
  const legX = spec.seatWidth / 2 - spec.legInset - spec.legWidth / 2;
  const legZ = spec.seatDepth / 2 - spec.legInset - spec.legDepth / 2;

  parts.push(
    makePart({
      id: 'dining-chair-seat',
      type: 'panel',
      role: 'panel',
      materialSlot: 'structure',
      geometry: {
        kind: 'roundedBox',
        width: spec.seatWidth,
        height: spec.seatThickness,
        depth: spec.seatDepth,
        radius: spec.cornerRadius,
        segments: 4,
      },
      dimensions: {
        width: spec.seatWidth,
        height: spec.seatThickness,
        depth: spec.seatDepth,
      },
      position: [0, seatBottom + spec.seatThickness / 2, 0],
      metadata: { woodenSeat: true },
    }),
  );

  const legPlacements = [
    { id: 'dining-chair-leg-front-left', x: -legX, z: legZ },
    { id: 'dining-chair-leg-front-right', x: legX, z: legZ },
    { id: 'dining-chair-leg-rear-left', x: -legX, z: -legZ },
    { id: 'dining-chair-leg-rear-right', x: legX, z: -legZ },
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
          height: legHeight,
          depth: spec.legDepth,
        },
        dimensions: { width: spec.legWidth, height: legHeight, depth: spec.legDepth },
        position: [leg.x, legHeight / 2, leg.z],
      }),
    );
    connections.push(
      createConnection({
        id: `${leg.id}-seat`,
        type: 'fixed',
        componentIds: [leg.id, 'dining-chair-seat'],
        position: [leg.x, seatBottom, leg.z],
        direction: [0, 1, 0],
      }),
    );
  }

  if (spec.supportRailsEnabled) {
    const railY = seatBottom - RAIL_HEIGHT_CM / 2;
    const frontWidth = spec.seatWidth - 2 * spec.legInset - spec.legWidth;
    const sideDepth = spec.seatDepth - 2 * spec.legInset - spec.legDepth;
    const rails = [
      {
        id: 'dining-chair-rail-front',
        width: frontWidth,
        depth: RAIL_THICKNESS_CM,
        position: [0, railY, legZ] as Vec3Tuple,
        legs: ['dining-chair-leg-front-left', 'dining-chair-leg-front-right'],
      },
      {
        id: 'dining-chair-rail-rear',
        width: frontWidth,
        depth: RAIL_THICKNESS_CM,
        position: [0, railY, -legZ] as Vec3Tuple,
        legs: ['dining-chair-leg-rear-left', 'dining-chair-leg-rear-right'],
      },
      {
        id: 'dining-chair-rail-left',
        width: RAIL_THICKNESS_CM,
        depth: sideDepth,
        position: [-legX, railY, 0] as Vec3Tuple,
        legs: ['dining-chair-leg-front-left', 'dining-chair-leg-rear-left'],
      },
      {
        id: 'dining-chair-rail-right',
        width: RAIL_THICKNESS_CM,
        depth: sideDepth,
        position: [legX, railY, 0] as Vec3Tuple,
        legs: ['dining-chair-leg-front-right', 'dining-chair-leg-rear-right'],
      },
    ];
    for (const rail of rails) {
      parts.push(
        makePart({
          id: rail.id,
          type: 'frame',
          role: 'frame',
          materialSlot: 'structure',
          geometry: {
            kind: 'box',
            width: rail.width,
            height: RAIL_HEIGHT_CM,
            depth: rail.depth,
          },
          dimensions: {
            width: rail.width,
            height: RAIL_HEIGHT_CM,
            depth: rail.depth,
          },
          position: rail.position,
        }),
      );
      for (const legId of rail.legs) {
        connections.push(
          createConnection({
            id: `${rail.id}-${legId}`,
            type: 'fixed',
            componentIds: [rail.id, legId],
            position: rail.position,
            direction: [0, 1, 0],
          }),
        );
      }
    }
  }

  if (spec.backrestEnabled) {
    const radians = (spec.backrestAngle * Math.PI) / 180;
    const pivotZ = -spec.seatDepth / 2 + spec.backrestThickness / 2;
    const half = spec.backrestHeight / 2;
    parts.push(
      makePart({
        id: 'dining-chair-backrest',
        type: 'panel',
        role: 'panel',
        materialSlot: 'structure',
        geometry: {
          kind: 'roundedBox',
          width: spec.backrestWidth,
          height: spec.backrestHeight,
          depth: spec.backrestThickness,
          radius: spec.cornerRadius,
          segments: 4,
        },
        dimensions: {
          width: spec.backrestWidth,
          height: spec.backrestHeight,
          depth: spec.backrestThickness,
        },
        position: [
          0,
          seatTop + half * Math.cos(radians),
          pivotZ - half * Math.sin(radians),
        ],
        rotation: [-spec.backrestAngle, 0, 0],
        metadata: { woodenBackrest: true },
      }),
    );
    connections.push(
      createConnection({
        id: 'dining-chair-backrest-seat',
        type: 'fixed',
        componentIds: ['dining-chair-backrest', 'dining-chair-seat'],
        position: [0, seatTop, pivotZ],
        direction: [0, 1, 0],
      }),
    );

    const screwX = Math.max(spec.backrestWidth / 2 - 5, 2);
    for (const [index, sign] of [1, -1].entries()) {
      const screw = screwPart(`dining-chair-backrest-screw-${index + 1}`, [
        sign * screwX,
        seatTop - 1,
        pivotZ,
      ]);
      parts.push(screw);
      connections.push(
        createConnection({
          id: `dining-chair-backrest-screw-${index + 1}-joint`,
          type: 'screw',
          componentIds: ['dining-chair-backrest', 'dining-chair-seat'],
          position: screw.position,
          direction: [0, 1, 0],
          hardwareId: screw.id,
        }),
      );
    }
  }

  if (spec.armrestsEnabled) {
    const armX = spec.seatWidth / 2 + spec.armrestWidth / 2 - 1;
    const postHeight = spec.armrestHeight - ARMREST_PAD_THICKNESS_CM;
    const postZ = -8;
    for (const [index, sign] of [1, -1].entries()) {
      const side = index === 0 ? 'left' : 'right';
      const postId = `dining-chair-armrest-post-${side}`;
      const padId = `dining-chair-armrest-pad-${side}`;
      parts.push(
        makePart({
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
          position: [sign * armX, seatTop + postHeight / 2, postZ],
          metadata: { armrest: true, armrestPost: true },
        }),
        makePart({
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
        }),
      );
      connections.push(
        createConnection({
          id: `${postId}-seat`,
          type: 'fixed',
          componentIds: [postId, 'dining-chair-seat'],
          position: [sign * armX, seatTop, postZ],
          direction: [0, 1, 0],
        }),
        createConnection({
          id: `${padId}-post`,
          type: 'fixed',
          componentIds: [padId, postId],
          position: [sign * armX, seatTop + postHeight, postZ],
          direction: [0, 1, 0],
        }),
      );

      const screw = screwPart(`dining-chair-armrest-screw-${index + 1}`, [
        sign * armX,
        seatTop - 1,
        postZ,
      ]);
      parts.push(screw);
      connections.push(
        createConnection({
          id: `dining-chair-armrest-screw-${index + 1}-joint`,
          type: 'screw',
          componentIds: [postId, 'dining-chair-seat'],
          position: screw.position,
          direction: [0, 1, 0],
          hardwareId: screw.id,
        }),
      );
    }
  }

  return { parts, connections, warnings: [] };
}

export const diningChairDefinition: FurnitureDefinition<DiningChairSpec> = {
  id: DINING_CHAIR_DEFINITION_ID,
  version: 1,
  family: 'chair',
  label: 'Ovqat stuli',
  fields: FIELDS,
  defaults: DEFAULT_DINING_CHAIR_SPEC,
  slots: SLOTS,
  limits: {
    maxParts: 64,
    maxPartVertices: 50_000,
    maxPartTriangles: 100_000,
    maxTotalVertices: 300_000,
  },
  groupName: 'dining-chair-assembly',
  parseSpec: parseDiningChairSpec,
  solve: solveDiningChairPlan,
};

registerFurnitureDefinition(diningChairDefinition);
