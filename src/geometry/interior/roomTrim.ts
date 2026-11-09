/**
 * Phase 9A.2.6 — parametric baseboard and crown moulding.
 *
 * Trim is derived geometry, never stored: `RoomSpec.trim` holds parameters and
 * this module turns them into deterministic `PlanPart`s for the existing
 * parametric pipeline. All lengths are centimetres and all coordinates follow
 * the room convention (floor top at Y = 0, interior X/Z centred on the origin).
 *
 * Corner topology repeats the wall butt joint: north/south trim runs the full
 * interior width and east/west trim butts between them. Both trims use the same
 * cross-section builder, so their mating faces are identical — no gap and no
 * positive-volume overlap at any corner.
 */
import type { Vec2Tuple, Vec3Tuple } from '../kernel';
import type { PlanPart } from '../universal/types';
import type {
  RoomBaseboardSpec,
  RoomCrownMoldingSpec,
  RoomLayout,
  RoomOpeningSpec,
  RoomSide,
  RoomSpec,
  RoomTrimPartMetadata,
  RoomTrimSpec,
  TrimProfile,
  TrimType,
} from './types';

export const BASEBOARD_MATERIAL_SLOT = 'baseboard';
export const CROWN_MATERIAL_SLOT = 'crown-molding';

/** Documented defaults; absent trim configs resolve to these. */
export const DEFAULT_BASEBOARD: RoomBaseboardSpec = Object.freeze({
  enabled: true,
  heightCm: 8,
  thicknessCm: 1.5,
  profile: 'beveled',
  materialSlot: BASEBOARD_MATERIAL_SLOT,
});

export const DEFAULT_CROWN_MOLDING: RoomCrownMoldingSpec = Object.freeze({
  enabled: true,
  heightCm: 8,
  projectionCm: 5,
  profile: 'beveled',
  materialSlot: CROWN_MATERIAL_SLOT,
});

export const BASEBOARD_LIMITS = {
  heightCm: { min: 2, max: 40, step: 0.5 },
  thicknessCm: { min: 0.5, max: 20, step: 0.5 },
} as const;

export const CROWN_MOLDING_LIMITS = {
  heightCm: { min: 2, max: 40, step: 0.5 },
  projectionCm: { min: 1, max: 40, step: 0.5 },
} as const;

/** Effective trim config for a spec; defaults fill every absent field. */
export interface ResolvedRoomTrim {
  readonly baseboard: RoomBaseboardSpec;
  readonly crownMolding: RoomCrownMoldingSpec;
}

export function resolveRoomTrim(trim: RoomTrimSpec | undefined): ResolvedRoomTrim {
  return {
    // Field-wise merge keeps a programmatically supplied partial config safe:
    // every stored spec is canonical, but a caller may still build one by hand.
    baseboard: { ...DEFAULT_BASEBOARD, ...trim?.baseboard },
    crownMolding: { ...DEFAULT_CROWN_MOLDING, ...trim?.crownMolding },
  };
}

/** One run interval along a wall, in wall-run centimetres. */
export interface TrimSegment {
  readonly startCm: number;
  readonly endCm: number;
}

/**
 * Subtract cut intervals from a run range and return the remaining segments.
 *
 * Cuts are clamped to the range, sorted and merged, so overlapping openings
 * cannot produce a negative or duplicated segment. Zero-length results are
 * dropped, which is what makes a fully covered wall emit no trim part.
 */
export function subtractRunIntervals(
  startCm: number,
  endCm: number,
  cuts: readonly TrimSegment[],
): TrimSegment[] {
  const rangeStart = Math.min(startCm, endCm);
  const rangeEnd = Math.max(startCm, endCm);
  if (!(rangeEnd > rangeStart)) {
    return [];
  }

  const clamped = cuts
    .map((cut) => ({
      startCm: Math.max(rangeStart, Math.min(cut.startCm, cut.endCm)),
      endCm: Math.min(rangeEnd, Math.max(cut.startCm, cut.endCm)),
    }))
    .filter((cut) => cut.endCm > cut.startCm)
    .sort((left, right) => left.startCm - right.startCm);

  const segments: TrimSegment[] = [];
  let cursor = rangeStart;
  for (const cut of clamped) {
    if (cut.startCm > cursor) {
      segments.push({ startCm: cursor, endCm: cut.startCm });
    }
    cursor = Math.max(cursor, cut.endCm);
  }
  if (cursor < rangeEnd) {
    segments.push({ startCm: cursor, endCm: rangeEnd });
  }
  return segments;
}

