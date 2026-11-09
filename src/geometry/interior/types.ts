/**
 * Phase 9A.2.1 — Interior domain and room contract.
 *
 * The room model is deliberately pure data: `RoomSpec` is what may be stored,
 * while `RoomPlan` is derived at build time. No Three.js object or mesh belongs
 * to either type.
 *
 * A room definition composes the 9A.1 `ParametricDefinition` contract instead
 * of extending the furniture vocabulary. The generic plan supplies parts and
 * material slots; the room-specific solver supplies boundary/wall metadata that
 * the furniture contract has no business knowing about.
 */
import type { ComponentDimensions } from '../components';
import type { Vec2Tuple, Vec3Tuple } from '../kernel';
import type {
  ParametricDefinition,
  ParametricPlan,
  ParametricSlot,
  RegisteredParametricDefinition,
} from '../parametric/types';
import type {
  DefinitionField,
  PlanLimits,
  SpecParseResult,
} from '../universal/types';

/** Domain id used by every interior definition. Kept open for future domains. */
export const INTERIOR_DOMAIN = 'interior';

/** Family name of the built-in room definition. */
export const ROOM_FAMILY = 'room';

/** Open room type identifier (e.g. `generic`, `living`, `office`). */
export type RoomType = string;

export const ROOM_SIDES = ['north', 'east', 'south', 'west'] as const;
export type RoomSide = (typeof ROOM_SIDES)[number];

export type RoomOpeningType = 'door' | 'window';

export interface DoorOpeningConfig {
  readonly frameWidthCm: number;
  readonly frameDepthCm: number;
  readonly leafThicknessCm: number;
  readonly leafInsetCm: number;
  readonly hingeSide: 'left' | 'right';
  readonly swingDirection: 'inward' | 'outward';
  readonly swingAngleDeg: number;
  readonly handleHeightCm: number;
}

export interface WindowOpeningConfig {
  readonly frameWidthCm: number;
  readonly frameDepthCm: number;
  readonly glassThicknessCm: number;
  readonly sillThicknessCm: number;
  readonly mullionCount: number;
  readonly transomCount: number;
}

/**
 * One parametric wall opening. Offsets are measured from the wall's start
 * point in the local X/Z plane:
 * - north/south walls start at the west end;
 * - east/west walls start at the north end.
 *
 * Component configs are optional so pre-9A.2.4 openings keep working. A config,
 * when present, is canonicalised to every field by the parser; the solver uses
 * documented defaults when it is absent.
 */
export interface RoomOpeningSpec {
  readonly id: string;
  readonly type: RoomOpeningType;
  readonly wallId: RoomSide;
  readonly offsetCm: number;
  readonly widthCm: number;
  readonly heightCm: number;
  readonly sillHeightCm: number;
  readonly door?: DoorOpeningConfig;
  readonly window?: WindowOpeningConfig;
}

/**
 * Material slots the built-in room definition exposes. Kept here (not only in
 * `roomDefinition`) so the spec parser can validate `RoomSpec.materials`
 * without importing the definition module.
 */
export const ROOM_MATERIAL_SLOT_IDS = [
  'floor',
  'wall',
  'ceiling',
  'baseboard',
  'crown-molding',
  'door-frame',
  'door-leaf',
  'door-hardware',
  'window-frame',
  'window-glass',
  'window-sill',
] as const;

export type RoomMaterialSlotId = (typeof ROOM_MATERIAL_SLOT_IDS)[number];

/**
 * One slot's material parameters, stored with the room.
 *
 * These are the same channels `MaterialSettingsInput` already understands plus
 * the physical tile size. A slot may set only `materialId` and inherit the rest
 * from that preset, or override individual channels.
 */
export interface RoomSlotMaterialSpec {
  readonly materialId?: string;
  readonly baseColor?: string;
  readonly metalness?: number;
  readonly roughness?: number;
  readonly opacity?: number;
  readonly textureScale?: number;
  readonly normalStrength?: number;
  readonly emissiveIntensity?: number;
  readonly aoIntensity?: number;
  readonly emissiveColor?: string;
  /** Real-world size of one texture tile, in centimetres. */
  readonly physicalTileCm?: number;
  readonly premiumTextures?: boolean;
}

/** Per-slot material parameters stored in a `RoomSpec`. */
export type RoomMaterialsSpec = Readonly<
  Partial<Record<RoomMaterialSlotId, RoomSlotMaterialSpec>>
>;

/** Trim cross-section shape. Detailed moulding profiles are a later phase. */
export const TRIM_PROFILES = ['square', 'beveled', 'stepped'] as const;
export type TrimProfile = (typeof TRIM_PROFILES)[number];

/** Fully-resolved baseboard parameters. */
export interface RoomBaseboardSpec {
  readonly enabled: boolean;
  readonly heightCm: number;
  readonly thicknessCm: number;
  readonly profile: TrimProfile;
  readonly materialSlot: RoomMaterialSlotId;
  /** Optional real-world tile override in centimetres. */
  readonly tileCm?: number;
}

