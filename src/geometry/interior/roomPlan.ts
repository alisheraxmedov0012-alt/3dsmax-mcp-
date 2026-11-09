/**
 * Phase 9A.2.1 — pure room geometry planning.
 *
 * This module derives a rectangular boundary, the six room parts (floor,
 * four walls, optional ceiling) and the room-specific metadata from a
 * validated `RoomSpec`. It never creates a Three.js object; the generic
 * `buildPlanWithDefinition` pipeline can materialise the parts later.
 */
import type { ComponentDimensions } from '../components';
import type { Vec2Tuple, Vec3Tuple } from '../kernel';
import { buildOpeningAssembly } from './openingComponents';
import { roomWallRunLength } from './roomSpec';
import {
  InteriorError,
  type RoomBoundary,
  type RoomBoundaryKind,
  type RoomBoundaryValidationResult,
  type RoomBoxLayout,
  type RoomCeilingPlan,
  type RoomFloorPlan,
  type RoomLayout,
  type RoomOpeningSpec,
  type RoomPlan,
  type RoomPlanMetadata,
  type RoomSide,
  type RoomSpec,
  type RoomWallLayout,
  type RoomWallPlan,
} from './types';

export const MAX_ROOM_BOUNDARY_POINTS = 256;
export const MAX_ROOM_COORDINATE_CM = 100_000;
const BOUNDARY_EPSILON = 1e-6;

function freezePoint(point: Vec2Tuple): Vec2Tuple {
  return Object.freeze([point[0], point[1]] as const);
}

function signedArea(points: readonly Vec2Tuple[]): number {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current[0] * next[1] - next[0] * current[1];
  }
  return sum / 2;
}

function orientation(a: Vec2Tuple, b: Vec2Tuple, c: Vec2Tuple): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: Vec2Tuple, b: Vec2Tuple, point: Vec2Tuple): boolean {
  return (
    point[0] >= Math.min(a[0], b[0]) - BOUNDARY_EPSILON &&
    point[0] <= Math.max(a[0], b[0]) + BOUNDARY_EPSILON &&
    point[1] >= Math.min(a[1], b[1]) - BOUNDARY_EPSILON &&
    point[1] <= Math.max(a[1], b[1]) + BOUNDARY_EPSILON
  );
}

function segmentsIntersect(a: Vec2Tuple, b: Vec2Tuple, c: Vec2Tuple, d: Vec2Tuple): boolean {
  const d1 = orientation(c, d, a);
  const d2 = orientation(c, d, b);
  const d3 = orientation(a, b, c);
  const d4 = orientation(a, b, d);

  if (
    ((d1 > BOUNDARY_EPSILON && d2 < -BOUNDARY_EPSILON) ||
      (d1 < -BOUNDARY_EPSILON && d2 > BOUNDARY_EPSILON)) &&
    ((d3 > BOUNDARY_EPSILON && d4 < -BOUNDARY_EPSILON) ||
      (d3 < -BOUNDARY_EPSILON && d4 > BOUNDARY_EPSILON))
  ) {
    return true;
  }

  // Collinear touching is a self-intersection for non-adjacent edges.
  if (Math.abs(d1) <= BOUNDARY_EPSILON && onSegment(c, d, a)) return true;
  if (Math.abs(d2) <= BOUNDARY_EPSILON && onSegment(c, d, b)) return true;
  if (Math.abs(d3) <= BOUNDARY_EPSILON && onSegment(a, b, c)) return true;
  if (Math.abs(d4) <= BOUNDARY_EPSILON && onSegment(a, b, d)) return true;
  return false;
}

