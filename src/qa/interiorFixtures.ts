/**
 * Phase 9A.2.8 — deterministic interior QA fixtures.
 *
 * One module builds every scene the parity harness exports and the unit tests
 * assert against, so the browser harness, Blender parity run and Vitest cannot
 * drift apart. Coordinates are centimetres in the scene convention: floor top
 * at Y = 0, room centred on the local X/Z origin.
 */
import { ROOM_STANDARD_DEFINITION_ID } from '../geometry/interior/roomDefinition';
import { DEFAULT_ROOM_SPEC } from '../geometry/interior/roomSpec';
import { createRoomInstance } from '../scene/roomInstance';
import { createDefaultSettings } from '../scene/sceneSettings';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  createUniversalSceneObject,
  type RoomInstance,
  type SceneData,
} from '../scene/types';

export interface InteriorRayExpectation {
  readonly id: string;
  readonly description: string;
  /** World-space origin in centimetres. */
  readonly originCm: readonly [number, number, number];
  /** Direction in world space; normalised by the Blender script. */
  readonly directionCm: readonly [number, number, number];
  readonly expect: 'pass' | 'block';
  /** Only objects whose name contains one of these strings are hit-tested. */
  readonly objectNameIncludes: readonly string[];
}

export interface InteriorFixtureExpectations {
  /** Total world-space bounds in centimetres, [x, y, z]. */
  readonly bboxCm: readonly [number, number, number];
  readonly bboxToleranceCm: number;
  readonly minMeshes: number;
  readonly wallParts: number;
  readonly ceilingParts: number;
  readonly baseboardParts: number;
  readonly crownParts: number;
  readonly minImages: number;
  readonly materialRoughness: Readonly<Record<string, number>>;
  readonly materialMetallic: Readonly<Record<string, number>>;
  readonly glass?: { readonly material: string; readonly alpha: number };
  readonly requiredObjectNames: readonly string[];
  readonly forbiddenObjectNames: readonly string[];
  readonly requiredNameIncludes: readonly string[];
  readonly roomTranslationsCm: Readonly<Record<string, readonly [number, number, number]>>;
  /** Real-world tile per floor mesh, sorted; 50 cm is the global default. */
  readonly floorTilesCm: readonly number[];
  readonly baseboardTileCm: number;
  readonly crownTileCm: number;
  readonly rays: readonly InteriorRayExpectation[];
}

export interface InteriorFixture {
  readonly id: string;
  readonly label: string;
  readonly scene: SceneData;
  readonly expectations: InteriorFixtureExpectations;
}

const ROOM_MATERIALS = {
  floor: { materialId: 'oak-parquet' },
  wall: { materialId: 'paint-white' },
  ceiling: { materialId: 'ceiling-white' },
  baseboard: { materialId: 'baseboard-oak' },
  'crown-molding': { materialId: 'crown-white' },
  'door-frame': { materialId: 'wood-oak' },
  'door-leaf': { materialId: 'wood-oak' },
  'door-hardware': { materialId: 'metal-satin-black' },
  'window-frame': { materialId: 'wood-oak' },
  'window-glass': { materialId: 'glass-clear' },
  'window-sill': { materialId: 'paint-white' },
} as const;

const OPENINGS = [
  {
    id: 'door-1',
    type: 'door' as const,
    wallId: 'north' as const,
    offsetCm: 100,
    widthCm: 90,
    heightCm: 200,
    sillHeightCm: 0,
  },
  {
    id: 'window-1',
    type: 'window' as const,
    wallId: 'north' as const,
    offsetCm: 250,
    widthCm: 100,
    heightCm: 100,
    sillHeightCm: 90,
  },
];

function openingRoom(id: string, overrides: Partial<RoomInstance> = {}): RoomInstance {
  return {
    ...createRoomInstance(ROOM_STANDARD_DEFINITION_ID, id, {
      ...DEFAULT_ROOM_SPEC,
      showCeiling: true,
      openings: OPENINGS,
      materials: ROOM_MATERIALS,
    }),
    ...overrides,
  };
}

