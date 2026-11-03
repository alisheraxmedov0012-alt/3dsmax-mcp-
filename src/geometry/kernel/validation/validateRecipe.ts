/**
 * Recipe validation runs before any Three.js object is created.
 *
 * This is the boundary between untrusted/parameter-driven input and geometry:
 * invalid numbers, excessive segment counts and self-intersecting profiles are
 * rejected with a typed error instead of producing a corrupt mesh.
 */
import {
  GEOMETRY_LIMITS,
  GeometryKernelError,
  type GeometryRecipe,
  type Vec2Tuple,
} from '../types';

function fail(message: string): never {
  throw new GeometryKernelError('invalid_recipe', message);
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    fail(`${label}: son chekli bo'lishi kerak.`);
  }
  return value;
}

function positive(value: number, label: string): number {
  finite(value, label);
  if (value <= 0) {
    fail(`${label}: noldan katta bo'lishi kerak.`);
  }
  return value;
}

function nonNegative(value: number, label: string): number {
  finite(value, label);
  if (value < 0) {
    fail(`${label}: manfiy bo'lmasligi kerak.`);
  }
  return value;
}

function integerInRange(
  value: number,
  label: string,
  min: number,
  max: number,
): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(`${label}: ${min}–${max} oralig'idagi butun son bo'lishi kerak.`);
  }
  return value;
}

function optionalSegments(value: number | undefined, label: string, min: number, max: number): void {
  if (value !== undefined) {
    integerInRange(value, label, min, max);
  }
}

function validatePoints(points: readonly Vec2Tuple[], label: string): void {
  if (points.length < 3) {
    fail(`${label}: kamida 3 nuqta kerak.`);
  }
  if (points.length > GEOMETRY_LIMITS.maxProfilePoints) {
    fail(`${label}: ko'pi bilan ${GEOMETRY_LIMITS.maxProfilePoints} nuqta bo'lishi mumkin.`);
  }
  points.forEach((point, index) => {
    finite(point[0], `${label}[${index}].x`);
    finite(point[1], `${label}[${index}].y`);
  });
  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length];
    const current = points[i];
    if (Math.hypot(next[0] - current[0], next[1] - current[1]) <= 1e-9) {
      fail(`${label}: qo'shni nuqtalar bir xil bo'lmasligi kerak.`);
    }
  }
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  if (Math.abs(area / 2) <= 1e-9) {
    fail(`${label}: profil maydoni nolga teng bo'lmasligi kerak.`);
  }
}

function segmentIntersects(
  a: Vec2Tuple,
  b: Vec2Tuple,
  c: Vec2Tuple,
  d: Vec2Tuple,
): boolean {
  const cross = (p: Vec2Tuple, q: Vec2Tuple, r: Vec2Tuple): number =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const onSegment = (p: Vec2Tuple, q: Vec2Tuple, r: Vec2Tuple): boolean =>
    Math.min(p[0], r[0]) - 1e-9 <= q[0] &&
    q[0] <= Math.max(p[0], r[0]) + 1e-9 &&
    Math.min(p[1], r[1]) - 1e-9 <= q[1] &&
    q[1] <= Math.max(p[1], r[1]) + 1e-9;

  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  const abCZero = Math.abs(abC) <= 1e-9;
  const abDZero = Math.abs(abD) <= 1e-9;
  const cdAZero = Math.abs(cdA) <= 1e-9;
  const cdBZero = Math.abs(cdB) <= 1e-9;

  if (!abCZero && !abDZero && !cdAZero && !cdBZero) {
    return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
  }
  if (abCZero && onSegment(a, c, b)) return true;
  if (abDZero && onSegment(a, d, b)) return true;
  if (cdAZero && onSegment(c, a, d)) return true;
  if (cdBZero && onSegment(c, b, d)) return true;
  return false;
}

/** Reject a profile that crosses itself. Adjacent edges are allowed to touch. */
function validateSimplePolygon(points: readonly Vec2Tuple[], label: string): void {
  const count = points.length;
  for (let i = 0; i < count; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % count];
    for (let j = i + 1; j < count; j += 1) {
      if (j === i || j === (i + 1) % count || i === (j + 1) % count) {
        continue;
      }
      const c = points[j];
      const d = points[(j + 1) % count];
      if (segmentIntersects(a, b, c, d)) {
        fail(`${label}: profil o'zini kesib o'tadi.`);
      }
    }
  }
}

