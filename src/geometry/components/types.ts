/**
 * Stage 1.2.1 — reusable furniture component contract.
 *
 * A component is a *description*, not a materialised mesh: it carries a
 * GeometryRecipe that `PartBuilder.addGeometry()` can turn into geometry. This
 * keeps material creation out of the component layer and makes every component
 * reusable on its own.
 */
import type { GeometryRecipe, Vec3Tuple } from '../kernel';

export const COMPONENT_VERSION = 1;

export const COMPONENT_TYPES = [
  'panel',
  'leg',
  'frame',
  'shelf',
  'support',
  'drawer',
  'door',
  'handle',
  'grommet',
  'bolt',
  'screw',
  'foot',
] as const;

export type ComponentType = (typeof COMPONENT_TYPES)[number];
export type ComponentRole = ComponentType;
export type ComponentMaterialSlot = 'panel' | 'frame' | 'hardware' | 'surface';

/**
 * UV policy a component may request explicitly.
 *
 * `auto` keeps the per-recipe default. `box` is used by the desk tabletop: its
 * extruded plate is not a box, but a physical box projection keeps the wood
 * grain density uniform instead of stretching one 0–1 planar map over 160 cm.
 */
export type ComponentUvMode =
  | 'auto'
  | 'box'
  | 'planar'
  | 'cylindrical'
  | 'geometry'
  | 'preserve'
  | 'physical-box';

export interface ComponentDimensions {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

export interface ComponentMetadata extends Record<string, unknown> {
  readonly partId: string;
  readonly role: ComponentRole;
  readonly materialSlot: ComponentMaterialSlot;
  readonly componentVersion: number;
}

export interface ComponentPart {
  readonly id: string;
  readonly type: ComponentType;
  readonly dimensions: ComponentDimensions;
  readonly position: Vec3Tuple;
  /** Euler XYZ in degrees, matching the scene convention. */
  readonly rotation: Vec3Tuple;
  readonly geometry: GeometryRecipe;
  readonly role: ComponentRole;
  readonly materialSlot: ComponentMaterialSlot;
  readonly componentVersion: number;
  readonly metadata: ComponentMetadata;
  /** Optional explicit UV policy; absent keeps `addComponent`'s `auto` behaviour. */
  readonly uv?: ComponentUvMode;
}

export interface ComponentPlacement {
  readonly position?: Vec3Tuple;
  readonly rotation?: Vec3Tuple;
  readonly role?: ComponentRole;
  readonly materialSlot?: ComponentMaterialSlot;
  readonly metadata?: Record<string, unknown>;
  readonly uv?: ComponentUvMode;
}

/** Internal result of a component-specific builder. */
export interface ComponentBuild {
  readonly geometry: GeometryRecipe;
  readonly dimensions: ComponentDimensions;
  readonly metadata?: Record<string, unknown>;
}

export interface PanelParams {
  readonly width: number;
  readonly height: number;
  readonly thickness: number;
  readonly cornerRadius?: number;
  readonly bevel?: number;
  readonly segments?: number;
  /** Use the extruded-plate recipe (local XY, thickness along Z) instead of a rounded box. */
  readonly plate?: boolean;
}

export interface LegParams {
  readonly height: number;
  readonly shape: 'square' | 'round';
  readonly width?: number;
  readonly depth?: number;
  readonly radius?: number;
  readonly taper?: number;
  readonly segments?: number;
  /** Square legs only: edge roundover in cm. `0` keeps the original sharp box. */
  readonly bevel?: number;
  /** Square legs only: roundover subdivisions. Defaults to 2. */
  readonly bevelSegments?: number;
}

export interface FrameParams {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly memberThickness: number;
  readonly profile?: 'rectangular';
  /** Edge roundover in cm; `0` keeps the original sharp extrusion. */
  readonly bevel?: number;
}

export interface ShelfParams {
  readonly width: number;
  readonly depth: number;
  readonly thickness: number;
  readonly cornerRadius?: number;
  readonly bevel?: number;
  readonly segments?: number;
  /**
   * Force the extruded-plate recipe even without a hole. The plate is built in
   * local XY (thickness along Z), so the caller must rotate it into place.
   */
  readonly plate?: boolean;
  /**
   * Optional through-hole. When present the shelf becomes an extruded plate in
   * local XY (thickness along Z), so the caller must rotate it into place.
   * Coordinates are in the plate plane: x across width, z across depth.
   */
  readonly hole?: {
    readonly x: number;
    readonly z: number;
    readonly radius: number;
  };
}

export interface SupportParams {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  /** Edge roundover in cm; `0` keeps the original sharp box. */
  readonly bevel?: number;
  readonly segments?: number;
}

export interface DrawerParams {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly sideThickness: number;
  readonly bottomThickness: number;
  /**
   * Split each face into its own vertices with face normals. The default keeps
   * the historical shared-vertex/smooth-normal output for existing furniture;
   * the Premium Desk opts in so its box edges shade sharply and box UVs do not
   * degenerate on shared diagonal normals.
   */
  readonly flatShading?: boolean;
}

export interface DoorParams {
  readonly width: number;
  readonly height: number;
  readonly thickness: number;
  readonly cornerRadius?: number;
  readonly bevel?: number;
  readonly segments?: number;
}

export interface HandleParams {
  readonly type: 'bar' | 'knob';
  readonly length?: number;
  readonly diameter: number;
  readonly projection: number;
  readonly mountingDistance?: number;
  readonly segments?: number;
}

export interface GrommetParams {
  readonly outerRadius: number;
  readonly innerRadius: number;
  readonly thickness: number;
  readonly segments?: number;
}

export interface BoltParams {
  readonly shaftDiameter: number;
  readonly length: number;
  readonly headDiameter: number;
  readonly headHeight: number;
  readonly segments?: number;
}

export interface ScrewParams {
  readonly shaftDiameter: number;
  readonly length: number;
  readonly headDiameter: number;
  readonly headHeight: number;
  readonly segments?: number;
}

export interface FootParams {
  readonly height: number;
  readonly diameter: number;
  readonly taper?: number;
  readonly segments?: number;
}

export interface ComponentParamsMap {
  readonly panel: PanelParams;
  readonly leg: LegParams;
  readonly frame: FrameParams;
  readonly shelf: ShelfParams;
  readonly support: SupportParams;
  readonly drawer: DrawerParams;
  readonly door: DoorParams;
  readonly handle: HandleParams;
  readonly grommet: GrommetParams;
  readonly bolt: BoltParams;
  readonly screw: ScrewParams;
  readonly foot: FootParams;
}

export const CONNECTION_TYPES = [
  'fixed',
  'screw',
  'bolt',
  'panel-to-panel',
  'leg-to-frame',
] as const;

export type ConnectionType = (typeof CONNECTION_TYPES)[number];

export interface ConnectionInput {
  readonly id: string;
  readonly type: ConnectionType;
  readonly componentIds: readonly [string, string];
  readonly position: Vec3Tuple;
  readonly direction: Vec3Tuple;
  readonly hardwareId?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface ComponentConnection extends Record<string, unknown> {
  readonly id: string;
  readonly type: ConnectionType;
  readonly componentIds: readonly [string, string];
  readonly position: Vec3Tuple;
  readonly direction: Vec3Tuple;
  readonly hardwareId?: string;
  readonly connectionVersion: number;
  readonly metadata: Record<string, unknown>;
}
