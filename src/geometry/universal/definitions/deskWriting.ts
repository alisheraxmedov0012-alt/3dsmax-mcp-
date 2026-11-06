/**
 * Stage 2.1d — `desk.writing` definition.
 *
 * The table structure is the common desk frame from `solveDesk()`. The drawer
 * module adds three components: the existing open-top drawer body, a separate
 * front panel and an optional static bar handle. There are no slides, no
 * animation and no closed drawer claim.
 */
import {
  createComponent,
  createConnection,
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

export const WRITING_DESK_DEFINITION_ID = 'desk.writing';

const SUPPORT_THICKNESS_CM = 2;
const DRAWER_SIDE_THICKNESS_CM = 1.5;
const DRAWER_BOTTOM_THICKNESS_CM = 1;
const HANDLE_LENGTH_CM = 16;
const HANDLE_PROJECTION_CM = 3;
const HANDLE_DIAMETER_CM = 1.2;
const HANDLE_MOUNTING_DISTANCE_CM = 12.8;
const MIN_DRAWER_HEIGHT_WITH_HANDLE_CM = 10;

const NO_MANUFACTURING_NOTE =
  'manufacturing: boxCm mavjud emas (geometry to‘rtburchak box emas).';

export interface WritingDeskSpec {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly tabletopThickness: number;

  readonly legWidth: number;
  readonly legDepth: number;
  readonly legInset: number;

  readonly frameThickness: number;
  readonly frameHeight: number;

  readonly drawerEnabled: boolean;
  readonly drawerWidth: number;
  readonly drawerHeight: number;
  readonly drawerDepth: number;
  readonly drawerFrontThickness: number;
  readonly handleEnabled: boolean;

  readonly cornerRadius: number;
}

export const DEFAULT_WRITING_DESK_SPEC: Readonly<WritingDeskSpec> = {
  width: 140,
  depth: 70,
  height: 75,
  tabletopThickness: 3,

  legWidth: 5,
  legDepth: 5,
  legInset: 5,

  frameThickness: 2.5,
  frameHeight: 8,

  drawerEnabled: true,
  drawerWidth: 45,
  drawerHeight: 12,
  drawerDepth: 40,
  drawerFrontThickness: 2,
  handleEnabled: true,

  cornerRadius: 0.8,
};

export interface WritingDeskSpecValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

type NumericKey = {
  [K in keyof WritingDeskSpec]: WritingDeskSpec[K] extends number ? K : never;
}[keyof WritingDeskSpec];

type BooleanKey = {
  [K in keyof WritingDeskSpec]: WritingDeskSpec[K] extends boolean ? K : never;
}[keyof WritingDeskSpec];

type MutableWritingDeskSpec = { -readonly [K in keyof WritingDeskSpec]: WritingDeskSpec[K] };

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
  'drawerWidth',
  'drawerHeight',
  'drawerDepth',
  'drawerFrontThickness',
  'cornerRadius',
];

const BOOLEAN_KEYS: readonly BooleanKey[] = ['drawerEnabled', 'handleEnabled'];

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
  { key: 'drawerEnabled', label: 'Tortma', kind: 'boolean' },
  { key: 'drawerWidth', label: 'Tortma kengligi (sm)', kind: 'number' },
  { key: 'drawerHeight', label: 'Tortma balandligi (sm)', kind: 'number' },
  { key: 'drawerDepth', label: 'Tortma chuqurligi (sm)', kind: 'number' },
  { key: 'drawerFrontThickness', label: 'Tortma old qalinligi (sm)', kind: 'number' },
  { key: 'handleEnabled', label: 'Tutqich', kind: 'boolean' },
  { key: 'cornerRadius', label: 'Burchak radiusi (sm)', kind: 'number' },
];

const SLOTS: readonly FurnitureSlot[] = [
  {
    id: 'surface',
    label: 'Ish yuzasi',
    color: '#a9744f',
    materialId: 'wood-oak',
    groupName: 'writing-desk-surface-group',
  },
  {
    id: 'structure',
    label: 'Konstruksiya',
    color: '#8b5a2b',
    materialId: 'wood-oak',
    groupName: 'writing-desk-structure-group',
  },
  {
    id: 'hardware',
    label: 'Furnitura',
    color: '#9aa3ad',
    materialId: 'metal-steel',
    groupName: 'writing-desk-hardware-group',
  },
];

