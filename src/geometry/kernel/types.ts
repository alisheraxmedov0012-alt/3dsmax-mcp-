/**
 * Stage 1.1 — declarative geometry recipes.
 *
 * The kernel is deliberately data-first: a recipe describes the geometry, while
 * the factory owns Three.js construction and validation. Furniture builders can
 * add new shapes without growing `PartBuilder` itself.
 *
 * Units follow the rest of the scene: centimetres. The kernel does not know about
 * materials, scene transforms or export formats.
 */
import type * as THREE from 'three';

export const GEOMETRY_KERNEL_VERSION = 1;

/** Hard limits that keep a single part from exhausting memory or the GPU. */
export const GEOMETRY_LIMITS = {
  maxSegments: 512,
  maxRoundedBoxSegments: 16,
  maxCurveSegments: 64,
  maxProfilePoints: 256,
  maxCurvePoints: 256,
  maxVertices: 250_000,
  maxTriangles: 500_000,
} as const;

export type Vec2Tuple = readonly [number, number];
export type Vec3Tuple = readonly [number, number, number];

export interface BoxRecipe {
  readonly kind: 'box';
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly widthSegments?: number;
  readonly heightSegments?: number;
  readonly depthSegments?: number;
}

export interface RoundedBoxRecipe {
  readonly kind: 'roundedBox';
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly radius: number;
  readonly segments?: number;
}

export interface CylinderRecipe {
  readonly kind: 'cylinder';
  readonly radiusTop: number;
  readonly radiusBottom: number;
  readonly height: number;
  readonly radialSegments?: number;
  readonly heightSegments?: number;
  readonly openEnded?: boolean;
  readonly thetaStart?: number;
  readonly thetaLength?: number;
}

export interface SphereRecipe {
  readonly kind: 'sphere';
  readonly radius: number;
  readonly widthSegments?: number;
  readonly heightSegments?: number;
  readonly phiStart?: number;
  readonly phiLength?: number;
  readonly thetaStart?: number;
  readonly thetaLength?: number;
}

export interface CapsuleRecipe {
  readonly kind: 'capsule';
  readonly radius: number;
  /** Length of the cylindrical middle section, excluding the two caps. */
  readonly length: number;
  readonly capSegments?: number;
  readonly radialSegments?: number;
}

export interface ExtrudeRecipe {
  readonly kind: 'extrude';
  /** Outer contour in the XY plane, in order. */
  readonly profile: readonly Vec2Tuple[];
  readonly depth: number;
  readonly holes?: readonly (readonly Vec2Tuple[])[];
  readonly bevelEnabled?: boolean;
  readonly bevelThickness?: number;
  readonly bevelSize?: number;
  readonly bevelSegments?: number;
  readonly curveSegments?: number;
  readonly steps?: number;
}

export interface LatheRecipe {
  readonly kind: 'lathe';
  /** Profile points in the XY plane; X is the radius and Y is the axis. */
  readonly points: readonly Vec2Tuple[];
  readonly segments?: number;
  readonly phiStart?: number;
  readonly phiLength?: number;
}

export interface TubeRecipe {
  readonly kind: 'tube';
  readonly points: readonly Vec3Tuple[];
  readonly radius: number;
  readonly tubularSegments?: number;
  readonly radialSegments?: number;
  readonly closed?: boolean;
}

export interface CustomGeometryRecipe {
  readonly kind: 'custom';
  /** Flat XYZ triples. A triangle mesh is non-indexed when `indices` is absent. */
  readonly positions: ArrayLike<number>;
  readonly indices?: ArrayLike<number>;
  readonly normals?: ArrayLike<number>;
  /** Flat UV pairs. A planar fallback is generated when omitted. */
  readonly uvs?: ArrayLike<number>;
  /** Default true: compute normals when the recipe does not provide them. */
  readonly computeNormals?: boolean;
}

export type GeometryRecipe =
  | BoxRecipe
  | RoundedBoxRecipe
  | CylinderRecipe
  | SphereRecipe
  | CapsuleRecipe
  | ExtrudeRecipe
  | LatheRecipe
  | TubeRecipe
  | CustomGeometryRecipe;

export type GeometryRecipeKind = GeometryRecipe['kind'];

export interface CreateGeometryOptions {
  /** Require a normal attribute. Default true. */
  readonly requireNormals?: boolean;
  /** Require a UV attribute. Default true. */
  readonly requireUv?: boolean;
  /** Reject zero-area/duplicate-index triangles. Default false: Three's sphere
   * and capsule poles contain zero-area triangles by construction. */
  readonly rejectDegenerate?: boolean;
  /** Per-part vertex budget. Defaults to GEOMETRY_LIMITS.maxVertices. */
  readonly maxVertices?: number;
  /** Per-part triangle budget. Defaults to GEOMETRY_LIMITS.maxTriangles. */
  readonly maxTriangles?: number;
}

export interface GeometryStats {
  readonly vertices: number;
  readonly triangles: number;
  readonly indexed: boolean;
}

export interface GeometryValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly hasNormals: boolean;
  readonly hasUv: boolean;
  readonly hasDegenerateTriangles: boolean;
  readonly boundingBoxValid: boolean;
}

export type GeometryKernelErrorCode =
  | 'invalid_recipe'
  | 'invalid_geometry'
  | 'budget_exceeded'
  | 'unsupported_recipe';

export class GeometryKernelError extends Error {
  readonly code: GeometryKernelErrorCode;

  constructor(code: GeometryKernelErrorCode, message: string) {
    super(message);
    this.name = 'GeometryKernelError';
    this.code = code;
  }
}

/** A geometry that has passed kernel validation, with its recipe metadata attached. */
export interface KernelGeometry extends THREE.BufferGeometry {
  userData: {
    kernel?: {
      version: number;
      kind: GeometryRecipeKind;
      warnings: readonly string[];
    };
    [key: string]: unknown;
  };
}
