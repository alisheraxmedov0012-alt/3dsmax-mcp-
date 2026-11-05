/**
 * Physical UV mapping for box parts.
 *
 * `BoxGeometry` gives every face a 0..1 UV square regardless of how large the
 * face is, so the procedural detail texture is stretched over a 200 cm table top
 * and squeezed onto a 4 cm leg. The resulting texel density differs by an order
 * of magnitude across one piece, which is exactly what makes a procedural map
 * look like a decal instead of a material.
 *
 * This module rescales each face's UVs by the face's physical size, so one UV
 * unit always covers {@link UV_TILE_CM} centimetres. `textureScale` still
 * multiplies the result (a texture-level repeat), which shrinks the tile but
 * keeps the density uniform across faces.
 *
 * Only `BoxGeometry`'s 24-vertex layout is handled; other geometry is left
 * untouched rather than guessed at.
 */
import * as THREE from 'three';
import { DEFAULT_UV_TILE_CM } from './types';

/** Centimetres covered by one UV unit before `textureScale` is applied. */
export const UV_TILE_CM = DEFAULT_UV_TILE_CM;

const MIN_TILE_CM = 1;
const MAX_TILE_CM = 1000;
const BOX_VERTEX_COUNT = 24;
const FACES_PER_BOX = 6;
const VERTICES_PER_FACE = 4;

export interface BoxUvScale {
  /** Tile size actually used, in centimetres. */
  tileCm: number;
  /**
   * `[uScale, vScale]` per box face, in Three.js `BoxGeometry` order:
   * +X, -X, +Y, -Y, +Z, -Z.
   */
  faces: ReadonlyArray<readonly [number, number]>;
}

function safeDimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0.1;
}

function safeTile(tileCm: number): number {
  if (!Number.isFinite(tileCm)) {
    return UV_TILE_CM;
  }
  return Math.min(Math.max(tileCm, MIN_TILE_CM), MAX_TILE_CM);
}

/**
 * UV scale factors for a box of the given size in centimetres.
 *
 * Side faces (+X/-X) span depth × height, horizontal faces (+Y/-Y) span
 * width × depth, and front/back faces (+Z/-Z) span width × height. Dividing each
 * span by the tile size yields the UV range that face must cover.
 */
export function boxFaceUvScale(
  size: readonly [number, number, number],
  tileCm: number = UV_TILE_CM,
): BoxUvScale {
  const [width, height, depth] = size.map(safeDimension) as [number, number, number];
  const tile = safeTile(tileCm);
  const uDepth = depth / tile;
  const uWidth = width / tile;
  const vHeight = height / tile;
  const vDepth = depth / tile;
  return {
    tileCm: tile,
    faces: [
      [uDepth, vHeight],
      [uDepth, vHeight],
      [uWidth, vDepth],
      [uWidth, vDepth],
      [uWidth, vHeight],
      [uWidth, vHeight],
    ],
  };
}

/**
 * Rescale a `BoxGeometry`'s UVs to a constant physical tile size.
 *
 * Idempotent: a geometry that already carries a physical UV layout is left
 * alone, so rebuilding a mesh cannot compound the scaling. Returns `true` when
 * the geometry was mapped.
 */
export function applyPhysicalBoxUvs(
  geometry: THREE.BufferGeometry,
  size: readonly [number, number, number],
  tileCm: number = UV_TILE_CM,
): boolean {
  if (geometry.userData.uvLayout) {
    return false;
  }

  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv || uv.count !== BOX_VERTEX_COUNT) {
    return false;
  }

  const scale = boxFaceUvScale(size, tileCm);
  for (let face = 0; face < FACES_PER_BOX; face += 1) {
    const [uScale, vScale] = scale.faces[face];
    for (let vertex = 0; vertex < VERTICES_PER_FACE; vertex += 1) {
      const index = face * VERTICES_PER_FACE + vertex;
      uv.setXY(index, uv.getX(index) * uScale, uv.getY(index) * vScale);
    }
  }
  uv.needsUpdate = true;
  geometry.userData.uvLayout = { layout: 'physical-box', tileCm: scale.tileCm };
  return true;
}

/** UV layout facts reported in export metadata (see `export/assetPackage`). */
export interface UvLayoutSummary {
  layout: 'physical-box';
  tileCm: number;
  textureScaleApplies: true;
}

export function describeUvLayout(tileCm: number = UV_TILE_CM): UvLayoutSummary {
  return {
    layout: 'physical-box',
    tileCm: safeTile(tileCm),
    textureScaleApplies: true,
  };
}

// ---------------------------------------------------------------------------
// Phase 4.4 — universal physical UV mapping
// ---------------------------------------------------------------------------