function checkPositive(
  errors: string[],
  spec: WritingDeskSpec,
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

export function validateWritingDeskSpec(
  spec: WritingDeskSpec,
): WritingDeskSpecValidation {
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
  const drawerWidth = checkPositive(errors, spec, 'drawerWidth', false);
  const drawerHeight = checkPositive(errors, spec, 'drawerHeight', false);
  const drawerDepth = checkPositive(errors, spec, 'drawerDepth', false);
  const drawerFrontThickness = checkPositive(errors, spec, 'drawerFrontThickness', false);
  const cornerRadius = checkPositive(errors, spec, 'cornerRadius', false);

  if (typeof spec.drawerEnabled !== 'boolean') {
    errors.push('drawerEnabled: boolean bo‘lishi kerak.');
  }
  if (typeof spec.handleEnabled !== 'boolean') {
    errors.push('handleEnabled: boolean bo‘lishi kerak.');
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
    legInset !== null &&
    frameThickness !== null
  ) {
    const frameWidth = width - 2 * legInset;
    const frameDepth = depth - 2 * legInset;
    if (frameWidth <= 0 || frameDepth <= 0) {
      errors.push('legInset: frame o‘lchamlari noldan katta bo‘lishi kerak.');
    } else if (frameThickness >= Math.min(frameWidth, frameDepth) / 2) {
      errors.push('frameThickness: frame o‘lchamining yarmidan kichik bo‘lishi kerak.');
    } else if (frameDepth <= 3 * frameThickness) {
      errors.push('frameThickness: frame chuqurligi uchun juda katta.');
    }
    if (frameWidth - 2 * frameThickness - 2 * legWidth <= 0) {
      errors.push('legWidth: frame ichki kengligi yetarli emas.');
    }

    if (spec.drawerEnabled) {
      if (drawerWidth !== null && drawerWidth <= 0) {
        errors.push('drawerWidth: tortma yoqilganda noldan katta bo‘lishi kerak.');
      }
      if (drawerHeight !== null && drawerHeight <= 0) {
        errors.push('drawerHeight: tortma yoqilganda noldan katta bo‘lishi kerak.');
      }
      if (drawerDepth !== null && drawerDepth <= 0) {
        errors.push('drawerDepth: tortma yoqilganda noldan katta bo‘lishi kerak.');
      }
      if (drawerFrontThickness !== null && drawerFrontThickness <= 0) {
        errors.push('drawerFrontThickness: tortma yoqilganda noldan katta bo‘lishi kerak.');
      }

      if (drawerWidth !== null && drawerWidth > frameWidth - 2 * frameThickness) {
        errors.push('drawerWidth: frame ichki ochilishidan oshadi.');
      }
      if (drawerHeight !== null && height !== null && tabletopThickness !== null) {
        if (drawerHeight >= height - tabletopThickness) {
          errors.push('drawerHeight: stol ostidagi mavjud balandlikdan kichik bo‘lishi kerak.');
        }
      }
      if (
        drawerDepth !== null &&
        drawerFrontThickness !== null &&
        frameDepth !== null &&
        frameThickness !== null
      ) {
        const clearDepth = frameDepth / 2 - 2 * frameThickness;
        const needed =
          drawerDepth / 2 +
          drawerFrontThickness +
          (spec.handleEnabled ? HANDLE_PROJECTION_CM : 0);
        if (needed > clearDepth) {
          errors.push(
            'drawerDepth: tortma va tutqich frame/support bilan to‘qnashadi.',
          );
        }
      }
      if (spec.handleEnabled) {
        if (drawerHeight !== null && drawerHeight < MIN_DRAWER_HEIGHT_WITH_HANDLE_CM) {
          errors.push(
            'drawerHeight: tutqich support ostiga sig‘ishi uchun kamida 10 sm bo‘lishi kerak.',
          );
        }
        if (drawerWidth !== null && drawerWidth < HANDLE_LENGTH_CM + 6) {
          errors.push('drawerWidth: tutqich uchun juda kichik.');
        }
      }
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

export function parseWritingDeskSpec(input: unknown): SpecParseResult<WritingDeskSpec> {
  if (!isRecord(input)) {
    return { ok: false, errors: ['WritingDeskSpec: obyekt bo‘lishi kerak.'] };
  }

  const errors: string[] = [];
  for (const key of Object.keys(input)) {
    if (!KNOWN_KEYS.has(key)) {
      errors.push(`WritingDeskSpec.${key}: noma'lum maydon.`);
    }
  }

  const spec: MutableWritingDeskSpec = { ...DEFAULT_WRITING_DESK_SPEC };
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

  const validation = validateWritingDeskSpec(spec);
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }
  return { ok: true, spec };
}

export function createWritingDeskSpec(
  overrides: Partial<WritingDeskSpec> = {},
): WritingDeskSpec {
  return { ...DEFAULT_WRITING_DESK_SPEC, ...overrides };
}

function writingSlot(slot: ComponentMaterialSlot): string {
  switch (slot) {
    case 'surface':
      return 'surface';
    case 'frame':
      return 'structure';
    case 'panel':
      return 'structure';
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

function toPlanPart(
  component: ComponentPart,
  id: string,
  slot: string,
  extraNotes: readonly string[] = [],
): PlanPart {
  const manufacturing = manufacturingFor(component);
  const notes = [...extraNotes, ...(manufacturing ? [] : [NO_MANUFACTURING_NOTE])];
  return {
    id,
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
    },
    ...(manufacturing ? { manufacturing } : {}),
    ...(notes.length > 0 ? { notes } : {}),
  };
}

function baseDeskSpec(spec: WritingDeskSpec): DeskSpec {
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
    frameInset: spec.legInset,
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

function writingId(id: string): string {
  return id.startsWith('desk-')
    ? `writing-desk-${id.slice('desk-'.length)}`
    : `writing-desk-${id}`;
}

function solveWritingDeskPlan(spec: WritingDeskSpec): FurniturePlanDraft {
  const base = solveDesk(baseDeskSpec(spec), { detail: 'standard' });
  const idMap = new Map<string, string>();
  for (const component of base.components) {
    idMap.set(component.id, writingId(component.id));
  }
  const mapId = (id: string): string => idMap.get(id) ?? writingId(id);

  const parts: PlanPart[] = base.components.map((component) =>
    toPlanPart(component, mapId(component.id), writingSlot(component.materialSlot)),
  );
  const connections: ComponentConnection[] = base.connections.map((connection) => {
    const [first, second] = connection.componentIds;
    return {
      ...connection,
      id: writingId(connection.id),
      componentIds: [mapId(first), mapId(second)],
      ...(connection.hardwareId !== undefined
        ? { hardwareId: mapId(connection.hardwareId) }
        : {}),
    };
  });

  if (spec.drawerEnabled) {
    const drawerCentreY = spec.height - spec.tabletopThickness - spec.drawerHeight / 2;
    const frontZ = spec.drawerDepth / 2 + spec.drawerFrontThickness / 2;

    const drawerBody = createComponent(
      'drawer',
      'writing-desk-drawer-body',
      {
        width: spec.drawerWidth,
        height: spec.drawerHeight,
        depth: spec.drawerDepth,
        sideThickness: DRAWER_SIDE_THICKNESS_CM,
        bottomThickness: DRAWER_BOTTOM_THICKNESS_CM,
      },
      { position: [0, drawerCentreY, 0], materialSlot: 'frame' },
    );
    parts.push(
      toPlanPart(drawerBody, drawerBody.id, 'structure', [
        'Ochiq ustki 5-box tortma korpusi; yopiq quti emas, rels va animatsiya yo‘q.',
      ]),
    );
    connections.push(
      createConnection({
        id: 'writing-desk-drawer-top',
        type: 'fixed',
        componentIds: [drawerBody.id, mapId('desk-tabletop')],
        position: [0, spec.height - spec.tabletopThickness, 0],
        direction: [0, 1, 0],
      }),
    );

    const drawerFront = createComponent(
      'door',
      'writing-desk-drawer-front',
      {
        width: spec.drawerWidth,
        height: spec.drawerHeight,
        thickness: spec.drawerFrontThickness,
        cornerRadius: 0,
        segments: 4,
      },
      {
        position: [0, drawerCentreY, frontZ],
        materialSlot: 'surface',
      },
    );
    parts.push(
      toPlanPart(drawerFront, drawerFront.id, 'surface', [
        'Statik tortma old paneli; ochilish mexanizmi yo‘q.',
      ]),
    );
    connections.push(
      createConnection({
        id: 'writing-desk-drawer-front',
        type: 'fixed',
        componentIds: [drawerFront.id, drawerBody.id],
        position: [0, drawerCentreY, spec.drawerDepth / 2],
        direction: [0, 0, 1],
      }),
    );

    if (spec.handleEnabled) {
      const frontFaceZ = frontZ + spec.drawerFrontThickness / 2;
      const handle = createComponent(
        'handle',
        'writing-desk-drawer-handle',
        {
          type: 'bar',
          length: HANDLE_LENGTH_CM,
          diameter: HANDLE_DIAMETER_CM,
          projection: HANDLE_PROJECTION_CM,
          mountingDistance: HANDLE_MOUNTING_DISTANCE_CM,
          segments: 24,
        },
        {
          position: [0, drawerCentreY, frontFaceZ + HANDLE_PROJECTION_CM / 2],
          rotation: [90, 0, 0],
          materialSlot: 'hardware',
        },
      );
      parts.push(
        toPlanPart(handle, handle.id, 'hardware', [
          'Statik bar tutqich; mexanizm yo‘q.',
        ]),
      );
      connections.push(
        createConnection({
          id: 'writing-desk-drawer-handle',
          type: 'fixed',
          componentIds: [handle.id, drawerFront.id],
          position: [0, drawerCentreY, frontFaceZ],
          direction: [0, 0, 1],
        }),
      );
    }
  }

  return { parts, connections, warnings: base.warnings };
}

export const writingDeskDefinition: FurnitureDefinition<WritingDeskSpec> = {
  id: WRITING_DESK_DEFINITION_ID,
  version: 1,
  family: 'table',
  label: 'Yozuv stoli',
  fields: FIELDS,
  defaults: DEFAULT_WRITING_DESK_SPEC,
  slots: SLOTS,
  limits: {
    maxParts: 64,
    maxPartVertices: 50_000,
    maxPartTriangles: 100_000,
    maxTotalVertices: 300_000,
  },
  groupName: 'writing-desk-assembly',
  parseSpec: parseWritingDeskSpec,
  solve: solveWritingDeskPlan,
};

registerFurnitureDefinition(writingDeskDefinition);
