import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { getMaterialPreset } from '../../materials/presets';
import { detectMirroredUv, UV_TILE_CM } from '../../materials/uv';
import { createDefaultSettings } from '../../scene/sceneSettings';
import { parseSceneJson, serializeSceneToJson } from '../../export/sceneJson';
import {
  ROOM_DEFAULTS,
  SCENE_SCHEMA_VERSION,
  type SceneData,
} from '../../scene/types';
import { buildRoomInstance, createRoomInstance } from '../../scene/roomInstance';
import { buildPlanWithDefinition } from '../universal/build';
import type { PlanPart } from '../universal/types';
import { createRoomPlan } from './registry';
import { resolveRoomMaterials } from './roomMaterials';
import { DEFAULT_ROOM_SPEC, parseRoomSpec } from './roomSpec';
import {
  BASEBOARD_MATERIAL_SLOT,
  CROWN_MATERIAL_SLOT,
  DEFAULT_BASEBOARD,
  DEFAULT_CROWN_MOLDING,
  buildBaseboardParts,
  buildCrownMoldingParts,
  buildTrimParts,
  resolveRoomTrim,
  subtractRunIntervals,
  trimProfilePoints,
} from './roomTrim';
import {
  ROOM_SLOTS,
  ROOM_STANDARD_DEFINITION_ID,
  roomStandardDefinition,
  solveRoomParts,
} from './roomDefinition';
import type {
  RoomBaseboardSpec,
  RoomCrownMoldingSpec,
  RoomOpeningSpec,
  RoomPlan,
  RoomSpec,
  RoomTrimPartMetadata,
} from './types';

const EXPORT_METADATA = { name: 'Trim', furnitureType: null, units: 'cm' as const };
const EXPORT_TIME = '2026-01-01T00:00:00.000Z';

/**
 * Test input shape: the parser accepts a partial trim block, while the stored
 * `RoomSpec` is canonical. Keeping the two shapes distinct mirrors how a UI or
 * imported JSON reaches the parser.
 */
type RoomSpecInput = Omit<Partial<RoomSpec>, 'trim'> & {
  readonly trim?: {
    readonly baseboard?: Partial<RoomBaseboardSpec>;
    readonly crownMolding?: Partial<RoomCrownMoldingSpec>;
  };
};

function specWith(overrides: RoomSpecInput): RoomSpec {
  const parsed = parseRoomSpec({ ...DEFAULT_ROOM_SPEC, ...overrides });
  if (!parsed.ok) {
    throw new Error(parsed.errors.join(' '));
  }
  return parsed.spec;
}

function planFor(overrides: RoomSpecInput = {}): RoomPlan {
  return createRoomPlan(ROOM_STANDARD_DEFINITION_ID, { ...DEFAULT_ROOM_SPEC, ...overrides });
}

function buildPlan(plan: RoomPlan) {
  const materials = resolveRoomMaterials(ROOM_SLOTS, plan.spec);
  return buildPlanWithDefinition(plan.parametric, roomStandardDefinition.parametric, {
    ...(Object.keys(materials.overrides).length > 0
      ? { materialOverrides: materials.overrides }
      : {}),
    uvTileOverrides: materials.tiles,
  });
}

function meshesOf(group: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      found.push(object);
    }
  });
  return found;
}

function meshNamed(group: THREE.Object3D, name: string): THREE.Mesh {
  const mesh = meshesOf(group).find((entry) => entry.name === name);
  if (!mesh) {
    throw new Error(`Mesh "${name}" topilmadi.`);
  }
  return mesh;
}

function meta(part: PlanPart): RoomTrimPartMetadata {
  return part.metadata as unknown as RoomTrimPartMetadata;
}

