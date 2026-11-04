/**
 * Stage 2.1b — `desk.gaming` definition.
 *
 * The common structure (tabletop, legs, frame, rails, fasteners) comes from the
 * existing `solveDesk()`; this module only adds the gaming-specific monitor
 * shelf and front accent rail. No solver formula is copied and no existing
 * builder changes.
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

export const GAMING_DESK_DEFINITION_ID = 'desk.gaming';

/** Monitor shelf edge margin from the tabletop edge, in cm. */
const SHELF_EDGE_MARGIN_CM = 5;
const SHELF_UPRIGHT_WIDTH_CM = 4;
const SHELF_UPRIGHT_DEPTH_CM = 6;
const ACCENT_RAIL_HEIGHT_CM = 2.5;
const ACCENT_RAIL_DEPTH_CM = 1.5;
const GROMMET_EDGE_MARGIN_CM = 5;

const SCREW_DIAMETERS = {
  shaftDiameter: 0.4,
  length: 3,
  headDiameter: 0.8,
  headHeight: 0.4,
} as const;

const NO_MANUFACTURING_NOTE =
  'manufacturing: boxCm mavjud emas (geometry to‘rtburchak box emas).';

export interface GamingDeskSpec {
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
  readonly supportThickness: number;

  readonly cornerRadius: number;

  readonly monitorShelfEnabled: boolean;
  readonly monitorShelfWidth: number;
  readonly monitorShelfDepth: number;
  readonly monitorShelfHeight: number;
  readonly monitorShelfThickness: number;

  readonly grommetEnabled: boolean;
  readonly grommetDiameter: number;
}

export const DEFAULT_GAMING_DESK_SPEC: Readonly<GamingDeskSpec> = {
  width: 160,
  depth: 75,
  height: 75,
  tabletopThickness: 3,

  legWidth: 6,
  legDepth: 6,
  legInset: 4,

  frameThickness: 3,
  frameHeight: 6,
  frameInset: 4,
  supportThickness: 2,

  cornerRadius: 1,

  monitorShelfEnabled: true,
  monitorShelfWidth: 100,
  monitorShelfDepth: 22,
  monitorShelfHeight: 18,
  monitorShelfThickness: 3,

  grommetEnabled: true,
  grommetDiameter: 8,
};

export interface GamingDeskSpecValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

type NumericKey = {
  [K in keyof GamingDeskSpec]: GamingDeskSpec[K] extends number ? K : never;
}[keyof GamingDeskSpec];

type BooleanKey = {
  [K in keyof GamingDeskSpec]: GamingDeskSpec[K] extends boolean ? K : never;
}[keyof GamingDeskSpec];

type MutableGamingDeskSpec = { -readonly [K in keyof GamingDeskSpec]: GamingDeskSpec[K] };

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
  'supportThickness',
  'cornerRadius',
  'monitorShelfWidth',
  'monitorShelfDepth',
  'monitorShelfHeight',
  'monitorShelfThickness',
  'grommetDiameter',
];

const BOOLEAN_KEYS: readonly BooleanKey[] = ['monitorShelfEnabled', 'grommetEnabled'];

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
  { key: 'monitorShelfEnabled', label: 'Monitor tokchasi', kind: 'boolean' },
  { key: 'monitorShelfWidth', label: 'Monitor tokchasi kengligi (sm)', kind: 'number' },
  { key: 'monitorShelfDepth', label: 'Monitor tokchasi chuqurligi (sm)', kind: 'number' },
  { key: 'monitorShelfHeight', label: 'Monitor tokchasi balandligi (sm)', kind: 'number' },
  { key: 'monitorShelfThickness', label: 'Monitor tokchasi qalinligi (sm)', kind: 'number' },
  { key: 'grommetEnabled', label: 'Kabel o‘tkazgichi', kind: 'boolean' },
  { key: 'grommetDiameter', label: 'Kabel o‘tkazgichi diametri (sm)', kind: 'number' },
];

const SLOTS: readonly FurnitureSlot[] = [
  {
    id: 'surface',
    label: 'Ish yuzasi',
    color: '#3b3f46',
    materialId: 'wood-oak',
    groupName: 'gaming-desk-surface-group',
  },
  {
    id: 'structure',
    label: 'Konstruksiya',
    color: '#22262b',
    materialId: 'metal-steel',
    groupName: 'gaming-desk-structure-group',
  },
  {
    id: 'accent',
    label: 'Aksent',
    color: '#b3262e',
    materialId: 'painted-red',
    groupName: 'gaming-desk-accent-group',
  },
  {
    id: 'hardware',
    label: 'Furnitura',
    color: '#9aa3ad',
    materialId: 'metal-steel',
    groupName: 'gaming-desk-hardware-group',
  },
];