/** Door openings cut the baseboard; a low window would cut it too. */
export function baseboardCuts(
  openings: readonly RoomOpeningSpec[],
  heightCm: number,
): TrimSegment[] {
  return openings
    .filter((opening) => opening.sillHeightCm < heightCm)
    .map((opening) => ({
      startCm: opening.offsetCm,
      endCm: opening.offsetCm + opening.widthCm,
    }));
}

/** Crown is at the wall top, so only an opening that reaches that band cuts it. */
export function crownCuts(
  openings: readonly RoomOpeningSpec[],
  roomHeightCm: number,
  heightCm: number,
): TrimSegment[] {
  const bandBottom = roomHeightCm - heightCm;
  return openings
    .filter((opening) => opening.sillHeightCm + opening.heightCm > bandBottom)
    .map((opening) => ({
      startCm: opening.offsetCm,
      endCm: opening.offsetCm + opening.widthCm,
    }));
}

/** Baseboard run range for a wall: full width for N/S, between corners for E/W. */
export function baseboardRange(
  spec: RoomSpec,
  side: RoomSide,
  thicknessCm: number,
): TrimSegment {
  return side === 'north' || side === 'south'
    ? { startCm: spec.wallThicknessCm, endCm: spec.wallThicknessCm + spec.widthCm }
    : { startCm: thicknessCm, endCm: spec.lengthCm - thicknessCm };
}

/** Crown run range uses the projection for the same butt-joint clearance. */
export function crownRange(spec: RoomSpec, side: RoomSide, projectionCm: number): TrimSegment {
  return side === 'north' || side === 'south'
    ? { startCm: spec.wallThicknessCm, endCm: spec.wallThicknessCm + spec.widthCm }
    : { startCm: projectionCm, endCm: spec.lengthCm - projectionCm };
}

/**
 * Cross-section of a trim, in (depth-from-wall, height) centimetres.
 *
 * The polygon is counter-clockwise, which the kernel's extrusion validation
 * requires. Profiles stay deliberately simple; ornate mouldings are a later
 * phase and would need a different profile source, not a different pipeline.
 */
export function trimProfilePoints(
  trimType: TrimType,
  profile: TrimProfile,
  insetCm: number,
  heightCm: number,
): Vec2Tuple[] {
  const depth = insetCm;
  const height = heightCm;
  if (trimType === 'baseboard') {
    switch (profile) {
      case 'square':
        return [
          [0, 0],
          [depth, 0],
          [depth, height],
          [0, height],
        ];
      case 'stepped':
        return [
          [0, 0],
          [depth, 0],
          [depth, height / 2],
          [depth * 0.65, height / 2],
          [depth * 0.65, height],
          [0, height],
        ];
      default: {
        const bevel = Math.min(depth, height) * 0.35;
        return [
          [0, 0],
          [depth, 0],
          [depth, height - bevel],
          [depth - bevel, height],
          [0, height],
        ];
      }
    }
  }

  switch (profile) {
    case 'square':
      return [
        [0, 0],
        [depth, 0],
        [depth, height],
        [0, height],
      ];
    case 'stepped':
      return [
        [0, 0],
        [depth * 0.5, 0],
        [depth * 0.5, height / 2],
        [depth, height / 2],
        [depth, height],
        [0, height],
      ];
    default:
      return [
        [0, 0],
        [depth * 0.3, 0],
        [depth, height],
        [0, height],
      ];
  }
}

interface TrimPlacement {
  readonly position: Vec3Tuple;
  readonly rotation: Vec3Tuple;
  readonly runLengthCm: number;
}

/**
 * World placement for an extrusion that runs along a wall.
 *
 * The profile's local +X is the inward depth and local +Z is the run. Each
 * side's rotation maps those axes onto the room, so the mesh origin stays a
 * corner of the extrusion and the wall's interior face is the depth origin.
 */
export function placeTrimSegment(
  spec: RoomSpec,
  side: RoomSide,
  segment: TrimSegment,
): TrimPlacement {
  const halfWidth = spec.widthCm / 2;
  const halfLength = spec.lengthCm / 2;
  const runLengthCm = segment.endCm - segment.startCm;
  const runToX = (run: number): number => run - (halfWidth + spec.wallThicknessCm);
  const runToZ = (run: number): number => -halfLength + run;

  switch (side) {
    case 'north':
      return {
        position: [runToX(segment.endCm), 0, -halfLength],
        rotation: [0, -90, 0],
        runLengthCm,
      };
    case 'south':
      return {
        position: [runToX(segment.startCm), 0, halfLength],
        rotation: [0, 90, 0],
        runLengthCm,
      };
    case 'east':
      return {
        position: [halfWidth, 0, runToZ(segment.endCm)],
        rotation: [0, 180, 0],
        runLengthCm,
      };
    default:
      return {
        position: [-halfWidth, 0, runToZ(segment.startCm)],
        rotation: [0, 0, 0],
        runLengthCm,
      };
  }
}

