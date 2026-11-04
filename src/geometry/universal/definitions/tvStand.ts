/**
 * Stage 2.7 — `stand.tv` definition.
 *
 * TV stand / media console: panelled carcass, one shelf, two doors above two
 * side-by-side drawers, hinges, handles and four legs. Static V1.
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

export const TV_STAND_DEFINITION_ID = 'stand.tv';

const DRAWER_HEIGHT_CM = 15;
const DRAWER_SIDE_CLEARANCE_CM = 1;
const DRAWER_SIDE_THICKNESS_CM = 1.5;
const DRAWER_BOTTOM_THICKNESS_CM = 1;
const LEG_WIDTH_CM = 5;
const LEG_DEPTH_CM = 5;
const LEG_INSET_CM = 5;
const HINGE_RADIUS_CM = 0.6;
const HINGE_HEIGHT_CM = 4;
const DOOR_HANDLE_LENGTH_CM = 10;
const DRAWER_HANDLE_LENGTH_CM = 12;
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

export interface TvStandSpec {
  readonly width: number;
  readonly depth: number;
  readonly totalHeight: number;
  readonly panelThickness: number;
  readonly backPanelThickness: number;

  readonly shelfEnabled: boolean;
  readonly doorsEnabled: boolean;
  readonly drawersEnabled: boolean;
  readonly doorCount: number;
  readonly drawerCount: number;
  readonly doorGap: number;

  readonly legsEnabled: boolean;
  readonly legHeight: number;

  readonly handlesEnabled: boolean;
}

export const DEFAULT_TV_STAND_SPEC: Readonly<TvStandSpec> = {
  width: 160,
  depth: 40,
  totalHeight: 55,
  panelThickness: 2,
  backPanelThickness: 0.6,

  shelfEnabled: true,
  doorsEnabled: true,
  drawersEnabled: true,
  doorCount: 2,
  drawerCount: 2,
  doorGap: 0.3,

  legsEnabled: true,
  legHeight: 10,

  handlesEnabled: true,
};

export interface TvStandSpecValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

type NumericKey = {
  [K in keyof TvStandSpec]: TvStandSpec[K] extends number ? K : never;
}[keyof TvStandSpec];

type BooleanKey = {
  [K in keyof TvStandSpec]: TvStandSpec[K] extends boolean ? K : never;
}[keyof TvStandSpec];

type MutableTvStandSpec = { -readonly [K in keyof TvStandSpec]: TvStandSpec[K] };

const NUMERIC_KEYS: readonly NumericKey[] = [
  'width',
  'depth',
  'totalHeight',
  'panelThickness',
  'backPanelThickness',
  'doorCount',
  'drawerCount',
  'doorGap',
  'legHeight',
];

const BOOLEAN_KEYS: readonly BooleanKey[] = [
  'shelfEnabled',
  'doorsEnabled',
  'drawersEnabled',
  'legsEnabled',
  'handlesEnabled',
];

const KNOWN_KEYS = new Set<string>([...NUMERIC_KEYS, ...BOOLEAN_KEYS]);

const FIELDS: readonly DefinitionField[] = [
  { key: 'width', label: 'Kenglik (sm)', kind: 'number' },
  { key: 'depth', label: 'Chuqurlik (sm)', kind: 'number' },
  { key: 'totalHeight', label: 'Umumiy balandlik (sm)', kind: 'number' },
  { key: 'panelThickness', label: 'Panel qalinligi (sm)', kind: 'number' },
  { key: 'backPanelThickness', label: 'Orqa panel qalinligi (sm)', kind: 'number' },
  { key: 'shelfEnabled', label: 'Tokcha', kind: 'boolean' },
  { key: 'doorsEnabled', label: 'Eshiklar', kind: 'boolean' },
  { key: 'drawersEnabled', label: 'Tortmalar', kind: 'boolean' },
  { key: 'doorCount', label: 'Eshiklar soni', kind: 'number', integer: true },
  { key: 'drawerCount', label: 'Tortmalar soni', kind: 'number', integer: true },
  { key: 'doorGap', label: 'Fasadlar orasi (sm)', kind: 'number' },
  { key: 'legsEnabled', label: 'Oyoqlar', kind: 'boolean' },
  { key: 'legHeight', label: 'Oyoq balandligi (sm)', kind: 'number' },
  { key: 'handlesEnabled', label: 'Tutqichlar', kind: 'boolean' },
];

const SLOTS: readonly FurnitureSlot[] = [
  {
    id: 'structure',
    label: 'Karkas',
    color: '#8b5a2b',
    materialId: 'wood-oak',
    groupName: 'tv-stand-structure-group',
  },
  {
    id: 'fronts',
    label: 'Fasadlar',
    color: '#a9744f',
    materialId: 'wood-oak',
    groupName: 'tv-stand-fronts-group',
  },
  {
    id: 'hardware',
    label: 'Furnitura',
    color: '#9aa3ad',
    materialId: 'metal-steel',
    groupName: 'tv-stand-hardware-group',
  },
];

function checkPositive(
  errors: string[],
  spec: TvStandSpec,
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

export function validateTvStandSpec(spec: TvStandSpec): TvStandSpecValidation {
  const errors: string[] = [];
  const width = checkPositive(errors, spec, 'width');
  const depth = checkPositive(errors, spec, 'depth');
  const totalHeight = checkPositive(errors, spec, 'totalHeight');
  const panelThickness = checkPositive(errors, spec, 'panelThickness');
  const backPanelThickness = checkPositive(errors, spec, 'backPanelThickness');
  const doorCount = checkPositive(errors, spec, 'doorCount');
  const drawerCount = checkPositive(errors, spec, 'drawerCount');
  const doorGap = checkPositive(errors, spec, 'doorGap', false);
  const legHeight = checkPositive(errors, spec, 'legHeight', false);

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
  if (totalHeight !== null && legHeight !== null && legHeight >= totalHeight) {
    errors.push('legHeight: totalHeight dan kichik bo‘lishi kerak.');
  }
  if (width !== null && panelThickness !== null && doorGap !== null && doorCount !== null) {
    const innerWidth = width - 2 * panelThickness;
    if (innerWidth <= 0) {
      errors.push('panelThickness: ichki kenglik noldan katta bo‘lishi kerak.');
    } else if ((innerWidth - doorGap) / doorCount <= 0) {
      errors.push('doorGap: eshiklar uchun yetarli emas.');
    }
  }
  if (depth !== null && panelThickness !== null && backPanelThickness !== null) {
    if (depth - backPanelThickness - panelThickness - DRAWER_SIDE_CLEARANCE_CM <= 0) {
      errors.push('depth: tortma uchun ichki chuqurlik yetarli emas.');
    }
  }
  if (panelThickness !== null && depth !== null) {
    if (panelThickness >= Math.min(width ?? Infinity, depth, totalHeight ?? Infinity) / 2) {
      errors.push('panelThickness: o‘lchamning yarmidan kichik bo‘lishi kerak.');
    }
  }
  if (backPanelThickness !== null && depth !== null && backPanelThickness >= depth / 2) {
    errors.push('backPanelThickness: depth ning yarmidan kichik bo‘lishi kerak.');
  }
  if (width !== null && LEG_WIDTH_CM > 0 && width <= 2 * (LEG_INSET_CM + LEG_WIDTH_CM)) {
    errors.push('width: oyoqlar stand chetidan chiqib ketadi.');
  }
  if (depth !== null && depth <= 2 * (LEG_INSET_CM + LEG_DEPTH_CM)) {
    errors.push('depth: oyoqlar stand chetidan chiqib ketadi.');
  }
  if (
    totalHeight !== null &&
    legHeight !== null &&
    panelThickness !== null &&
    doorGap !== null
  ) {
    const carcassHeight = totalHeight - legHeight;
    const doorHeight =
      carcassHeight - panelThickness - DRAWER_HEIGHT_CM - 2 * doorGap;
    if (doorHeight <= 0) {
      errors.push('totalHeight: eshik va tortmalar uchun vertikal joy yetarli emas.');
    }
  }

  return { valid: errors.length === 0, errors };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseTvStandSpec(input: unknown): SpecParseResult<TvStandSpec> {
  if (!isRecord(input)) {
    return { ok: false, errors: ['TvStandSpec: obyekt bo‘lishi kerak.'] };
  }

  const errors: string[] = [];
  for (const key of Object.keys(input)) {
    if (!KNOWN_KEYS.has(key)) {
      errors.push(`TvStandSpec.${key}: noma'lum maydon.`);
    }
  }

  const spec: MutableTvStandSpec = { ...DEFAULT_TV_STAND_SPEC };
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

  const validation = validateTvStandSpec(spec);
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }
  return { ok: true, spec };
}

export function createTvStandSpec(overrides: Partial<TvStandSpec> = {}): TvStandSpec {
  return { ...DEFAULT_TV_STAND_SPEC, ...overrides };
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

function solveTvStandPlan(spec: TvStandSpec): FurniturePlanDraft {
  const parts: PlanPart[] = [];
  const connections: ComponentConnection[] = [];
  const carcassHeight = spec.totalHeight - spec.legHeight;
  const carcassBottom = spec.legsEnabled ? spec.legHeight : 0;
  const carcassTop = carcassBottom + carcassHeight;
  const carcassCentreY = carcassBottom + carcassHeight / 2;
  const innerWidth = spec.width - 2 * spec.panelThickness;
  const innerHeight = carcassHeight - 2 * spec.panelThickness;
  const innerDepth = spec.depth - spec.backPanelThickness;
  const sideX = spec.width / 2 - spec.panelThickness / 2;

  const carcassParts: Array<{ id: string; size: Vec3Tuple; position: Vec3Tuple }> = [
    {
      id: 'tv-stand-side-left',
      size: [spec.panelThickness, carcassHeight, spec.depth],
      position: [-sideX, carcassCentreY, 0],
    },
    {
      id: 'tv-stand-side-right',
      size: [spec.panelThickness, carcassHeight, spec.depth],
      position: [sideX, carcassCentreY, 0],
    },
    {
      id: 'tv-stand-top',
      size: [innerWidth, spec.panelThickness, spec.depth],
      position: [0, carcassTop - spec.panelThickness / 2, 0],
    },
    {
      id: 'tv-stand-bottom',
      size: [innerWidth, spec.panelThickness, spec.depth],
      position: [0, carcassBottom + spec.panelThickness / 2, 0],
    },
    {
      id: 'tv-stand-back',
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
      id: 'tv-stand-top-left',
      type: 'panel-to-panel',
      componentIds: ['tv-stand-top', 'tv-stand-side-left'],
      position: [-sideX, carcassTop, 0],
      direction: [0, 1, 0],
    }),
    createConnection({
      id: 'tv-stand-top-right',
      type: 'panel-to-panel',
      componentIds: ['tv-stand-top', 'tv-stand-side-right'],
      position: [sideX, carcassTop, 0],
      direction: [0, 1, 0],
    }),
    createConnection({
      id: 'tv-stand-bottom-left',
      type: 'panel-to-panel',
      componentIds: ['tv-stand-bottom', 'tv-stand-side-left'],
      position: [-sideX, carcassBottom, 0],
      direction: [0, 1, 0],
    }),
    createConnection({
      id: 'tv-stand-bottom-right',
      type: 'panel-to-panel',
      componentIds: ['tv-stand-bottom', 'tv-stand-side-right'],
      position: [sideX, carcassBottom, 0],
      direction: [0, 1, 0],
    }),
    createConnection({
      id: 'tv-stand-back-bottom',
      type: 'fixed',
      componentIds: ['tv-stand-back', 'tv-stand-bottom'],
      position: [0, carcassBottom, -spec.depth / 2],
      direction: [0, 1, 0],
    }),
  );

  const frontZ = spec.depth / 2 - spec.panelThickness / 2;
  const drawerHeight = DRAWER_HEIGHT_CM;
  const drawerWidth = (innerWidth - spec.doorGap) / 2;
  const doorHeight =
    carcassHeight - spec.panelThickness - drawerHeight - 2 * spec.doorGap;
  const doorBottom = carcassBottom + drawerHeight + spec.doorGap;
  const doorCentreY = doorBottom + doorHeight / 2;
  const drawerCentreY = carcassBottom + drawerHeight / 2;
  const columnCentres = [-drawerWidth / 2 - spec.doorGap / 2, drawerWidth / 2 + spec.doorGap / 2];

  if (spec.shelfEnabled) {
    const shelfY = doorCentreY;
    parts.push(
      makePart({
        id: 'tv-stand-shelf',
        type: 'shelf',
        role: 'shelf',
        materialSlot: 'structure',
        geometry: {
          kind: 'box',
          width: innerWidth,
          height: spec.panelThickness,
          depth: innerDepth,
        },
        dimensions: {
          width: innerWidth,
          height: spec.panelThickness,
          depth: innerDepth,
        },
        position: [0, shelfY, spec.backPanelThickness / 2],
        cutFromSheet: true,
        metadata: { shelf: true },
      }),
    );
    connections.push(
      createConnection({
        id: 'tv-stand-shelf-left',
        type: 'panel-to-panel',
        componentIds: ['tv-stand-shelf', 'tv-stand-side-left'],
        position: [-innerWidth / 2, shelfY, 0],
        direction: [0, 1, 0],
      }),
      createConnection({
        id: 'tv-stand-shelf-right',
        type: 'panel-to-panel',
        componentIds: ['tv-stand-shelf', 'tv-stand-side-right'],
        position: [innerWidth / 2, shelfY, 0],
        direction: [0, 1, 0],
      }),
    );
  }

  if (spec.doorsEnabled && spec.doorCount === 2) {
    for (const [index, x] of columnCentres.entries()) {
      const side = index === 0 ? 'left' : 'right';
      const doorId = `tv-stand-door-${side}`;
      const door = createComponent(
        'door',
        doorId,
        {
          width: drawerWidth,
          height: doorHeight,
          thickness: spec.panelThickness,
          cornerRadius: 0,
          segments: 4,
        },
        { position: [x, doorCentreY, frontZ], materialSlot: 'panel' },
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

      for (const [hingeIndex, y] of [doorBottom + 6, doorBottom + doorHeight - 6].entries()) {
        const hingeId = `tv-stand-hinge-${side}-${hingeIndex + 1}`;
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
          position: [x + (index === 0 ? -drawerWidth / 2 + 1 : drawerWidth / 2 - 1), y, frontZ],
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
            componentIds: [hingeId, index === 0 ? 'tv-stand-side-left' : 'tv-stand-side-right'],
            position: hinge.position,
            direction: [1, 0, 0],
          }),
        );
      }

      if (spec.handlesEnabled) {
        const handleId = `tv-stand-door-handle-${side}`;
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
              x + (index === 0 ? drawerWidth / 2 - 4 : -drawerWidth / 2 + 4),
              doorCentreY,
              frontZ + spec.panelThickness / 2 + HANDLE_PROJECTION_CM / 2,
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
  }

  if (spec.drawersEnabled && spec.drawerCount === 2) {
    const drawerDepth = innerDepth - spec.panelThickness - DRAWER_SIDE_CLEARANCE_CM;
    const drawerBodyZ = frontZ - spec.panelThickness / 2 - drawerDepth / 2;
    for (const [index, x] of columnCentres.entries()) {
      const bodyId = `tv-stand-drawer-body-${index + 1}`;
      const frontId = `tv-stand-drawer-front-${index + 1}`;
      const body = createComponent(
        'drawer',
        bodyId,
        {
          width: drawerWidth - 2 * DRAWER_SIDE_CLEARANCE_CM,
          height: drawerHeight,
          depth: drawerDepth,
          sideThickness: DRAWER_SIDE_THICKNESS_CM,
          bottomThickness: DRAWER_BOTTOM_THICKNESS_CM,
        },
        { position: [x, drawerCentreY, drawerBodyZ], materialSlot: 'frame' },
      );
      const front = createComponent(
        'door',
        frontId,
        {
          width: drawerWidth,
          height: drawerHeight,
          thickness: spec.panelThickness,
          cornerRadius: 0,
          segments: 4,
        },
        { position: [x, drawerCentreY, frontZ], materialSlot: 'panel' },
      );
      parts.push(
        makePart({
          id: body.id,
          type: body.type,
          role: body.role,
          materialSlot: 'structure',
          geometry: body.geometry,
          dimensions: body.dimensions,
          position: body.position,
          rotation: body.rotation,
          metadata: { componentVersion: body.componentVersion, drawerBody: true },
        }),
        makePart({
          id: front.id,
          type: front.type,
          role: front.role,
          materialSlot: 'fronts',
          geometry: front.geometry,
          dimensions: front.dimensions,
          position: front.position,
          rotation: front.rotation,
          cutFromSheet: true,
          metadata: { componentVersion: front.componentVersion, drawerFront: true },
        }),
      );
      connections.push(
        createConnection({
          id: `${frontId}-body`,
          type: 'fixed',
          componentIds: [frontId, bodyId],
          position: [x, drawerCentreY, spec.depth / 2 - spec.panelThickness],
          direction: [0, 0, 1],
        }),
        createConnection({
          id: `${bodyId}-carcass`,
          type: 'fixed',
          componentIds: [bodyId, 'tv-stand-bottom'],
          position: [x, carcassBottom + drawerHeight, drawerBodyZ],
          direction: [0, 1, 0],
        }),
      );

      if (spec.handlesEnabled) {
        const handleId = `tv-stand-drawer-handle-${index + 1}`;
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
            position: [x, drawerCentreY, frontZ + spec.panelThickness / 2 + HANDLE_PROJECTION_CM / 2],
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

  if (spec.legsEnabled) {
    const legX = spec.width / 2 - LEG_INSET_CM - LEG_WIDTH_CM / 2;
    const legZ = spec.depth / 2 - LEG_INSET_CM - LEG_DEPTH_CM / 2;
    const legPlacements = [
      { id: 'tv-stand-leg-front-left', x: -legX, z: legZ },
      { id: 'tv-stand-leg-front-right', x: legX, z: legZ },
      { id: 'tv-stand-leg-rear-left', x: -legX, z: -legZ },
      { id: 'tv-stand-leg-rear-right', x: legX, z: -legZ },
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
            width: LEG_WIDTH_CM,
            height: spec.legHeight,
            depth: LEG_DEPTH_CM,
          },
          dimensions: { width: LEG_WIDTH_CM, height: spec.legHeight, depth: LEG_DEPTH_CM },
          position: [leg.x, spec.legHeight / 2, leg.z],
        }),
      );
      connections.push(
        createConnection({
          id: `${leg.id}-bottom`,
          type: 'fixed',
          componentIds: [leg.id, 'tv-stand-bottom'],
          position: [leg.x, spec.legHeight, leg.z],
          direction: [0, 1, 0],
        }),
      );
      const screw = screwPart(`tv-stand-leg-screw-${index + 1}`, [
        leg.x,
        spec.legHeight - 1,
        leg.z,
      ]);
      parts.push(screw);
      connections.push(
        createConnection({
          id: `tv-stand-leg-screw-${index + 1}-joint`,
          type: 'screw',
          componentIds: [leg.id, 'tv-stand-bottom'],
          position: screw.position,
          direction: [0, 1, 0],
          hardwareId: screw.id,
        }),
      );
    }
  }

  return { parts, connections, warnings: [] };
}

export const tvStandDefinition: FurnitureDefinition<TvStandSpec> = {
  id: TV_STAND_DEFINITION_ID,
  version: 1,
  family: 'dresser',
  label: 'TV stand / media konsol',
  fields: FIELDS,
  defaults: DEFAULT_TV_STAND_SPEC,
  slots: SLOTS,
  limits: {
    maxParts: 96,
    maxPartVertices: 50_000,
    maxPartTriangles: 100_000,
    maxTotalVertices: 400_000,
  },
  groupName: 'tv-stand-assembly',
  parseSpec: parseTvStandSpec,
  solve: solveTvStandPlan,
};

registerFurnitureDefinition(tvStandDefinition);