function checkPositive(
  errors: string[],
  spec: GamingDeskSpec,
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

/** Validate every channel and cross-part relationship without correcting it. */
export function validateGamingDeskSpec(spec: GamingDeskSpec): GamingDeskSpecValidation {
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
  const supportThickness = checkPositive(errors, spec, 'supportThickness');
  const cornerRadius = checkPositive(errors, spec, 'cornerRadius', false);
  const monitorShelfWidth = checkPositive(errors, spec, 'monitorShelfWidth', false);
  const monitorShelfDepth = checkPositive(errors, spec, 'monitorShelfDepth', false);
  const monitorShelfHeight = checkPositive(errors, spec, 'monitorShelfHeight', false);
  const monitorShelfThickness = checkPositive(errors, spec, 'monitorShelfThickness', false);
  const grommetDiameter = checkPositive(errors, spec, 'grommetDiameter', false);

  if (typeof spec.monitorShelfEnabled !== 'boolean') {
    errors.push('monitorShelfEnabled: boolean bo‘lishi kerak.');
  }
  if (typeof spec.grommetEnabled !== 'boolean') {
    errors.push('grommetEnabled: boolean bo‘lishi kerak.');
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
    supportThickness !== null &&
    height !== null &&
    tabletopThickness !== null &&
    supportThickness >= height - tabletopThickness
  ) {
    errors.push('supportThickness: stol ostidagi balandlikdan kichik bo‘lishi kerak.');
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
      errors.push('frameThickness: support rail uchun frameDepth yetarli emas.');
    }
    if (frameWidth - 2 * frameThickness - 2 * legWidth <= 0) {
      errors.push('legWidth: support rail uchun frame ichki kengligi yetarli emas.');
    }
  }
  if (width !== null && depth !== null && tabletopThickness !== null && cornerRadius !== null) {
    if (cornerRadius >= Math.min(width, depth, tabletopThickness) / 2) {
      errors.push('cornerRadius: tabletop o‘lchamining yarmidan oshmasligi kerak.');
    }
  }
  if (depth !== null && depth <= ACCENT_RAIL_DEPTH_CM) {
    errors.push('depth: old aksent qirrasi uchun juda kichik.');
  }

  if (spec.monitorShelfEnabled) {
    if (monitorShelfWidth !== null && width !== null) {
      if (monitorShelfWidth <= 0) {
        errors.push('monitorShelfWidth: yoqilganda noldan katta bo‘lishi kerak.');
      }
      if (monitorShelfWidth > width - 2 * SHELF_EDGE_MARGIN_CM) {
        errors.push('monitorShelfWidth: stol kengligidan chetlari bilan sig‘maydi.');
      }
      if (monitorShelfWidth < 2 * SHELF_UPRIGHT_WIDTH_CM + 10) {
        errors.push('monitorShelfWidth: ikkita tayanch uchun juda kichik.');
      }
    }
    if (monitorShelfDepth !== null && depth !== null) {
      if (monitorShelfDepth <= 0) {
        errors.push('monitorShelfDepth: yoqilganda noldan katta bo‘lishi kerak.');
      }
      if (monitorShelfDepth > depth - 2 * SHELF_EDGE_MARGIN_CM) {
        errors.push('monitorShelfDepth: stol chuqurligidan chetlari bilan sig‘maydi.');
      }
      if (monitorShelfDepth < SHELF_UPRIGHT_DEPTH_CM) {
        errors.push('monitorShelfDepth: tayanch chuqurligidan kichik bo‘lmasligi kerak.');
      }
    }
    if (monitorShelfHeight !== null) {
      if (monitorShelfHeight <= 0) {
        errors.push('monitorShelfHeight: yoqilganda noldan katta bo‘lishi kerak.');
      }
      if (height !== null && monitorShelfHeight > height) {
        errors.push('monitorShelfHeight: stol balandligidan oshmasligi kerak.');
      }
    }
    if (monitorShelfThickness !== null && monitorShelfThickness <= 0) {
      errors.push('monitorShelfThickness: yoqilganda noldan katta bo‘lishi kerak.');
    }
  }

  if (spec.grommetEnabled) {
    if (grommetDiameter !== null) {
      if (grommetDiameter <= 0) {
        errors.push('grommetDiameter: grommet yoqilganda noldan katta bo‘lishi kerak.');
      }
      const radius = grommetDiameter / 2;
      if (
        width !== null &&
        depth !== null &&
        radius + GROMMET_EDGE_MARGIN_CM > Math.min(width, depth) / 2
      ) {
        errors.push('grommetDiameter: grommet tabletop chegarasidan chiqadi.');
      }
      if (spec.monitorShelfEnabled && depth !== null && monitorShelfDepth !== null) {
        const shelfZ = -(depth / 2 - SHELF_EDGE_MARGIN_CM - monitorShelfDepth / 2);
        const shelfFrontZ = shelfZ + monitorShelfDepth / 2;
        const grommetZ = shelfFrontZ + GROMMET_EDGE_MARGIN_CM + radius;
        if (grommetZ + radius > depth / 2 - GROMMET_EDGE_MARGIN_CM) {
          errors.push('grommetDiameter: monitor tokchasi oldidagi bo‘sh joyga sig‘maydi.');
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseGamingDeskSpec(input: unknown): SpecParseResult<GamingDeskSpec> {
  if (!isRecord(input)) {
    return { ok: false, errors: ['GamingDeskSpec: obyekt bo‘lishi kerak.'] };
  }

  const errors: string[] = [];
  for (const key of Object.keys(input)) {
    if (!KNOWN_KEYS.has(key)) {
      errors.push(`GamingDeskSpec.${key}: noma'lum maydon.`);
    }
  }

  const spec: MutableGamingDeskSpec = { ...DEFAULT_GAMING_DESK_SPEC };
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

  const validation = validateGamingDeskSpec(spec);
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }
  return { ok: true, spec };
}

export function createGamingDeskSpec(
  overrides: Partial<GamingDeskSpec> = {},
): GamingDeskSpec {
  return { ...DEFAULT_GAMING_DESK_SPEC, ...overrides };
}

function gamingSlot(slot: ComponentMaterialSlot): string {
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

function toPlanPart(
  component: ComponentPart,
  id: string,
  slot: string,
  extraMetadata: Readonly<Record<string, unknown>> = {},
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
      ...extraMetadata,
    },
    ...(manufacturing ? { manufacturing } : {}),
    ...(notes.length > 0 ? { notes } : {}),
  };
}

function baseDeskSpec(spec: GamingDeskSpec): DeskSpec {
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
    supportThickness: spec.supportThickness,
    cornerRadius: spec.cornerRadius,
    grommetEnabled: false,
    grommetDiameter: 0,
    drawerEnabled: false,
    drawerWidth: 0,
    drawerHeight: 0,
    drawerDepth: 0,
  };
}

function solveGamingDeskPlan(spec: GamingDeskSpec): FurniturePlanDraft {
  const base = solveDesk(baseDeskSpec(spec));
  const idMap = new Map<string, string>();
  for (const component of base.components) {
    idMap.set(component.id, `gaming-${component.id}`);
  }
  const mapId = (id: string): string => idMap.get(id) ?? `gaming-${id}`;

  const parts: PlanPart[] = base.components.map((component) =>
    toPlanPart(component, mapId(component.id), gamingSlot(component.materialSlot)),
  );
  const connections: ComponentConnection[] = base.connections.map((connection) => {
    const [first, second] = connection.componentIds;
    return {
      ...connection,
      id: `gaming-${connection.id}`,
      componentIds: [mapId(first), mapId(second)],
      ...(connection.hardwareId !== undefined
        ? { hardwareId: mapId(connection.hardwareId) }
        : {}),
    };
  });

  const { width, depth, height, tabletopThickness, legInset } = spec;
  const railWidth = width - 2 * legInset;

  const accentRail = createComponent(
    'support',
    'gaming-desk-accent-rail',
    { width: railWidth, height: ACCENT_RAIL_HEIGHT_CM, depth: ACCENT_RAIL_DEPTH_CM },
    {
      position: [
        0,
        height - tabletopThickness - ACCENT_RAIL_HEIGHT_CM / 2,
        -(depth / 2 - ACCENT_RAIL_DEPTH_CM / 2),
      ],
      role: 'panel',
      materialSlot: 'frame',
    },
  );
  parts.push(
    toPlanPart(accentRail, accentRail.id, 'accent', { decorative: true }, [
      'Dekorativ old aksent qirrasi; konstruktiv yuk ko‘tarmaydi.',
    ]),
  );
  connections.push(
    createConnection({
      id: 'gaming-desk-accent-top',
      type: 'fixed',
      componentIds: [accentRail.id, mapId('desk-tabletop')],
      position: accentRail.position,
      direction: [0, 1, 0],
    }),
  );

  if (spec.grommetEnabled) {
    const outerRadius = spec.grommetDiameter / 2;
    const shelfZ = spec.monitorShelfEnabled
      ? -(depth / 2 - SHELF_EDGE_MARGIN_CM - spec.monitorShelfDepth / 2)
      : 0;
    const grommetZ = spec.monitorShelfEnabled
      ? shelfZ + spec.monitorShelfDepth / 2 + GROMMET_EDGE_MARGIN_CM + outerRadius
      : -(depth / 2 - outerRadius - GROMMET_EDGE_MARGIN_CM);

    const grommet = createComponent(
      'grommet',
      'gaming-desk-grommet',
      {
        outerRadius,
        innerRadius: outerRadius * 0.55,
        thickness: tabletopThickness,
        segments: 32,
      },
      { position: [0, height - tabletopThickness / 2, grommetZ], materialSlot: 'hardware' },
    );
    parts.push(
      toPlanPart(grommet, grommet.id, 'hardware', {}, [
        'Dekorativ kabel halqasi; tabletopda haqiqiy teshik ochilmaydi.',
      ]),
    );
    connections.push(
      createConnection({
        id: 'gaming-desk-grommet-top',
        type: 'fixed',
        componentIds: [grommet.id, mapId('desk-tabletop')],
        position: grommet.position,
        direction: [0, 1, 0],
      }),
    );
  }

  if (spec.monitorShelfEnabled) {
    const shelfZ = -(depth / 2 - SHELF_EDGE_MARGIN_CM - spec.monitorShelfDepth / 2);
    const shelf = createComponent(
      'shelf',
      'gaming-desk-monitor-shelf',
      {
        width: spec.monitorShelfWidth,
        depth: spec.monitorShelfDepth,
        thickness: spec.monitorShelfThickness,
        cornerRadius: 0,
        segments: 4,
      },
      {
        position: [
          0,
          height + spec.monitorShelfHeight + spec.monitorShelfThickness / 2,
          shelfZ,
        ],
        materialSlot: 'surface',
      },
    );
    parts.push(toPlanPart(shelf, shelf.id, 'surface'));

    const uprightX = spec.monitorShelfWidth / 2 - SHELF_UPRIGHT_WIDTH_CM / 2;
    const uprights = [
      { id: 'gaming-desk-monitor-upright-left', x: -uprightX },
      { id: 'gaming-desk-monitor-upright-right', x: uprightX },
    ].map(({ id, x }) =>
      createComponent(
        'support',
        id,
        {
          width: SHELF_UPRIGHT_WIDTH_CM,
          height: spec.monitorShelfHeight,
          depth: SHELF_UPRIGHT_DEPTH_CM,
        },
        { position: [x, height + spec.monitorShelfHeight / 2, shelfZ], materialSlot: 'frame' },
      ),
    );
    for (const upright of uprights) {
      parts.push(toPlanPart(upright, upright.id, 'structure'));
    }

    const shelfScrews = uprights.map((upright, index) =>
      createComponent('screw', `gaming-desk-shelf-screw-${index + 1}`, SCREW_DIAMETERS, {
        position: [upright.position[0], height - tabletopThickness, shelfZ],
        materialSlot: 'hardware',
      }),
    );
    for (const screw of shelfScrews) {
      parts.push(toPlanPart(screw, screw.id, 'hardware'));
    }

    uprights.forEach((upright, index) => {
      connections.push(
        createConnection({
          id: `gaming-desk-shelf-upright-${index + 1}-top`,
          type: 'screw',
          componentIds: [upright.id, mapId('desk-tabletop')],
          position: shelfScrews[index].position,
          direction: [0, 1, 0],
          hardwareId: shelfScrews[index].id,
        }),
      );
      connections.push(
        createConnection({
          id: `gaming-desk-shelf-upright-${index + 1}-board`,
          type: 'fixed',
          componentIds: [upright.id, shelf.id],
          position: [upright.position[0], height + spec.monitorShelfHeight, shelfZ],
          direction: [0, 1, 0],
        }),
      );
    });
  }

  return { parts, connections, warnings: base.warnings };
}

export const gamingDeskDefinition: FurnitureDefinition<GamingDeskSpec> = {
  id: GAMING_DESK_DEFINITION_ID,
  version: 1,
  family: 'table',
  label: 'Gaming stoli',
  fields: FIELDS,
  defaults: DEFAULT_GAMING_DESK_SPEC,
  slots: SLOTS,
  limits: {
    maxParts: 64,
    maxPartVertices: 50_000,
    maxPartTriangles: 100_000,
    maxTotalVertices: 300_000,
  },
  groupName: 'gaming-desk-assembly',
  parseSpec: parseGamingDeskSpec,
  solve: solveGamingDeskPlan,
};

registerFurnitureDefinition(gamingDeskDefinition);