/** Mapping strategies. `physical-box` stays a backwards-compatible alias. */
export type UvMappingMode = 'box' | 'planar' | 'cylindrical' | 'preserve';
export type UvRequestedMode = UvMappingMode | 'physical-box' | 'auto' | 'geometry';
export type UvOrientation = 'auto' | 'vertical' | 'horizontal';
export type UvPlane = 'xy' | 'xz' | 'yz';

/** A hard sanity bound; real furniture UV spans are far below this. */
export const MAX_UV_ABS = 10_000;

/**
 * Structural subset of kernel recipes needed to choose and size a mapping.
 * Keeping this local avoids a materials -> geometry runtime dependency.
 */
export interface UvRecipeDescriptor {
  readonly kind: string;
  readonly width?: number;
  readonly height?: number;
  readonly depth?: number;
  readonly radiusTop?: number;
  readonly radiusBottom?: number;
  readonly radius?: number;
  readonly thetaLength?: number;
  readonly uvs?: ArrayLike<number>;
}

export interface UvMappingOptions {
  mode?: UvRequestedMode;
  tileCm?: number;
  orientation?: UvOrientation;
  /** Planar projection plane. Omitted picks the flattest axis deterministically. */
  plane?: UvPlane;
  /** Cylindrical texture shift, in UV units. It does not alter vertex seams. */
  seamOffset?: number;
  flipU?: boolean;
  flipV?: boolean;
}

export interface UvDiagnostics {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly hasUv: boolean;
  readonly uvCount: number;
  readonly positionCount: number;
  readonly nonFiniteCount: number;
  readonly minU: number | null;
  readonly minV: number | null;
  readonly maxU: number | null;
  readonly maxV: number | null;
  readonly spanU: number;
  readonly spanV: number;
}

export interface UvLayoutRecord {
  readonly layout: UvMappingMode;
  readonly tileCm: number;
  readonly orientation: UvOrientation;
  readonly plane?: UvPlane;
  readonly seamOffset?: number;
}

export interface UvMappingResult {
  readonly applied: boolean;
  readonly mode: UvMappingMode;
  readonly diagnostics: UvDiagnostics;
}

/** Which physical mapping a recipe wants by default. */
export function uvModeForRecipe(recipe: UvRecipeDescriptor): UvMappingMode {
  switch (recipe.kind) {
    case 'box':
    case 'roundedBox':
      return 'box';
    case 'cylinder':
    case 'capsule':
    case 'lathe':
    case 'tube':
      return 'cylindrical';
    case 'extrude':
      return 'planar';
    case 'custom':
      return recipe.uvs === undefined ? 'planar' : 'preserve';
    default:
      return 'preserve';
  }
}

/**
 * Default grain direction per furniture part type.
 *
 * Legs, supports, frames, feet and doors read as vertical members, so their V
 * axis follows height. Panels/shelves keep the automatic long-side mapping.
 */
export function uvOrientationForPart(partType: string | null | undefined): UvOrientation {
  switch ((partType ?? '').toLowerCase()) {
    case 'leg':
    case 'support':
    case 'frame':
    case 'foot':
    case 'door':
      return 'vertical';
    default:
      return 'auto';
  }
}

function finiteOr(value: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bounds(geometry: THREE.BufferGeometry): {
  min: [number, number, number];
  max: [number, number, number];
} | null {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!position || position.count === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

function orient(uv: THREE.BufferAttribute, index: number, u: number, v: number, horizontal: boolean): void {
  if (horizontal) {
    uv.setXY(index, v, u);
  } else {
    uv.setXY(index, u, v);
  }
}

/** Generic box/rounded-box projection based on the dominant vertex normal. */
function mapBoxByNormals(
  geometry: THREE.BufferGeometry,
  tile: number,
  orientation: UvOrientation,
): boolean {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!position || !normal || !uv || uv.count !== position.count) {
    return false;
  }
  const box = bounds(geometry);
  if (!box) {
    return false;
  }
  const [minX, minY, minZ] = box.min;
  const [maxX, , maxZ] = box.max;
  const horizontal = orientation === 'horizontal';

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const nz = Math.abs(normal.getZ(i));

    let u: number;
    let v: number;
    if (nx >= ny && nx >= nz) {
      u = normal.getX(i) < 0 ? (maxZ - z) / tile : (z - minZ) / tile;
      v = (y - minY) / tile;
    } else if (nz >= ny) {
      u = normal.getZ(i) < 0 ? (maxX - x) / tile : (x - minX) / tile;
      v = (y - minY) / tile;
    } else {
      u = (x - minX) / tile;
      v = normal.getY(i) < 0 ? (maxZ - z) / tile : (z - minZ) / tile;
    }
    orient(uv, i, u, v, horizontal);
  }
  uv.needsUpdate = true;
  return true;
}