function isSelfIntersecting(points: readonly Vec2Tuple[]): boolean {
  const count = points.length;
  for (let first = 0; first < count; first += 1) {
    const firstNext = (first + 1) % count;
    for (let second = first + 1; second < count; second += 1) {
      const secondNext = (second + 1) % count;
      // Adjacent edges share an endpoint by design.
      if (first === second || firstNext === second || secondNext === first) {
        continue;
      }
      if (
        segmentsIntersect(
          points[first],
          points[firstNext],
          points[second],
          points[secondNext],
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Validate an arbitrary floor boundary.
 *
 * The ordering rule is explicit: points must be counter-clockwise in the local
 * X/Z plane (positive signed area). This keeps future extrusion and hole
 * generation deterministic instead of guessing a winding.
 */
export function validateRoomBoundary(
  value: unknown,
  kind: RoomBoundaryKind = 'polygon',
): RoomBoundaryValidationResult {
  const errors: string[] = [];
  if (!Array.isArray(value)) {
    return { ok: false, errors: ['boundary: nuqtalar ro‘yxati bo‘lishi kerak.'] };
  }
  if (value.length < 3) {
    errors.push('boundary: kamida 3 ta nuqta kerak.');
  }
  if (value.length > MAX_ROOM_BOUNDARY_POINTS) {
    errors.push(
      `boundary: ko‘pi bilan ${MAX_ROOM_BOUNDARY_POINTS} ta nuqta bo‘lishi mumkin.`,
    );
  }
  if (kind === 'rectangle' && value.length !== 4) {
    errors.push('boundary: to‘rtburchak uchun 4 ta nuqta kerak.');
  }

  const points: Vec2Tuple[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of value.entries()) {
    if (!Array.isArray(raw) || raw.length !== 2) {
      errors.push(`boundary[${index}]: [x, z] juftligi bo‘lishi kerak.`);
      continue;
    }
    const x = raw[0];
    const z = raw[1];
    if (
      typeof x !== 'number' ||
      typeof z !== 'number' ||
      !Number.isFinite(x) ||
      !Number.isFinite(z)
    ) {
      errors.push(`boundary[${index}]: koordinatalar chekli son bo‘lishi kerak.`);
      continue;
    }
    if (Math.abs(x) > MAX_ROOM_COORDINATE_CM || Math.abs(z) > MAX_ROOM_COORDINATE_CM) {
      errors.push(`boundary[${index}]: koordinata chegaradan katta.`);
      continue;
    }
    const key = `${x}|${z}`;
    if (seen.has(key)) {
      errors.push(`boundary[${index}]: takroriy nuqta.`);
      continue;
    }
    seen.add(key);
    points.push(freezePoint([x, z]));
  }

  if (errors.length === 0) {
    const area = signedArea(points);
    if (!Number.isFinite(area) || area <= BOUNDARY_EPSILON) {
      errors.push('boundary: degenerate (nol yoki manfiy yuza) — CCW tartib kerak.');
    } else if (isSelfIntersecting(points)) {
      errors.push('boundary: qirralar o‘zaro kesishadi.');
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const xs = points.map((point) => point[0]);
  const zs = points.map((point) => point[1]);
  const boundary: RoomBoundary = Object.freeze({
    kind,
    points: Object.freeze(points.map(freezePoint)),
    widthCm: Math.max(...xs) - Math.min(...xs),
    lengthCm: Math.max(...zs) - Math.min(...zs),
    areaCm2: signedArea(points),
  });
  return { ok: true, boundary };
}

/**
 * Build the canonical rectangular boundary: NW, NE, SE, SW in the local X/Z
 * plane, positive signed area. The room centre is (0, 0).
 */
export function createRectangularBoundary(widthCm: number, lengthCm: number): RoomBoundary {
  if (
    !Number.isFinite(widthCm) ||
    !Number.isFinite(lengthCm) ||
    widthCm <= 0 ||
    lengthCm <= 0
  ) {
    throw new InteriorError(
      'invalid_boundary',
      'boundary: kenglik va uzunlik musbat chekli son bo‘lishi kerak.',
    );
  }
  const halfWidth = widthCm / 2;
  const halfLength = lengthCm / 2;
  const result = validateRoomBoundary(
    [
      [-halfWidth, -halfLength],
      [halfWidth, -halfLength],
      [halfWidth, halfLength],
      [-halfWidth, halfLength],
    ],
    'rectangle',
  );
  if (!result.ok) {
    throw new InteriorError('invalid_boundary', result.errors.join(' '));
  }
  return result.boundary;
}

function boxLayout(
  partId: string,
  type: 'wall' | 'floor' | 'ceiling',
  materialSlot: string,
  dimensions: ComponentDimensions,
  position: Vec3Tuple,
  rotation: Vec3Tuple = [0, 0, 0],
): RoomBoxLayout {
  return {
    partId,
    type,
    role: type,
    materialSlot,
    dimensions,
    position,
    rotation,
  };
}

interface WallInput {
  readonly partId: string;
  readonly side: RoomSide;
  readonly edgeIndex: number;
  readonly lengthCm: number;
  readonly dimensions: ComponentDimensions;
  readonly center: Vec3Tuple;
  readonly extrudePosition: Vec3Tuple;
  readonly rotation: Vec3Tuple;
  readonly outwardNormal: Vec2Tuple;
  readonly openings: readonly RoomOpeningSpec[];
}

function wallLayout(input: WallInput): RoomWallLayout {
  const geometryKind = input.openings.length > 0 ? 'extrude' : 'box';
  return {
    ...boxLayout(
      input.partId,
      'wall',
      'wall',
      input.dimensions,
      geometryKind === 'box' ? input.center : input.extrudePosition,
      input.rotation,
    ),
    side: input.side,
    edgeIndex: input.edgeIndex,
    lengthCm: input.lengthCm,
    outwardNormal: Object.freeze([
      input.outwardNormal[0],
      input.outwardNormal[1],
    ] as const),
    center: input.center,
    geometryKind,
    openings: input.openings,
    openingIds: Object.freeze(input.openings.map((opening) => opening.id)),
  };
}

/**
 * Resolve the deterministic wall layout of a rectangular room.
 *
 * Corner topology is a **butt joint**, not overlapping boxes:
 * - north/south walls span the full outer width and own the four corners;
 * - east/west walls span the inner length and butt between them.
 *
 * This keeps the perimeter closed, uses one constant wall thickness, and
 * leaves no positive-volume overlap at any corner. Walls with openings use an
 * extruded elevation profile (see `solveRoomParts`); walls without openings
 * stay as boxes.
 */
export function createRoomLayout(spec: RoomSpec): RoomLayout {
  const { widthCm, lengthCm, heightCm, wallThicknessCm, floorThicknessCm, ceilingThicknessCm } =
    spec;
  const t = wallThicknessCm;
  const openings = spec.openings ?? [];
  const northLength = roomWallRunLength(widthCm, lengthCm, t, 'north');
  const eastLength = roomWallRunLength(widthCm, lengthCm, t, 'east');

  const floor = boxLayout(
    'room-floor',
    'floor',
    'floor',
    { width: widthCm, height: floorThicknessCm, depth: lengthCm },
    [0, -floorThicknessCm / 2, 0],
  );

  const wallInputs: readonly WallInput[] = [
    {
      partId: 'room-wall-north',
      side: 'north',
      edgeIndex: 0,
      lengthCm: northLength,
      dimensions: { width: northLength, height: heightCm, depth: t },
      center: [0, heightCm / 2, -lengthCm / 2 - t / 2],
      extrudePosition: [0, 0, -lengthCm / 2 - t],
      rotation: [0, 0, 0],
      outwardNormal: [0, -1],
      openings: openings.filter((opening) => opening.wallId === 'north'),
    },
    {
      partId: 'room-wall-east',
      side: 'east',
      edgeIndex: 1,
      lengthCm: eastLength,
      dimensions: { width: lengthCm, height: heightCm, depth: t },
      center: [widthCm / 2 + t / 2, heightCm / 2, 0],
      extrudePosition: [widthCm / 2 + t, 0, 0],
      rotation: [0, -90, 0],
      outwardNormal: [1, 0],
      openings: openings.filter((opening) => opening.wallId === 'east'),
    },
    {
      partId: 'room-wall-south',
      side: 'south',
      edgeIndex: 2,
      lengthCm: northLength,
      dimensions: { width: northLength, height: heightCm, depth: t },
      center: [0, heightCm / 2, lengthCm / 2 + t / 2],
      extrudePosition: [0, 0, lengthCm / 2],
      rotation: [0, 0, 0],
      outwardNormal: [0, 1],
      openings: openings.filter((opening) => opening.wallId === 'south'),
    },
    {
      partId: 'room-wall-west',
      side: 'west',
      edgeIndex: 3,
      lengthCm: eastLength,
      dimensions: { width: lengthCm, height: heightCm, depth: t },
      center: [-widthCm / 2 - t / 2, heightCm / 2, 0],
      extrudePosition: [-widthCm / 2, 0, 0],
      rotation: [0, -90, 0],
      outwardNormal: [-1, 0],
      openings: openings.filter((opening) => opening.wallId === 'west'),
    },
  ];

  const walls = wallInputs.map(wallLayout);

  const ceiling = spec.showCeiling
    ? boxLayout(
        'room-ceiling',
        'ceiling',
        'ceiling',
        {
          width: widthCm + 2 * t,
          height: ceilingThicknessCm,
          depth: lengthCm + 2 * t,
        },
        [0, heightCm + ceilingThicknessCm / 2, 0],
      )
    : null;

  return {
    floor,
    walls,
    ceiling,
  };
}

/** Derive the room-only metadata from a validated spec. */
export function solveRoomMetadata(spec: RoomSpec): RoomPlanMetadata {
  const layout = createRoomLayout(spec);
  const boundary = createRectangularBoundary(spec.widthCm, spec.lengthCm);

  const floor: RoomFloorPlan = Object.freeze({
    partId: layout.floor.partId,
    widthCm: spec.widthCm,
    lengthCm: spec.lengthCm,
    thicknessCm: spec.floorThicknessCm,
    topY: 0,
    materialSlot: layout.floor.materialSlot,
  });

  const walls: readonly RoomWallPlan[] = Object.freeze(
    layout.walls.map((wall) =>
      Object.freeze({
        partId: wall.partId,
        side: wall.side,
        edgeIndex: wall.edgeIndex,
        lengthCm: wall.lengthCm,
        heightCm: spec.heightCm,
        thicknessCm: spec.wallThicknessCm,
        center: wall.center,
        outwardNormal: wall.outwardNormal,
        materialSlot: wall.materialSlot,
        openingIds: wall.openingIds,
      }),
    ),
  );

  const openings = Object.freeze(
    layout.walls.flatMap((wall) =>
      wall.openings.map((opening) => buildOpeningAssembly(wall, opening).plan),
    ),
  );

  const ceiling: RoomCeilingPlan | null = layout.ceiling
    ? Object.freeze({
        partId: layout.ceiling.partId,
        widthCm: spec.widthCm + 2 * spec.wallThicknessCm,
        lengthCm: spec.lengthCm + 2 * spec.wallThicknessCm,
        thicknessCm: spec.ceilingThicknessCm,
        bottomY: spec.heightCm,
        materialSlot: layout.ceiling.materialSlot,
      })
    : null;

  return Object.freeze({
    boundary,
    walls,
    openings,
    floor,
    ceiling,
  });
}

/** Freeze every level of a derived plan; callers never own mutable plan data. */
export function freezeRoomPlan(plan: RoomPlan): RoomPlan {
  const boundary = Object.freeze({
    ...plan.boundary,
    points: Object.freeze(plan.boundary.points.map(freezePoint)),
  });
  const walls = Object.freeze(
    plan.walls.map((wall) => Object.freeze(Object.assign({}, wall))),
  );
  const openings = Object.freeze([...plan.openings]);
  const floor = Object.freeze({ ...plan.floor });
  const ceiling = plan.ceiling ? Object.freeze({ ...plan.ceiling }) : null;
  return Object.freeze({
    ...plan,
    spec: Object.freeze({ ...plan.spec }),
    boundary,
    walls,
    openings,
    floor,
    ceiling,
  });
}