function plainRoom(
  id: string,
  specOverrides: Record<string, unknown>,
  overrides: Partial<RoomInstance> = {},
): RoomInstance {
  return {
    ...createRoomInstance(ROOM_STANDARD_DEFINITION_ID, id, {
      ...DEFAULT_ROOM_SPEC,
      showCeiling: true,
      ...specOverrides,
    }),
    ...overrides,
  };
}

function sceneWith(rooms: RoomInstance[], objects: SceneData['objects'] = []): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    room: { ...ROOM_DEFAULTS },
    objects,
    settings: createDefaultSettings(),
    rooms,
  };
}

/** Door, window and solid-wall rays for the 400 × 500 room at the origin. */
const ROOM_A_RAYS: readonly InteriorRayExpectation[] = [
  {
    id: 'door-opening',
    description: 'Door centre passes through the north wall',
    originCm: [-59, 100, -200],
    directionCm: [0, 0, -1],
    expect: 'pass',
    objectNameIncludes: ['room-wall-north'],
  },
  {
    id: 'window-opening',
    description: 'Window centre passes through the north wall',
    originCm: [96, 140, -200],
    directionCm: [0, 0, -1],
    expect: 'pass',
    objectNameIncludes: ['room-wall-north'],
  },
  {
    id: 'solid-wall',
    description: 'Solid north wall blocks the ray',
    originCm: [150, 100, -200],
    directionCm: [0, 0, -1],
    expect: 'block',
    objectNameIncludes: ['room-wall-north'],
  },
];