function choosePlanarPlane(geometry: THREE.BufferGeometry): UvPlane {
  const box = bounds(geometry);
  if (!box) {
    return 'xz';
  }
  const extents = [
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2],
  ];
  if (extents[2] <= extents[0] && extents[2] <= extents[1]) {
    return 'xy';
  }
  if (extents[1] <= extents[0]) {
    return 'xz';
  }
  return 'yz';
}

const PLANE_AXES: Record<UvPlane, readonly [number, number]> = {
  xy: [0, 1],
  xz: [0, 2],
  yz: [1, 2],
};

function mapPlanar(
  geometry: THREE.BufferGeometry,
  plane: UvPlane,
  tile: number,
  options: UvMappingOptions,
): boolean {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!position || !uv || uv.count !== position.count) {
    return false;
  }
  const box = bounds(geometry);
  if (!box) {
    return false;
  }
  const [uAxis, vAxis] = PLANE_AXES[plane];
  const minU = box.min[uAxis];
  const maxU = box.max[uAxis];
  const minV = box.min[vAxis];
  const maxV = box.max[vAxis];
  const horizontal = options.orientation === 'horizontal';

  for (let i = 0; i < position.count; i += 1) {
    const coordU = position.getComponent(i, uAxis);
    const coordV = position.getComponent(i, vAxis);
    const u = (options.flipU ? maxU - coordU : coordU - minU) / tile;
    const v = (options.flipV ? maxV - coordV : coordV - minV) / tile;
    orient(uv, i, u, v, horizontal);
  }
  uv.needsUpdate = true;
  return true;
}

function mapCylindrical(
  geometry: THREE.BufferGeometry,
  tile: number,
  recipe: UvRecipeDescriptor,
  options: UvMappingOptions,
): boolean {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!position || !normal || !uv || uv.count !== position.count) {
    return false;
  }
  const box = bounds(geometry);
  if (!box) {
    return false;
  }
  const centerX = (box.min[0] + box.max[0]) / 2;
  const centerZ = (box.min[2] + box.max[2]) / 2;
  const minY = box.min[1];
  const arc = Math.min(
    Math.max(finiteOr(recipe.thetaLength ?? Math.PI * 2, Math.PI * 2), 0.0001),
    Math.PI * 2,
  );
  const seamOffset = finiteOr(options.seamOffset ?? 0, 0);
  const horizontal = options.orientation === 'horizontal';

  // TubeGeometry's U runs along the path and V around the radius, the opposite
  // of a cylinder. Approximate the path length by the longest bbox extent and
  // the radius by the second-smallest extent; a strongly curved tube is a
  // documented approximation, not an unwrap.
  const extents = [
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2],
  ].sort((left, right) => left - right);
  const tubeRadius = Math.max(extents[1] / 2, 1e-6);
  const tubeLength = Math.max(extents[2], 1e-6);

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const ny = normal.getY(i);
    if (recipe.kind === 'tube') {
      const u = (uv.getX(i) * tubeLength) / tile;
      const v = (uv.getY(i) * Math.PI * 2 * tubeRadius) / tile + seamOffset;
      orient(uv, i, u, v, horizontal);
      continue;
    }
    if (Math.abs(ny) > 0.9) {
      // Cap: a physical planar projection reads better than a radial disc map.
      const u = (x - centerX) / tile;
      const v = (ny < 0 ? centerZ - z : z - centerZ) / tile;
      orient(uv, i, u, v, horizontal);
      continue;
    }

    const radius = Math.max(Math.hypot(x - centerX, z - centerZ), 1e-6);
    const normalizedU = uv.getX(i);
    const u = (normalizedU * arc * radius) / tile + seamOffset;
    const v = (y - minY) / tile;
    orient(uv, i, u, v, horizontal);
  }
  uv.needsUpdate = true;
  return true;
}