/** Fully-resolved crown-moulding parameters. */
export interface RoomCrownMoldingSpec {
  readonly enabled: boolean;
  readonly heightCm: number;
  readonly projectionCm: number;
  readonly profile: TrimProfile;
  readonly materialSlot: RoomMaterialSlotId;
  readonly tileCm?: number;
}

/**
 * Decorative trim stored with the room. Both members are optional so a spec
 * may configure one trim without restating the other; the parser fills every
 * supplied block to a complete, validated config.
 */
export interface RoomTrimSpec {
  readonly baseboard?: RoomBaseboardSpec;
  readonly crownMolding?: RoomCrownMoldingSpec;
}

/**
 * Stored room parameters. Everything here is a JSON scalar; geometry, meshes
 * and derived extents live in `RoomPlan` instead.
 *
 * Lengths are centimetres. The room is centred on the local X/Z origin:
 * X spans `[-widthCm/2, widthCm/2]`, Z spans `[-lengthCm/2, lengthCm/2]`,
 * and the floor top surface is Y = 0.
 */
export interface RoomSpec {
  readonly widthCm: number;
  readonly lengthCm: number;
  readonly heightCm: number;
  readonly wallThicknessCm: number;
  readonly floorThicknessCm: number;
  readonly ceilingThicknessCm: number;
  readonly showCeiling: boolean;
  readonly roomType: RoomType;
  /** Optional so pre-9A.2.3 specs round-trip without a new key. */
  readonly openings?: readonly RoomOpeningSpec[];
  /** Optional so pre-9A.2.5 specs round-trip without a new key. */
  readonly materials?: RoomMaterialsSpec;
  /** Optional so pre-9A.2.6 specs round-trip without a new key. */
  readonly trim?: RoomTrimSpec;
}

export type TrimType = 'baseboard' | 'crown-molding';

/** Metadata attached to each generated trim part (inside `PlanPart.metadata`). */
export interface RoomTrimPartMetadata {
  readonly wallId: RoomSide;
  readonly trimType: TrimType;
  /** Segment bounds in wall-run centimetres (0 = wall start). */
  readonly segmentStartCm: number;
  readonly segmentEndCm: number;
  readonly profile: TrimProfile;
  readonly heightCm: number;
  readonly materialSlot: RoomMaterialSlotId;
  readonly thicknessCm?: number;
  readonly projectionCm?: number;
}

export type RoomBoundaryKind = 'rectangle' | 'polygon';

/**
 * Floor-plane boundary in centimetres.
 *
 * Points are ordered counter-clockwise as seen looking down the +Y axis
 * (positive signed area) and are stored in the local X/Z plane. The rectangle
 * order is NW, NE, SE, SW. Future polygon support reuses the same shape.
 */
export interface RoomBoundary {
  readonly kind: RoomBoundaryKind;
  readonly points: readonly Vec2Tuple[];
  /** Axis-aligned extents of the boundary, in centimetres. */
  readonly widthCm: number;
  readonly lengthCm: number;
  readonly areaCm2: number;
}

export interface RoomFloorPlan {
  readonly partId: string;
  readonly widthCm: number;
  readonly lengthCm: number;
  readonly thicknessCm: number;
  /** Floor top surface; the scene convention puts it at Y = 0. */
  readonly topY: number;
  readonly materialSlot: string;
}

export interface RoomCeilingPlan {
  readonly partId: string;
  readonly widthCm: number;
  readonly lengthCm: number;
  readonly thicknessCm: number;
  /** Underside of the ceiling slab. */
  readonly bottomY: number;
  readonly materialSlot: string;
}

export interface RoomWallPlan {
  readonly partId: string;
  readonly side: RoomSide;
  /** Boundary edge index the wall belongs to. */
  readonly edgeIndex: number;
  /** Wall run from corner to corner, in centimetres. */
  readonly lengthCm: number;
  readonly heightCm: number;
  readonly thicknessCm: number;
  readonly center: Vec3Tuple;
  /** Outward normal in the X/Z plane. */
  readonly outwardNormal: Vec2Tuple;
  readonly materialSlot: string;
  /** Opening ids hosted by this wall, in plan order. */
  readonly openingIds: readonly string[];
}

export interface RoomBounds3 {
  readonly min: Vec3Tuple;
  readonly max: Vec3Tuple;
}

export interface DoorAssemblyPlan {
  readonly framePartIds: readonly string[];
  readonly leafPartId: string;
  readonly handlePartId: string;
  readonly hingeCount: number;
  readonly hingeSide: 'left' | 'right';
  readonly swingDirection: 'inward' | 'outward';
  readonly swingAngleDeg: number;
  readonly pivot: Vec3Tuple;
  readonly hingePositions: readonly Vec3Tuple[];
  readonly closedPosition: Vec3Tuple;
  readonly closedRotationDeg: Vec3Tuple;
  /** Additional world-Y rotation to apply around `pivot` for an open leaf. */
  readonly openRotationYDeg: number;
}

export interface WindowAssemblyPlan {
  readonly framePartIds: readonly string[];
  readonly glassPartIds: readonly string[];
  readonly sillPartId: string;
  readonly mullionPartIds: readonly string[];
  readonly transomPartIds: readonly string[];
}

