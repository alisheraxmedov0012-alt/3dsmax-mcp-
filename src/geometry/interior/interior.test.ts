import { describe, expect, it } from 'vitest';
import { buildRoom } from '../buildRoom';
import { FURNITURE_TYPES } from '../furniture/types';
import { listParametricDefinitions, parametricDefinitions } from '../parametric/registry';
import { buildPlanWithDefinition } from '../universal/build';
import { furnitureDefinitions } from '../universal/registry';
import { DEFAULT_ROOM_SPEC, parseRoomSpec, ROOM_OPENING_EDGE_MARGIN_CM, ROOM_OPENING_MIN_GAP_CM, ROOM_OPENING_MIN_LINTEL_CM, MAX_ROOM_OPENINGS } from './roomSpec';
import {
  createRectangularBoundary,
  createRoomLayout,
  solveRoomMetadata,
  validateRoomBoundary,
} from './roomPlan';
import {
  ROOM_STANDARD_DEFINITION_ID,
  ROOM_SLOTS,
  roomStandardDefinition,
  solveRoomParts,
  wallExtrudeRecipe,
} from './roomDefinition';
import {
  InteriorDefinitionRegistry,
  createRoomPlan,
  defineRoomDefinition,
  interiorDefinitions,
  listInteriorDefinitions,
  requireRoomDefinition,
  tryCreateRoomPlan,
} from './registry';
import {
  INTERIOR_DOMAIN,
  ROOM_FAMILY,
  InteriorError,
  type RoomOpeningSpec,
  type RoomSpec,
} from './types';

const FURNITURE_DEFINITION_IDS = [
  'bed.standard',
  'cabinet.standard',
  'chair.armchair',
  'chair.dining',
  'chair.ergonomic',
  'chair.office',
  'desk.computer',
  'desk.gaming',
  'desk.writing',
  'kitchen.baseCabinet',
  'sofa.standard',
  'stand.tv',
  'table.dining',
];

function specWith(overrides: Partial<RoomSpec>): RoomSpec {
  return { ...DEFAULT_ROOM_SPEC, ...overrides };
}

function door(overrides: Partial<RoomOpeningSpec> = {}): RoomOpeningSpec {
  return {
    id: 'door-1',
    type: 'door',
    wallId: 'north',
    offsetCm: 100,
    widthCm: 90,
    heightCm: 200,
    sillHeightCm: 0,
    ...overrides,
  };
}

function windowOpening(overrides: Partial<RoomOpeningSpec> = {}): RoomOpeningSpec {
  return {
    id: 'window-1',
    type: 'window',
    wallId: 'north',
    offsetCm: 250,
    widthCm: 100,
    heightCm: 100,
    sillHeightCm: 90,
    ...overrides,
  };
}

