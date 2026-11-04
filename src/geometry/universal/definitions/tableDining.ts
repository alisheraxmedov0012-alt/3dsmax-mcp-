/**
 * Stage 2.1c — `table.dining` definition.
 *
 * A dining table is structurally the common desk frame without storage or cable
 * management: tabletop, four legs, apron/frame, optional support rails and the
 * same fasteners. The base parts come from `solveDesk()`; this adapter only
 * removes the support group when disabled and renames the ids.
 */
import {
  type ComponentConnection,
  type ComponentMaterialSlot,
  type ComponentPart,
} from '../../components';
import { solveDesk, type DeskSpec } from '../../furniture/desk';
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

export const DINING_TABLE_DEFINITION_ID = 'table.dining';

/** Fixed rail thickness used when the optional supports are present, in cm. */
const SUPPORT_THICKNESS_CM = 2;
const NO_MANUFACTURING_NOTE =
  'manufacturing: boxCm mavjud emas (geometry to‘rtburchak box emas).';

const SUPPORT_PART_IDS = [
  'desk-support-front',
  'desk-support-back',
  'desk-screw-1',
  'desk-screw-2',
] as const;

export interface DiningTableSpec {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly tabletopThickness: number;

  readonly legWidth: number;
  readonly legDepth: number;
  readonly legInset: number;

  readonly frameThickness: number;
  readonly frameHeight: number;
  readonly frameInset: number;

  readonly supportEnabled: boolean;
  readonly cornerRadius: number;
}

export const DEFAULT_DINING_TABLE_SPEC: Readonly<DiningTableSpec> = {
  width: 160,
  depth: 90,
  height: 75,
  tabletopThickness: 3,

  legWidth: 7,
  legDepth: 7,
  legInset: 8,

  frameThickness: 3,
  frameHeight: 10,
  frameInset: 5,

  supportEnabled: true,
  cornerRadius: 1,
};

export interface DiningTableSpecValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

type NumericKey = {
  [K in keyof DiningTableSpec]: DiningTableSpec[K] extends number ? K : never;
}[keyof DiningTableSpec];

type BooleanKey = {
  [K in keyof DiningTableSpec]: DiningTableSpec[K] extends boolean ? K : never;
}[keyof DiningTableSpec];

type MutableDiningTableSpec = { -readonly [K in keyof DiningTableSpec]: DiningTableSpec[K] };

const NUMERIC_KEYS: readonly NumericKey[] = [
  'width',
  'depth',
  'height',
  'tabletopThickness',
  'legWidth',
  'legDepth',
  'legInset',
  'frameThickness',
  'frameHeight',
  'frameInset',
  'cornerRadius',
];

const BOOLEAN_KEYS: readonly BooleanKey[] = ['supportEnabled'];

const KNOWN_KEYS = new Set<string>([...NUMERIC_KEYS, ...BOOLEAN_KEYS]);

const FIELDS: readonly DefinitionField[] = [
  { key: 'width', label: 'Kenglik (sm)', kind: 'number' },
  { key: 'depth', label: 'Chuqurlik (sm)', kind: 'number' },
  { key: 'height', label: 'Balandlik (sm)', kind: 'number' },
  { key: 'tabletopThickness', label: 'Stol usti qalinligi (sm)', kind: 'number' },
  { key: 'legWidth', label: 'Oyoq kengligi (sm)', kind: 'number' },
  { key: 'legDepth', label: 'Oyoq chuqurligi (sm)', kind: 'number' },
  { key: 'legInset', label: 'Oyoq chekinishi (sm)', kind: 'number' },
  { key: 'frameThickness', label: 'Karkas qalinligi (sm)', kind: 'number' },
  { key: 'frameHeight', label: 'Karkas balandligi (sm)', kind: 'number' },
  { key: 'frameInset', label: 'Karkas chekinishi (sm)', kind: 'number' },
  { key: 'supportEnabled', label: 'Qo‘shimcha tayanch', kind: 'boolean' },
  { key: 'cornerRadius', label: 'Burchak radiusi (sm)', kind: 'number' },
];

