import { describe, expect, it } from 'vitest';
import { buildPlanWithDefinition } from '../universal/build';
import {
  ROOM_STANDARD_DEFINITION_ID,
  requireRoomDefinition,
  createRoomPlan,
} from './index';
import { DEFAULT_ROOM_SPEC, parseRoomSpec } from './roomSpec';
import type {
  DoorOpeningConfig,
  RoomOpeningSpec,
  RoomSpec,
  WindowOpeningConfig,
} from './types';

function specWith(openings: RoomOpeningSpec[]): RoomSpec {
  return { ...DEFAULT_ROOM_SPEC, openings };
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

function doorConfig(overrides: Partial<DoorOpeningConfig> = {}): DoorOpeningConfig {
  return {
    frameWidthCm: 6,
    frameDepthCm: 4,
    leafThicknessCm: 4,
    leafInsetCm: 0.5,
    hingeSide: 'left',
    swingDirection: 'inward',
    swingAngleDeg: 0,
    handleHeightCm: 100,
    ...overrides,
  };
}

function windowConfig(overrides: Partial<WindowOpeningConfig> = {}): WindowOpeningConfig {
  return {
    frameWidthCm: 6,
    frameDepthCm: 4,
    glassThicknessCm: 1,
    sillThicknessCm: 4,
    mullionCount: 0,
    transomCount: 0,
    ...overrides,
  };
}

function partsById(plan: ReturnType<typeof createRoomPlan>) {
  return new Map(plan.parametric.parts.map((part) => [part.id, part]));
}

describe('door components', () => {
  it('derives a default frame, leaf, handle and hinge metadata', () => {
    const plan = createRoomPlan(ROOM_STANDARD_DEFINITION_ID, specWith([door()]));
    const parts = partsById(plan);
    const opening = plan.openings[0];
    expect(opening.type).toBe('door');
    expect(opening.door).toBeDefined();
    if (!opening.door) return;

    expect(opening.door.framePartIds).toEqual([
      'door-1-door-frame-left',
      'door-1-door-frame-right',
      'door-1-door-frame-header',
    ]);
    expect(opening.door.leafPartId).toBe('door-1-door-leaf');
    expect(opening.door.handlePartId).toBe('door-1-door-handle');
    expect(opening.door.hingeCount).toBe(3);
    expect(opening.door.hingePositions).toHaveLength(3);
    expect(opening.door.hingeSide).toBe('left');
    expect(opening.door.swingDirection).toBe('inward');
    expect(opening.door.swingAngleDeg).toBe(0);
    expect(opening.door.openRotationYDeg).toBe(0);

    expect(parts.get('door-1-door-frame-left')?.type).toBe('door-frame');
    expect(parts.get('door-1-door-frame-left')?.dimensions).toEqual({
      width: 6,
      height: 200,
      depth: 4,
    });
    expect(parts.get('door-1-door-frame-left')?.materialSlot).toBe('door-frame');
    expect(parts.get('door-1-door-leaf')?.dimensions).toEqual({
      width: 77,
      height: 193,
      depth: 4,
    });
    expect(parts.get('door-1-door-leaf')?.materialSlot).toBe('door-leaf');
    expect(parts.get('door-1-door-handle')?.type).toBe('door-handle');
    expect(parts.get('door-1-door-handle')?.materialSlot).toBe('door-hardware');
    expect(parts.get('door-1-door-handle')?.position).toEqual([-23.5, 100, -247]);
    expect(opening.door.closedPosition).toEqual([-59, 97, -252]);
    expect(opening.door.closedRotationDeg).toEqual([0, 0, 0]);
    expect(opening.door.pivot).toEqual([-97, 0.5, -252]);
    expect(opening.door.hingePositions[0]).toEqual([-97, 48.75, -252]);
  });

  it('canonicalises partial door/window configs with defaults', () => {
    const parsed = parseRoomSpec({
      openings: [
        door({ door: { frameWidthCm: 8 } as never }),
        windowOpening({ window: { mullionCount: 1 } as never }),
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.spec.openings?.[0].door).toEqual(doorConfig({ frameWidthCm: 8 }));
    expect(parsed.spec.openings?.[1].window).toEqual(
      windowConfig({ mullionCount: 1 }),
    );
  });

  it('honours right hinge and outward swing metadata', () => {
    const plan = createRoomPlan(
      ROOM_STANDARD_DEFINITION_ID,
      specWith([
        door({
          door: doorConfig({
            hingeSide: 'right',
            swingDirection: 'outward',
            swingAngleDeg: 60,
            handleHeightCm: 110,
          }),
        }),
      ]),
    );
    const doorPlan = plan.openings[0].door;
    expect(doorPlan).toBeDefined();
    if (!doorPlan) return;
    expect(doorPlan.hingeSide).toBe('right');
    expect(doorPlan.swingDirection).toBe('outward');
    expect(doorPlan.swingAngleDeg).toBe(60);
    expect(doorPlan.openRotationYDeg).toBe(-60);
    expect(doorPlan.hingePositions[0][0]).toBeGreaterThan(
      plan.openings[0].center[0],
    );
    const handle = plan.parametric.parts.find(
      (part) => part.id === 'door-1-door-handle',
    );
    expect(handle?.position[1]).toBe(110);
  });

  it('rejects invalid door component parameters', () => {
    const invalid: unknown[] = [
      { openings: [door({ door: doorConfig({ frameWidthCm: 50 }) })] },
      { openings: [door({ door: doorConfig({ frameDepthCm: 5 }) })] },
      { openings: [door({ door: doorConfig({ leafThicknessCm: 12 }) })] },
      { openings: [door({ door: doorConfig({ leafInsetCm: 50 }) })] },
      { openings: [door({ door: doorConfig({ swingAngleDeg: -1 }) })] },
      { openings: [door({ door: doorConfig({ swingAngleDeg: 121 }) })] },
      { openings: [door({ door: doorConfig({ handleHeightCm: 250 }) })] },
      { openings: [door({ door: doorConfig({ hingeSide: 'middle' as never }) })] },
      { openings: [door({ door: doorConfig({ swingDirection: 'sideways' as never }) })] },
      {
        openings: [
          door({ door: { ...doorConfig(), unknownField: true } as never }),
        ],
      },
      { openings: [windowOpening({ door: doorConfig() })] },
      { openings: [door({ window: windowConfig() })] },
    ];
    for (const input of invalid) {
      expect(parseRoomSpec(input).ok).toBe(false);
    }
  });
});

describe('window components', () => {
  it('derives a frame, glass and sill for the default window', () => {
    const plan = createRoomPlan(ROOM_STANDARD_DEFINITION_ID, specWith([windowOpening()]));
    const parts = partsById(plan);
    const opening = plan.openings[0];
    expect(opening.window).toBeDefined();
    if (!opening.window) return;
    expect(opening.window.framePartIds).toEqual([
      'window-1-window-frame-left',
      'window-1-window-frame-right',
      'window-1-window-frame-top',
      'window-1-window-frame-bottom',
    ]);
    expect(opening.window.glassPartIds).toEqual(['window-1-window-glass-1-1']);
    expect(opening.window.sillPartId).toBe('window-1-window-sill');
    expect(opening.window.mullionPartIds).toEqual([]);
    expect(opening.window.transomPartIds).toEqual([]);

    expect(parts.get('window-1-window-glass-1-1')?.dimensions).toEqual({
      width: 88,
      height: 84,
      depth: 1,
    });
    expect(parts.get('window-1-window-frame-left')?.dimensions).toEqual({
      width: 6,
      height: 96,
      depth: 4,
    });
    expect(parts.get('window-1-window-frame-top')?.dimensions).toEqual({
      width: 88,
      height: 6,
      depth: 4,
    });
    expect(parts.get('window-1-window-sill')?.dimensions).toEqual({
      width: 100,
      height: 4,
      depth: 8,
    });
    expect(parts.get('window-1-window-glass-1-1')?.materialSlot).toBe(
      'window-glass',
    );
    expect(parts.get('window-1-window-sill')?.materialSlot).toBe('window-sill');
  });

  it('derives mullions, transoms and glass cells', () => {
    const plan = createRoomPlan(
      ROOM_STANDARD_DEFINITION_ID,
      specWith([
        windowOpening({
          window: windowConfig({ mullionCount: 1, transomCount: 1 }),
        }),
      ]),
    );
    const opening = plan.openings[0].window;
    expect(opening).toBeDefined();
    if (!opening) return;
    expect(opening.glassPartIds).toHaveLength(4);
    expect(opening.mullionPartIds).toHaveLength(1);
    expect(opening.transomPartIds).toHaveLength(1);
    expect(plan.parametric.parts.filter((part) => part.type === 'window-glass')).toHaveLength(4);
    expect(plan.parametric.parts.filter((part) => part.type === 'mullion')).toHaveLength(1);
    expect(plan.parametric.parts.filter((part) => part.type === 'transom')).toHaveLength(1);
    const mullion = plan.parametric.parts.find((part) => part.type === 'mullion');
    const transom = plan.parametric.parts.find((part) => part.type === 'transom');
    expect(mullion?.dimensions).toEqual({ width: 3, height: 84, depth: 4 });
    expect(transom?.dimensions).toEqual({ width: 88, height: 3, depth: 4 });
  });

  it('rejects invalid window component parameters', () => {
    const invalid: unknown[] = [
      { openings: [windowOpening({ window: windowConfig({ frameWidthCm: 50 }) })] },
      { openings: [windowOpening({ window: windowConfig({ frameDepthCm: 5 }) })] },
      { openings: [windowOpening({ window: windowConfig({ glassThicknessCm: 9 }) })] },
      { openings: [windowOpening({ window: windowConfig({ glassThicknessCm: 0 }) })] },
      { openings: [windowOpening({ window: windowConfig({ sillThicknessCm: 0 }) })] },
      { openings: [windowOpening({ window: windowConfig({ sillThicknessCm: 90 }) })] },
      { openings: [windowOpening({ window: windowConfig({ mullionCount: 1.5 as never }) })] },
      { openings: [windowOpening({ window: windowConfig({ transomCount: 1.5 as never }) })] },
      {
        openings: [
          windowOpening({ window: { ...windowConfig(), unknownField: true } as never }),
        ],
      },
    ];
    for (const input of invalid) {
      expect(parseRoomSpec(input).ok).toBe(false);
    }
  });
});

describe('opening component plan integration', () => {
  it('keeps part ids unique and is deterministic', () => {
    const spec = specWith([door(), windowOpening()]);
    const first = createRoomPlan(ROOM_STANDARD_DEFINITION_ID, spec);
    const second = createRoomPlan(ROOM_STANDARD_DEFINITION_ID, spec);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    const ids = first.parametric.parts.map((part) => part.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('materialises components through the generic pipeline', () => {
    const definition = requireRoomDefinition(ROOM_STANDARD_DEFINITION_ID);
    const plan = createRoomPlan(
      ROOM_STANDARD_DEFINITION_ID,
      specWith([door(), windowOpening()]),
    );
    const built = buildPlanWithDefinition(plan.parametric, definition.parametric);
    try {
      const names: string[] = [];
      built.group.traverse((object) => {
        if ((object as { isMesh?: boolean }).isMesh) names.push(object.name);
      });
      expect(names).toContain('door-1-door-frame-left');
      expect(names).toContain('door-1-door-leaf');
      expect(names).toContain('door-1-door-handle');
      expect(names).toContain('window-1-window-glass-1-1');
      expect(names).toContain('window-1-window-sill');
      expect(built.materialSlots).toEqual([
        'floor',
        'wall',
        'door-frame',
        'door-leaf',
        'door-hardware',
        'window-frame',
        'window-glass',
        'window-sill',
        'baseboard',
      ]);
    } finally {
      built.dispose();
    }
  });
});
