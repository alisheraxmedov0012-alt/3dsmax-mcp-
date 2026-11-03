import type { GeometryRecipe } from '../kernel';

export function panelRecipe(
  width: number,
  height: number,
  thickness: number,
  cornerRadius: number,
  bevel: number,
  segments: number,
): GeometryRecipe {
  const radius = Math.max(cornerRadius, bevel);
  return radius > 0
    ? { kind: 'roundedBox', width, height, depth: thickness, radius, segments }
    : { kind: 'box', width, height, depth: thickness };
}

export function shelfRecipe(
  width: number,
  thickness: number,
  depth: number,
  cornerRadius: number,
  bevel: number,
  segments: number,
): GeometryRecipe {
  const radius = Math.max(cornerRadius, bevel);
  return radius > 0
    ? { kind: 'roundedBox', width, height: thickness, depth, radius, segments }
    : { kind: 'box', width, height: thickness, depth };
}

/** Rectangular picture-frame profile, extruded along Z. */
export function frameRecipe(
  width: number,
  height: number,
  depth: number,
  memberThickness: number,
): GeometryRecipe {
  const innerWidth = width - 2 * memberThickness;
  const innerHeight = height - 2 * memberThickness;
  return {
    kind: 'extrude',
    profile: [
      [-width / 2, -height / 2],
      [width / 2, -height / 2],
      [width / 2, height / 2],
      [-width / 2, height / 2],
    ],
    holes: [[
      [-innerWidth / 2, -innerHeight / 2],
      [innerWidth / 2, -innerHeight / 2],
      [innerWidth / 2, innerHeight / 2],
      [-innerWidth / 2, innerHeight / 2],
    ]],
    depth,
  };
}

/** Revolved ring/flange for a cable grommet. */
export function grommetRecipe(
  outerRadius: number,
  innerRadius: number,
  thickness: number,
  segments: number,
): GeometryRecipe {
  const half = thickness / 2;
  return {
    kind: 'lathe',
    points: [
      [innerRadius, -half],
      [outerRadius, -half],
      [outerRadius, half],
      [innerRadius, half],
      [innerRadius, -half],
    ],
    segments,
  };
}

/** Solid bolt/screw silhouette: shaft plus a wider head, revolved around Y. */
export function fastenerRecipe(
  shaftDiameter: number,
  length: number,
  headDiameter: number,
  headHeight: number,
  segments: number,
): GeometryRecipe {
  const shaftRadius = shaftDiameter / 2;
  const headRadius = headDiameter / 2;
  // A tiny positive radius avoids zero-area pole triangles at the lathe axis;
  // the resulting pin-hole is below manufacturing relevance and keeps GLB safe.
  const axisRadius = Math.max(shaftRadius * 0.05, 0.005);
  const bottom = -length / 2;
  const neck = length / 2 - headHeight;
  const top = length / 2;
  return {
    kind: 'lathe',
    points: [
      [axisRadius, bottom],
      [shaftRadius, bottom],
      [shaftRadius, neck],
      [headRadius, neck],
      [headRadius, top],
      [axisRadius, top],
    ],
    segments,
  };
}

/** Tapered square leg/foot as a custom eight-vertex frustum. */
export function taperedSquareRecipe(
  width: number,
  height: number,
  taper: number,
  depth: number = width,
): GeometryRecipe {
  const bottomX = width / 2;
  const bottomZ = depth / 2;
  const topX = (width * (1 - taper)) / 2;
  const topZ = (depth * (1 - taper)) / 2;
  const halfHeight = height / 2;
  return {
    kind: 'custom',
    positions: [
      -bottomX, -halfHeight, -bottomZ,
      bottomX, -halfHeight, -bottomZ,
      bottomX, -halfHeight, bottomZ,
      -bottomX, -halfHeight, bottomZ,
      -topX, halfHeight, -topZ,
      topX, halfHeight, -topZ,
      topX, halfHeight, topZ,
      -topX, halfHeight, topZ,
    ],
    indices: [
      0, 1, 2, 0, 2, 3,
      4, 7, 6, 4, 6, 5,
      0, 4, 5, 0, 5, 1,
      1, 5, 6, 1, 6, 2,
      2, 6, 7, 2, 7, 3,
      3, 7, 4, 3, 4, 0,
    ],
  };
}

function addBox(
  positions: number[],
  indices: number[],
  centre: readonly [number, number, number],
  size: readonly [number, number, number],
): void {
  const [cx, cy, cz] = centre;
  const [sx, sy, sz] = size;
  const x0 = cx - sx / 2;
  const x1 = cx + sx / 2;
  const y0 = cy - sy / 2;
  const y1 = cy + sy / 2;
  const z0 = cz - sz / 2;
  const z1 = cz + sz / 2;
  const base = positions.length / 3;
  positions.push(
    x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1,
    x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1,
  );
  indices.push(
    base + 0, base + 1, base + 2, base + 0, base + 2, base + 3,
    base + 4, base + 7, base + 6, base + 4, base + 6, base + 5,
    base + 0, base + 4, base + 5, base + 0, base + 5, base + 1,
    base + 1, base + 5, base + 6, base + 1, base + 6, base + 2,
    base + 2, base + 6, base + 7, base + 2, base + 7, base + 3,
    base + 3, base + 7, base + 4, base + 3, base + 4, base + 0,
  );
}

/** Open-top drawer body: bottom slab, two sides and front/back walls. */
export function drawerRecipe(
  width: number,
  height: number,
  depth: number,
  sideThickness: number,
  bottomThickness: number,
): GeometryRecipe {
  const positions: number[] = [];
  const indices: number[] = [];
  const wallHeight = height - bottomThickness;
  const wallY = bottomThickness / 2;
  addBox(positions, indices, [0, -height / 2 + bottomThickness / 2, 0], [
    width,
    bottomThickness,
    depth,
  ]);
  addBox(positions, indices, [-(width / 2 - sideThickness / 2), wallY, 0], [
    sideThickness,
    wallHeight,
    depth,
  ]);
  addBox(positions, indices, [width / 2 - sideThickness / 2, wallY, 0], [
    sideThickness,
    wallHeight,
    depth,
  ]);
  addBox(positions, indices, [0, wallY, -(depth / 2 - sideThickness / 2)], [
    width - 2 * sideThickness,
    wallHeight,
    sideThickness,
  ]);
  addBox(positions, indices, [0, wallY, depth / 2 - sideThickness / 2], [
    width - 2 * sideThickness,
    wallHeight,
    sideThickness,
  ]);
  return { kind: 'custom', positions, indices };
}

/** Curved bar handle with two mounting posts. */
export function barHandleRecipe(
  length: number,
  projection: number,
  diameter: number,
  segments: number,
): GeometryRecipe {
  const halfLength = length / 2;
  const halfProjection = projection / 2;
  return {
    kind: 'tube',
    points: [
      [-halfLength, halfProjection, 0],
      [-halfLength, -halfProjection, 0],
      [halfLength, -halfProjection, 0],
      [halfLength, halfProjection, 0],
    ],
    radius: diameter / 2,
    tubularSegments: segments,
    radialSegments: 8,
  };
}

export function knobHandleRecipe(
  diameter: number,
  projection: number,
  segments: number,
): GeometryRecipe {
  return {
    kind: 'cylinder',
    radiusTop: diameter / 2,
    radiusBottom: diameter / 2,
    height: projection,
    radialSegments: segments,
  };
}
