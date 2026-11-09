/**
 * Phase 9A.2.1 — `room.standard` definition.
 *
 * The definition is a normal `ParametricDefinition<RoomSpec>` (9A.1), plus the
 * room-only `solveRoom` metadata. It is registered in the interior registry,
 * not the furniture registry, so `listParametricDefinitions()` is unchanged.
 */
import type {
  ParametricDefinition,
  ParametricPlanDraft,
  ParametricSlot,
} from '../parametric/types';
import type { ExtrudeRecipe, Vec2Tuple } from '../kernel';
import type { PlanPart } from '../universal/types';
import {
  INTERIOR_DOMAIN,
  ROOM_FAMILY,
  type RoomBoxLayout,
  type RoomDefinition,
  type RoomSpec,
  type RoomWallLayout,
} from './types';
import {
  DEFAULT_ROOM_SPEC,
  ROOM_SPEC_FIELDS,
  parseRoomSpec,
} from './roomSpec';
import { createRoomLayout, solveRoomMetadata } from './roomPlan';
import { resolveRoomMaterials } from './roomMaterials';
import { buildTrimParts } from './roomTrim';
import { buildOpeningAssembly } from './openingComponents';
import { DEFAULT_UV_TILE_CM } from '../../materials/types';

export const ROOM_STANDARD_DEFINITION_ID = 'room.standard';

export const ROOM_SLOTS: readonly ParametricSlot[] = [
  {
    id: 'floor',
    label: 'Pol',
    color: '#a9744f',
    materialId: 'wood-oak',
    groupName: 'room-floor-group',
    materialName: 'Room_Floor',
  },
  {
    id: 'wall',
    label: 'Devor',
    color: '#d9dee5',
    materialId: 'default',
    groupName: 'room-wall-group',
    materialName: 'Room_Wall',
  },
  {
    id: 'door-frame',
    label: 'Eshik ramkasi',
    color: '#8b5a2b',
    materialId: 'wood-oak',
    groupName: 'room-door-frame-group',
    materialName: 'Room_Door_Frame',
  },
  {
    id: 'door-leaf',
    label: 'Eshik polotnosi',
    color: '#a9744f',
    materialId: 'wood-oak',
    groupName: 'room-door-leaf-group',
    materialName: 'Room_Door_Leaf',
  },
  {
    id: 'door-hardware',
    label: 'Eshik furniturasi',
    color: '#9aa3ad',
    materialId: 'metal-satin-black',
    groupName: 'room-door-hardware-group',
    materialName: 'Room_Door_Hardware',
  },
  {
    id: 'window-frame',
    label: 'Deraza ramkasi',
    color: '#8b5a2b',
    materialId: 'wood-oak',
    groupName: 'room-window-frame-group',
    materialName: 'Room_Window_Frame',
  },
  {
    id: 'window-glass',
    label: 'Deraza oynasi',
    color: '#bfe3ea',
    materialId: 'glass-clear',
    groupName: 'room-window-glass-group',
    materialName: 'Room_Window_Glass',
  },
  {
    id: 'window-sill',
    label: 'Deraza tokchasi',
    color: '#f2f3f5',
    materialId: 'default',
    groupName: 'room-window-sill-group',
    materialName: 'Room_Window_Sill',
  },
  {
    id: 'ceiling',
    label: 'Shift',
    color: '#f2f3f5',
    materialId: 'default',
    groupName: 'room-ceiling-group',
    materialName: 'Room_Ceiling',
  },
  {
    id: 'baseboard',
    label: 'Plintus',
    color: '#f2f3f5',
    materialId: 'baseboard-white',
    groupName: 'room-baseboard-group',
    materialName: 'Room_Baseboard',
  },
  {
    id: 'crown-molding',
    label: 'Karniz',
    color: '#f7f6f3',
    materialId: 'crown-white',
    groupName: 'room-crown-molding-group',
    materialName: 'Room_Crown_Molding',
  },
];

function boxPart(layout: RoomBoxLayout): PlanPart {
  const { width, height, depth } = layout.dimensions;
  return {
    id: layout.partId,
    type: layout.type,
    role: layout.role,
    dimensions: layout.dimensions,
    geometry: { kind: 'box', width, height, depth },
    position: layout.position,
    rotation: layout.rotation,
    materialSlot: layout.materialSlot,
    // Rooms are measured in centimetres; physical-box tiling keeps future
    // floor/wall textures at a uniform texel density.
    uv: 'physical-box',
  };
}

/**
 * Wall elevation profile with real openings.
 *
 * Window openings are internal holes. Door openings (and any opening whose sill
 * is zero) are bottom notches in the outer contour: a hole touching the bottom
 * edge is not a valid closed hole, and a door must reach the floor anyway.
 * Profile X is the wall run, Y is height; extrusion depth is wall thickness.
 */
