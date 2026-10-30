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

/** Centimetres covered by one UV unit before `textureScale` is applied. */
export const UV_TILE_CM = 50;

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
