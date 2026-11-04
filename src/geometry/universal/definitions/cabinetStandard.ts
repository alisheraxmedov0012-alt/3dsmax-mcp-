/**
 * Stage 2.4 — `cabinet.standard` definition.
 *
 * Two-door, two-drawer floor cabinet: panelled carcass, optional shelf, two
 * flush doors with hinges, two drawer assemblies with fronts and handles, and
 * four legs. Static V1: no door swing or drawer travel.
 */
import {
  createComponent,
  createConnection,
  type ComponentConnection,
  type ComponentPart,
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

export const CABINET_STANDARD_DEFINITION_ID = 'cabinet.standard';

const LEG_INSET_CM = 5;
const DOOR_GAP_CM = 1;
const DRAWER_SIDE_CLEARANCE_CM = 1;
const DRAWER_SIDE_THICKNESS_CM = 1.5;
const DRAWER_BOTTOM_THICKNESS_CM = 1;
const HINGE_RADIUS_CM = 0.6;
const HINGE_HEIGHT_CM = 4;
const DOOR_HANDLE_LENGTH_CM = 12;
const DRAWER_HANDLE_LENGTH_CM = 16;
const HANDLE_PROJECTION_CM = 2.5;
const HANDLE_DIAMETER_CM = 1.2;
const SCREW_DIAMETERS = {
  shaftDiameter: 0.4,
  length: 3,
  headDiameter: 0.8,
  headHeight: 0.4,
} as const;

const NO_MANUFACTURING_NOTE =
  'manufacturing: boxCm mavjud emas (geometry to‘rtburchak box emas).';

export interface CabinetStandardSpec {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly panelThickness: number;
  readonly backPanelThickness: number;

  readonly shelfCount: number;
  readonly doorCount: number;
  readonly drawerCount: number;

  readonly doorThickness: number;
  readonly drawerHeight: number;
  readonly drawerDepth: number;
  readonly shelfThickness: number;

  readonly legHeight: number;
  readonly legWidth: number;
  readonly legDepth: number;

  readonly handleEnabled: boolean;
  readonly doorsEnabled: boolean;
  readonly drawersEnabled: boolean;
  readonly shelfEnabled: boolean;
}

export const DEFAULT_CABINET_STANDARD_SPEC: Readonly<CabinetStandardSpec> = {
  width: 120,
  height: 100,
  depth: 45,
  panelThickness: 2,
  backPanelThickness: 0.6,

  shelfCount: 1,
  doorCount: 2,
  drawerCount: 2,

  doorThickness: 2,
  drawerHeight: 18,
  drawerDepth: 38,
  shelfThickness: 2,

  legHeight: 10,
  legWidth: 5,
  legDepth: 5,

  handleEnabled: true,
  doorsEnabled: true,
  drawersEnabled: true,
  shelfEnabled: true,
};

export interface CabinetStandardSpecValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

type NumericKey = {
  [K in keyof CabinetStandardSpec]: CabinetStandardSpec[K] extends number ? K : never;
}[keyof CabinetStandardSpec];

type BooleanKey = {
  [K in keyof CabinetStandardSpec]: CabinetStandardSpec[K] extends boolean ? K : never;
}[keyof CabinetStandardSpec];

type MutableCabinetStandardSpec = {
  -readonly [K in keyof CabinetStandardSpec]: CabinetStandardSpec[K];
};

const NUMERIC_KEYS: readonly NumericKey[] = [
  'width',
  'height',
  'depth',
  'panelThickness',
  'backPanelThickness',
  'shelfCount',
  'doorCount',
  'drawerCount',
  'doorThickness',
  'drawerHeight',
  'drawerDepth',
  'shelfThickness',
  'legHeight',
  'legWidth',
  'legDepth',
];

const BOOLEAN_KEYS: readonly BooleanKey[] = [
  'handleEnabled',
  'doorsEnabled',
  'drawersEnabled',
  'shelfEnabled',
];

const KNOWN_KEYS = new Set<string>([...NUMERIC_KEYS, ...BOOLEAN_KEYS]);

const FIELDS: readonly DefinitionField[] = [
  { key: 'width', label: 'Kenglik (sm)', kind: 'number' },
  { key: 'height', label: 'Balandlik (sm)', kind: 'number' },
  { key: 'depth', label: 'Chuqurlik (sm)', kind: 'number' },
  { key: 'panelThickness', label: 'Panel qalinligi (sm)', kind: 'number' },
  { key: 'backPanelThickness', label: 'Orqa panel qalinligi (sm)', kind: 'number' },
  { key: 'shelfCount', label: 'Tokchalar soni', kind: 'number', integer: true },
  { key: 'doorCount', label: 'Eshiklar soni', kind: 'number', integer: true },
  { key: 'drawerCount', label: 'Tortmalar soni', kind: 'number', integer: true },
  { key: 'doorThickness', label: 'Eshik qalinligi (sm)', kind: 'number' },
  { key: 'drawerHeight', label: 'Tortma balandligi (sm)', kind: 'number' },
  { key: 'drawerDepth', label: 'Tortma chuqurligi (sm)', kind: 'number' },
  { key: 'shelfThickness', label: 'Tokcha qalinligi (sm)', kind: 'number' },
  { key: 'legHeight', label: 'Oyoq balandligi (sm)', kind: 'number' },
  { key: 'legWidth', label: 'Oyoq kengligi (sm)', kind: 'number' },
  { key: 'legDepth', label: 'Oyoq chuqurligi (sm)', kind: 'number' },
  { key: 'handleEnabled', label: 'Tutqichlar', kind: 'boolean' },
  { key: 'doorsEnabled', label: 'Eshiklar', kind: 'boolean' },
  { key: 'drawersEnabled', label: 'Tortmalar', kind: 'boolean' },
  { key: 'shelfEnabled', label: 'Tokcha', kind: 'boolean' },
];

const SLOTS: readonly FurnitureSlot[] = [
  {
    id: 'structure',
    label: 'Karkas',
    color: '#8b5a2b',
    materialId: 'wood-oak',
    groupName: 'cabinet-structure-group',
  },
  {
    id: 'fronts',
    label: 'Fasadlar',
    color: '#a9744f',
    materialId: 'wood-oak',
    groupName: 'cabinet-fronts-group',
  },
  {
    id: 'hardware',
    label: 'Furnitura',
    color: '#9aa3ad',
    materialId: 'metal-steel',
    groupName: 'cabinet-hardware-group',
  },
];

function checkPositive(
  errors: string[],
  spec: CabinetStandardSpec,
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

export function validateCabinetStandardSpec(
  spec: CabinetStandardSpec,
): CabinetStandardSpecValidation {
  const errors: string[] = [];
  const width = checkPositive(errors, spec, 'width');
  const height = checkPositive(errors, spec, 'height');
  const depth = checkPositive(errors, spec, 'depth');
  const panelThickness = checkPositive(errors, spec, 'panelThickness');
  const backPanelThickness = checkPositive(errors, spec, 'backPanelThickness');
  const shelfCount = checkPositive(errors, spec, 'shelfCount', false);
  const doorCount = checkPositive(errors, spec, 'doorCount');
  const drawerCount = checkPositive(errors, spec, 'drawerCount');
  const doorThickness = checkPositive(errors, spec, 'doorThickness');
  const drawerHeight = checkPositive(errors, spec, 'drawerHeight');
  const drawerDepth = checkPositive(errors, spec, 'drawerDepth');
  const shelfThickness = checkPositive(errors, spec, 'shelfThickness');
  const legHeight = checkPositive(errors, spec, 'legHeight', false);
  const legWidth = checkPositive(errors, spec, 'legWidth');
  const legDepth = checkPositive(errors, spec, 'legDepth');

  for (const key of BOOLEAN_KEYS) {
    if (typeof spec[key] !== 'boolean') {
      errors.push(`${key}: boolean bo‘lishi kerak.`);
    }
  }
  if (doorCount !== null && (!Number.isInteger(doorCount) || doorCount !== 2)) {
    errors.push('doorCount: V1 uchun aynan 2 bo‘lishi kerak.');
  }
  if (drawerCount !== null && (!Number.isInteger(drawerCount) || drawerCount !== 2)) {
    errors.push('drawerCount: V1 uchun aynan 2 bo‘lishi kerak.');
  }
  if (shelfCount !== null && (!Number.isInteger(shelfCount) || (shelfCount !== 0 && shelfCount !== 1))) {
    errors.push('shelfCount: 0 yoki 1 bo‘lishi kerak.');
  }
  if (panelThickness !== null && width !== null && height !== null && depth !== null) {
    if (panelThickness >= Math.min(width, height, depth) / 2) {
      errors.push('panelThickness: tashqi o‘lchamning yarmidan kichik bo‘lishi kerak.');
    }
  }
  if (backPanelThickness !== null && depth !== null && backPanelThickness >= depth / 2) {
    errors.push('backPanelThickness: depth ning yarmidan kichik bo‘lishi kerak.');
  }
  if (legHeight !== null && height !== null && legHeight >= height) {
    errors.push('legHeight: height dan kichik bo‘lishi kerak.');
  }
  if (width !== null && legWidth !== null && width <= 2 * (LEG_INSET_CM + legWidth)) {
    errors.push('width: oyoqlar cabinet chetidan chiqib ketadi.');
  }
  if (depth !== null && legDepth !== null && depth <= 2 * (LEG_INSET_CM + legDepth)) {
    errors.push('depth: oyoqlar cabinet chetidan chiqib ketadi.');
  }

  if (
    width !== null &&
    height !== null &&
    depth !== null &&
    panelThickness !== null &&
    backPanelThickness !== null &&
    legHeight !== null &&
    drawerHeight !== null &&
    drawerCount !== null &&
    doorThickness !== null
  ) {
    const carcassHeight = height - legHeight;
    const innerWidth = width - 2 * panelThickness;
    const innerHeight = carcassHeight - 2 * panelThickness;
    const innerDepth = depth - backPanelThickness;
    const drawerZoneHeight = drawerCount * drawerHeight;
    const doorZoneBottom = legHeight + drawerZoneHeight;
    const doorZoneTop = height - panelThickness;

    if (innerWidth <= 0 || innerHeight <= 0 || innerDepth <= 0) {
      errors.push('panelThickness: ichki hajm noldan katta bo‘lishi kerak.');
    }
    if (doorZoneTop <= doorZoneBottom) {
      errors.push('drawerHeight: eshiklar uchun vertikal joy qolmaydi.');
    }
    if (innerWidth - DOOR_GAP_CM <= 0) {
      errors.push('width: ikkita eshik uchun yetarli emas.');
    }
    if (drawerDepth !== null && innerDepth - doorThickness <= 0) {
      errors.push('drawerDepth: ichki chuqurlik yetarli emas.');
    }
    if (drawerDepth !== null && drawerDepth > innerDepth - doorThickness) {
      errors.push('drawerDepth: karkas ichki chuqurligidan oshadi.');
    }
    if (shelfThickness !== null && shelfThickness >= innerHeight / 2) {
      errors.push('shelfThickness: ichki balandlikning yarmidan kichik bo‘lishi kerak.');
    }
    if (doorThickness !== null && doorThickness >= (doorZoneTop - doorZoneBottom) / 2) {
      errors.push('doorThickness: eshik balandligiga nisbatan juda katta.');
    }
    if (drawerHeight !== null && drawerZoneHeight + panelThickness >= carcassHeight) {
      errors.push('drawerHeight: karkas balandligidan chiqib ketadi.');
    }
    if (drawerCount !== null && drawerHeight !== null && drawerCount * drawerHeight <= 0) {
      errors.push('drawerHeight: tortmalar uchun musbat balandlik kerak.');
    }
  }

  return { valid: errors.length === 0, errors };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseCabinetStandardSpec(
  input: unknown,
): SpecParseResult<CabinetStandardSpec> {
  if (!isRecord(input)) {
    return { ok: false, errors: ['CabinetStandardSpec: obyekt bo‘lishi kerak.'] };
  }

  const errors: string[] = [];
  for (const key of Object.keys(input)) {
    if (!KNOWN_KEYS.has(key)) {
      errors.push(`CabinetStandardSpec.${key}: noma'lum maydon.`);
    }
  }

  const spec: MutableCabinetStandardSpec = { ...DEFAULT_CABINET_STANDARD_SPEC };
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

  const validation = validateCabinetStandardSpec(spec);
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }
  return { ok: true, spec };
}

export function createCabinetStandardSpec(
  overrides: Partial<CabinetStandardSpec> = {},
): CabinetStandardSpec {
  return { ...DEFAULT_CABINET_STANDARD_SPEC, ...overrides };
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

function componentPart(
  component: ComponentPart,
  slot: string,
  cutFromSheet = false,
  extraMetadata: Readonly<Record<string, unknown>> = {},
): PlanPart {
  const manufacturing = manufacturingForGeometry(component.geometry, cutFromSheet);
  return {
    id: component.id,
    type: component.type,
    role: component.role,
    dimensions: component.dimensions,
    geometry: component.geometry,
    position: component.position,
    rotation: component.rotation,
    materialSlot: slot,
    metadata: {
      componentSlot: component.materialSlot,
      componentVersion: component.componentVersion,
      ...extraMetadata,
    },
    ...(manufacturing
      ? { manufacturing }
      : { notes: [NO_MANUFACTURING_NOTE] }),
  };
}

function screwPart(id: string, position: Vec3Tuple): PlanPart {
  const screw = createComponent('screw', id, SCREW_DIAMETERS, {
    position,
    materialSlot: 'hardware',
  });
  return componentPart(screw, 'hardware');
}

function solveCabinetStandardPlan(spec: CabinetStandardSpec): FurniturePlanDraft {
  const parts: PlanPart[] = [];
  const connections: ComponentConnection[] = [];
  const carcassHeight = spec.height - spec.legHeight;
  const innerWidth = spec.width - 2 * spec.panelThickness;
  const innerHeight = carcassHeight - 2 * spec.panelThickness;
  const innerDepth = spec.depth - spec.backPanelThickness;
  const drawerZoneHeight = spec.drawerCount * spec.drawerHeight;
  const doorZoneBottom = spec.legHeight + drawerZoneHeight;
  const doorZoneTop = spec.height - spec.panelThickness;
  const doorHeight = doorZoneTop - doorZoneBottom;
  const doorWidth = (innerWidth - DOOR_GAP_CM) / 2;
  const drawerWidth = innerWidth - 2 * DRAWER_SIDE_CLEARANCE_CM;
  const frontZ = spec.depth / 2 - spec.doorThickness / 2;
  const drawerBodyZ = frontZ - spec.doorThickness / 2 - spec.drawerDepth / 2;

  const sideLeft = -spec.width / 2 + spec.panelThickness / 2;
  const sideRight = spec.width / 2 - spec.panelThickness / 2;
  const carcassY = spec.legHeight + carcassHeight / 2;

  const carcassParts: Array<{ id: string; size: Vec3Tuple; position: Vec3Tuple }> = [
    {
      id: 'cabinet-side-left',
      size: [spec.panelThickness, carcassHeight, spec.depth],
      position: [sideLeft, carcassY, 0],
    },
    {
      id: 'cabinet-side-right',
      size: [spec.panelThickness, carcassHeight, spec.depth],
      position: [sideRight, carcassY, 0],
    },
    {
      id: 'cabinet-top',
      size: [innerWidth, spec.panelThickness, spec.depth],
      position: [0, spec.height - spec.panelThickness / 2, 0],
    },
    {
      id: 'cabinet-bottom',
      size: [innerWidth, spec.panelThickness, spec.depth],
      position: [0, spec.legHeight + spec.panelThickness / 2, 0],
    },
    {
      id: 'cabinet-back',
      size: [innerWidth, innerHeight, spec.backPanelThickness],
      position: [0, carcassY, -(spec.depth / 2 - spec.backPanelThickness / 2)],
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
      id: 'cabinet-top-left',
      type: 'panel-to-panel',
      componentIds: ['cabinet-top', 'cabinet-side-left'],
      position: [sideLeft, spec.height - spec.panelThickness, 0],
      direction: [0, 1, 0],
    }),
    createConnection({
      id: 'cabinet-top-right',
      type: 'panel-to-panel',
      componentIds: ['cabinet-top', 'cabinet-side-right'],
      position: [sideRight, spec.height - spec.panelThickness, 0],
      direction: [0, 1, 0],
    }),
    createConnection({
      id: 'cabinet-bottom-left',
      type: 'panel-to-panel',
      componentIds: ['cabinet-bottom', 'cabinet-side-left'],
      position: [sideLeft, spec.legHeight + spec.panelThickness, 0],
      direction: [0, 1, 0],
    }),
    createConnection({
      id: 'cabinet-bottom-right',
      type: 'panel-to-panel',
      componentIds: ['cabinet-bottom', 'cabinet-side-right'],
      position: [sideRight, spec.legHeight + spec.panelThickness, 0],
      direction: [0, 1, 0],
    }),
    createConnection({
      id: 'cabinet-back-bottom',
      type: 'fixed',
      componentIds: ['cabinet-back', 'cabinet-bottom'],
      position: [0, spec.legHeight + spec.panelThickness, -spec.depth / 2],
      direction: [0, 1, 0],
    }),
  );

  if (spec.shelfEnabled && spec.shelfCount === 1) {
    const shelfY = doorZoneBottom + doorHeight / 2;
    parts.push(
      makePart({
        id: 'cabinet-shelf',
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
        id: 'cabinet-shelf-left',
        type: 'panel-to-panel',
        componentIds: ['cabinet-shelf', 'cabinet-side-left'],
        position: [-innerWidth / 2, shelfY, 0],
        direction: [0, 1, 0],
      }),
      createConnection({
        id: 'cabinet-shelf-right',
        type: 'panel-to-panel',
        componentIds: ['cabinet-shelf', 'cabinet-side-right'],
        position: [innerWidth / 2, shelfY, 0],
        direction: [0, 1, 0],
      }),
    );
  }

  if (spec.doorsEnabled) {
    const doorCentres = [-doorWidth / 2 - DOOR_GAP_CM / 2, doorWidth / 2 + DOOR_GAP_CM / 2];
    for (const [index, x] of doorCentres.entries()) {
      const side = index === 0 ? 'left' : 'right';
      const doorId = `cabinet-door-${side}`;
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
        { position: [x, doorZoneBottom + doorHeight / 2, frontZ], materialSlot: 'panel' },
      );
      parts.push(componentPart(door, 'fronts', true));

      for (const [hingeIndex, y] of [
        doorZoneBottom + 8,
        doorZoneTop - 8,
      ].entries()) {
        const hingeId = `cabinet-hinge-${side}-${hingeIndex + 1}`;
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
          position: [x + (index === 0 ? -doorWidth / 2 + 1 : doorWidth / 2 - 1), y, frontZ],
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
            componentIds: [hingeId, index === 0 ? 'cabinet-side-left' : 'cabinet-side-right'],
            position: hinge.position,
            direction: [1, 0, 0],
          }),
        );
      }

      if (spec.handleEnabled) {
        const handleId = `cabinet-door-handle-${side}`;
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
              x + (index === 0 ? doorWidth / 2 - 5 : -doorWidth / 2 + 5),
              doorZoneBottom + doorHeight / 2,
              frontZ + spec.doorThickness / 2 + HANDLE_PROJECTION_CM / 2,
            ],
            rotation: [90, 0, 0],
            materialSlot: 'hardware',
          },
        );
        parts.push(componentPart(handle, 'hardware'));
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
  }

  if (spec.drawersEnabled) {
    for (let index = 0; index < spec.drawerCount; index += 1) {
      const y = spec.legHeight + spec.drawerHeight / 2 + index * spec.drawerHeight;
      const bodyId = `cabinet-drawer-body-${index + 1}`;
      const frontId = `cabinet-drawer-front-${index + 1}`;
      const body = createComponent(
        'drawer',
        bodyId,
        {
          width: drawerWidth,
          height: spec.drawerHeight,
          depth: spec.drawerDepth,
          sideThickness: DRAWER_SIDE_THICKNESS_CM,
          bottomThickness: DRAWER_BOTTOM_THICKNESS_CM,
        },
        { position: [0, y, drawerBodyZ], materialSlot: 'frame' },
      );
      const front = createComponent(
        'door',
        frontId,
        {
          width: drawerWidth,
          height: spec.drawerHeight,
          thickness: spec.doorThickness,
          cornerRadius: 0,
          segments: 4,
        },
        { position: [0, y, frontZ], materialSlot: 'panel' },
      );
      parts.push(
        componentPart(body, 'structure', false, { drawerBody: true }),
        componentPart(front, 'fronts', true, { drawerFront: true }),
      );
      connections.push(
        createConnection({
          id: `${frontId}-body`,
          type: 'fixed',
          componentIds: [frontId, bodyId],
          position: [0, y, spec.depth / 2 - spec.doorThickness],
          direction: [0, 0, 1],
        }),
        createConnection({
          id: `${bodyId}-carcass`,
          type: 'fixed',
          componentIds: [bodyId, 'cabinet-side-left'],
          position: [0, y, drawerBodyZ],
          direction: [0, 1, 0],
        }),
      );

      if (spec.handleEnabled) {
        const handleId = `cabinet-drawer-handle-${index + 1}`;
        const handle = createComponent(
          'handle',
          handleId,
          {
            type: 'bar',
            length: DRAWER_HANDLE_LENGTH_CM,
            diameter: HANDLE_DIAMETER_CM,
            projection: HANDLE_PROJECTION_CM,
            mountingDistance: DRAWER_HANDLE_LENGTH_CM - 2,
            segments: 20,
          },
          {
            position: [0, y, frontZ + spec.doorThickness / 2 + HANDLE_PROJECTION_CM / 2],
            rotation: [90, 0, 0],
            materialSlot: 'hardware',
          },
        );
        parts.push(componentPart(handle, 'hardware'));
        connections.push(
          createConnection({
            id: `${handleId}-front`,
            type: 'fixed',
            componentIds: [handleId, frontId],
            position: handle.position,
            direction: [0, 0, 1],
          }),
        );
      }
    }
  }

  const legX = spec.width / 2 - LEG_INSET_CM - spec.legWidth / 2;
  const legZ = spec.depth / 2 - LEG_INSET_CM - spec.legDepth / 2;
  const legPlacements = [
    { id: 'cabinet-leg-front-left', x: -legX, z: legZ },
    { id: 'cabinet-leg-front-right', x: legX, z: legZ },
    { id: 'cabinet-leg-rear-left', x: -legX, z: -legZ },
    { id: 'cabinet-leg-rear-right', x: legX, z: -legZ },
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
        id: `${leg.id}-bottom`,
        type: 'fixed',
        componentIds: [leg.id, 'cabinet-bottom'],
        position: [leg.x, spec.legHeight, leg.z],
        direction: [0, 1, 0],
      }),
    );
    const screw = screwPart(`cabinet-leg-screw-${index + 1}`, [
      leg.x,
      spec.legHeight - 1,
      leg.z,
    ]);
    parts.push(screw);
    connections.push(
      createConnection({
        id: `cabinet-leg-screw-${index + 1}-joint`,
        type: 'screw',
        componentIds: [leg.id, 'cabinet-bottom'],
        position: screw.position,
        direction: [0, 1, 0],
        hardwareId: screw.id,
      }),
    );
  }

  return { parts, connections, warnings: [] };
}

export const cabinetStandardDefinition: FurnitureDefinition<CabinetStandardSpec> = {
  id: CABINET_STANDARD_DEFINITION_ID,
  version: 1,
  family: 'dresser',
  label: 'Standart shkaf',
  fields: FIELDS,
  defaults: DEFAULT_CABINET_STANDARD_SPEC,
  slots: SLOTS,
  limits: {
    maxParts: 96,
    maxPartVertices: 50_000,
    maxPartTriangles: 100_000,
    maxTotalVertices: 400_000,
  },
  groupName: 'cabinet-standard-assembly',
  parseSpec: parseCabinetStandardSpec,
  solve: solveCabinetStandardPlan,
};

registerFurnitureDefinition(cabinetStandardDefinition);