export function wallExtrudeRecipe(wall: RoomWallLayout): ExtrudeRecipe {
  const length = wall.lengthCm;
  const height = wall.dimensions.height;
  const depth = wall.dimensions.depth;
  const bottomOpenings = wall.openings
    .filter((opening) => opening.sillHeightCm <= 0)
    .slice()
    .sort((left, right) => left.offsetCm - right.offsetCm);
  const windowOpenings = wall.openings.filter(
    (opening) => opening.sillHeightCm > 0,
  );

  const profile: Vec2Tuple[] = [[-length / 2, 0]];
  for (const opening of bottomOpenings) {
    const start = opening.offsetCm - length / 2;
    const end = start + opening.widthCm;
    profile.push(
      [start, 0],
      [start, opening.heightCm],
      [end, opening.heightCm],
      [end, 0],
    );
  }
  profile.push([length / 2, 0], [length / 2, height], [-length / 2, height]);

  const holes: Vec2Tuple[][] = windowOpenings.map((opening) => {
    const start = opening.offsetCm - length / 2;
    const end = start + opening.widthCm;
    const bottom = opening.sillHeightCm;
    const top = bottom + opening.heightCm;
    // Clockwise hole winding against the counter-clockwise outer profile.
    return [
      [start, bottom],
      [start, top],
      [end, top],
      [end, bottom],
    ];
  });

  return {
    kind: 'extrude',
    profile,
    holes,
    depth,
    bevelEnabled: false,
  };
}

function wallPart(wall: RoomWallLayout): PlanPart {
  const geometry =
    wall.geometryKind === 'extrude'
      ? wallExtrudeRecipe(wall)
      : {
          kind: 'box' as const,
          width: wall.dimensions.width,
          height: wall.dimensions.height,
          depth: wall.dimensions.depth,
        };
  return {
    id: wall.partId,
    type: 'wall',
    role: 'wall',
    dimensions: wall.dimensions,
    geometry,
    position: wall.position,
    rotation: wall.rotation,
    materialSlot: wall.materialSlot,
    uv: wall.geometryKind === 'extrude' ? 'surface' : 'physical-box',
  };
}

/** Solve the generic 9A.1 geometry draft for a validated room spec. */
export function solveRoomParts(spec: RoomSpec): ParametricPlanDraft {
  const layout = createRoomLayout(spec);
  const { tiles } = resolveRoomMaterials(ROOM_SLOTS, spec);
  // Parts without an explicit physical tile keep the historical plan shape and
  // the 50 cm default, so pre-9A.2.5 rooms materialise identically.
  const withTile = (part: PlanPart): PlanPart => {
    const tile = tiles[part.materialSlot];
    return tile === undefined || tile === DEFAULT_UV_TILE_CM ? part : { ...part, uvTileCm: tile };
  };

  const parts: PlanPart[] = [withTile(boxPart(layout.floor))];
  for (const wall of layout.walls) {
    parts.push(withTile(wallPart(wall)));
    for (const opening of wall.openings) {
      for (const part of buildOpeningAssembly(wall, opening).parts) {
        parts.push(withTile(part));
      }
    }
  }
  if (layout.ceiling) {
    parts.push(withTile(boxPart(layout.ceiling)));
  }
  for (const part of buildTrimParts(spec, layout)) {
    parts.push(withTile(part));
  }
  return {
    parts,
    connections: [],
    warnings: [],
  };
}

export const roomStandardDefinition: RoomDefinition = {
  id: ROOM_STANDARD_DEFINITION_ID,
  domain: INTERIOR_DOMAIN,
  family: ROOM_FAMILY,
  label: 'Standart xona',
  parametric: {
    id: ROOM_STANDARD_DEFINITION_ID,
    version: 1,
    domain: INTERIOR_DOMAIN,
    family: ROOM_FAMILY,
    label: 'Standart xona',
    fields: ROOM_SPEC_FIELDS,
    defaults: DEFAULT_ROOM_SPEC,
    slots: ROOM_SLOTS,
    limits: {
      maxParts: 512,
      maxPartVertices: 10_000,
      maxPartTriangles: 20_000,
      maxTotalVertices: 500_000,
    },
    groupName: 'room-assembly',
    parseSpec: parseRoomSpec,
    solve: solveRoomParts,
  },
  solveRoom: solveRoomMetadata,
};

/** Type-safe view used by registry tests and future adapters. */
export const roomStandardParametric: ParametricDefinition<RoomSpec> =
  roomStandardDefinition.parametric;