/** Build-time metadata for one opening; frame/leaf/glass are all derived. */
export interface RoomOpeningPlan {
  readonly id: string;
  readonly type: RoomOpeningType;
  readonly wallId: RoomSide;
  readonly offsetCm: number;
  readonly widthCm: number;
  readonly heightCm: number;
  readonly sillHeightCm: number;
  readonly center: Vec3Tuple;
  readonly bounds: RoomBounds3;
  readonly door?: DoorAssemblyPlan;
  readonly window?: WindowAssemblyPlan;
}

/** Room-specific metadata derived from one validated `RoomSpec`. */
export interface RoomPlanMetadata {
  readonly boundary: RoomBoundary;
  readonly walls: readonly RoomWallPlan[];
  readonly openings: readonly RoomOpeningPlan[];
  readonly floor: RoomFloorPlan;
  readonly ceiling: RoomCeilingPlan | null;
}

/**
 * The full build-time result. `parametric` is the 9A.1 generic plan; its parts
 * are the single source of geometry for a future room builder.
 */
export interface RoomPlan extends RoomPlanMetadata {
  readonly definitionId: string;
  readonly domain: typeof INTERIOR_DOMAIN;
  readonly family: typeof ROOM_FAMILY;
  readonly spec: RoomSpec;
  readonly parametric: ParametricPlan;
}

/**
 * A room definition composes the generic contract rather than extending it:
 * `parametric` owns parse/solve/limits, `solveRoom` adds room-only metadata.
 */
export interface RoomDefinition {
  readonly id: string;
  readonly domain: typeof INTERIOR_DOMAIN;
  readonly family: typeof ROOM_FAMILY;
  readonly label: string;
  readonly parametric: ParametricDefinition<RoomSpec>;
  readonly solveRoom: (spec: RoomSpec) => RoomPlanMetadata;
}

/** The type-erased record the interior registry stores. */
export interface RegisteredRoomDefinition {
  readonly id: string;
  readonly domain: typeof INTERIOR_DOMAIN;
  readonly family: typeof ROOM_FAMILY;
  readonly label: string;
  readonly parametric: RegisteredParametricDefinition;
  readonly fields: readonly DefinitionField[];
  readonly defaults: Readonly<RoomSpec>;
  readonly slots: readonly ParametricSlot[];
  readonly limits: PlanLimits;
  readonly groupName?: string;
  readonly parseSpec: (input: unknown) => SpecParseResult<RoomSpec>;
  readonly createPlan: (input: unknown) => RoomPlanCreationResult;
}

export type RoomPlanIssueCode =
  | 'invalid_spec'
  | 'invalid_boundary'
  | 'invalid_plan'
  | 'invalid_definition'
  | 'unknown_definition';

export interface RoomPlanIssue {
  readonly code: RoomPlanIssueCode;
  readonly message: string;
  readonly partId?: string;
}

export type RoomPlanCreationResult =
  | { readonly ok: true; readonly plan: RoomPlan }
  | { readonly ok: false; readonly issues: readonly RoomPlanIssue[] };

export type RoomBoundaryValidationResult =
  | { readonly ok: true; readonly boundary: RoomBoundary }
  | { readonly ok: false; readonly errors: readonly string[] };

export type InteriorErrorCode =
  | 'invalid_definition'
  | 'duplicate_definition'
  | 'unknown_definition'
  | 'invalid_room_spec'
  | 'invalid_boundary'
  | 'invalid_plan';

export class InteriorError extends Error {
  readonly code: InteriorErrorCode;
  readonly issues: readonly RoomPlanIssue[];

  constructor(
    code: InteriorErrorCode,
    message: string,
    issues: readonly RoomPlanIssue[] = [],
  ) {
    super(message);
    this.name = 'InteriorError';
    this.code = code;
    this.issues = issues;
  }
}

/** Convenience alias so callers do not need the universal import path. */
export type RoomSpecParseResult = SpecParseResult<RoomSpec>;

/** Internal layout shape shared by part solving and room metadata. */
export interface RoomBoxLayout {
  readonly partId: string;
  readonly type: 'wall' | 'floor' | 'ceiling';
  readonly role: 'wall' | 'floor' | 'ceiling';
  readonly materialSlot: string;
  readonly dimensions: ComponentDimensions;
  /** Mesh position: centre for boxes, profile origin for extrusions. */
  readonly position: Vec3Tuple;
  /** Euler XYZ in degrees. */
  readonly rotation: Vec3Tuple;
}

export interface RoomWallLayout extends RoomBoxLayout {
  readonly side: RoomSide;
  readonly edgeIndex: number;
  readonly lengthCm: number;
  readonly outwardNormal: Vec2Tuple;
  readonly center: Vec3Tuple;
  readonly geometryKind: 'box' | 'extrude';
  readonly openings: readonly RoomOpeningSpec[];
  readonly openingIds: readonly string[];
}

export interface RoomLayout {
  readonly floor: RoomBoxLayout;
  readonly walls: readonly RoomWallLayout[];
  readonly ceiling: RoomBoxLayout | null;
}