function trimParts(plan: RoomPlan, type: 'baseboard' | 'crown-molding'): PlanPart[] {
  return plan.parametric.parts.filter((part) => part.type === type);
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

interface FaceUv {
  readonly count: number;
  readonly spanU: number;
  readonly spanV: number;
}

function faceUv(mesh: THREE.Mesh, axis: 'x' | 'y' | 'z', sign: 1 | -1): FaceUv {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  let count = 0;
  for (let index = 0; index < uv.count; index += 1) {
    if (normal.getComponent(index, axisIndex) * sign < 0.99) {
      continue;
    }
    minU = Math.min(minU, uv.getX(index));
    maxU = Math.max(maxU, uv.getX(index));
    minV = Math.min(minV, uv.getY(index));
    maxV = Math.max(maxV, uv.getY(index));
    count += 1;
  }
  return { count, spanU: maxU - minU, spanV: maxV - minV };
}

interface TrimRect {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function trimRect(part: PlanPart, spec: RoomSpec): TrimRect {
  const details = meta(part);
  const inset = details.thicknessCm ?? details.projectionCm ?? 0;
  const halfWidth = spec.widthCm / 2;
  const halfLength = spec.lengthCm / 2;
  const runToX = (run: number): number => run - (halfWidth + spec.wallThicknessCm);
  const runToZ = (run: number): number => -halfLength + run;
  switch (details.wallId) {
    case 'north':
      return {
        minX: runToX(details.segmentStartCm),
        maxX: runToX(details.segmentEndCm),
        minZ: -halfLength,
        maxZ: -halfLength + inset,
      };
    case 'south':
      return {
        minX: runToX(details.segmentStartCm),
        maxX: runToX(details.segmentEndCm),
        minZ: halfLength - inset,
        maxZ: halfLength,
      };
    case 'east':
      return {
        minX: halfWidth - inset,
        maxX: halfWidth,
        minZ: runToZ(details.segmentStartCm),
        maxZ: runToZ(details.segmentEndCm),
      };
    default:
      return {
        minX: -halfWidth,
        maxX: -halfWidth + inset,
        minZ: runToZ(details.segmentStartCm),
        maxZ: runToZ(details.segmentEndCm),
      };
  }
}

function overlapArea(first: TrimRect, second: TrimRect): number {
  const width = Math.min(first.maxX, second.maxX) - Math.max(first.minX, second.minX);
  const depth = Math.min(first.maxZ, second.maxZ) - Math.max(first.minZ, second.minZ);
  return Math.max(0, width) * Math.max(0, depth);
}

function boxOverlapVolume(first: THREE.Box3, second: THREE.Box3): number {
  const size = new THREE.Vector3();
  first.clone().intersect(second).getSize(size);
  return Math.max(0, size.x) * Math.max(0, size.y) * Math.max(0, size.z);
}

function area(points: readonly (readonly [number, number])[]): number {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current[0] * next[1] - next[0] * current[1];
  }
  return sum / 2;
}

describe('9A.2.6 — trim spec parsing', () => {
  it('leaves old specs without a trim key and resolves documented defaults', () => {
    const parsed = parseRoomSpec({ ...DEFAULT_ROOM_SPEC });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect('trim' in parsed.spec).toBe(false);
    const resolved = resolveRoomTrim(parsed.spec.trim);
    expect(resolved.baseboard).toEqual(DEFAULT_BASEBOARD);
    expect(resolved.crownMolding).toEqual(DEFAULT_CROWN_MOLDING);
    expect(resolved.baseboard.enabled).toBe(true);
    expect(resolved.baseboard.heightCm).toBe(8);
    expect(resolved.baseboard.thicknessCm).toBe(1.5);
    expect(resolved.crownMolding.heightCm).toBe(8);
    expect(resolved.crownMolding.projectionCm).toBe(5);
    expect(resolved.baseboard.profile).toBe('beveled');
  });

  it('fills a partial baseboard config to a complete canonical one', () => {
    const parsed = parseRoomSpec({
      ...DEFAULT_ROOM_SPEC,
      trim: { baseboard: { heightCm: 12 } },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.spec.trim?.baseboard).toEqual({
      enabled: true,
      heightCm: 12,
      thicknessCm: 1.5,
      profile: 'beveled',
      materialSlot: BASEBOARD_MATERIAL_SLOT,
    });
    expect(parsed.spec.trim?.crownMolding).toBeUndefined();
  });

  it('fills a partial crown config and keeps enabled:false', () => {
    const parsed = parseRoomSpec({
      ...DEFAULT_ROOM_SPEC,
      trim: { crownMolding: { enabled: false, profile: 'square', projectionCm: 7 } },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.spec.trim?.crownMolding).toEqual({
      enabled: false,
      heightCm: 8,
      projectionCm: 7,
      profile: 'square',
      materialSlot: CROWN_MATERIAL_SLOT,
    });
  });

  it('accepts all three profiles for both trim types', () => {
    for (const profile of ['square', 'beveled', 'stepped'] as const) {
      const parsed = parseRoomSpec({
        ...DEFAULT_ROOM_SPEC,
        trim: {
          baseboard: { profile },
          crownMolding: { profile },
        },
      });
      expect(parsed.ok, profile).toBe(true);
    }
  });

  it('rejects invalid profiles, sizes, slots, tiles and unknown fields', () => {
    const cases: unknown[] = [
      { baseboard: { profile: 'ornate' } },
      { baseboard: { heightCm: 0 } },
      { baseboard: { heightCm: Number.NaN } },
      { baseboard: { heightCm: 500 } },
      { baseboard: { thicknessCm: 300 } },
      { baseboard: { materialSlot: 'attic' } },
      { baseboard: { tileCm: 1 } },
      { baseboard: { glossy: true } },
      { crownMolding: { projectionCm: 0 } },
      { crownMolding: { heightCm: 500 } },
      { crownMolding: { materialSlot: 'attic' } },
      { crownMolding: { tileCm: 5000 } },
      { crownMolding: 'square' },
      { attic: {} },
    ];
    for (const trim of cases) {
      const parsed = parseRoomSpec({ ...DEFAULT_ROOM_SPEC, trim });
      expect(parsed.ok, JSON.stringify(trim)).toBe(false);
    }
    expect(parseRoomSpec({ ...DEFAULT_ROOM_SPEC, trim: 'moulding' }).ok).toBe(false);
  });

  it('rejects trim heights that cannot fit the room', () => {
    const overlap = parseRoomSpec({
      ...DEFAULT_ROOM_SPEC,
      heightCm: 20,
      trim: { baseboard: { heightCm: 12 }, crownMolding: { heightCm: 12 } },
    });
    expect(overlap.ok).toBe(false);
    const baseboard = parseRoomSpec({
      ...DEFAULT_ROOM_SPEC,
      heightCm: 20,
      trim: { baseboard: { heightCm: 20 } },
    });
    expect(baseboard.ok).toBe(false);
  });

  it('round-trips trim parameters through scene JSON', () => {
    const room = createRoomInstance(ROOM_STANDARD_DEFINITION_ID, 'trim-room', {
      ...DEFAULT_ROOM_SPEC,
      showCeiling: true,
      trim: {
        baseboard: { heightCm: 10, profile: 'square' },
        crownMolding: { heightCm: 6, projectionCm: 4, profile: 'stepped' },
      },
    });
    const scene: SceneData = {
      schemaVersion: SCENE_SCHEMA_VERSION,
      room: { ...ROOM_DEFAULTS },
      objects: [],
      settings: createDefaultSettings(),
      rooms: [room],
    };
    const parsed = parseSceneJson(serializeSceneToJson(scene, EXPORT_METADATA, EXPORT_TIME));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.scene.rooms).toEqual(scene.rooms);
    expect(parsed.scene.rooms?.[0]?.spec.trim?.baseboard?.heightCm).toBe(10);
  });
});

describe('9A.2.6 — baseboard geometry', () => {
  it('builds four deterministic baseboard parts by default', () => {
    const plan = planFor();
    const parts = trimParts(plan, 'baseboard');
    expect(parts.map((part) => part.id)).toEqual([
      'room-baseboard-north-1',
      'room-baseboard-east-1',
      'room-baseboard-south-1',
      'room-baseboard-west-1',
    ]);
    for (const part of parts) {
      expect(part.type).toBe('baseboard');
      expect(part.role).toBe('baseboard');
      expect(part.materialSlot).toBe(BASEBOARD_MATERIAL_SLOT);
      expect(part.uv).toBe('surface');
      expect(part.geometry.kind).toBe('extrude');
      expect(meta(part).trimType).toBe('baseboard');
      expect(meta(part).profile).toBe('beveled');
      expect(meta(part).heightCm).toBe(8);
      expect(meta(part).thicknessCm).toBe(1.5);
    }
  });

  it('places north/south full width and east/west between the corners', () => {
    const spec = specWith({});
    const plan = planFor({});
    const bySide = new Map(trimParts(plan, 'baseboard').map((part) => [meta(part).wallId, part]));

    const north = bySide.get('north');
    expect(north?.dimensions).toEqual({ width: 400, height: 8, depth: 1.5 });
    expect(north?.position).toEqual([200, 0, -250]);
    expect(north?.rotation).toEqual([0, -90, 0]);
    expect(meta(north as PlanPart)).toMatchObject({
      segmentStartCm: 4,
      segmentEndCm: 404,
    });

    const east = bySide.get('east');
    expect(east?.dimensions.width).toBeCloseTo(497, 5);
    expect(east?.position).toEqual([200, 0, 248.5]);
    expect(east?.rotation).toEqual([0, 180, 0]);

    const south = bySide.get('south');
    expect(south?.position).toEqual([-200, 0, 250]);
    expect(south?.rotation).toEqual([0, 90, 0]);

    const west = bySide.get('west');
    expect(west?.position).toEqual([-200, 0, -248.5]);
    expect(west?.rotation).toEqual([0, 0, 0]);
    expect(trimRect(west as PlanPart, spec)).toEqual({
      minX: -200,
      maxX: -198.5,
      minZ: -248.5,
      maxZ: 248.5,
    });
  });

  it('uses the configured height and thickness', () => {
    const plan = planFor({
      trim: { baseboard: { heightCm: 12, thicknessCm: 2.5 } },
    });
    const north = trimParts(plan, 'baseboard').find((part) => meta(part).wallId === 'north');
    expect(north?.dimensions).toEqual({ width: 400, height: 12, depth: 2.5 });
    expect(meta(north as PlanPart).thicknessCm).toBe(2.5);
  });

  it('emits no baseboard when disabled', () => {
    const plan = planFor({ trim: { baseboard: { enabled: false } } });
    expect(trimParts(plan, 'baseboard')).toHaveLength(0);
    expect(plan.parametric.parts).toHaveLength(5);
  });

  it('supports square, beveled and stepped profiles with CCW sections', () => {
    const counts = new Map<string, number>();
    for (const profile of ['square', 'beveled', 'stepped'] as const) {
      const plan = planFor({ trim: { baseboard: { profile } } });
      const part = trimParts(plan, 'baseboard')[0];
      expect(part.geometry.kind).toBe('extrude');
      if (part.geometry.kind !== 'extrude') continue;
      const points = part.geometry.profile;
      counts.set(profile, points.length);
      expect(area(points), profile).toBeGreaterThan(0);
      expect(meta(part).profile).toBe(profile);
    }
    expect(counts.get('square')).toBe(4);
    expect(counts.get('beveled')).toBe(5);
    expect(counts.get('stepped')).toBe(6);
    expect(trimProfilePoints('baseboard', 'square', 2, 10)[1]).toEqual([2, 0]);
  });

  it('splits the baseboard around a door opening and leaves the window alone', () => {
    const plan = planFor({ openings: [door(), windowOpening()] });
    const north = trimParts(plan, 'baseboard').filter((part) => meta(part).wallId === 'north');
    expect(north.map((part) => part.id)).toEqual([
      'room-baseboard-north-1',
      'room-baseboard-north-2',
    ]);
    expect(north.map((part) => meta(part).segmentStartCm)).toEqual([4, 190]);
    expect(north.map((part) => meta(part).segmentEndCm)).toEqual([100, 404]);
    expect(north.map((part) => part.dimensions.width)).toEqual([96, 214]);
    // Window sill is 90 cm, well above an 8 cm baseboard.
    expect(trimParts(plan, 'baseboard').filter((part) => meta(part).wallId === 'east')).toHaveLength(
      1,
    );
  });

  it('cuts a zero-sill window as well, because it reaches the floor', () => {
    const plan = planFor({
      openings: [windowOpening({ sillHeightCm: 0, heightCm: 200 })],
    });
    const north = trimParts(plan, 'baseboard').filter((part) => meta(part).wallId === 'north');
    expect(north).toHaveLength(2);
  });

  it('merges overlapping cuts through subtractRunIntervals', () => {
    expect(
      subtractRunIntervals(0, 100, [
        { startCm: 10, endCm: 60 },
        { startCm: 40, endCm: 80 },
      ]),
    ).toEqual([
      { startCm: 0, endCm: 10 },
      { startCm: 80, endCm: 100 },
    ]);
    expect(subtractRunIntervals(0, 100, [{ startCm: 0, endCm: 100 }])).toEqual([]);
    expect(subtractRunIntervals(0, 100, [{ startCm: -20, endCm: 30 }])).toEqual([
      { startCm: 30, endCm: 100 },
    ]);
  });

  it('leaves exact door clearance in world space and no frame overlap', () => {
    const plan = planFor({ openings: [door()] });
    const spec = specWith({ openings: [door()] });
    const doorX = {
      minX: 100 - (spec.widthCm / 2 + spec.wallThicknessCm),
      maxX: 190 - (spec.widthCm / 2 + spec.wallThicknessCm),
    };
    const north = trimParts(plan, 'baseboard').filter((part) => meta(part).wallId === 'north');
    for (const part of north) {
      const rect = trimRect(part, spec);
      expect(Math.min(rect.maxX, doorX.maxX) - Math.max(rect.minX, doorX.minX)).toBeLessThanOrEqual(
        0,
      );
    }
    const ends = north.map((part) => trimRect(part, spec));
    expect(ends[0]?.maxX).toBeCloseTo(doorX.minX, 6);
    expect(ends[1]?.minX).toBeCloseTo(doorX.maxX, 6);

    const built = buildPlan(plan);
    try {
      built.group.updateMatrixWorld(true);
      const doorBox = new THREE.Box3(
        new THREE.Vector3(doorX.minX, 0, -260),
        new THREE.Vector3(doorX.maxX, 8, -246),
      );
      for (const part of north) {
        const mesh = meshNamed(built.group, part.id);
        expect(boxOverlapVolume(new THREE.Box3().setFromObject(mesh), doorBox)).toBe(0);
      }
    } finally {
      built.dispose();
    }
  });

  it('butt-joints the four walls with no overlap and no gap', () => {
    const spec = specWith({});
    const plan = planFor({});
    const parts = trimParts(plan, 'baseboard');
    const rects = parts.map((part) => trimRect(part, spec));
    for (let first = 0; first < rects.length; first += 1) {
      for (let second = first + 1; second < rects.length; second += 1) {
        expect(overlapArea(rects[first], rects[second])).toBe(0);
      }
    }
    const north = parts.find((part) => meta(part).wallId === 'north');
    const east = parts.find((part) => meta(part).wallId === 'east');
    const northRect = trimRect(north as PlanPart, spec);
    const eastRect = trimRect(east as PlanPart, spec);
    expect(northRect.maxZ).toBeCloseTo(eastRect.minZ, 6);
    expect(Math.min(northRect.maxX, eastRect.maxX) - Math.max(northRect.minX, eastRect.minX)).toBeGreaterThan(
      0,
    );
  });
});

describe('9A.2.6 — crown molding geometry', () => {
  it('builds four crown parts only when the ceiling exists', () => {
    const withoutCeiling = planFor({ showCeiling: false });
    expect(trimParts(withoutCeiling, 'crown-molding')).toHaveLength(0);

    const withCeiling = planFor({ showCeiling: true });
    const parts = trimParts(withCeiling, 'crown-molding');
    expect(parts.map((part) => part.id)).toEqual([
      'room-crown-molding-north-1',
      'room-crown-molding-east-1',
      'room-crown-molding-south-1',
      'room-crown-molding-west-1',
    ]);
    for (const part of parts) {
      expect(part.type).toBe('crown-molding');
      expect(part.materialSlot).toBe(CROWN_MATERIAL_SLOT);
      expect(part.uv).toBe('surface');
      expect(meta(part).trimType).toBe('crown-molding');
      expect(meta(part).heightCm).toBe(8);
      expect(meta(part).projectionCm).toBe(5);
    }
  });

  it('sits directly below the ceiling with the configured projection', () => {
    const plan = planFor({ showCeiling: true, heightCm: 280 });
    const north = trimParts(plan, 'crown-molding').find((part) => meta(part).wallId === 'north');
    expect(north?.dimensions).toEqual({ width: 400, height: 8, depth: 5 });
    expect(north?.position).toEqual([200, 272, -250]);
    expect(north?.rotation).toEqual([0, -90, 0]);
    expect((north?.position[1] ?? 0) + (north?.dimensions.height ?? 0)).toBe(280);

    const east = trimParts(plan, 'crown-molding').find((part) => meta(part).wallId === 'east');
    expect(east?.position).toEqual([200, 272, 245]);
  });

  it('honours height and projection overrides', () => {
    const plan = planFor({
      showCeiling: true,
      trim: { crownMolding: { heightCm: 12, projectionCm: 8, profile: 'square' } },
    });
    const north = trimParts(plan, 'crown-molding').find((part) => meta(part).wallId === 'north');
    expect(north?.dimensions).toEqual({ width: 400, height: 12, depth: 8 });
    expect(north?.position[1]).toBe(268);
    if (north?.geometry.kind === 'extrude') {
      expect(area(north.geometry.profile)).toBeGreaterThan(0);
      expect(north.geometry.profile.length).toBe(4);
    }
  });

  it('emits no crown when disabled', () => {
    const plan = planFor({
      showCeiling: true,
      trim: { crownMolding: { enabled: false } },
    });
    expect(trimParts(plan, 'crown-molding')).toHaveLength(0);
  });

  it('does not cut normal door/window openings and cuts a full-height one', () => {
    const normal = planFor({ showCeiling: true, openings: [door(), windowOpening()] });
    expect(trimParts(normal, 'crown-molding')).toHaveLength(4);

    const tall = planFor({
      showCeiling: true,
      openings: [door({ heightCm: 265 })],
      trim: { crownMolding: { heightCm: 20 } },
    });
    const north = trimParts(tall, 'crown-molding').filter((part) => meta(part).wallId === 'north');
    expect(north).toHaveLength(2);
  });

  it('butt-joints crown corners with no overlap', () => {
    const spec = specWith({ showCeiling: true });
    const parts = trimParts(planFor({ showCeiling: true }), 'crown-molding');
    const rects = parts.map((part) => trimRect(part, spec));
    for (let first = 0; first < rects.length; first += 1) {
      for (let second = first + 1; second < rects.length; second += 1) {
        expect(overlapArea(rects[first], rects[second])).toBe(0);
      }
    }
    const north = trimRect(parts[0], spec);
    const east = trimRect(parts[1], spec);
    expect(north.maxZ).toBeCloseTo(east.minZ, 6);
  });
});

describe('9A.2.6 — trim materials and physical UV', () => {
  const trimPresets = [
    'baseboard-white',
    'baseboard-oak',
    'baseboard-dark',
    'crown-white',
    'crown-matte',
    'crown-oak',
  ] as const;

  it('registers dielectric trim presets with a real tile size', () => {
    for (const id of trimPresets) {
      const preset = getMaterialPreset(id);
      expect(preset.id, id).toBe(id);
      expect(preset.metalness, id).toBe(0);
      expect(preset.physicalTileCm, id).toBe(100);
      expect(preset.color, id).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('applies spec and instance materials to the trim slots', () => {
    const room = createRoomInstance(ROOM_STANDARD_DEFINITION_ID, 'trim-room', {
      ...DEFAULT_ROOM_SPEC,
      showCeiling: true,
      materials: {
        baseboard: { materialId: 'baseboard-oak' },
        'crown-molding': { materialId: 'crown-matte' },
      },
    });
    const specBuilt = buildRoomInstance(room);
    try {
      const baseboard = meshNamed(specBuilt.group, 'room-baseboard-north-1');
      const baseboardMaterial = baseboard.material as THREE.MeshStandardMaterial;
      expect(baseboardMaterial.color.getHexString()).toBe(
        getMaterialPreset('baseboard-oak').color?.slice(1),
      );
      const crown = meshNamed(specBuilt.group, 'room-crown-molding-north-1');
      const crownMaterial = crown.material as THREE.MeshStandardMaterial;
      expect(crownMaterial.color.getHexString()).toBe(
        getMaterialPreset('crown-matte').color?.slice(1),
      );
    } finally {
      specBuilt.dispose();
    }

    const overridden = buildRoomInstance({
      ...room,
      materialAssignments: {
        baseboard: { baseColor: '#123456', roughness: 0.4, physicalTileCm: 50 },
      },
    });
    try {
      const baseboard = meshNamed(overridden.group, 'room-baseboard-north-1');
      const material = baseboard.material as THREE.MeshStandardMaterial;
      expect(material.color.getHexString()).toBe('123456');
      expect(material.roughness).toBeCloseTo(0.4, 5);
      expect((baseboard.geometry.userData.uvLayout as { tileCm?: number }).tileCm).toBe(50);
    } finally {
      overridden.dispose();
    }
  });

  it('maps trim UVs physically and consistently across split segments', () => {
    const plan = planFor({
      openings: [door()],
      trim: { baseboard: { profile: 'square' } },
      materials: { baseboard: { materialId: 'baseboard-white' } },
    });
    const built = buildPlan(plan);
    try {
      built.group.updateMatrixWorld(true);
      const north = trimParts(plan, 'baseboard')
        .filter((part) => meta(part).wallId === 'north')
        .map((part) => meshNamed(built.group, part.id));
      expect(north).toHaveLength(2);
      const lengths = [96, 214];
      north.forEach((mesh, index) => {
        const front = faceUv(mesh, 'x', 1);
        expect(front.spanU).toBeCloseTo(lengths[index] / 100, 5);
        expect(front.spanV).toBeCloseTo(8 / 100, 5);
        expect(detectMirroredUv(mesh.geometry as THREE.BufferGeometry).mirroredTriangles).toBe(0);
        const normal = (mesh.geometry as THREE.BufferGeometry).getAttribute(
          'normal',
        ) as THREE.BufferAttribute;
        for (let vertex = 0; vertex < normal.count; vertex += 1) {
          expect(
            Math.hypot(normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex)),
          ).toBeCloseTo(1, 5);
        }
      });
    } finally {
      built.dispose();
    }
  });

  it('uses an explicit tileCm from the trim config', () => {
    const plan = planFor({
      trim: { baseboard: { tileCm: 40 } },
      materials: { baseboard: { materialId: 'baseboard-white' } },
    });
    const north = trimParts(plan, 'baseboard').find((part) => meta(part).wallId === 'north');
    expect(north?.uvTileCm).toBe(40);
    const built = buildPlan(plan);
    try {
      const mesh = meshNamed(built.group, 'room-baseboard-north-1');
      expect((mesh.geometry.userData.uvLayout as { tileCm?: number }).tileCm).toBe(40);
      expect(faceUv(mesh, 'x', 1).spanU).toBeCloseTo(400 / 40, 5);
    } finally {
      built.dispose();
    }
  });

  it('shares one material per trim slot', () => {
    const plan = planFor({ showCeiling: true, openings: [door()] });
    const built = buildPlan(plan);
    try {
      const bySlot = new Map<string, Set<THREE.Material>>();
      for (const part of plan.parametric.parts) {
        const mesh = meshNamed(built.group, part.id);
        const set = bySlot.get(part.materialSlot) ?? new Set<THREE.Material>();
        set.add(mesh.material as THREE.Material);
        bySlot.set(part.materialSlot, set);
      }
      for (const [slot, materials] of bySlot) {
        expect(materials.size, slot).toBe(1);
      }
    } finally {
      built.dispose();
    }
  });
});

describe('9A.2.6 — determinism, budget and regression', () => {
  it('produces identical parts on repeated solves', () => {
    const spec = specWith({
      showCeiling: true,
      openings: [door(), windowOpening()],
      trim: { baseboard: { profile: 'stepped' }, crownMolding: { profile: 'square' } },
    });
    expect(solveRoomParts(spec)).toEqual(solveRoomParts(spec));
  });

  it('keeps the default room at nine parts and the ceiling room at fourteen', () => {
    expect(planFor().parametric.parts).toHaveLength(9);
    expect(planFor({ showCeiling: true }).parametric.parts).toHaveLength(14);
    expect(planFor({ showCeiling: true }).parametric.parts.filter((part) => part.type === 'crown-molding')).toHaveLength(4);
  });

  it('stays within the part budget for an opening-heavy trimmed room', () => {
    const openings: RoomOpeningSpec[] = [];
    for (const side of ['north', 'east', 'south', 'west'] as const) {
      openings.push(
        door({ id: `${side}-door-1`, wallId: side, offsetCm: 20 }),
        windowOpening({ id: `${side}-window-1`, wallId: side, offsetCm: 150 }),
        door({ id: `${side}-door-2`, wallId: side, offsetCm: 280 }),
      );
    }
    const plan = planFor({ showCeiling: true, openings });
    expect(plan.parametric.parts.length).toBeLessThanOrEqual(512);
    expect(trimParts(plan, 'baseboard').length).toBeGreaterThan(4);
    expect(trimParts(plan, 'crown-molding')).toHaveLength(4);
  });

  it('builds and disposes the 20-room cap with trim enabled', () => {
    const rooms = Array.from({ length: 20 }, (_, index) =>
      buildRoomInstance(
        createRoomInstance(ROOM_STANDARD_DEFINITION_ID, `trim-room-${index}`, {
          ...DEFAULT_ROOM_SPEC,
          showCeiling: index % 2 === 0,
          openings: [door({ id: `door-${index}` }), windowOpening({ id: `window-${index}` })],
          materials: {
            baseboard: { materialId: index % 2 === 0 ? 'baseboard-white' : 'baseboard-oak' },
          },
        }),
      ),
    );
    try {
      for (const room of rooms) {
        const meshes = meshesOf(room.group);
        expect(meshes.length).toBeLessThanOrEqual(512);
        expect(meshes.some((mesh) => mesh.name.startsWith('room-baseboard-'))).toBe(true);
      }
    } finally {
      for (const room of rooms) {
        room.dispose();
      }
    }
  });

  it('keeps buildBaseboardParts and buildCrownMoldingParts pure and explicit', () => {
    const spec = specWith({ showCeiling: true });
    const plan = planFor({ showCeiling: true });
    const layout = {
      floor: {
        partId: 'room-floor',
        type: 'floor',
        role: 'floor',
        materialSlot: 'floor',
        dimensions: { width: 400, height: 4, depth: 500 },
        position: [0, -2, 0],
        rotation: [0, 0, 0],
      },
      walls: [],
      ceiling: null,
    } as const;
    expect(buildBaseboardParts(spec, layout as never)).toHaveLength(4);
    expect(buildCrownMoldingParts(spec, layout as never)).toHaveLength(4);
    expect(buildTrimParts(spec, layout as never)).toHaveLength(8);
    expect(plan.parametric.parts).toHaveLength(14);
    expect(UV_TILE_CM).toBe(50);
  });
});
