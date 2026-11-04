/**
 * Stage 2.1a — `desk.computer` definition.
 *
 * This is an adapter, not a second solver: parsing goes through
 * `validateDeskSpec`, geometry comes from `solveDesk`, and the existing
 * `buildDesk` API is untouched. The parity test compares every component and
 * the exported GLB with the Premium Desk builder.
 */
import type {
  ComponentMaterialSlot,
  ComponentPart,
} from '../../components';
import type { DeskMaterialSlot } from '../../furniture/desk';
import {
  DEFAULT_DESK_SPEC,
  solveDesk,
  validateDeskSpec,
  type DeskSpec,
} from '../../furniture/desk';
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

export const DESK_COMPUTER_DEFINITION_ID = 'desk.computer';

type NumericDeskKey = {
  [K in keyof DeskSpec]: DeskSpec[K] extends number ? K : never;
}[keyof DeskSpec];

type BooleanDeskKey = {
  [K in keyof DeskSpec]: DeskSpec[K] extends boolean ? K : never;
}[keyof DeskSpec];

type MutableDeskSpec = { -readonly [K in keyof DeskSpec]: DeskSpec[K] };

const NUMERIC_KEYS: readonly NumericDeskKey[] = [
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
  'supportThickness',
  'cornerRadius',
  'grommetDiameter',
  'drawerWidth',
  'drawerHeight',
  'drawerDepth',
];

const BOOLEAN_KEYS: readonly BooleanDeskKey[] = ['grommetEnabled', 'drawerEnabled'];

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
  { key: 'supportThickness', label: 'Tayanch qalinligi (sm)', kind: 'number' },
  { key: 'cornerRadius', label: 'Burchak radiusi (sm)', kind: 'number' },
  { key: 'grommetEnabled', label: 'Kabel o‘tkazgichi', kind: 'boolean' },
  { key: 'grommetDiameter', label: 'Kabel o‘tkazgichi diametri (sm)', kind: 'number' },
  { key: 'drawerEnabled', label: 'Tortma', kind: 'boolean' },
  { key: 'drawerWidth', label: 'Tortma kengligi (sm)', kind: 'number' },
  { key: 'drawerHeight', label: 'Tortma balandligi (sm)', kind: 'number' },
  { key: 'drawerDepth', label: 'Tortma chuqurligi (sm)', kind: 'number' },
];

const SLOTS: readonly FurnitureSlot[] = [
  {
    id: 'tabletop',
    label: 'Stol usti',
    color: '#a9744f',
    materialId: 'wood-oak',
    groupName: 'desk-tabletop-group',
  },
  {
    id: 'structure',
    label: 'Karkas',
    color: '#3f4650',
    materialId: 'metal-steel',
    groupName: 'desk-structure-group',
  },
  {
    id: 'drawer',
    label: 'Tortma',
    color: '#8b5a2b',
    materialId: 'wood-oak',
    groupName: 'desk-drawer-group',
  },
  {
    id: 'hardware',
    label: 'Furnitura',
    color: '#9aa3ad',
    materialId: 'metal-steel',
    groupName: 'desk-hardware-group',
  },
];

const NO_MANUFACTURING_NOTE =
  'manufacturing: boxCm mavjud emas (geometry to‘rtburchak box emas).';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse untrusted input into a complete DeskSpec.
 *
 * Missing channels take the declared default; present channels must be finite
 * numbers/booleans. Unknown keys are rejected rather than ignored. The result is
 * then checked by `validateDeskSpec` before it can reach the solver.
 */
export function parseDeskSpec(input: unknown): SpecParseResult<DeskSpec> {
  if (!isRecord(input)) {
    return { ok: false, errors: ['DeskSpec: obyekt bo‘lishi kerak.'] };
  }

  const errors: string[] = [];
  for (const key of Object.keys(input)) {
    if (!KNOWN_KEYS.has(key)) {
      errors.push(`DeskSpec.${key}: noma'lum maydon.`);
    }
  }

  const spec: MutableDeskSpec = { ...DEFAULT_DESK_SPEC };
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

  const validation = validateDeskSpec(spec);
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }

  return { ok: true, spec };
}

function deskSlot(slot: ComponentMaterialSlot): DeskMaterialSlot {
  switch (slot) {
    case 'surface':
      return 'tabletop';
    case 'frame':
      return 'structure';
    case 'panel':
      return 'drawer';
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

function toPlanPart(component: ComponentPart): PlanPart {
  const manufacturing = manufacturingFor(component);
  return {
    id: component.id,
    type: component.type,
    role: component.role,
    dimensions: component.dimensions,
    geometry: component.geometry,
    position: component.position,
    rotation: component.rotation,
    materialSlot: deskSlot(component.materialSlot),
    metadata: {
      componentSlot: component.materialSlot,
      componentVersion: component.componentVersion,
    },
    ...(manufacturing ? { manufacturing } : { notes: [NO_MANUFACTURING_NOTE] }),
  };
}

function solveDeskPlan(spec: DeskSpec): FurniturePlanDraft {
  const plan = solveDesk(spec);
  return {
    parts: plan.components.map(toPlanPart),
    connections: plan.connections,
    warnings: plan.warnings,
  };
}

export const deskComputerDefinition: FurnitureDefinition<DeskSpec> = {
  id: DESK_COMPUTER_DEFINITION_ID,
  version: 1,
  family: 'table',
  label: 'Kompyuter stoli',
  fields: FIELDS,
  defaults: DEFAULT_DESK_SPEC,
  slots: SLOTS,
  limits: {
    maxParts: 64,
    maxPartVertices: 50_000,
    maxPartTriangles: 100_000,
    maxTotalVertices: 200_000,
  },
  groupName: 'desk-assembly',
  parseSpec: parseDeskSpec,
  solve: solveDeskPlan,
};

registerFurnitureDefinition(deskComputerDefinition);