describe('RoomSpec parsing', () => {
  it('provides canonical defaults', () => {
    const result = parseRoomSpec({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec).toEqual(DEFAULT_ROOM_SPEC);
    expect(Object.isFrozen(DEFAULT_ROOM_SPEC)).toBe(true);
    expect(result.spec).toEqual({
      widthCm: 400,
      lengthCm: 500,
      heightCm: 280,
      wallThicknessCm: 4,
      floorThicknessCm: 4,
      ceilingThicknessCm: 4,
      showCeiling: false,
      roomType: 'generic',
      openings: [],
    });
  });

  it('accepts the minimum and maximum documented dimensions', () => {
    const minimum = parseRoomSpec({
      widthCm: 100,
      lengthCm: 100,
      heightCm: 100,
      wallThicknessCm: 1,
      floorThicknessCm: 1,
      ceilingThicknessCm: 1,
      showCeiling: true,
      roomType: 'living',
    });
    expect(minimum.ok).toBe(true);

    const maximum = parseRoomSpec({
      widthCm: 2000,
      lengthCm: 2000,
      heightCm: 600,
      wallThicknessCm: 100,
      floorThicknessCm: 100,
      ceilingThicknessCm: 100,
      showCeiling: false,
      roomType: 'office',
    });
    expect(maximum.ok).toBe(true);
  });

  it('rejects non-finite, negative, zero and out-of-range values', () => {
    const invalid: unknown[] = [
      { widthCm: Number.NaN },
      { lengthCm: Infinity },
      { heightCm: -1 },
      { widthCm: 99 },
      { lengthCm: 2001 },
      { wallThicknessCm: 0 },
      { floorThicknessCm: -5 },
      { ceilingThicknessCm: 101 },
      { wallThicknessCm: '4' },
      { showCeiling: 'yes' },
      { roomType: 'Living Room' },
      { roomType: ' ' },
      { unknownField: 1 },
    ];
    for (const input of invalid) {
      const result = parseRoomSpec(input);
      expect(result.ok, JSON.stringify(input)).toBe(false);
    }
  });

  it('rejects cross-field geometry that closes the interior', () => {
    expect(parseRoomSpec({ widthCm: 100, wallThicknessCm: 50 }).ok).toBe(false);
    expect(parseRoomSpec({ heightCm: 100, floorThicknessCm: 100 }).ok).toBe(false);
    expect(parseRoomSpec({ heightCm: 100, ceilingThicknessCm: 100 }).ok).toBe(false);
  });

  it('canonicalizes key order and trims roomType', () => {
    const first = parseRoomSpec({
      roomType: ' office ',
      showCeiling: true,
      widthCm: 300,
      lengthCm: 400,
      heightCm: 300,
      wallThicknessCm: 5,
      floorThicknessCm: 3,
      ceilingThicknessCm: 3,
    });
    const second = parseRoomSpec({
      ceilingThicknessCm: 3,
      floorThicknessCm: 3,
      wallThicknessCm: 5,
      heightCm: 300,
      lengthCm: 400,
      widthCm: 300,
      showCeiling: true,
      roomType: 'office',
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(JSON.stringify(first.spec)).toBe(JSON.stringify(second.spec));
    expect(Object.keys(first.spec)).toEqual([
      'widthCm',
      'lengthCm',
      'heightCm',
      'wallThicknessCm',
      'floorThicknessCm',
      'ceilingThicknessCm',
      'showCeiling',
      'roomType',
      'openings',
    ]);
  });
});

describe('RoomSpec openings', () => {
  it('defaults openings to an empty list and preserves an explicit empty list', () => {
    const absent = parseRoomSpec({});
    expect(absent.ok).toBe(true);
    if (!absent.ok) return;
    expect(absent.spec.openings).toEqual([]);

    const empty = parseRoomSpec({ openings: [] });
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    expect(empty.spec.openings).toEqual([]);
  });

  it('parses valid doors, windows and multiple openings canonically', () => {
    const result = parseRoomSpec({
      openings: [door(), windowOpening()],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.openings).toEqual([door(), windowOpening()]);
    expect(Object.keys(result.spec)).toEqual([
      'widthCm',
      'lengthCm',
      'heightCm',
      'wallThicknessCm',
      'floorThicknessCm',
      'ceilingThicknessCm',
      'showCeiling',
      'roomType',
      'openings',
    ]);
  });

  it('rejects malformed opening values and unknown keys', () => {
    const invalid: unknown[] = [
      { openings: [door({ type: 'arch' as never })] },
      { openings: [door({ wallId: 'floor' as never })] },
      { openings: [door({ id: '' })] },
      { openings: [door({ offsetCm: Number.NaN })] },
      { openings: [door({ widthCm: 0 })] },
      { openings: [door({ heightCm: -1 })] },
      { openings: [door({ sillHeightCm: 10 })] },
      { openings: [door({ extra: true } as never)] },
      { openings: [door({ id: 'same' }), door({ id: 'same' })] },
    ];
    for (const input of invalid) {
      expect(parseRoomSpec(input).ok).toBe(false);
    }
  });

  it('enforces wall edge margins, lintel and vertical bounds', () => {
    const tooClose = door({ offsetCm: ROOM_OPENING_EDGE_MARGIN_CM - 1 });
    const pastEnd = door({ offsetCm: 400, widthCm: 20 });
    const noLintel = door({ heightCm: 280 });
    const windowTooHigh = windowOpening({ sillHeightCm: 200, heightCm: 100 });
    for (const entry of [tooClose, pastEnd, noLintel, windowTooHigh]) {
      expect(parseRoomSpec({ openings: [entry] }).ok).toBe(false);
    }
    expect(
      parseRoomSpec({
        openings: [door({ heightCm: 280 - ROOM_OPENING_MIN_LINTEL_CM })],
      }).ok,
    ).toBe(true);
  });

  it('rejects overlapping openings and too-small gaps on one wall', () => {
    const overlap = [
      door({ id: 'a', offsetCm: 100, widthCm: 80 }),
      windowOpening({ id: 'b', offsetCm: 150, widthCm: 80 }),
    ];
    const tooTight = [
      door({ id: 'a', offsetCm: 100, widthCm: 80 }),
      windowOpening({
        id: 'b',
        offsetCm: 100 + 80 + ROOM_OPENING_MIN_GAP_CM - 1,
        widthCm: 80,
      }),
    ];
    expect(parseRoomSpec({ openings: overlap }).ok).toBe(false);
    expect(parseRoomSpec({ openings: tooTight }).ok).toBe(false);

    const validGap = [
      door({ id: 'a', offsetCm: 100, widthCm: 80 }),
      windowOpening({
        id: 'b',
        offsetCm: 100 + 80 + ROOM_OPENING_MIN_GAP_CM,
        widthCm: 80,
      }),
    ];
    expect(parseRoomSpec({ openings: validGap }).ok).toBe(true);
  });

  it('enforces the per-room opening cap', () => {
    const openings = Array.from({ length: MAX_ROOM_OPENINGS + 1 }, (_, index) =>
      door({
        id: `d-${index}`,
        offsetCm: ROOM_OPENING_EDGE_MARGIN_CM + index * 30,
        widthCm: 20,
      }),
    );
    expect(parseRoomSpec({ openings }).ok).toBe(false);
  });
});


describe('RoomBoundary', () => {
  it('creates a deterministic rectangular boundary in NW, NE, SE, SW order', () => {
    const boundary = createRectangularBoundary(400, 500);
    expect(boundary.kind).toBe('rectangle');
    expect(boundary.widthCm).toBe(400);
    expect(boundary.lengthCm).toBe(500);
    expect(boundary.areaCm2).toBe(200_000);
    expect(boundary.points).toEqual([
      [-200, -250],
      [200, -250],
      [200, 250],
      [-200, 250],
    ]);
    expect(Object.isFrozen(boundary)).toBe(true);
    expect(Object.isFrozen(boundary.points)).toBe(true);
  });

  it('rejects degenerate, duplicate, non-finite and clockwise boundaries', () => {
    expect(validateRoomBoundary([[0, 0], [100, 0], [200, 0]]).ok).toBe(false);
    expect(validateRoomBoundary([[0, 0], [100, 0], [100, 0], [0, 100]]).ok).toBe(false);
    expect(validateRoomBoundary([[0, 0], [Number.NaN, 0], [0, 100]]).ok).toBe(false);
    expect(validateRoomBoundary([[0, 0], [100, 0]]).ok).toBe(false);
    expect(
      validateRoomBoundary([
        [-200, -250],
        [-200, 250],
        [200, 250],
        [200, -250],
      ]).ok,
    ).toBe(false);
  });

  it('rejects a self-intersecting polygon', () => {
    expect(
      validateRoomBoundary([
        [0, 0],
        [100, 100],
        [100, 0],
        [0, 100],
      ]).ok,
    ).toBe(false);
  });

  it('accepts a valid square and exposes its extents', () => {
    const result = validateRoomBoundary([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.boundary.widthCm).toBe(100);
    expect(result.boundary.lengthCm).toBe(100);
    expect(result.boundary.areaCm2).toBe(10_000);
  });

  it('rejects an invalid rectangle size through the plan boundary constructor', () => {
    expect(() => createRectangularBoundary(0, 500)).toThrowError(
      expect.objectContaining({ code: 'invalid_boundary' }),
    );
    expect(() => createRectangularBoundary(-400, 500)).toThrowError(
      expect.objectContaining({ code: 'invalid_boundary' }),
    );
  });
});

describe('RoomDefinition and registry', () => {
  it('registers room.standard in the interior view only', () => {
    const definition = interiorDefinitions.get(ROOM_STANDARD_DEFINITION_ID);
    expect(definition).toBeDefined();
    expect(definition?.domain).toBe(INTERIOR_DOMAIN);
    expect(definition?.family).toBe(ROOM_FAMILY);
    expect(definition?.parametric.id).toBe(ROOM_STANDARD_DEFINITION_ID);
    expect(definition?.parametric.domain).toBe(INTERIOR_DOMAIN);
    expect(definition?.parametric.family).toBe(ROOM_FAMILY);

    expect(parametricDefinitions.get(ROOM_STANDARD_DEFINITION_ID)).toBeUndefined();
    expect(
      listParametricDefinitions().some(
        (entry) => entry.id === ROOM_STANDARD_DEFINITION_ID,
      ),
    ).toBe(false);
    expect(listInteriorDefinitions().map((entry) => entry.id)).toEqual([
      ROOM_STANDARD_DEFINITION_ID,
    ]);
  });

  it('keeps the furniture registry and legacy builder type list unchanged', () => {
    expect(furnitureDefinitions.list()).toHaveLength(13);
    expect(
      furnitureDefinitions
        .list()
        .map((definition) => definition.id)
        .sort(),
    ).toEqual(FURNITURE_DEFINITION_IDS);
    expect(FURNITURE_TYPES).toHaveLength(8);
  });

  it('exposes a generic ParametricDefinition-compatible contract', () => {
    const parametric = roomStandardDefinition.parametric;
    expect(parametric.id).toBe(ROOM_STANDARD_DEFINITION_ID);
    expect(parametric.domain).toBe(INTERIOR_DOMAIN);
    expect(parametric.family).toBe(ROOM_FAMILY);
    expect(parametric.fields.length).toBe(8);
    expect(parametric.slots).toBe(ROOM_SLOTS);
    expect(parametric.parseSpec({})).toEqual({ ok: true, spec: DEFAULT_ROOM_SPEC });
    expect(parametric.solve(DEFAULT_ROOM_SPEC as RoomSpec).parts).toHaveLength(9);
    expect(solveRoomParts(DEFAULT_ROOM_SPEC as RoomSpec).parts).toHaveLength(9);
    expect(solveRoomMetadata(DEFAULT_ROOM_SPEC as RoomSpec).floor.partId).toBe(
      'room-floor',
    );
  });

  it('rejects duplicate room ids and furniture-id collisions', () => {
    const registry = new InteriorDefinitionRegistry();
    registry.register(roomStandardDefinition);
    expect(() => registry.register(roomStandardDefinition)).toThrowError(
      expect.objectContaining({ code: 'duplicate_definition' }),
    );

    const collision = {
      ...roomStandardDefinition,
      id: 'desk.computer',
      parametric: {
        ...roomStandardDefinition.parametric,
        id: 'desk.computer',
      },
    };
    expect(() => registry.register(collision)).toThrowError(
      expect.objectContaining({ code: 'duplicate_definition' }),
    );
  });

  it('rejects an invalid room definition identity', () => {
    expect(() =>
      defineRoomDefinition({
        ...roomStandardDefinition,
        domain: 'furniture' as never,
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid_definition' }));
    expect(() =>
      defineRoomDefinition({
        ...roomStandardDefinition,
        family: 'wall' as never,
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid_definition' }));
  });

  it('looks up definitions and reports unknown ids', () => {
    expect(requireRoomDefinition(ROOM_STANDARD_DEFINITION_ID).id).toBe(
      ROOM_STANDARD_DEFINITION_ID,
    );
    expect(() => requireRoomDefinition('room.missing')).toThrowError(
      expect.objectContaining({ code: 'unknown_definition' }),
    );
    expect(createRoomPlan).toBeTypeOf('function');
  });
});

describe('RoomPlan', () => {
  it('derives a floor and four walls without a ceiling by default', () => {
    const plan = createRoomPlan(ROOM_STANDARD_DEFINITION_ID, DEFAULT_ROOM_SPEC);
    expect(plan.definitionId).toBe(ROOM_STANDARD_DEFINITION_ID);
    expect(plan.domain).toBe(INTERIOR_DOMAIN);
    expect(plan.family).toBe(ROOM_FAMILY);
    expect(plan.boundary.kind).toBe('rectangle');
    expect(plan.floor.partId).toBe('room-floor');
    expect(plan.ceiling).toBeNull();
    expect(plan.openings).toEqual([]);
    expect(plan.parametric.parts.map((part) => part.id)).toEqual([
      'room-floor',
      'room-wall-north',
      'room-wall-east',
      'room-wall-south',
      'room-wall-west',
      'room-baseboard-north-1',
      'room-baseboard-east-1',
      'room-baseboard-south-1',
      'room-baseboard-west-1',
    ]);
    expect(plan.walls.map((wall) => wall.side)).toEqual([
      'north',
      'east',
      'south',
      'west',
    ]);
  });

  it('uses the expected floor and wall dimensions and centres', () => {
    const plan = createRoomPlan(ROOM_STANDARD_DEFINITION_ID, DEFAULT_ROOM_SPEC);
    const floor = plan.parametric.parts.find((part) => part.id === 'room-floor');
    expect(floor?.dimensions).toEqual({ width: 400, height: 4, depth: 500 });
    expect(floor?.position).toEqual([0, -2, 0]);
    expect(floor?.type).toBe('floor');
    expect(floor?.role).toBe('floor');
    expect(floor?.uv).toBe('physical-box');

    const north = plan.parametric.parts.find((part) => part.id === 'room-wall-north');
    expect(north?.dimensions).toEqual({ width: 408, height: 280, depth: 4 });
    expect(north?.position).toEqual([0, 140, -252]);

    const east = plan.parametric.parts.find((part) => part.id === 'room-wall-east');
    expect(east?.dimensions).toEqual({ width: 500, height: 280, depth: 4 });
    expect(east?.position).toEqual([202, 140, 0]);

    expect(plan.walls.find((wall) => wall.side === 'north')).toEqual({
      partId: 'room-wall-north',
      side: 'north',
      edgeIndex: 0,
      lengthCm: 408,
      heightCm: 280,
      thicknessCm: 4,
      center: [0, 140, -252],
      outwardNormal: [0, -1],
      materialSlot: 'wall',
      openingIds: [],
    });
    expect(plan.floor).toEqual({
      partId: 'room-floor',
      widthCm: 400,
      lengthCm: 500,
      thicknessCm: 4,
      topY: 0,
      materialSlot: 'floor',
    });
  });

  it('adds an optional ceiling with matching metadata', () => {
    const plan = createRoomPlan(
      ROOM_STANDARD_DEFINITION_ID,
      specWith({ showCeiling: true }),
    );
    expect(plan.parametric.parts).toHaveLength(14);
    expect(plan.ceiling).toEqual({
      partId: 'room-ceiling',
      widthCm: 408,
      lengthCm: 508,
      thicknessCm: 4,
      bottomY: 280,
      materialSlot: 'ceiling',
    });
    const ceiling = plan.parametric.parts.find((part) => part.id === 'room-ceiling');
    expect(ceiling?.dimensions).toEqual({ width: 408, height: 4, depth: 508 });
    expect(ceiling?.position).toEqual([0, 282, 0]);
    expect(ceiling?.type).toBe('ceiling');
  });

  it('turns opening walls into extrude parts with hole metadata', () => {
    const spec = specWith({ openings: [door(), windowOpening()] });
    const plan = createRoomPlan(ROOM_STANDARD_DEFINITION_ID, spec);
    const northPart = plan.parametric.parts.find(
      (part) => part.id === 'room-wall-north',
    );
    expect(northPart?.geometry.kind).toBe('extrude');
    expect(plan.openings).toHaveLength(2);
    expect(plan.openings[0]).toMatchObject({
      id: 'door-1',
      type: 'door',
      wallId: 'north',
      offsetCm: 100,
      widthCm: 90,
      heightCm: 200,
      sillHeightCm: 0,
      center: [-59, 100, -252],
    });
    expect(plan.openings[0].bounds).toEqual({
      min: [-104, 0, -254],
      max: [-14, 200, -250],
    });
    expect(plan.openings[1]).toMatchObject({
      id: 'window-1',
      type: 'window',
      wallId: 'north',
      center: [96, 140, -252],
    });
    expect(plan.walls.find((wall) => wall.side === 'north')?.openingIds).toEqual([
      'door-1',
      'window-1',
    ]);

    const layout = createRoomLayout(spec);
    const northWall = layout.walls.find((wall) => wall.side === 'north');
    expect(northWall?.geometryKind).toBe('extrude');
    if (!northWall) return;
    const recipe = wallExtrudeRecipe(northWall);
    expect(recipe.kind).toBe('extrude');
    expect(recipe.depth).toBe(4);
    // The door is a bottom notch; the window is an internal hole.
    expect(recipe.holes).toHaveLength(1);
    expect(recipe.profile[0]).toEqual([-204, 0]);
    expect(recipe.profile).toContainEqual([-104, 0]);
    expect(recipe.profile).toContainEqual([-104, 200]);
    expect(recipe.profile).toContainEqual([-14, 200]);
    expect(recipe.profile).toContainEqual([-14, 0]);
  });


  it('is deterministic and metadata matches the generic parts', () => {
    const first = createRoomPlan(ROOM_STANDARD_DEFINITION_ID, specWith({ showCeiling: true }));
    const second = createRoomPlan(ROOM_STANDARD_DEFINITION_ID, specWith({ showCeiling: true }));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));

    for (const wall of first.walls) {
      const part = first.parametric.parts.find((entry) => entry.id === wall.partId);
      expect(part).toBeDefined();
      expect(part?.dimensions.height).toBe(wall.heightCm);
      expect(part?.dimensions.width).toBe(wall.lengthCm);
      expect(part?.position).toEqual(wall.center);
    }
    expect(first.parametric.parts.filter((part) => part.type === 'wall')).toHaveLength(4);
  });

  it('returns typed issues for invalid specs and unknown definitions', () => {
    const invalid = tryCreateRoomPlan(ROOM_STANDARD_DEFINITION_ID, { widthCm: Number.NaN });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.issues[0].code).toBe('invalid_spec');
    }

    const missing = tryCreateRoomPlan('room.missing', {});
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.issues[0].code).toBe('unknown_definition');
    }

    expect(() =>
      createRoomPlan(ROOM_STANDARD_DEFINITION_ID, { widthCm: 0 }),
    ).toThrowError(expect.objectContaining({ code: 'invalid_room_spec' }));
    expect(() => createRoomPlan('room.missing', {})).toThrowError(
      expect.objectContaining({ code: 'unknown_definition' }),
    );
  });

  it('materialises through the existing generic build pipeline', () => {
    const definition = requireRoomDefinition(ROOM_STANDARD_DEFINITION_ID);
    const plan = createRoomPlan(
      ROOM_STANDARD_DEFINITION_ID,
      specWith({ showCeiling: true }),
    );
    const built = buildPlanWithDefinition(plan.parametric, definition.parametric);
    try {
      expect(built.materialSlots).toEqual([
        'floor',
        'wall',
        'ceiling',
        'baseboard',
        'crown-molding',
      ]);
      let meshes = 0;
      built.group.traverse((object) => {
        if ((object as { isMesh?: boolean }).isMesh) meshes += 1;
      });
      expect(meshes).toBe(14);
    } finally {
      built.dispose();
    }
  });
});

describe('legacy compatibility', () => {
  it('keeps the legacy rectangular room builder working', () => {
    const built = buildRoom({ widthCm: 400, lengthCm: 500, heightCm: 280 });
    try {
      expect(built.group.getObjectByName('room-floor')).toBeDefined();
      expect(
        built.group.children.filter((child) => child.name.startsWith('room-wall-')),
      ).toHaveLength(4);
      expect(built.group.getObjectByName('room-ceiling')).toBeUndefined();
    } finally {
      built.dispose();
    }
  });

  it('does not leak the interior definition into the furniture registry', () => {
    expect(listParametricDefinitions().map((entry) => entry.id)).not.toContain(
      ROOM_STANDARD_DEFINITION_ID,
    );
    expect(parametricDefinitions.has(ROOM_STANDARD_DEFINITION_ID)).toBe(false);
  });

  it('exposes a typed interior error', () => {
    expect(new InteriorError('invalid_boundary', 'x')).toMatchObject({
      name: 'InteriorError',
      code: 'invalid_boundary',
    });
  });
});
