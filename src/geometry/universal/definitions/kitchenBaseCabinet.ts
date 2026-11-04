/**
 * Stage 2.6 — `kitchen.baseCabinet` definition.
 *
 * One 60 cm kitchen base module: panelled carcass, one shelf, two doors with
 * hinges and handles, a countertop with overhangs, and either a toe-kick plinth
 * or four support feet when the plinth is disabled.
 *
 * Height model: plinthHeight + carcassHeight + countertopThickness = totalHeight.
 * The requested default totalHeight (90) with 10 plinth and 3.8 countertop
 * requires carcassHeight = 76.2, so that is the declared default.
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

export const KITCHEN_BASE_CABINET_DEFINITION_ID = 'kitchen.baseCabinet';

const HINGE_RADIUS_CM = 0.6;
const HINGE_HEIGHT_CM = 4;
const DOOR_HANDLE_LENGTH_CM = 10;
const HANDLE_PROJECTION_CM = 2.5;
const HANDLE_DIAMETER_CM = 1.2;
const FOOT_RADIUS_CM = 2;

const NO_MANUFACTURING_NOTE =
  'manufacturing: boxCm mavjud emas (geometry to‘rtburchak box emas).';

export interface KitchenBaseCabinetSpec {
  readonly width: number;
  readonly depth: number;
  readonly totalHeight: number;
  readonly carcassHeight: number;
  readonly panelThickness: number;
  readonly backPanelThickness: number;

  readonly countertopThickness: number;
  readonly countertopOverhangFront: number;
  readonly countertopOverhangSide: number;

  readonly shelfEnabled: boolean;
  readonly shelfThickness: number;

  readonly doorCount: number;
  readonly doorThickness: number;
  readonly doorGap: number;

  readonly plinthEnabled: boolean;
  readonly plinthHeight: number;
  readonly plinthInset: number;

  readonly handleEnabled: boolean;
}

export const DEFAULT_KITCHEN_BASE_CABINET_SPEC: Readonly<KitchenBaseCabinetSpec> = {
  width: 60,
  depth: 60,
  totalHeight: 90,
  carcassHeight: 76.2,
  panelThickness: 2,
  backPanelThickness: 0.6,

  countertopThickness: 3.8,
  countertopOverhangFront: 2,
  countertopOverhangSide: 1,

  shelfEnabled: true,
  shelfThickness: 2,

  doorCount: 2,
  doorThickness: 2,
  doorGap: 0.3,

  plinthEnabled: true,
  plinthHeight: 10,
  plinthInset: 5,

  handleEnabled: true,
};

export interface KitchenBaseCabinetSpecValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

type NumericKey = {
  [K in keyof KitchenBaseCabinetSpec]: KitchenBaseCabinetSpec[K] extends number ? K : never;
}[keyof KitchenBaseCabinetSpec];

type BooleanKey = {
  [K in keyof KitchenBaseCabinetSpec]: KitchenBaseCabinetSpec[K] extends boolean ? K : never;
}[keyof KitchenBaseCabinetSpec];

type MutableKitchenBaseCabinetSpec = {
  -readonly [K in keyof KitchenBaseCabinetSpec]: KitchenBaseCabinetSpec[K];
};

const NUMERIC_KEYS: readonly NumericKey[] = [
  'width',
  'depth',
  'totalHeight',
  'carcassHeight',
  'panelThickness',
  'backPanelThickness',
  'countertopThickness',
  'countertopOverhangFront',
  'countertopOverhangSide',
  'shelfThickness',
  'doorCount',
  'doorThickness',
  'doorGap',
  'plinthHeight',
  'plinthInset',
];

const BOOLEAN_KEYS: readonly BooleanKey[] = [
  'shelfEnabled',
  'plinthEnabled',
  'handleEnabled',
];

const KNOWN_KEYS = new Set<string>([...NUMERIC_KEYS, ...BOOLEAN_KEYS]);

const FIELDS: readonly DefinitionField[] = [
  { key: 'width', label: 'Kenglik (sm)', kind: 'number' },
  { key: 'depth', label: 'Chuqurlik (sm)', kind: 'number' },
  { key: 'totalHeight', label: 'Umumiy balandlik (sm)', kind: 'number' },
  { key: 'carcassHeight', label: 'Karkas balandligi (sm)', kind: 'number' },
  { key: 'panelThickness', label: 'Panel qalinligi (sm)', kind: 'number' },
  { key: 'backPanelThickness', label: 'Orqa panel qalinligi (sm)', kind: 'number' },
  { key: 'countertopThickness', label: 'Ish yuzasi qalinligi (sm)', kind: 'number' },
  { key: 'countertopOverhangFront', label: 'Oldingi osma (sm)', kind: 'number' },
  { key: 'countertopOverhangSide', label: 'Yon osma (sm)', kind: 'number' },
  { key: 'shelfEnabled', label: 'Tokcha', kind: 'boolean' },
  { key: 'shelfThickness', label: 'Tokcha qalinligi (sm)', kind: 'number' },
  { key: 'doorCount', label: 'Eshiklar soni', kind: 'number', integer: true },
  { key: 'doorThickness', label: 'Eshik qalinligi (sm)', kind: 'number' },
  { key: 'doorGap', label: 'Eshiklar orasi (sm)', kind: 'number' },
  { key: 'plinthEnabled', label: 'Plinth', kind: 'boolean' },
  { key: 'plinthHeight', label: 'Plinth balandligi (sm)', kind: 'number' },
  { key: 'plinthInset', label: 'Plinth chekinishi (sm)', kind: 'number' },
  { key: 'handleEnabled', label: 'Tutqichlar', kind: 'boolean' },
];

const SLOTS: readonly FurnitureSlot[] = [
  {
    id: 'structure',
    label: 'Karkas',
    color: '#8b5a2b',
    materialId: 'wood-oak',
    groupName: 'kitchen-base-structure-group',
  },
  {
    id: 'fronts',
    label: 'Fasadlar',
    color: '#a9744f',
    materialId: 'wood-oak',
    groupName: 'kitchen-base-fronts-group',
  },
  {
    id: 'countertop',
    label: 'Ish yuzasi',
    color: '#8c9096',
    materialId: 'plastic-white',
    groupName: 'kitchen-base-countertop-group',
  },
  {
    id: 'hardware',
    label: 'Furnitura',
    color: '#9aa3ad',
    materialId: 'metal-steel',
    groupName: 'kitchen-base-hardware-group',
  },
];

function checkPositive(
  errors: string[],
  spec: KitchenBaseCabinetSpec,
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

export function validateKitchenBaseCabinetSpec(
  spec: KitchenBaseCabinetSpec,
): KitchenBaseCabinetSpecValidation {
  const errors: string[] = [];
  const width = checkPositive(errors, spec, 'width');
  const depth = checkPositive(errors, spec, 'depth');
  const totalHeight = checkPositive(errors, spec, 'totalHeight');
  const carcassHeight = checkPositive(errors, spec, 'carcassHeight');
  const panelThickness = checkPositive(errors, spec, 'panelThickness');
  const backPanelThickness = checkPositive(errors, spec, 'backPanelThickness');
  const countertopThickness = checkPositive(errors, spec, 'countertopThickness');
  const overhangFront = checkPositive(errors, spec, 'countertopOverhangFront', false);
  const overhangSide = checkPositive(errors, spec, 'countertopOverhangSide', false);
  const shelfThickness = checkPositive(errors, spec, 'shelfThickness');
  const doorCount = checkPositive(errors, spec, 'doorCount');
  const doorThickness = checkPositive(errors, spec, 'doorThickness');
  const doorGap = checkPositive(errors, spec, 'doorGap', false);
  const plinthHeight = checkPositive(errors, spec, 'plinthHeight');
  const plinthInset = checkPositive(errors, spec, 'plinthInset', false);

  for (const key of BOOLEAN_KEYS) {
    if (typeof spec[key] !== 'boolean') {
      errors.push(`${key}: boolean bo‘lishi kerak.`);
    }
  }
  if (doorCount !== null && (!Number.isInteger(doorCount) || doorCount !== 2)) {
    errors.push('doorCount: V1 uchun aynan 2 bo‘lishi kerak.');
  }
  if (
    totalHeight !== null &&
    carcassHeight !== null &&
    countertopThickness !== null &&
    plinthHeight !== null
  ) {
    if (totalHeight !== plinthHeight + carcassHeight + countertopThickness) {
      errors.push(
        'totalHeight: plinthHeight + carcassHeight + countertopThickness ga teng bo‘lishi kerak.',
      );
    }
  }
  if (panelThickness !== null && width !== null && carcassHeight !== null && depth !== null) {
    if (panelThickness >= Math.min(width, carcassHeight, depth) / 2) {
      errors.push('panelThickness: o‘lchamning yarmidan kichik bo‘lishi kerak.');
    }
  }
  if (backPanelThickness !== null && depth !== null && backPanelThickness >= depth / 2) {
    errors.push('backPanelThickness: depth ning yarmidan kichik bo‘lishi kerak.');
  }
  if (plinthHeight !== null && plinthHeight <= 0) {
    errors.push('plinthHeight: noldan katta bo‘lishi kerak.');
  }
  if (width !== null && depth !== null && plinthInset !== null) {
    if (width - 2 * plinthInset <= 0) {
      errors.push('plinthInset: plinth kengligi noldan katta bo‘lishi kerak.');
    }
    if (depth - plinthInset <= 0) {
      errors.push('plinthInset: plinth chuqurligi noldan katta bo‘lishi kerak.');
    }
  }
  if (width !== null && panelThickness !== null && doorGap !== null && doorCount !== null) {
    const innerWidth = width - 2 * panelThickness;
    if (innerWidth <= 0) {
      errors.push('panelThickness: ichki kenglik noldan katta bo‘lishi kerak.');
    } else if ((innerWidth - doorGap) / doorCount <= 0) {
      errors.push('doorGap: eshiklar uchun yetarli emas.');
    }
  }
  if (carcassHeight !== null && panelThickness !== null && shelfThickness !== null) {
    const innerHeight = carcassHeight - 2 * panelThickness;
    if (innerHeight <= 0) {
      errors.push('panelThickness: ichki balandlik noldan katta bo‘lishi kerak.');
    } else if (shelfThickness >= innerHeight / 2) {
      errors.push('shelfThickness: ichki balandlikning yarmidan kichik bo‘lishi kerak.');
    }
  }
  if (depth !== null && backPanelThickness !== null && doorThickness !== null) {
    if (depth - backPanelThickness - doorThickness <= 0) {
      errors.push('doorThickness: ichki chuqurlik yetarli emas.');
    }
  }
  if (overhangFront !== null && overhangSide !== null) {
    if (overhangFront < 0 || overhangSide < 0) {
      errors.push('countertopOverhang: manfiy bo‘lmasligi kerak.');
    }
  }

  return { valid: errors.length === 0, errors };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseKitchenBaseCabinetSpec(
  input: unknown,
): SpecParseResult<KitchenBaseCabinetSpec> {
  if (!isRecord(input)) {
    return { ok: false, errors: ['KitchenBaseCabinetSpec: obyekt bo‘lishi kerak.'] };
  }

  const errors: string[] = [];
  for (const key of Object.keys(input)) {
    if (!KNOWN_KEYS.has(key)) {
      errors.push(`KitchenBaseCabinetSpec.${key}: noma'lum maydon.`);
    }
  }

  const spec: MutableKitchenBaseCabinetSpec = { ...DEFAULT_KITCHEN_BASE_CABINET_SPEC };
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

  const validation = validateKitchenBaseCabinetSpec(spec);
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }
  return { ok: true, spec };
}

export function createKitchenBaseCabinetSpec(
  overrides: Partial<KitchenBaseCabinetSpec> = {},
): KitchenBaseCabinetSpec {
  return { ...DEFAULT_KITCHEN_BASE_CABINET_SPEC, ...overrides };
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

function solveKitchenBaseCabinetPlan(
  spec: KitchenBaseCabinetSpec,
): FurniturePlanDraft {
  const parts: PlanPart[] = [];
  const connections: ComponentConnection[] = [];
  const innerWidth = spec.width - 2 * spec.panelThickness;
  const innerHeight = spec.carcassHeight - 2 * spec.panelThickness;
  const innerDepth = spec.depth - spec.backPanelThickness;
  const carcassBottom = spec.plinthHeight;
  const carcassTop = carcassBottom + spec.carcassHeight;
  const carcassCentreY = carcassBottom + spec.carcassHeight / 2;
  const sideX = spec.width / 2 - spec.panelThickness / 2;

  const carcassParts: Array<{ id: string; size: Vec3Tuple; position: Vec3Tuple }> = [
    {
      id: 'kitchen-base-side-left',
      size: [spec.panelThickness, spec.carcassHeight, spec.depth],
      position: [-sideX, carcassCentreY, 0],
    },
    {
      id: 'kitchen-base-side-right',
      size: [spec.panelThickness, spec.carcassHeight, spec.depth],
      position: [sideX, carcassCentreY, 0],
    },
    {
      id: 'kitchen-base-top',
      size: [innerWidth, spec.panelThickness, spec.depth],
      position: [0, carcassTop - spec.panelThickness / 2, 0],
    },
    {
      id: 'kitchen-base-bottom',
      size: [innerWidth, spec.panelThickness, spec.depth],
      position: [0, carcassBottom + spec.panelThickness / 2, 0],
    },
    {
      id: 'kitchen-base-back',
      size: [innerWidth, innerHeight, spec.backPanelThickness],
      position: [0, carcassCentreY, -(spec.depth / 2 - spec.backPanelThickness / 2)],
    },
  ];
  for (const panel of carcassParts) {
    parts.push(
      makePart({
        id: panel.id,
        type: 'panel',
        role: 'panel',
        materialSlot: 'structure',
        geometry: {
          kind: 'box',
          width: panel.size[0],
          height: panel.size[1],
          depth: panel.size[2],
        },
        dimensions: {
          width: panel.size[0],
          height: panel.size[1],
          depth: panel.size[2],
        },
        position: panel.position,
        cutFromSheet: true,
      }),
    );
  }
  connections.push(
    createConnection({
      id: 'kitchen-base-top-left',
      type: 'panel-to-panel',
      componentIds: ['kitchen-base-top', 'kitchen-base-side-left'],
      position: [-sideX, carcassTop, 0],
      direction: [0, 1, 0],
    }),
    createConnection({
      id: 'kitchen-base-top-right',
      type: 'panel-to-panel',
      componentIds: ['kitchen-base-top', 'kitchen-base-side-right'],
      position: [sideX, carcassTop, 0],
      direction: [0, 1, 0],
    }),
    createConnection({
      id: 'kitchen-base-bottom-left',
      type: 'panel-to-panel',
      componentIds: ['kitchen-base-bottom', 'kitchen-base-side-left'],
      position: [-sideX, carcassBottom, 0],
      direction: [0, 1, 0],
    }),
    createConnection({
      id: 'kitchen-base-bottom-right',
      type: 'panel-to-panel',
      componentIds: ['kitchen-base-bottom', 'kitchen-base-side-right'],
      position: [sideX, carcassBottom, 0],
      direction: [0, 1, 0],
    }),
    createConnection({
      id: 'kitchen-base-back-bottom',
      type: 'fixed',
      componentIds: ['kitchen-base-back', 'kitchen-base-bottom'],
      position: [0, carcassBottom, -spec.depth / 2],
      direction: [0, 1, 0],
    }),
  );

  const countertopWidth = spec.width + 2 * spec.countertopOverhangSide;
  const countertopDepth = spec.depth + spec.countertopOverhangFront;
  const countertopZ = spec.countertopOverhangFront / 2;
  parts.push(
    makePart({
      id: 'kitchen-base-countertop',
      type: 'panel',
      role: 'panel',
      materialSlot: 'countertop',
      geometry: {
        kind: 'box',
        width: countertopWidth,
        height: spec.countertopThickness,
        depth: countertopDepth,
      },
      dimensions: {
        width: countertopWidth,
        height: spec.countertopThickness,
        depth: countertopDepth,
      },
      position: [0, carcassTop + spec.countertopThickness / 2, countertopZ],
      cutFromSheet: true,
      metadata: { countertop: true },
    }),
  );
  connections.push(
    createConnection({
      id: 'kitchen-base-countertop-top',
      type: 'fixed',
      componentIds: ['kitchen-base-countertop', 'kitchen-base-top'],
      position: [0, carcassTop, 0],
      direction: [0, 1, 0],
    }),
  );

  if (spec.shelfEnabled) {
    const shelfY = carcassBottom + spec.carcassHeight / 2;
    parts.push(
      makePart({
        id: 'kitchen-base-shelf',
        type: 'shelf',
        role: 'shelf',
        materialSlot: 'structure',
        geometry: {
          kind: 'box',
          width: innerWidth,
          height: spec.shelfThickness,
          depth: innerDepth,
        },
        dimensions: {
          width: innerWidth,
          height: spec.shelfThickness,
          depth: innerDepth,
        },
        position: [0, shelfY, spec.backPanelThickness / 2],
        cutFromSheet: true,
        metadata: { shelf: true },
      }),
    );
    connections.push(
      createConnection({
        id: 'kitchen-base-shelf-left',
        type: 'panel-to-panel',
        componentIds: ['kitchen-base-shelf', 'kitchen-base-side-left'],
        position: [-innerWidth / 2, shelfY, 0],
        direction: [0, 1, 0],
      }),
      createConnection({
        id: 'kitchen-base-shelf-right',
        type: 'panel-to-panel',
        componentIds: ['kitchen-base-shelf', 'kitchen-base-side-right'],
        position: [innerWidth / 2, shelfY, 0],
        direction: [0, 1, 0],
      }),
    );
  }

  const doorWidth = (innerWidth - spec.doorGap) / 2;
  const doorHeight = spec.carcassHeight - 2 * spec.doorGap;
  const doorCentreY = carcassBottom + spec.carcassHeight / 2;
  const doorZ = spec.depth / 2 - spec.doorThickness / 2;
  const doorCentres = [-doorWidth / 2 - spec.doorGap / 2, doorWidth / 2 + spec.doorGap / 2];
  for (const [index, x] of doorCentres.entries()) {
    const side = index === 0 ? 'left' : 'right';
    const doorId = `kitchen-base-door-${side}`;
    const door = createComponent(
      'door',
      doorId,
      {
        width: doorWidth,
        height: doorHeight,
        thickness: spec.doorThickness,
        cornerRadius: 0,
        segments: 4,
      },
      { position: [x, doorCentreY, doorZ], materialSlot: 'panel' },
    );
    parts.push(
      makePart({
        id: door.id,
        type: door.type,
        role: door.role,
        materialSlot: 'fronts',
        geometry: door.geometry,
        dimensions: door.dimensions,
        position: door.position,
        rotation: door.rotation,
        cutFromSheet: true,
        metadata: { componentVersion: door.componentVersion },
      }),
    );

    for (const [hingeIndex, y] of [
      carcassBottom + 8,
      carcassTop - 8,
    ].entries()) {
      const hingeId = `kitchen-base-hinge-${side}-${hingeIndex + 1}`;
      const hinge = makePart({
        id: hingeId,
        type: 'support',
        role: 'support',
        materialSlot: 'hardware',
        geometry: {
          kind: 'cylinder',
          radiusTop: HINGE_RADIUS_CM,
          radiusBottom: HINGE_RADIUS_CM,
          height: HINGE_HEIGHT_CM,
          radialSegments: 12,
        },
        dimensions: {
          width: HINGE_RADIUS_CM * 2,
          height: HINGE_HEIGHT_CM,
          depth: HINGE_RADIUS_CM * 2,
        },
        position: [
          x + (index === 0 ? -doorWidth / 2 + 1 : doorWidth / 2 - 1),
          y,
          doorZ,
        ],
        metadata: { hinge: true, doorId },
        notes: ['Eshik halqasi statik silindr sifatida ifodalangan; harakat yo‘q.'],
      });
      parts.push(hinge);
      connections.push(
        createConnection({
          id: `${hingeId}-door`,
          type: 'fixed',
          componentIds: [hingeId, doorId],
          position: hinge.position,
          direction: [0, 1, 0],
        }),
        createConnection({
          id: `${hingeId}-carcass`,
          type: 'fixed',
          componentIds: [hingeId, index === 0 ? 'kitchen-base-side-left' : 'kitchen-base-side-right'],
          position: hinge.position,
          direction: [1, 0, 0],
        }),
      );
    }

    if (spec.handleEnabled) {
      const handleId = `kitchen-base-door-handle-${side}`;
      const handle = createComponent(
        'handle',
        handleId,
        {
          type: 'bar',
          length: DOOR_HANDLE_LENGTH_CM,
          diameter: HANDLE_DIAMETER_CM,
          projection: HANDLE_PROJECTION_CM,
          mountingDistance: DOOR_HANDLE_LENGTH_CM - 2,
          segments: 20,
        },
        {
          position: [
            x + (index === 0 ? doorWidth / 2 - 4 : -doorWidth / 2 + 4),
            doorCentreY,
            doorZ + spec.doorThickness / 2 + HANDLE_PROJECTION_CM / 2,
          ],
          rotation: [90, 0, 0],
          materialSlot: 'hardware',
        },
      );
      parts.push(
        makePart({
          id: handle.id,
          type: handle.type,
          role: handle.role,
          materialSlot: 'hardware',
          geometry: handle.geometry,
          dimensions: handle.dimensions,
          position: handle.position,
          rotation: handle.rotation,
          metadata: { componentVersion: handle.componentVersion },
        }),
      );
      connections.push(
        createConnection({
          id: `${handleId}-door`,
          type: 'fixed',
          componentIds: [handleId, doorId],
          position: handle.position,
          direction: [0, 0, 1],
        }),
      );
    }
  }

  if (spec.plinthEnabled) {
    const plinthWidth = spec.width - 2 * spec.plinthInset;
    const plinthDepth = spec.depth - spec.plinthInset;
    parts.push(
      makePart({
        id: 'kitchen-base-plinth',
        type: 'panel',
        role: 'panel',
        materialSlot: 'structure',
        geometry: {
          kind: 'box',
          width: plinthWidth,
          height: spec.plinthHeight,
          depth: plinthDepth,
        },
        dimensions: {
          width: plinthWidth,
          height: spec.plinthHeight,
          depth: plinthDepth,
        },
        position: [0, spec.plinthHeight / 2, -spec.plinthInset / 2],
        cutFromSheet: true,
        metadata: { plinth: true },
      }),
    );
    connections.push(
      createConnection({
        id: 'kitchen-base-plinth-bottom',
        type: 'fixed',
        componentIds: ['kitchen-base-plinth', 'kitchen-base-bottom'],
        position: [0, spec.plinthHeight, 0],
        direction: [0, 1, 0],
      }),
    );
  } else {
    const footX = spec.width / 2 - 4;
    const footZ = spec.depth / 2 - 4;
    for (const [index, position] of [
      [-footX, -footZ],
      [footX, -footZ],
      [-footX, footZ],
      [footX, footZ],
    ].entries()) {
      const footId = `kitchen-base-foot-${index + 1}`;
      parts.push(
        makePart({
          id: footId,
          type: 'foot',
          role: 'foot',
          materialSlot: 'structure',
          geometry: {
            kind: 'cylinder',
            radiusTop: FOOT_RADIUS_CM,
            radiusBottom: FOOT_RADIUS_CM,
            height: spec.plinthHeight,
            radialSegments: 16,
          },
          dimensions: {
            width: FOOT_RADIUS_CM * 2,
            height: spec.plinthHeight,
            depth: FOOT_RADIUS_CM * 2,
          },
          position: [position[0], spec.plinthHeight / 2, position[1]],
          metadata: { supportFoot: true },
          notes: ['Plinth o‘chirilganda korpusni ko‘taruvchi statik tayanch.'],
        }),
      );
      connections.push(
        createConnection({
          id: `${footId}-bottom`,
          type: 'fixed',
          componentIds: [footId, 'kitchen-base-bottom'],
          position: [position[0], spec.plinthHeight, position[1]],
          direction: [0, 1, 0],
        }),
      );
    }
  }

  return { parts, connections, warnings: [] };
}

export const kitchenBaseCabinetDefinition: FurnitureDefinition<KitchenBaseCabinetSpec> = {
  id: KITCHEN_BASE_CABINET_DEFINITION_ID,
  version: 1,
  family: 'dresser',
  label: 'Oshxona pastki shkafi',
  fields: FIELDS,
  defaults: DEFAULT_KITCHEN_BASE_CABINET_SPEC,
  slots: SLOTS,
  limits: {
    maxParts: 64,
    maxPartVertices: 50_000,
    maxPartTriangles: 100_000,
    maxTotalVertices: 300_000,
  },
  groupName: 'kitchen-base-cabinet-assembly',
  parseSpec: parseKitchenBaseCabinetSpec,
  solve: solveKitchenBaseCabinetPlan,
};

registerFurnitureDefinition(kitchenBaseCabinetDefinition);