/** Validate UV presence, count, finiteness and scale without throwing. */
export function validateUvGeometry(geometry: THREE.BufferGeometry): UvDiagnostics {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const positionCount = position?.count ?? 0;
  if (!uv) {
    return {
      valid: false,
      errors: ['UV attribute topilmadi.'],
      warnings: [],
      hasUv: false,
      uvCount: 0,
      positionCount,
      nonFiniteCount: 0,
      minU: null,
      minV: null,
      maxU: null,
      maxV: null,
      spanU: 0,
      spanV: 0,
    };
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  if (uv.count !== positionCount) {
    errors.push(`UV soni (${uv.count}) vertex soni (${positionCount}) bilan mos emas.`);
  }

  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  let nonFiniteCount = 0;
  for (let i = 0; i < uv.count; i += 1) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    if (!Number.isFinite(u) || !Number.isFinite(v)) {
      nonFiniteCount += 1;
      continue;
    }
    minU = Math.min(minU, u);
    minV = Math.min(minV, v);
    maxU = Math.max(maxU, u);
    maxV = Math.max(maxV, v);
  }
  if (nonFiniteCount > 0) {
    errors.push(`${nonFiniteCount} ta UV qiymati NaN yoki Infinity.`);
  }

  const hasValues = Number.isFinite(minU);
  const spanU = hasValues ? maxU - minU : 0;
  const spanV = hasValues ? maxV - minV : 0;
  if (hasValues && spanU < 1e-9 && spanV < 1e-9 && positionCount > 0) {
    warnings.push('UV span nolga teng (degenerate mapping).');
  }
  if (hasValues && (Math.max(Math.abs(minU), Math.abs(maxU), Math.abs(minV), Math.abs(maxV)) > MAX_UV_ABS)) {
    warnings.push(`UV qiymatlari ${MAX_UV_ABS} chegarasidan katta.`);
  }
  if (uv.count === 0) {
    errors.push('UV attribute bo\u2019sh.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    hasUv: true,
    uvCount: uv.count,
    positionCount,
    nonFiniteCount,
    minU: hasValues ? minU : null,
    minV: hasValues ? minV : null,
    maxU: hasValues ? maxU : null,
    maxV: hasValues ? maxV : null,
    spanU,
    spanV,
  };
}

/** Diagnostics are out-of-band: GLTFExporter would serialize userData as extras. */
const diagnosticsByGeometry = new WeakMap<THREE.BufferGeometry, UvDiagnostics>();

export function setUvDiagnostics(
  geometry: THREE.BufferGeometry,
  diagnostics: UvDiagnostics,
): void {
  diagnosticsByGeometry.set(geometry, diagnostics);
}

export function getUvDiagnostics(
  geometry: THREE.BufferGeometry,
): UvDiagnostics | undefined {
  return diagnosticsByGeometry.get(geometry);
}

/**
 * Apply a physical mapping to a geometry and validate it.
 *
 * A failed mapping restores the previous UV buffer, so a diagnostics failure
 * never leaves broken UVs on a mesh. The geometry is left untouched when the
 * recipe asks to preserve authored UVs or was already mapped.
 */
export function applyUvMapping(
  geometry: THREE.BufferGeometry,
  recipe: UvRecipeDescriptor,
  options: UvMappingOptions = {},
): UvMappingResult {
  const resolved =
    options.mode === undefined || options.mode === 'auto'
      ? uvModeForRecipe(recipe)
      : options.mode === 'physical-box'
        ? 'box'
        : options.mode;

  if (resolved === 'geometry' || resolved === 'preserve' || geometry.userData.uvLayout) {
    return {
      applied: false,
      mode: resolved === 'geometry' ? 'preserve' : resolved,
      diagnostics: validateUvGeometry(geometry),
    };
  }

  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv) {
    return { applied: false, mode: resolved, diagnostics: validateUvGeometry(geometry) };
  }
  const backup = Float32Array.from(uv.array as ArrayLike<number>);
  const tile = safeTile(options.tileCm ?? UV_TILE_CM);
  const orientation = options.orientation ?? 'auto';

  let applied = false;
  if (resolved === 'box') {
    if (recipe.kind === 'box' && uv.count === BOX_VERTEX_COUNT && orientation === 'auto') {
      applied = applyPhysicalBoxUvs(
        geometry,
        [safeDimension(recipe.width ?? 1), safeDimension(recipe.height ?? 1), safeDimension(recipe.depth ?? 1)],
        tile,
      );
    } else {
      applied = mapBoxByNormals(geometry, tile, orientation);
    }
  } else if (resolved === 'planar') {
    applied = mapPlanar(geometry, options.plane ?? choosePlanarPlane(geometry), tile, options);
  } else if (resolved === 'cylindrical') {
    applied = mapCylindrical(geometry, tile, recipe, options);
  }

  if (!applied) {
    return { applied: false, mode: resolved, diagnostics: validateUvGeometry(geometry) };
  }

  const diagnostics = validateUvGeometry(geometry);
  if (!diagnostics.valid) {
    uv.array.set(backup);
    uv.needsUpdate = true;
    delete geometry.userData.uvLayout;
    return { applied: false, mode: resolved, diagnostics };
  }

  geometry.userData.uvLayout = {
    layout: resolved,
    tileCm: tile,
    orientation,
    ...(resolved === 'planar' ? { plane: options.plane ?? choosePlanarPlane(geometry) } : {}),
    ...(resolved === 'cylindrical' ? { seamOffset: finiteOr(options.seamOffset ?? 0, 0) } : {}),
  } satisfies UvLayoutRecord;
  setUvDiagnostics(geometry, diagnostics);
  if (recipe.kind === 'custom' && resolved === 'planar') {
    geometry.userData.uvSource = 'planar-physical';
  }
  return { applied: true, mode: resolved, diagnostics };
}
