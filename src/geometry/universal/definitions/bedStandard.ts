/**
 * Stage 2.5 — `bed.standard` definition.
 *
 * Double bed: four rails, 14 slats, mattress, headboard with optional padding,
 * optional footboard, four legs and an optional centre support with two legs.
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

export const BED_STANDARD_DEFINITION_ID = 'bed.standard';

const LEG_INSET_CM = 5;
const CENTER_BEAM_WIDTH_CM = 8;
const CENTER_BEAM_HEIGHT_CM = 6;
const HEADBOARD_PADDING_MARGIN_CM = 8;
const SCREW_DIAMETERS = {
  shaftDiameter: 0.4,
  length: 3,
  headDiameter: 0.8,
  headHeight: 0.4,
} as const;

const NO_MANUFACTURING_NOTE =
  'manufacturing: boxCm mavjud emas (geometry to‘rtburchak box emas).';

export interface BedStandardSpec {
  readonly width: number;
  readonly length: number;
  readonly totalHeight: number;
  readonly frameHeight: number;
  readonly frameThickness: number;
  readonly mattressThickness: number;
  readonly mattressInset: number;

  readonly headboardHeight: number;
  readonly headboardThickness: number;
  readonly headboardWidth: number;

  readonly footboardEnabled: boolean;
  readonly footboardHeight: number;

  readonly slatCount: number;
  readonly slatThickness: number;
  readonly slatWidth: number;

  readonly legHeight: number;
  readonly legWidth: number;
  readonly legDepth: number;
  readonly legCount: number;

  readonly centerSupportEnabled: boolean;
  readonly headboardPaddingEnabled: boolean;
}

export const DEFAULT_BED_STANDARD_SPEC: Readonly<BedStandardSpec> = {
  width: 160,
  length: 200,
  totalHeight: 110,
  frameHeight: 30,
  frameThickness: 5,
  mattressThickness: 20,
  mattressInset: 2,

  headboardHeight: 80,
  headboardThickness: 6,
  headboardWidth: 160,

  footboardEnabled: false,
  footboardHeight: 35,

  slatCount: 14,
  slatThickness: 2,
  slatWidth: 8,

  legHeight: 20,
  legWidth: 8,
  legDepth: 8,
  legCount: 4,

  centerSupportEnabled: true,
  headboardPaddingEnabled: true,
};

export interface BedStandardSpecValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

type NumericKey = {
  [K in keyof BedStandardSpec]: BedStandardSpec[K] extends number ? K : never;
}[keyof BedStandardSpec];

type BooleanKey = {
  [K in keyof BedStandardSpec]: BedStandardSpec[K] extends boolean ? K : never;
}[keyof BedStandardSpec];

type MutableBedStandardSpec = {
  -readonly [K in keyof BedStandardSpec]: BedStandardSpec[K];
};

const NUMERIC_KEYS: readonly NumericKey[] = [
  'width',
  'length',
  'totalHeight',
  'frameHeight',
  'frameThickness',
  'mattressThickness',
  'mattressInset',
  'headboardHeight',
  'headboardThickness',
  'headboardWidth',
  'footboardHeight',
  'slatCount',
  'slatThickness',
  'slatWidth',
  'legHeight',
  'legWidth',
  'legDepth',
  'legCount',
];

const BOOLEAN_KEYS: readonly BooleanKey[] = [
  'footboardEnabled',
  'centerSupportEnabled',
  'headboardPaddingEnabled',
];

const KNOWN_KEYS = new Set<string>([...NUMERIC_KEYS, ...BOOLEAN_KEYS]);

const FIELDS: readonly DefinitionField[] = [
  { key: 'width', label: 'Kenglik (sm)', kind: 'number' },
  { key: 'length', label: 'Uzunlik (sm)', kind: 'number' },
  { key: 'totalHeight', label: 'Umumiy balandlik (sm)', kind: 'number' },
  { key: 'frameHeight', label: 'Karkas balandligi (sm)', kind: 'number' },
  { key: 'frameThickness', label: 'Karkas qalinligi (sm)', kind: 'number' },
  { key: 'mattressThickness', label: 'Matras qalinligi (sm)', kind: 'number' },
  { key: 'mattressInset', label: 'Matras botishi (sm)', kind: 'number' },
  { key: 'headboardHeight', label: 'Bosh suyanchiq balandligi (sm)', kind: 'number' },
  { key: 'headboardThickness', label: 'Bosh suyanchiq qalinligi (sm)', kind: 'number' },
  { key: 'headboardWidth', label: 'Bosh suyanchiq kengligi (sm)', kind: 'number' },
  { key: 'footboardEnabled', label: 'Oyoq tomoni paneli', kind: 'boolean' },
  { key: 'footboardHeight', label: 'Oyoq paneli balandligi (sm)', kind: 'number' },
  { key: 'slatCount', label: 'Slatlar soni', kind: 'number', integer: true },
  { key: 'slatThickness', label: 'Slat qalinligi (sm)', kind: 'number' },
  { key: 'slatWidth', label: 'Slat kengligi (sm)', kind: 'number' },
  { key: 'legHeight', label: 'Oyoq balandligi (sm)', kind: 'number' },
  { key: 'legWidth', label: 'Oyoq kengligi (sm)', kind: 'number' },
  { key: 'legDepth', label: 'Oyoq chuqurligi (sm)', kind: 'number' },
  { key: 'legCount', label: 'Oyoqlar soni', kind: 'number', integer: true },
  { key: 'centerSupportEnabled', label: 'Markaziy tayanch', kind: 'boolean' },
  { key: 'headboardPaddingEnabled', label: 'Bosh suyanchiq qoplamasi', kind: 'boolean' },
];

const SLOTS: readonly FurnitureSlot[] = [
  {
    id: 'structure',
    label: 'Yog‘och karkas',
    color: '#8b5a2b',
    materialId: 'wood-oak',
    groupName: 'bed-structure-group',
  },
  {
    id: 'mattress',
    label: 'Matras',
    color: '#d9d4c8',
    materialId: 'fabric-linen',
    groupName: 'bed-mattress-group',
  },
  {
    id: 'upholstery',
    label: 'Qoplama',
    color: '#5b6b73',
    materialId: 'fabric-linen',
    groupName: 'bed-upholstery-group',
  },
  {
    id: 'hardware',
    label: 'Furnitura',
    color: '#9aa3ad',
    materialId: 'metal-steel',
    groupName: 'bed-hardware-group',
  },
];

function checkPositive(
  errors: string[],
  spec: BedStandardSpec,
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

export function validateBedStandardSpec(spec: BedStandardSpec): BedStandardSpecValidation {
  const errors: string[] = [];
  const width = checkPositive(errors, spec, 'width');
  const length = checkPositive(errors, spec, 'length');
  const totalHeight = checkPositive(errors, spec, 'totalHeight');
  const frameHeight = checkPositive(errors, spec, 'frameHeight');
  const frameThickness = checkPositive(errors, spec, 'frameThickness');
  const mattressThickness = checkPositive(errors, spec, 'mattressThickness');
  const mattressInset = checkPositive(errors, spec, 'mattressInset', false);
  const headboardHeight = checkPositive(errors, spec, 'headboardHeight');
  const headboardThickness = checkPositive(errors, spec, 'headboardThickness');
  const headboardWidth = checkPositive(errors, spec, 'headboardWidth');
  const footboardHeight = checkPositive(errors, spec, 'footboardHeight', false);
  const slatCount = checkPositive(errors, spec, 'slatCount');
  const slatThickness = checkPositive(errors, spec, 'slatThickness');
  const slatWidth = checkPositive(errors, spec, 'slatWidth');
  const legHeight = checkPositive(errors, spec, 'legHeight');
  const legWidth = checkPositive(errors, spec, 'legWidth');
  const legDepth = checkPositive(errors, spec, 'legDepth');
  const legCount = checkPositive(errors, spec, 'legCount');

  for (const key of BOOLEAN_KEYS) {
    if (typeof spec[key] !== 'boolean') {
      errors.push(`${key}: boolean bo‘lishi kerak.`);
    }
  }
  if (legCount !== null && (!Number.isInteger(legCount) || legCount !== 4)) {
    errors.push('legCount: V1 uchun aynan 4 bo‘lishi kerak.');
  }
  if (slatCount !== null && (!Number.isInteger(slatCount) || slatCount !== 14)) {
    errors.push('slatCount: V1 uchun aynan 14 bo‘lishi kerak.');
  }
  if (legHeight !== null && frameHeight !== null && legHeight >= frameHeight) {
    errors.push('legHeight: frameHeight dan kichik bo‘lishi kerak.');
  }
  if (totalHeight !== null && headboardHeight !== null && frameHeight !== null) {
    if (Math.abs(totalHeight - (headboardHeight + frameHeight)) > 1e-9) {
      errors.push('totalHeight: headboardHeight + frameHeight ga teng bo‘lishi kerak.');
    }
  }
  if (headboardWidth !== null && width !== null && headboardWidth > width) {
    errors.push('headboardWidth: width dan oshmasligi kerak.');
  }
  if (frameThickness !== null && width !== null && length !== null) {
    const innerWidth = width - 2 * frameThickness;
    const innerLength = length - 2 * frameThickness;
    if (innerWidth <= 0 || innerLength <= 0) {
      errors.push('frameThickness: ichki o‘lchamlar noldan katta bo‘lishi kerak.');
    }
    if (headboardThickness !== null && innerLength - headboardThickness <= 0) {
      errors.push('headboardThickness: matras uchun uzunlik qolmaydi.');
    }
    if (slatCount !== null && slatWidth !== null && innerLength > 0) {
      const pitch = innerLength / (slatCount + 1);
      if (pitch <= slatWidth) {
        errors.push('slatWidth: slatlar orasidagi oraliq yetarli emas.');
      }
    }
    if (
      mattressThickness !== null &&
      mattressInset !== null &&
      frameHeight !== null &&
      totalHeight !== null
    ) {
      const mattressBottom = frameHeight - mattressInset;
      if (mattressBottom < 0) {
        errors.push('mattressInset: frameHeight dan katta bo‘lmasligi kerak.');
      }
      if (mattressBottom + mattressThickness >= totalHeight) {
        errors.push('mattressThickness: totalHeight dan chiqib ketadi.');
      }
    }
    if (slatThickness !== null && frameHeight !== null && legHeight !== null) {
      const railHeight = frameHeight - legHeight;
      if (slatThickness >= railHeight) {
        errors.push('slatThickness: karkas rail balandligidan kichik bo‘lishi kerak.');
      }
    }
  }
  if (width !== null && legWidth !== null && width <= 2 * (LEG_INSET_CM + legWidth)) {
    errors.push('width: oyoqlar karavot chetidan chiqib ketadi.');
  }
  if (length !== null && legDepth !== null && length <= 2 * (LEG_INSET_CM + legDepth)) {
    errors.push('length: oyoqlar karavot chetidan chiqib ketadi.');
  }
  if (spec.headboardPaddingEnabled) {
    if (headboardWidth !== null && headboardHeight !== null && mattressThickness !== null) {
      const paddingWidth = headboardWidth - 2 * HEADBOARD_PADDING_MARGIN_CM;
      const paddingHeight = headboardHeight - mattressThickness - 10;
      if (paddingWidth <= 0 || paddingHeight <= 0) {
        errors.push('headboardPaddingEnabled: headboard padding uchun o‘lcham yetarli emas.');
      }
    }
  }
  if (spec.footboardEnabled && footboardHeight !== null) {
    if (footboardHeight <= 0) {
      errors.push('footboardHeight: footboard yoqilganda noldan katta bo‘lishi kerak.');
    }
    if (totalHeight !== null && frameHeight !== null && footboardHeight > totalHeight - frameHeight) {
      errors.push('footboardHeight: headboard balandligidan oshmasligi kerak.');
    }
  }

  return { valid: errors.length === 0, errors };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseBedStandardSpec(input: unknown): SpecParseResult<BedStandardSpec> {
  if (!isRecord(input)) {
    return { ok: false, errors: ['BedStandardSpec: obyekt bo‘lishi kerak.'] };
  }

  const errors: string[] = [];
  for (const key of Object.keys(input)) {
    if (!KNOWN_KEYS.has(key)) {
      errors.push(`BedStandardSpec.${key}: noma'lum maydon.`);
    }
  }

  const spec: MutableBedStandardSpec = { ...DEFAULT_BED_STANDARD_SPEC };
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

  const validation = validateBedStandardSpec(spec);
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }
  return { ok: true, spec };
}

export function createBedStandardSpec(
  overrides: Partial<BedStandardSpec> = {},
): BedStandardSpec {
  return { ...DEFAULT_BED_STANDARD_SPEC, ...overrides };
}

function manufacturingForGeometry(
  geometry: GeometryRecipe,
  cutFromSheet: boolean,
): ManufacturingMetadata | undefined {
  if (geometry.kind !== 'box') {
    return undefined;
  }
  return {
    boxCm: [geometry.width, geometry.height, geometry.depth],
    cutFromSheet,
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
  readonly cutFromSheet?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly notes?: readonly string[];
}

function makePart(input: PartInput): PlanPart {
  const manufacturing = manufacturingForGeometry(input.geometry, input.cutFromSheet ?? false);
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

function solveBedStandardPlan(spec: BedStandardSpec): FurniturePlanDraft {
  const parts: PlanPart[] = [];
  const connections: ComponentConnection[] = [];
  const innerWidth = spec.width - 2 * spec.frameThickness;
  const innerLength = spec.length - 2 * spec.frameThickness;
  const railHeight = spec.frameHeight - spec.legHeight;
  const railCentreY = spec.legHeight + railHeight / 2;
  const sideRailX = spec.width / 2 - spec.frameThickness / 2;
  const endRailZ = spec.length / 2 - spec.frameThickness / 2;

  const rails = [
    {
      id: 'bed-side-rail-left',
      size: [spec.frameThickness, railHeight, innerLength] as Vec3Tuple,
      position: [-sideRailX, railCentreY, 0] as Vec3Tuple,
    },
    {
      id: 'bed-side-rail-right',
      size: [spec.frameThickness, railHeight, innerLength] as Vec3Tuple,
      position: [sideRailX, railCentreY, 0] as Vec3Tuple,
    },
    {
      id: 'bed-head-rail',
      size: [innerWidth, railHeight, spec.frameThickness] as Vec3Tuple,
      position: [0, railCentreY, -endRailZ] as Vec3Tuple,
    },
    {
      id: 'bed-foot-rail',
      size: [innerWidth, railHeight, spec.frameThickness] as Vec3Tuple,
      position: [0, railCentreY, endRailZ] as Vec3Tuple,
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
          width: rail.size[0],
          height: rail.size[1],
          depth: rail.size[2],
        },
        dimensions: { width: rail.size[0], height: rail.size[1], depth: rail.size[2] },
        position: rail.position,
        cutFromSheet: true,
      }),
    );
  }
  connections.push(
    createConnection({
      id: 'bed-side-left-head',
      type: 'panel-to-panel',
      componentIds: ['bed-side-rail-left', 'bed-head-rail'],
      position: [-sideRailX, railCentreY, -endRailZ],
      direction: [0, 1, 0],
    }),
    createConnection({
      id: 'bed-side-left-foot',
      type: 'panel-to-panel',
      componentIds: ['bed-side-rail-left', 'bed-foot-rail'],
      position: [-sideRailX, railCentreY, endRailZ],
      direction: [0, 1, 0],
    }),
    createConnection({
      id: 'bed-side-right-head',
      type: 'panel-to-panel',
      componentIds: ['bed-side-rail-right', 'bed-head-rail'],
      position: [sideRailX, railCentreY, -endRailZ],
      direction: [0, 1, 0],
    }),
    createConnection({
      id: 'bed-side-right-foot',
      type: 'panel-to-panel',
      componentIds: ['bed-side-rail-right', 'bed-foot-rail'],
      position: [sideRailX, railCentreY, endRailZ],
      direction: [0, 1, 0],
    }),
  );

  const slatTop = spec.frameHeight - spec.mattressInset;
  const slatPitch = innerLength / (spec.slatCount + 1);
  for (let index = 0; index < spec.slatCount; index += 1) {
    const id = `bed-slat-${index + 1}`;
    const z = -innerLength / 2 + slatPitch * (index + 1);
    parts.push(
      makePart({
        id,
        type: 'shelf',
        role: 'shelf',
        materialSlot: 'structure',
        geometry: {
          kind: 'box',
          width: innerWidth,
          height: spec.slatThickness,
          depth: spec.slatWidth,
        },
        dimensions: {
          width: innerWidth,
          height: spec.slatThickness,
          depth: spec.slatWidth,
        },
        position: [0, slatTop - spec.slatThickness / 2, z],
        cutFromSheet: true,
        metadata: { slat: true, slatIndex: index + 1 },
      }),
    );
    connections.push(
      createConnection({
        id: `${id}-left`,
        type: 'fixed',
        componentIds: [id, 'bed-side-rail-left'],
        position: [-innerWidth / 2, slatTop, z],
        direction: [1, 0, 0],
      }),
      createConnection({
        id: `${id}-right`,
        type: 'fixed',
        componentIds: [id, 'bed-side-rail-right'],
        position: [innerWidth / 2, slatTop, z],
        direction: [-1, 0, 0],
      }),
    );
  }

  const mattressBottom = spec.frameHeight - spec.mattressInset;
  const mattressLength = innerLength - spec.headboardThickness;
  const mattressCentreZ =
    -spec.length / 2 + spec.headboardThickness + mattressLength / 2;
  parts.push(
    makePart({
      id: 'bed-mattress',
      type: 'panel',
      role: 'panel',
      materialSlot: 'mattress',
      geometry: {
        kind: 'roundedBox',
        width: innerWidth,
        height: spec.mattressThickness,
        depth: mattressLength,
        radius: 3,
        segments: 6,
      },
      dimensions: {
        width: innerWidth,
        height: spec.mattressThickness,
        depth: mattressLength,
      },
      position: [0, mattressBottom + spec.mattressThickness / 2, mattressCentreZ],
      metadata: { mattress: true },
      notes: ['Matras — hajmli yumshoq blok; ichki prujina modellashtirilmagan.'],
    }),
  );
  connections.push(
    createConnection({
      id: 'bed-mattress-slat',
      type: 'fixed',
      componentIds: ['bed-mattress', 'bed-slat-1'],
      position: [0, mattressBottom, mattressCentreZ],
      direction: [0, 1, 0],
    }),
  );

  const headboardZ = -spec.length / 2 + spec.headboardThickness / 2;
  parts.push(
    makePart({
      id: 'bed-headboard',
      type: 'panel',
      role: 'panel',
      materialSlot: 'structure',
      geometry: {
        kind: 'box',
        width: spec.headboardWidth,
        height: spec.headboardHeight,
        depth: spec.headboardThickness,
      },
      dimensions: {
        width: spec.headboardWidth,
        height: spec.headboardHeight,
        depth: spec.headboardThickness,
      },
      position: [0, spec.frameHeight + spec.headboardHeight / 2, headboardZ],
      cutFromSheet: true,
      metadata: { headboard: true },
    }),
  );
  connections.push(
    createConnection({
      id: 'bed-headboard-head-rail',
      type: 'fixed',
      componentIds: ['bed-headboard', 'bed-head-rail'],
      position: [0, spec.frameHeight, headboardZ],
      direction: [0, 1, 0],
    }),
  );
  const headboardScrewX = Math.max(spec.headboardWidth / 2 - 15, 2);
  for (const [index, sign] of [1, -1].entries()) {
    const screw = screwPart(`bed-headboard-screw-${index + 1}`, [
      sign * headboardScrewX,
      spec.frameHeight + 2,
      headboardZ,
    ]);
    parts.push(screw);
    connections.push(
      createConnection({
        id: `bed-headboard-screw-${index + 1}-joint`,
        type: 'screw',
        componentIds: ['bed-headboard', 'bed-head-rail'],
        position: screw.position,
        direction: [0, 1, 0],
        hardwareId: screw.id,
      }),
    );
  }

  if (spec.headboardPaddingEnabled) {
    const paddingWidth = spec.headboardWidth - 2 * HEADBOARD_PADDING_MARGIN_CM;
    const paddingHeight = spec.headboardHeight - spec.mattressThickness - 10;
    const paddingThickness = 4;
    const paddingBottom = mattressBottom + spec.mattressThickness + 2;
    parts.push(
      makePart({
        id: 'bed-headboard-padding',
        type: 'panel',
        role: 'panel',
        materialSlot: 'upholstery',
        geometry: {
          kind: 'roundedBox',
          width: paddingWidth,
          height: paddingHeight,
          depth: paddingThickness,
          radius: 1.5,
          segments: 4,
        },
        dimensions: {
          width: paddingWidth,
          height: paddingHeight,
          depth: paddingThickness,
        },
        position: [
          0,
          paddingBottom + paddingHeight / 2,
          headboardZ + spec.headboardThickness / 2 + paddingThickness / 2,
        ],
        metadata: { headboardPadding: true },
        notes: ['Bosh suyanchiq yumshoq qoplamasi.'],
      }),
    );
    connections.push(
      createConnection({
        id: 'bed-headboard-padding-headboard',
        type: 'fixed',
        componentIds: ['bed-headboard-padding', 'bed-headboard'],
        position: [0, paddingBottom + paddingHeight / 2, headboardZ],
        direction: [0, 0, 1],
      }),
    );
  }

  if (spec.footboardEnabled) {
    const footboardZ = spec.length / 2 - spec.frameThickness / 2;
    parts.push(
      makePart({
        id: 'bed-footboard',
        type: 'panel',
        role: 'panel',
        materialSlot: 'structure',
        geometry: {
          kind: 'box',
          width: spec.width,
          height: spec.footboardHeight,
          depth: spec.frameThickness,
        },
        dimensions: {
          width: spec.width,
          height: spec.footboardHeight,
          depth: spec.frameThickness,
        },
        position: [0, spec.frameHeight + spec.footboardHeight / 2, footboardZ],
        cutFromSheet: true,
        metadata: { footboard: true },
      }),
    );
    connections.push(
      createConnection({
        id: 'bed-footboard-left',
        type: 'fixed',
        componentIds: ['bed-footboard', 'bed-side-rail-left'],
        position: [-sideRailX, spec.frameHeight, footboardZ],
        direction: [0, 1, 0],
      }),
      createConnection({
        id: 'bed-footboard-right',
        type: 'fixed',
        componentIds: ['bed-footboard', 'bed-side-rail-right'],
        position: [sideRailX, spec.frameHeight, footboardZ],
        direction: [0, 1, 0],
      }),
    );
  }

  if (spec.centerSupportEnabled) {
    const beamTop = slatTop - spec.slatThickness;
    const beamHeight = CENTER_BEAM_HEIGHT_CM;
    parts.push(
      makePart({
        id: 'bed-center-support',
        type: 'frame',
        role: 'frame',
        materialSlot: 'structure',
        geometry: {
          kind: 'box',
          width: CENTER_BEAM_WIDTH_CM,
          height: beamHeight,
          depth: innerLength,
        },
        dimensions: {
          width: CENTER_BEAM_WIDTH_CM,
          height: beamHeight,
          depth: innerLength,
        },
        position: [0, beamTop - beamHeight / 2, 0],
        metadata: { centerSupport: true },
      }),
    );
    connections.push(
      createConnection({
        id: 'bed-center-support-head',
        type: 'fixed',
        componentIds: ['bed-center-support', 'bed-head-rail'],
        position: [0, beamTop, -endRailZ],
        direction: [0, 1, 0],
      }),
    );
    const centerLegZ = innerLength / 4;
    for (const [index, sign] of [1, -1].entries()) {
      const legId = `bed-center-leg-${index + 1}`;
      parts.push(
        makePart({
          id: legId,
          type: 'leg',
          role: 'leg',
          materialSlot: 'structure',
          geometry: {
            kind: 'box',
            width: spec.legWidth,
            height: spec.legHeight,
            depth: spec.legDepth,
          },
          dimensions: { width: spec.legWidth, height: spec.legHeight, depth: spec.legDepth },
          position: [0, spec.legHeight / 2, sign * centerLegZ],
          metadata: { centerLeg: true },
        }),
      );
      connections.push(
        createConnection({
          id: `${legId}-beam`,
          type: 'fixed',
          componentIds: [legId, 'bed-center-support'],
          position: [0, spec.legHeight, sign * centerLegZ],
          direction: [0, 1, 0],
        }),
      );
    }
    const centerScrew = screwPart('bed-center-screw-1', [0, beamTop + 1, 0]);
    parts.push(centerScrew);
    connections.push(
      createConnection({
        id: 'bed-center-screw-1-joint',
        type: 'screw',
        componentIds: ['bed-center-support', 'bed-slat-1'],
        position: centerScrew.position,
        direction: [0, 1, 0],
        hardwareId: centerScrew.id,
      }),
    );
  }

  const legX = spec.width / 2 - LEG_INSET_CM - spec.legWidth / 2;
  const legZ = spec.length / 2 - LEG_INSET_CM - spec.legDepth / 2;
  const legPlacements = [
    { id: 'bed-leg-head-left', x: -legX, z: -legZ },
    { id: 'bed-leg-head-right', x: legX, z: -legZ },
    { id: 'bed-leg-foot-left', x: -legX, z: legZ },
    { id: 'bed-leg-foot-right', x: legX, z: legZ },
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
        dimensions: { width: spec.legWidth, height: spec.legHeight, depth: spec.legDepth },
        position: [leg.x, spec.legHeight / 2, leg.z],
      }),
    );
    const railId = leg.z < 0 ? 'bed-head-rail' : 'bed-foot-rail';
    connections.push(
      createConnection({
        id: `${leg.id}-rail`,
        type: 'fixed',
        componentIds: [leg.id, railId],
        position: [leg.x, spec.legHeight, leg.z],
        direction: [0, 1, 0],
      }),
    );
    const screw = screwPart(`bed-leg-screw-${index + 1}`, [
      leg.x,
      spec.legHeight - 1,
      leg.z,
    ]);
    parts.push(screw);
    connections.push(
      createConnection({
        id: `bed-leg-screw-${index + 1}-joint`,
        type: 'screw',
        componentIds: [leg.id, railId],
        position: screw.position,
        direction: [0, 1, 0],
        hardwareId: screw.id,
      }),
    );
  }

  return { parts, connections, warnings: [] };
}

export const bedStandardDefinition: FurnitureDefinition<BedStandardSpec> = {
  id: BED_STANDARD_DEFINITION_ID,
  version: 1,
  family: 'bed',
  label: 'Standart ikki kishilik karavot',
  fields: FIELDS,
  defaults: DEFAULT_BED_STANDARD_SPEC,
  slots: SLOTS,
  limits: {
    maxParts: 128,
    maxPartVertices: 50_000,
    maxPartTriangles: 100_000,
    maxTotalVertices: 500_000,
  },
  groupName: 'bed-standard-assembly',
  parseSpec: parseBedStandardSpec,
  solve: solveBedStandardPlan,
};

registerFurnitureDefinition(bedStandardDefinition);