function pointInPolygon(point: Vec2Tuple, polygon: readonly Vec2Tuple[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    const intersects =
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonsIntersect(a: readonly Vec2Tuple[], b: readonly Vec2Tuple[]): boolean {
  for (let i = 0; i < a.length; i += 1) {
    const a0 = a[i];
    const a1 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j += 1) {
      const b0 = b[j];
      const b1 = b[(j + 1) % b.length];
      if (segmentIntersects(a0, a1, b0, b1)) {
        return true;
      }
    }
  }
  return false;
}

function validateHoles(holes: readonly (readonly Vec2Tuple[])[], outer: readonly Vec2Tuple[]): void {
  holes.forEach((hole, index) => {
    validatePoints(hole, `holes[${index}]`);
    validateSimplePolygon(hole, `holes[${index}]`);
    if (!pointInPolygon(hole[0], outer)) {
      fail(`holes[${index}]: teshik tashqi profil ichida bo'lishi kerak.`);
    }
    if (polygonsIntersect(hole, outer)) {
      fail(`holes[${index}]: teshik tashqi profil chegarasini kesib o'tadi.`);
    }
    for (let other = 0; other < index; other += 1) {
      if (polygonsIntersect(hole, holes[other])) {
        fail(`holes[${index}]: teshik holes[${other}] bilan kesishadi.`);
      }
    }
  });
}

export function validateRecipe(recipe: GeometryRecipe): void {
  switch (recipe.kind) {
    case 'box': {
      positive(recipe.width, 'box.width');
      positive(recipe.height, 'box.height');
      positive(recipe.depth, 'box.depth');
      optionalSegments(recipe.widthSegments, 'box.widthSegments', 1, 64);
      optionalSegments(recipe.heightSegments, 'box.heightSegments', 1, 64);
      optionalSegments(recipe.depthSegments, 'box.depthSegments', 1, 64);
      return;
    }
    case 'roundedBox': {
      positive(recipe.width, 'roundedBox.width');
      positive(recipe.height, 'roundedBox.height');
      positive(recipe.depth, 'roundedBox.depth');
      positive(recipe.radius, 'roundedBox.radius');
      optionalSegments(recipe.segments, 'roundedBox.segments', 1, GEOMETRY_LIMITS.maxRoundedBoxSegments);
      const maxRadius = Math.min(recipe.width, recipe.height, recipe.depth) / 2;
      if (recipe.radius > maxRadius) {
        fail(`roundedBox.radius: ${maxRadius} sm dan oshmasligi kerak.`);
      }
      return;
    }
    case 'cylinder': {
      nonNegative(recipe.radiusTop, 'cylinder.radiusTop');
      nonNegative(recipe.radiusBottom, 'cylinder.radiusBottom');
      if (recipe.radiusTop === 0 && recipe.radiusBottom === 0) {
        fail('cylinder: radiusTop yoki radiusBottom noldan katta bo\'lishi kerak.');
      }
      positive(recipe.height, 'cylinder.height');
      optionalSegments(recipe.radialSegments, 'cylinder.radialSegments', 3, GEOMETRY_LIMITS.maxSegments);
      optionalSegments(recipe.heightSegments, 'cylinder.heightSegments', 1, 64);
      if (recipe.thetaStart !== undefined) finite(recipe.thetaStart, 'cylinder.thetaStart');
      if (recipe.thetaLength !== undefined) positive(recipe.thetaLength, 'cylinder.thetaLength');
      return;
    }
    case 'sphere': {
      positive(recipe.radius, 'sphere.radius');
      optionalSegments(recipe.widthSegments, 'sphere.widthSegments', 3, 256);
      optionalSegments(recipe.heightSegments, 'sphere.heightSegments', 2, 256);
      if (recipe.phiStart !== undefined) finite(recipe.phiStart, 'sphere.phiStart');
      if (recipe.phiLength !== undefined) positive(recipe.phiLength, 'sphere.phiLength');
      if (recipe.thetaStart !== undefined) finite(recipe.thetaStart, 'sphere.thetaStart');
      if (recipe.thetaLength !== undefined) positive(recipe.thetaLength, 'sphere.thetaLength');
      return;
    }
    case 'capsule': {
      positive(recipe.radius, 'capsule.radius');
      nonNegative(recipe.length, 'capsule.length');
      optionalSegments(recipe.capSegments, 'capsule.capSegments', 1, 64);
      optionalSegments(recipe.radialSegments, 'capsule.radialSegments', 3, 128);
      return;
    }
    case 'extrude': {
      validatePoints(recipe.profile, 'extrude.profile');
      validateSimplePolygon(recipe.profile, 'extrude.profile');
      validateHoles(recipe.holes ?? [], recipe.profile);
      positive(recipe.depth, 'extrude.depth');
      if (recipe.bevelEnabled === true) {
        positive(recipe.bevelThickness ?? 0.2, 'extrude.bevelThickness');
        positive(recipe.bevelSize ?? 0.1, 'extrude.bevelSize');
      }
      optionalSegments(recipe.bevelSegments, 'extrude.bevelSegments', 1, 16);
      optionalSegments(recipe.curveSegments, 'extrude.curveSegments', 1, GEOMETRY_LIMITS.maxCurveSegments);
      optionalSegments(recipe.steps, 'extrude.steps', 1, GEOMETRY_LIMITS.maxCurveSegments);
      return;
    }
    case 'lathe': {
      if (recipe.points.length < 2) {
        fail('lathe.points: kamida 2 nuqta kerak.');
      }
      if (recipe.points.length > GEOMETRY_LIMITS.maxProfilePoints) {
        fail(`lathe.points: ko'pi bilan ${GEOMETRY_LIMITS.maxProfilePoints} nuqta bo'lishi mumkin.`);
      }
      recipe.points.forEach((point, index) => {
        finite(point[0], `lathe.points[${index}].x`);
        finite(point[1], `lathe.points[${index}].y`);
        if (point[0] < 0) {
          fail(`lathe.points[${index}].x: manfiy radius bo'lmasligi kerak.`);
        }
      });
      if (!recipe.points.some((point) => point[0] > 0)) {
        fail('lathe.points: kamida bitta radius noldan katta bo\'lishi kerak.');
      }
      optionalSegments(recipe.segments, 'lathe.segments', 3, GEOMETRY_LIMITS.maxSegments);
      if (recipe.phiStart !== undefined) finite(recipe.phiStart, 'lathe.phiStart');
      if (recipe.phiLength !== undefined) positive(recipe.phiLength, 'lathe.phiLength');
      return;
    }
    case 'tube': {
      if (recipe.points.length < 2) {
        fail('tube.points: kamida 2 nuqta kerak.');
      }
      if (recipe.closed === true && recipe.points.length < 3) {
        fail('tube.points: yopiq curve uchun kamida 3 nuqta kerak.');
      }
      if (recipe.points.length > GEOMETRY_LIMITS.maxCurvePoints) {
        fail(`tube.points: ko'pi bilan ${GEOMETRY_LIMITS.maxCurvePoints} nuqta bo'lishi mumkin.`);
      }
      recipe.points.forEach((point, index) => {
        finite(point[0], `tube.points[${index}].x`);
        finite(point[1], `tube.points[${index}].y`);
        finite(point[2], `tube.points[${index}].z`);
      });
      positive(recipe.radius, 'tube.radius');
      optionalSegments(recipe.tubularSegments, 'tube.tubularSegments', 2, GEOMETRY_LIMITS.maxSegments);
      optionalSegments(recipe.radialSegments, 'tube.radialSegments', 3, 128);
      return;
    }
    case 'custom': {
      if (recipe.positions.length === 0 || recipe.positions.length % 3 !== 0) {
        fail('custom.positions: bo\'sh bo\'lmasligi va XYZ uchliklaridan iborat bo\'lishi kerak.');
      }
      const vertexCount = recipe.positions.length / 3;
      if (vertexCount > GEOMETRY_LIMITS.maxVertices) {
        fail(`custom.positions: ko'pi bilan ${GEOMETRY_LIMITS.maxVertices} vertex bo'lishi mumkin.`);
      }
      for (let i = 0; i < recipe.positions.length; i += 1) {
        finite(recipe.positions[i], `custom.positions[${i}]`);
      }
      if (recipe.indices !== undefined) {
        if (recipe.indices.length === 0 || recipe.indices.length % 3 !== 0) {
          fail('custom.indices: bo\'sh bo\'lmasligi va uchliklardan iborat bo\'lishi kerak.');
        }
        for (let i = 0; i < recipe.indices.length; i += 1) {
          const index = recipe.indices[i];
          if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
            fail(`custom.indices[${i}]: vertex chegarasidan tashqarida.`);
          }
        }
      }
      if (recipe.normals !== undefined && recipe.normals.length !== recipe.positions.length) {
        fail('custom.normals: positions bilan bir xil uzunlikda bo\'lishi kerak.');
      }
      if (recipe.normals !== undefined) {
        for (let i = 0; i < recipe.normals.length; i += 1) {
          finite(recipe.normals[i], `custom.normals[${i}]`);
        }
      }
      if (recipe.uvs !== undefined && recipe.uvs.length !== vertexCount * 2) {
        fail('custom.uvs: har bir vertex uchun ikkita qiymat kerak.');
      }
      if (recipe.uvs !== undefined) {
        for (let i = 0; i < recipe.uvs.length; i += 1) {
          finite(recipe.uvs[i], `custom.uvs[${i}]`);
        }
      }
      return;
    }
    default: {
      const exhaustive: never = recipe;
      throw new GeometryKernelError(
        'unsupported_recipe',
        `Qo'llab-quvvatlanmaydigan geometry recipe: ${String(exhaustive)}`,
      );
    }
  }
}