function trimPart(
  spec: RoomSpec,
  side: RoomSide,
  trimType: TrimType,
  segment: TrimSegment,
  index: number,
  config: {
    readonly profile: TrimProfile;
    readonly heightCm: number;
    readonly insetCm: number;
    readonly materialSlot: string;
    readonly baseboard: boolean;
  },
): PlanPart {
  const placement = placeTrimSegment(spec, side, segment);
  const height = config.heightCm;
  const y = config.baseboard ? 0 : spec.heightCm - height;
  const metadata: RoomTrimPartMetadata = {
    wallId: side,
    trimType,
    segmentStartCm: segment.startCm,
    segmentEndCm: segment.endCm,
    profile: config.profile,
    heightCm: height,
    materialSlot: config.materialSlot as RoomTrimPartMetadata['materialSlot'],
    ...(config.baseboard
      ? { thicknessCm: config.insetCm }
      : { projectionCm: config.insetCm }),
  };

  return {
    id: `room-${trimType}-${side}-${index + 1}`,
    type: trimType,
    role: trimType,
    dimensions: {
      width: placement.runLengthCm,
      height,
      depth: config.insetCm,
    },
    geometry: {
      kind: 'extrude',
      profile: trimProfilePoints(trimType, config.profile, config.insetCm, height),
      holes: [],
      depth: placement.runLengthCm,
      bevelEnabled: false,
    },
    position: [placement.position[0], placement.position[1] + y, placement.position[2]],
    rotation: placement.rotation,
    materialSlot: config.materialSlot,
    uv: 'surface',
    metadata: { ...metadata } as unknown as Readonly<Record<string, unknown>>,
  };
}

function wallOpenings(layout: RoomLayout, side: RoomSide): readonly RoomOpeningSpec[] {
  return layout.walls.find((wall) => wall.side === side)?.openings ?? [];
}

const TRIM_SIDES: readonly RoomSide[] = ['north', 'east', 'south', 'west'];

/** Baseboard parts for every wall, split around door/low openings. */
export function buildBaseboardParts(spec: RoomSpec, layout: RoomLayout): PlanPart[] {
  const { baseboard } = resolveRoomTrim(spec.trim);
  if (!baseboard.enabled) {
    return [];
  }

  const parts: PlanPart[] = [];
  for (const side of TRIM_SIDES) {
    const range = baseboardRange(spec, side, baseboard.thicknessCm);
    const cuts = baseboardCuts(wallOpenings(layout, side), baseboard.heightCm);
    const segments = subtractRunIntervals(range.startCm, range.endCm, cuts);
    segments.forEach((segment, index) => {
      parts.push(
        trimPart(spec, side, 'baseboard', segment, index, {
          profile: baseboard.profile,
          heightCm: baseboard.heightCm,
          insetCm: baseboard.thicknessCm,
          materialSlot: baseboard.materialSlot,
          baseboard: true,
        }),
      );
    });
  }
  return parts;
}

/** Crown parts; only created when the room actually has a ceiling. */
export function buildCrownMoldingParts(spec: RoomSpec, layout: RoomLayout): PlanPart[] {
  const { crownMolding } = resolveRoomTrim(spec.trim);
  if (!crownMolding.enabled || !spec.showCeiling) {
    return [];
  }

  const parts: PlanPart[] = [];
  for (const side of TRIM_SIDES) {
    const range = crownRange(spec, side, crownMolding.projectionCm);
    const cuts = crownCuts(wallOpenings(layout, side), spec.heightCm, crownMolding.heightCm);
    const segments = subtractRunIntervals(range.startCm, range.endCm, cuts);
    segments.forEach((segment, index) => {
      parts.push(
        trimPart(spec, side, 'crown-molding', segment, index, {
          profile: crownMolding.profile,
          heightCm: crownMolding.heightCm,
          insetCm: crownMolding.projectionCm,
          materialSlot: crownMolding.materialSlot,
          baseboard: false,
        }),
      );
    });
  }
  return parts;
}

/** Every trim part for a room, in deterministic wall order. */
export function buildTrimParts(spec: RoomSpec, layout: RoomLayout): PlanPart[] {
  return [...buildBaseboardParts(spec, layout), ...buildCrownMoldingParts(spec, layout)];
}