const INTERIOR_FIXTURE_LIST: readonly InteriorFixture[] = [
  {
    id: 'room-only',
    label: 'Room only: 400 × 500 × 280 with door, window, ceiling and trim',
    scene: sceneWith([openingRoom('room-a')]),
    expectations: {
      bboxCm: [408, 288, 510],
      bboxToleranceCm: 1,
      minMeshes: 26,
      wallParts: 4,
      ceilingParts: 1,
      baseboardParts: 5,
      crownParts: 4,
      minImages: 5,
      materialRoughness: {
        Room_Floor: 0.58,
        Room_Wall: 0.85,
        Room_Ceiling: 0.9,
        Room_Baseboard: 0.6,
        Room_Crown_Molding: 0.8,
      },
      materialMetallic: { Room_Door_Hardware: 1.0 },
      glass: { material: 'Room_Window_Glass', alpha: 0.3 },
      requiredObjectNames: [
        'room-floor',
        'room-ceiling',
        'room-wall-north',
        'door-1-door-leaf',
        'window-1-window-glass-1-1',
      ],
      forbiddenObjectNames: [],
      requiredNameIncludes: ['room-baseboard', 'room-crown-molding'],
      roomTranslationsCm: { 'room-a': [0, 0, 0] },
      floorTilesCm: [100],
      baseboardTileCm: 100,
      crownTileCm: 100,
      rays: ROOM_A_RAYS,
    },
  },
  {
    id: 'furniture-room',
    label: 'Furniture + room: computer desk inside the same room',
    scene: sceneWith(
      [openingRoom('room-furniture')],
      [
        createUniversalSceneObject('desk.computer', 'desk-1', undefined, {
          name: 'Kompyuter stoli',
          position: { x: 0, y: 0, z: 0 },
          material: {
            materialId: 'wood-oak',
            metalness: 0.0,
            roughness: 0.6,
          },
        }),
      ],
    ),
    expectations: {
      bboxCm: [408, 288, 510],
      bboxToleranceCm: 1,
      minMeshes: 40,
      wallParts: 4,
      ceilingParts: 1,
      baseboardParts: 5,
      crownParts: 4,
      minImages: 5,
      materialRoughness: {
        Room_Floor: 0.58,
        Room_Wall: 0.85,
        Room_Ceiling: 0.9,
        Room_Baseboard: 0.6,
        Room_Crown_Molding: 0.8,
      },
      materialMetallic: { Room_Door_Hardware: 1.0 },
      glass: { material: 'Room_Window_Glass', alpha: 0.3 },
      requiredObjectNames: ['room-floor', 'object:desk-1'],
      forbiddenObjectNames: [],
      requiredNameIncludes: ['room-baseboard', 'room-crown-molding', 'desk'],
      roomTranslationsCm: { 'room-furniture': [0, 0, 0] },
      floorTilesCm: [100],
      baseboardTileCm: 100,
      crownTileCm: 100,
      rays: ROOM_A_RAYS,
    },
  },
  {
    id: 'multi-room',
    label: 'Multi-room: opening room plus a smaller room at X = 700 cm',
    scene: sceneWith([
      openingRoom('room-a'),
      plainRoom(
        'room-b',
        {
          widthCm: 300,
          lengthCm: 350,
          heightCm: 260,
          materials: {
            floor: { materialId: 'marble' },
            wall: { materialId: 'paint-gray' },
            ceiling: { materialId: 'ceiling-matte' },
            baseboard: { materialId: 'baseboard-white' },
            'crown-molding': { materialId: 'crown-matte' },
          },
        },
        { position: { x: 700, y: 0, z: 0 } },
      ),
    ]),
    expectations: {
      bboxCm: [1058, 288, 510],
      bboxToleranceCm: 1,
      minMeshes: 40,
      wallParts: 8,
      ceilingParts: 2,
      baseboardParts: 9,
      crownParts: 8,
      minImages: 5,
      materialRoughness: {
        Room_Floor: 0.58,
        Room_Wall: 0.85,
        Room_Baseboard: 0.6,
        Room_Crown_Molding: 0.8,
      },
      materialMetallic: { Room_Door_Hardware: 1.0 },
      glass: { material: 'Room_Window_Glass', alpha: 0.3 },
      requiredObjectNames: ['room:room-a', 'room:room-b'],
      forbiddenObjectNames: [],
      requiredNameIncludes: ['room-floor', 'room-baseboard', 'room-crown-molding'],
      roomTranslationsCm: {
        'room-a': [0, 0, 0],
        'room-b': [700, 0, 0],
      },
      floorTilesCm: [100, 120],
      baseboardTileCm: 100,
      crownTileCm: 100,
      rays: ROOM_A_RAYS,
    },
  },
  {
    id: 'hidden-room',
    label: 'Hidden room: one visible room, one visible:false room',
    scene: sceneWith([
      plainRoom('room-visible', {}),
      plainRoom(
        'room-hidden',
        { widthCm: 300, lengthCm: 300, heightCm: 240 },
        { position: { x: 800, y: 0, z: 0 }, visible: false },
      ),
    ]),
    expectations: {
      bboxCm: [408, 288, 508],
      bboxToleranceCm: 1,
      minMeshes: 14,
      wallParts: 4,
      ceilingParts: 1,
      baseboardParts: 4,
      crownParts: 4,
      minImages: 2,
      materialRoughness: {
        Room_Floor: 0.65,
        Room_Wall: 0.6,
        Room_Ceiling: 0.6,
        Room_Baseboard: 0.7,
        Room_Crown_Molding: 0.8,
      },
      materialMetallic: {},
      requiredObjectNames: ['room:room-visible'],
      forbiddenObjectNames: ['room:room-hidden'],
      requiredNameIncludes: ['room-baseboard', 'room-crown-molding'],
      roomTranslationsCm: { 'room-visible': [0, 0, 0] },
      floorTilesCm: [50],
      baseboardTileCm: 100,
      crownTileCm: 100,
      rays: [],
    },
  },
];

export const INTERIOR_FIXTURES: readonly InteriorFixture[] = Object.freeze(
  INTERIOR_FIXTURE_LIST,
);

export function getInteriorFixture(id: string): InteriorFixture | undefined {
  return INTERIOR_FIXTURES.find((fixture) => fixture.id === id);
}