const SLOTS: readonly FurnitureSlot[] = [
  {
    id: 'surface',
    label: 'Stol usti',
    color: '#8b5a2b',
    materialId: 'wood-oak',
    groupName: 'dining-table-surface-group',
  },
  {
    id: 'structure',
    label: 'Konstruksiya',
    color: '#6b4423',
    materialId: 'wood-oak',
    groupName: 'dining-table-structure-group',
  },
  {
    id: 'hardware',
    label: 'Furnitura',
    color: '#9aa3ad',
    materialId: 'metal-steel',
    groupName: 'dining-table-hardware-group',
  },
];

function checkPositive(
  errors: string[],
  spec: DiningTableSpec,
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

export function validateDiningTableSpec(spec: DiningTableSpec): DiningTableSpecValidation {
  const errors: string[] = [];
  const width = checkPositive(errors, spec, 'width');
  const depth = checkPositive(errors, spec, 'depth');
  const height = checkPositive(errors, spec, 'height');
  const tabletopThickness = checkPositive(errors, spec, 'tabletopThickness');
  const legWidth = checkPositive(errors, spec, 'legWidth');
  const legDepth = checkPositive(errors, spec, 'legDepth');
  const legInset = checkPositive(errors, spec, 'legInset', false);
  const frameThickness = checkPositive(errors, spec, 'frameThickness');
  const frameHeight = checkPositive(errors, spec, 'frameHeight');
  const frameInset = checkPositive(errors, spec, 'frameInset', false);
  const cornerRadius = checkPositive(errors, spec, 'cornerRadius', false);

  if (typeof spec.supportEnabled !== 'boolean') {
    errors.push('supportEnabled: boolean bo‘lishi kerak.');
  }

  if (width !== null && legWidth !== null && legInset !== null) {
    if (width <= 2 * legInset + legWidth) {
      errors.push('width: legInset va legWidth stol chetidan chiqmasligi kerak.');
    }
  }
  if (depth !== null && legDepth !== null && legInset !== null) {
    if (depth <= 2 * legInset + legDepth) {
      errors.push('depth: legInset va legDepth stol chetidan chiqmasligi kerak.');
    }
  }
  if (height !== null && tabletopThickness !== null && frameHeight !== null) {
    if (height <= tabletopThickness + frameHeight) {
      errors.push('height: tabletopThickness + frameHeight dan katta bo‘lishi kerak.');
    }
  }
  if (
    width !== null &&
    depth !== null &&
    legWidth !== null &&
    frameInset !== null &&
    frameThickness !== null
  ) {
    const frameWidth = width - 2 * frameInset;
    const frameDepth = depth - 2 * frameInset;
    if (frameWidth <= 0 || frameDepth <= 0) {
      errors.push('frameInset: frame o‘lchamlari noldan katta bo‘lishi kerak.');
    } else if (frameThickness >= Math.min(frameWidth, frameDepth) / 2) {
      errors.push('frameThickness: frame o‘lchamining yarmidan kichik bo‘lishi kerak.');
    } else if (frameDepth <= 3 * frameThickness) {
      errors.push('frameThickness: frame chuqurligi uchun juda katta.');
    }
    if (frameWidth - 2 * frameThickness - 2 * legWidth <= 0) {
      errors.push('legWidth: frame ichki kengligi yetarli emas.');
    }
  }
  if (width !== null && depth !== null && tabletopThickness !== null && cornerRadius !== null) {
    if (cornerRadius >= Math.min(width, depth, tabletopThickness) / 2) {
      errors.push('cornerRadius: tabletop o‘lchamining yarmidan kichik bo‘lishi kerak.');
    }
  }

  return { valid: errors.length === 0, errors };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseDiningTableSpec(input: unknown): SpecParseResult<DiningTableSpec> {
  if (!isRecord(input)) {
    return { ok: false, errors: ['DiningTableSpec: obyekt bo‘lishi kerak.'] };
  }

  const errors: string[] = [];
  for (const key of Object.keys(input)) {
    if (!KNOWN_KEYS.has(key)) {
      errors.push(`DiningTableSpec.${key}: noma'lum maydon.`);
    }
  }

  const spec: MutableDiningTableSpec = { ...DEFAULT_DINING_TABLE_SPEC };
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

  const validation = validateDiningTableSpec(spec);
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }
  return { ok: true, spec };
}

export function createDiningTableSpec(
  overrides: Partial<DiningTableSpec> = {},
): DiningTableSpec {
  return { ...DEFAULT_DINING_TABLE_SPEC, ...overrides };
}

function diningSlot(slot: ComponentMaterialSlot): string {
  switch (slot) {
    case 'surface':
      return 'surface';
    case 'frame':
      return 'structure';
    case 'panel':
      return 'surface';
    case 'hardware':
      return 'hardware';
    default: {
      const exhaustive: never = slot;
      throw new Error(`Noma'lum material slot: ${String(exhaustive)}`);
    }
  }
}

function manufacturingFor(component: ComponentPart): ManufacturingMetadata | undefined {
  if (component.geometry.kind !== 'box') {
    return undefined;
  }
  const cutFromSheet =
    component.type === 'shelf' ||
    component.type === 'drawer' ||
    component.type === 'door' ||
    component.type === 'panel';
  return {
    boxCm: [
      component.geometry.width,
      component.geometry.height,
      component.geometry.depth,
    ],
    cutFromSheet,
  };
}

function toPlanPart(component: ComponentPart, id: string): PlanPart {
  const manufacturing = manufacturingFor(component);
  return {
    id,
    type: component.type,
    role: component.role,
    dimensions: component.dimensions,
    geometry: component.geometry,
    position: component.position,
    rotation: component.rotation,
    materialSlot: diningSlot(component.materialSlot),
    metadata: {
      componentSlot: component.materialSlot,
      componentVersion: component.componentVersion,
    },
    ...(manufacturing
      ? { manufacturing }
      : { notes: [NO_MANUFACTURING_NOTE] }),
  };
}

function baseDeskSpec(spec: DiningTableSpec): DeskSpec {
  return {
    width: spec.width,
    depth: spec.depth,
    height: spec.height,
    tabletopThickness: spec.tabletopThickness,
    legWidth: spec.legWidth,
    legDepth: spec.legDepth,
    legInset: spec.legInset,
    frameThickness: spec.frameThickness,
    frameHeight: spec.frameHeight,
    frameInset: spec.frameInset,
    supportThickness: SUPPORT_THICKNESS_CM,
    cornerRadius: spec.cornerRadius,
    grommetEnabled: false,
    grommetDiameter: 0,
    drawerEnabled: false,
    drawerWidth: 0,
    drawerHeight: 0,
    drawerDepth: 0,
  };
}

function diningId(id: string): string {
  return id.startsWith('desk-') ? `dining-table-${id.slice('desk-'.length)}` : `dining-table-${id}`;
}

function solveDiningPlan(spec: DiningTableSpec): FurniturePlanDraft {
  const base = solveDesk(baseDeskSpec(spec));

  const removed = new Set<string>(spec.supportEnabled ? [] : SUPPORT_PART_IDS);
  const components = base.components.filter((component) => !removed.has(component.id));
  const connections = base.connections.filter(
    (connection) =>
      !connection.componentIds.some((id) => removed.has(id)) &&
      !(connection.hardwareId !== undefined && removed.has(connection.hardwareId)),
  );

  const idMap = new Map<string, string>();
  for (const component of components) {
    idMap.set(component.id, diningId(component.id));
  }
  const mapId = (id: string): string => idMap.get(id) ?? diningId(id);

  const parts = components.map((component) => toPlanPart(component, mapId(component.id)));
  const mappedConnections: ComponentConnection[] = [];
  for (const connection of connections) {
    const [first, second] = connection.componentIds;
    mappedConnections.push({
      ...connection,
      id: diningId(connection.id),
      componentIds: [mapId(first), mapId(second)],
      ...(connection.hardwareId !== undefined
        ? { hardwareId: mapId(connection.hardwareId) }
        : {}),
    });
  }

  return { parts, connections: mappedConnections, warnings: base.warnings };
}

export const diningTableDefinition: FurnitureDefinition<DiningTableSpec> = {
  id: DINING_TABLE_DEFINITION_ID,
  version: 1,
  family: 'table',
  label: 'Ovqat stoli',
  fields: FIELDS,
  defaults: DEFAULT_DINING_TABLE_SPEC,
  slots: SLOTS,
  limits: {
    maxParts: 64,
    maxPartVertices: 50_000,
    maxPartTriangles: 100_000,
    maxTotalVertices: 300_000,
  },
  groupName: 'dining-table-assembly',
  parseSpec: parseDiningTableSpec,
  solve: solveDiningPlan,
};

registerFurnitureDefinition(diningTableDefinition);
