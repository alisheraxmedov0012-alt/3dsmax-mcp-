/**
 * W3 geometry-quality tests.
 *
 * These assert real geometric conditions (part envelopes, part-to-part
 * relations, parameter sensitivity, finiteness) rather than merely that "an
 * object was created". Coordinates are in centimetres, Y is up, the piece rests
 * on the Y = 0 floor plane and is centred on X/Z.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildFurniture } from './buildFurniture';
import {
  createFurnitureParams,
  FURNITURE_FIELDS,
  FURNITURE_TYPES,
  type FurnitureParams,
  type FurnitureType,
} from './types';

interface Part {
  id: string;
  min: THREE.Vector3;
  max: THREE.Vector3;
}

function partList(group: THREE.Group): Part[] {
  group.updateMatrixWorld(true);
  const out: Part[] = [];
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const box = new THREE.Box3().setFromObject(mesh);
    out.push({ id: mesh.name, min: box.min.clone(), max: box.max.clone() });
  });
  return out;
}

function bounds(group: THREE.Group): THREE.Box3 {
  group.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(group);
}

function part(group: THREE.Group, id: string): Part {
  const found = partList(group).find((p) => p.id === id);
  if (!found) {
    throw new Error(`Part not found: ${id}`);
  }
  return found;
}

/**
 * True when two parts share volume. Touching faces do not count, so a leg whose
 * top meets the frame's bottom is not an overlap — only real interpenetration is.
 */
function intersects(a: Part, b: Part, tolerance = 0.05): boolean {
  return (
    a.min.x < b.max.x - tolerance &&
    a.max.x > b.min.x + tolerance &&
    a.min.y < b.max.y - tolerance &&
    a.max.y > b.min.y + tolerance &&
    a.min.z < b.max.z - tolerance &&
    a.max.z > b.min.z + tolerance
  );
}

function withParams(type: FurnitureType, overrides: Partial<FurnitureParams>): FurnitureParams {
  return { ...createFurnitureParams(type), ...overrides };
}

/** In-range matrix: defaults plus each field set to its declared min and max. */
function inRangeMatrix(type: FurnitureType): FurnitureParams[] {
  const base = createFurnitureParams(type);
  const rows: FurnitureParams[] = [{ ...base }];
  for (const spec of FURNITURE_FIELDS[type]) {
    rows.push({ ...base, [spec.key]: spec.range.min });
    rows.push({ ...base, [spec.key]: spec.range.max });
  }
  return rows;
}

const EXPECTED_PARTS: Record<FurnitureType, string[]> = {
  table: ['table-top', 'table-leg-1'],
  chair: ['chair-seat', 'chair-back', 'chair-leg-1'],
  armchair: ['armchair-seat', 'armchair-back', 'armchair-arm-1', 'armchair-leg-1'],
  sofa: ['sofa-seat', 'sofa-back', 'sofa-arm-1', 'sofa-leg-1'],
  bed: ['bed-leg-1', 'bed-frame', 'bed-mattress', 'bed-headboard'],
  wardrobe: ['wardrobe-side-1', 'wardrobe-top', 'wardrobe-bottom', 'wardrobe-back', 'wardrobe-shelf-1', 'wardrobe-door-1'],
  shelf: ['shelf-side-1', 'shelf-top', 'shelf-bottom', 'shelf-back', 'shelf-board-1'],
  dresser: ['dresser-body', 'dresser-drawer-1'],
};

describe('W3 geometry integrity', () => {
  it('builds every type with finite, positive-sized parts and stable ids', () => {
    for (const type of FURNITURE_TYPES) {
      const built = buildFurniture(type, createFurnitureParams(type));
      const parts = partList(built.group);

      // Every expected part exists.
      for (const id of EXPECTED_PARTS[type]) {
        expect(parts.map((p) => p.id)).toContain(id);
      }

      // Part ids are unique and partId matches the name.
      const ids = parts.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      built.group.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          expect(mesh.userData.partId).toBe(mesh.name);
        }
      });

      // Every part has finite coordinates and positive size on all axes.
      for (const p of parts) {
        const size = p.max.clone().sub(p.min);
        for (const v of [p.min.x, p.min.y, p.min.z, p.max.x, p.max.y, p.max.z]) {
          expect(Number.isFinite(v)).toBe(true);
        }
        expect(size.x).toBeGreaterThan(0);
        expect(size.y).toBeGreaterThan(0);
        expect(size.z).toBeGreaterThan(0);
      }

      const box = bounds(built.group);
      expect(Number.isFinite(box.min.x)).toBe(true);
      expect(Number.isFinite(box.max.y)).toBe(true);
      built.dispose();
    }
  });

  it('keeps every part inside the declared X/Z envelope for in-range params', () => {
    for (const type of FURNITURE_TYPES) {
      const frontAllowance = type === 'dresser' ? 2.5 : 0.75; // drawer/door fronts
      for (const params of inRangeMatrix(type)) {
        const built = buildFurniture(type, params);
        for (const p of partList(built.group)) {
          expect(p.min.x).toBeGreaterThanOrEqual(-params.widthCm / 2 - 0.75);
          expect(p.max.x).toBeLessThanOrEqual(params.widthCm / 2 + 0.75);
          expect(p.min.z).toBeGreaterThanOrEqual(-params.depthCm / 2 - 0.75);
          expect(p.max.z).toBeLessThanOrEqual(params.depthCm / 2 + frontAllowance);
          // Nothing sinks below the floor.
          expect(p.min.y).toBeGreaterThanOrEqual(-0.75);
        }
        built.dispose();
      }
    }
  });

  it('respects the total height for seated types and the frame/mattress model for the bed', () => {
    for (const type of ['table', 'chair', 'armchair', 'sofa', 'wardrobe', 'shelf', 'dresser'] as const) {
      for (const params of inRangeMatrix(type)) {
        const built = buildFurniture(type, params);
        // Allow the same front allowance as above; none of these exceed height.
        expect(bounds(built.group).max.y).toBeLessThanOrEqual(params.heightCm + 0.75);
        built.dispose();
      }
    }
    // Bed: heightCm is the frame-top height; mattress and headboard legitimately
    // rise above it, but never above the taller of the two.
    for (const params of inRangeMatrix('bed')) {
      const built = buildFurniture('bed', params);
      const frameTop = part(built.group, 'bed-frame').max.y;
      const mattressTop = part(built.group, 'bed-mattress').max.y;
      const headboardTop = part(built.group, 'bed-headboard').max.y;
      expect(bounds(built.group).max.y).toBeLessThanOrEqual(
        Math.max(mattressTop, headboardTop, frameTop) + 0.01,
      );
      built.dispose();
    }
  });
});

describe('W3 parameter sensitivity (geometry actually changes)', () => {
  it('widens the table with widthCm', () => {
    const narrow = buildFurniture('table', withParams('table', { widthCm: 100 }));
    const wide = buildFurniture('table', withParams('table', { widthCm: 200 }));
    const narrowW = bounds(narrow.group).getSize(new THREE.Vector3()).x;
    const wideW = bounds(wide.group).getSize(new THREE.Vector3()).x;
    expect(wideW).toBeGreaterThan(narrowW);
    expect(narrowW).toBeCloseTo(100, 3);
    expect(wideW).toBeCloseTo(200, 3);
    narrow.dispose();
    wide.dispose();
  });

  it('raises the wardrobe with heightCm', () => {
    const low = buildFurniture('wardrobe', withParams('wardrobe', { heightCm: 150 }));
    const high = buildFurniture('wardrobe', withParams('wardrobe', { heightCm: 240 }));
    expect(bounds(high.group).max.y).toBeCloseTo(240, 3);
    expect(bounds(low.group).max.y).toBeCloseTo(150, 3);
    low.dispose();
    high.dispose();
  });

  it('adds/removes shelves, doors, drawers and legs with their counts', () => {
    const shelfIds = (count: number) =>
      partList(buildFurniture('shelf', withParams('shelf', { shelfCount: count })).group).filter((p) =>
        p.id.startsWith('shelf-board-'),
      ).length;
    expect(shelfIds(2)).toBe(2);
    expect(shelfIds(6)).toBe(6);

    const doorIds = (count: number) =>
      partList(buildFurniture('wardrobe', withParams('wardrobe', { doorCount: count })).group).filter((p) =>
        p.id.startsWith('wardrobe-door-'),
      ).length;
    expect(doorIds(1)).toBe(1);
    expect(doorIds(3)).toBe(3);

    const drawerIds = (count: number) =>
      partList(buildFurniture('dresser', withParams('dresser', { drawerCount: count })).group).filter((p) =>
        p.id.startsWith('dresser-drawer-'),
      ).length;
    expect(drawerIds(2)).toBe(2);
    expect(drawerIds(5)).toBe(5);

    const legIds = (count: number) =>
      partList(buildFurniture('table', withParams('table', { legCount: count })).group).filter((p) =>
        p.id.startsWith('table-leg-'),
      ).length;
    expect(legIds(4)).toBe(4);
    expect(legIds(6)).toBe(6);
  });

  it('makes the table top thicker with topThicknessCm', () => {
    const thin = buildFurniture('table', withParams('table', { topThicknessCm: 2 }));
    const thick = buildFurniture('table', withParams('table', { topThicknessCm: 8 }));
    const topThickness = (g: THREE.Group) => part(g, 'table-top').max.y - part(g, 'table-top').min.y;
    expect(topThickness(thin.group)).toBeCloseTo(2, 3);
    expect(topThickness(thick.group)).toBeCloseTo(8, 3);
    thin.dispose();
    thick.dispose();
  });
});

describe('W3 part relations', () => {
  it('chair: legs meet the seat, the back sits on the seat and stays within height', () => {
    const params = createFurnitureParams('chair');
    const built = buildFurniture('chair', params);
    const seat = part(built.group, 'chair-seat');
    const leg = part(built.group, 'chair-leg-1');
    const back = part(built.group, 'chair-back');
    expect(leg.max.y).toBeCloseTo(seat.min.y, 3);
    expect(back.min.y).toBeCloseTo(seat.max.y, 3);
    expect(back.max.y).toBeLessThanOrEqual(params.heightCm + 0.01);
    expect(leg.min.y).toBeCloseTo(0, 3);
    built.dispose();
  });

  it('chair/armchair: the backrest never exceeds height even when the seat is high', () => {
    // Reachable through validation: seatHeight just below the type's min height.
    for (const type of ['chair', 'armchair'] as const) {
      const heightSpec = FURNITURE_FIELDS[type].find((f) => f.key === 'heightCm')!;
      const heightCm = heightSpec.range.min;
      const params = withParams(type, { heightCm, seatHeightCm: heightCm - 1 });
      const built = buildFurniture(type, params);
      expect(bounds(built.group).max.y).toBeLessThanOrEqual(heightCm + 0.01);
      built.dispose();
    }
  });

  it('armchair: the armrests stand on the seat frame, not on the floor', () => {
    // Design decision (was: "arms rise from the floor"): armrests used to start at
    // y = 0, which put each leg inside its armrest. They now start where the legs
    // end, so they rest on the seat frame and the top height is unchanged.
    for (const params of inRangeMatrix('armchair')) {
      const built = buildFurniture('armchair', params);
      const arm = part(built.group, 'armchair-arm-1');
      const leg = part(built.group, 'armchair-leg-1');

      expect(arm.min.y).toBeCloseTo(leg.max.y, 3);
      expect(arm.min.y).toBeGreaterThan(0);
      expect(arm.max.y).toBeLessThanOrEqual(params.heightCm + 0.01);
      built.dispose();
    }
  });

  it('sofa: legs meet the seat and the back rests on the seat', () => {
    const built = buildFurniture('sofa', createFurnitureParams('sofa'));
    const seat = part(built.group, 'sofa-seat');
    const leg = part(built.group, 'sofa-leg-1');
    const back = part(built.group, 'sofa-back');
    expect(leg.max.y).toBeCloseTo(seat.min.y, 3);
    expect(back.min.y).toBeCloseTo(seat.max.y, 3);
    built.dispose();
  });

  it('bed: legs meet the frame, the frame meets the mattress and the headboard stands on the floor', () => {
    const built = buildFurniture('bed', createFurnitureParams('bed'));
    const leg = part(built.group, 'bed-leg-1');
    const frame = part(built.group, 'bed-frame');
    const mattress = part(built.group, 'bed-mattress');
    const headboard = part(built.group, 'bed-headboard');
    expect(leg.min.y).toBeCloseTo(0, 3);
    expect(leg.max.y).toBeCloseTo(frame.min.y, 3);
    expect(frame.max.y).toBeCloseTo(mattress.min.y, 3);
    expect(headboard.min.y).toBeCloseTo(0, 3);
    built.dispose();
  });

  it('bed: the headboard does not pass through the frame, the mattress or the legs', () => {
    // Regression: the frame used to span the whole depth while the headboard was
    // laid over its back edge, so the headboard shared volume with the frame slab
    // and with the mattress standing on it.
    for (const params of inRangeMatrix('bed')) {
      const built = buildFurniture('bed', params);
      const headboard = part(built.group, 'bed-headboard');
      const frame = part(built.group, 'bed-frame');
      const mattress = part(built.group, 'bed-mattress');

      expect(intersects(headboard, frame), 'headboard/frame').toBe(false);
      expect(intersects(headboard, mattress), 'headboard/mattress').toBe(false);
      for (const legPart of partList(built.group).filter((p) => p.id.startsWith('bed-leg-'))) {
        expect(intersects(headboard, legPart), `headboard/${legPart.id}`).toBe(false);
      }
      built.dispose();
    }
  });

  it('bed: the outer box still equals the declared width and depth', () => {
    // The overlap fix must not push the piece past the parametric footprint: the
    // headboard stays inside depthCm rather than hanging behind the frame.
    for (const params of inRangeMatrix('bed')) {
      const built = buildFurniture('bed', params);
      const box = bounds(built.group);
      expect(box.max.x - box.min.x).toBeCloseTo(params.widthCm, 5);
      expect(box.max.z - box.min.z).toBeCloseTo(params.depthCm, 5);
      built.dispose();
    }
  });

  it('table: the six legs do not touch each other', () => {
    // legCount = 6 adds a middle column; the columns must stay clear of one
    // another at every in-range width/depth.
    for (const params of inRangeMatrix('table')) {
      const built = buildFurniture('table', { ...params, legCount: 6 });
      const legs = partList(built.group).filter((p) => p.id.startsWith('table-leg-'));
      expect(legs.length, 'leg count').toBe(6);
      for (let i = 0; i < legs.length; i += 1) {
        for (let j = i + 1; j < legs.length; j += 1) {
          expect(intersects(legs[i], legs[j]), `${legs[i].id}/${legs[j].id}`).toBe(false);
        }
      }
      built.dispose();
    }
  });

  it('chair: the backrest does not pass through the seat or the legs', () => {
    for (const params of inRangeMatrix('chair')) {
      const built = buildFurniture('chair', params);
      const back = part(built.group, 'chair-back');
      const seat = part(built.group, 'chair-seat');
      expect(intersects(back, seat), 'back/seat').toBe(false);
      for (const leg of partList(built.group).filter((p) => p.id.startsWith('chair-leg-'))) {
        expect(intersects(back, leg), `back/${leg.id}`).toBe(false);
      }
      built.dispose();
    }
  });

  it('sofa: the seat block does not pass through the legs or the backrest', () => {
    for (const params of inRangeMatrix('sofa')) {
      const built = buildFurniture('sofa', params);
      const seat = part(built.group, 'sofa-seat');
      const back = part(built.group, 'sofa-back');
      expect(intersects(seat, back), 'seat/back').toBe(false);
      for (const leg of partList(built.group).filter((p) => p.id.startsWith('sofa-leg-'))) {
        expect(intersects(seat, leg), `seat/${leg.id}`).toBe(false);
      }
      built.dispose();
    }
  });

  it('shelf: the boards do not pass through the sides or the back', () => {
    for (const params of inRangeMatrix('shelf')) {
      const built = buildFurniture('shelf', params);
      const sides = partList(built.group).filter((p) => p.id.startsWith('shelf-side-'));
      const back = part(built.group, 'shelf-back');
      const boards = partList(built.group).filter((p) => p.id.startsWith('shelf-board-'));
      expect(boards.length).toBeGreaterThan(0);
      for (const board of boards) {
        for (const side of sides) {
          expect(intersects(board, side), `${board.id}/${side.id}`).toBe(false);
        }
        expect(intersects(board, back), `${board.id}/back`).toBe(false);
      }
      built.dispose();
    }
  });

  it('dresser: the drawer and door fronts do not pass through the body or the legs', () => {
    for (const params of inRangeMatrix('dresser')) {
      const built = buildFurniture('dresser', params);
      const body = part(built.group, 'dresser-body');
      const legs = partList(built.group).filter((p) => p.id.startsWith('dresser-leg-'));
      const fronts = partList(built.group).filter(
        (p) => p.id.startsWith('dresser-drawer-') || p.id.startsWith('dresser-door-'),
      );
      expect(fronts.length).toBeGreaterThan(0);
      for (const front of fronts) {
        expect(intersects(front, body), `${front.id}/body`).toBe(false);
        for (const leg of legs) {
          expect(intersects(front, leg), `${front.id}/${leg.id}`).toBe(false);
        }
      }
      built.dispose();
    }
  });

  it('armchair: the legs do not pass through the armrests', () => {
    // AABB only (parts are axis-aligned boxes, so here it is exact): the leg box
    // must not share volume with the armrest box.
    for (const params of inRangeMatrix('armchair')) {
      const built = buildFurniture('armchair', params);
      const arms = partList(built.group).filter((p) => p.id.startsWith('armchair-arm-'));
      const legs = partList(built.group).filter((p) => p.id.startsWith('armchair-leg-'));
      expect(arms).toHaveLength(2);
      expect(legs).toHaveLength(4);
      for (const arm of arms) {
        for (const leg of legs) {
          expect(intersects(arm, leg), `${arm.id}/${leg.id}`).toBe(false);
        }
      }
      built.dispose();
    }
  });

  it('sofa: the seat block does not pass through the armrests', () => {
    for (const params of inRangeMatrix('sofa')) {
      const built = buildFurniture('sofa', params);
      const seat = part(built.group, 'sofa-seat');
      const arms = partList(built.group).filter((p) => p.id.startsWith('sofa-arm-'));
      expect(arms).toHaveLength(2);
      for (const arm of arms) {
        expect(intersects(arm, seat), `${arm.id}/seat`).toBe(false);
      }
      built.dispose();
    }
  });

  it('wardrobe: the door fronts do not pass through the shelves', () => {
    for (const params of inRangeMatrix('wardrobe')) {
      const built = buildFurniture('wardrobe', params);
      const doors = partList(built.group).filter((p) => p.id.startsWith('wardrobe-door-'));
      const shelves = partList(built.group).filter((p) => p.id.startsWith('wardrobe-shelf-'));
      expect(doors.length).toBeGreaterThan(0);
      for (const door of doors) {
        for (const shelf of shelves) {
          expect(intersects(door, shelf), `${door.id}/${shelf.id}`).toBe(false);
        }
        // The shelf stops behind the door but still reaches the back panel.
        for (const shelf of shelves) {
          expect(shelf.max.z).toBeLessThanOrEqual(door.min.z + 0.01);
        }
      }
      built.dispose();
    }
  });

  it('wardrobe: shelves sit strictly between the bottom and the top panel', () => {
    const built = buildFurniture('wardrobe', withParams('wardrobe', { shelfCount: 4 }));
    const bottom = part(built.group, 'wardrobe-bottom');
    const top = part(built.group, 'wardrobe-top');
    const shelves = partList(built.group).filter((p) => p.id.startsWith('wardrobe-shelf-'));
    expect(shelves.length).toBe(4);
    for (const shelf of shelves) {
      expect(shelf.min.y).toBeGreaterThanOrEqual(bottom.max.y - 0.01);
      expect(shelf.max.y).toBeLessThanOrEqual(top.min.y + 0.01);
    }
    built.dispose();
  });

  it('dresser: drawer fronts fall within the body height', () => {
    const built = buildFurniture('dresser', withParams('dresser', { drawerCount: 3 }));
    const body = part(built.group, 'dresser-body');
    const drawers = partList(built.group).filter((p) => p.id.startsWith('dresser-drawer-'));
    expect(drawers.length).toBe(3);
    for (const drawer of drawers) {
      expect(drawer.min.y).toBeGreaterThanOrEqual(body.min.y - 0.01);
      expect(drawer.max.y).toBeLessThanOrEqual(body.max.y + 0.01);
    }
    built.dispose();
  });
});

describe('W3 robustness (bad values cannot damage the mesh)', () => {
  const probes = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -50, 1e9];

  it('never throws and always yields finite, positive geometry', () => {
    for (const type of FURNITURE_TYPES) {
      for (const spec of FURNITURE_FIELDS[type]) {
        for (const probe of probes) {
          const params = { ...createFurnitureParams(type), [spec.key]: probe } as FurnitureParams;
          const built = buildFurniture(type, params);
          const box = bounds(built.group);
          for (const v of [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z]) {
            expect(Number.isFinite(v)).toBe(true);
          }
          const size = box.getSize(new THREE.Vector3());
          expect(size.x).toBeGreaterThan(0);
          expect(size.y).toBeGreaterThan(0);
          expect(size.z).toBeGreaterThan(0);
          built.dispose();
        }
      }
    }
  });
});

describe('W3 stability and lifecycle', () => {
  it('produces the same part set on a rebuild', () => {
    for (const type of FURNITURE_TYPES) {
      const first = buildFurniture(type, createFurnitureParams(type));
      const second = buildFurniture(type, createFurnitureParams(type));
      const ids = (g: THREE.Group) => partList(g).map((p) => p.id).sort();
      expect(ids(second.group)).toEqual(ids(first.group));
      first.dispose();
      second.dispose();
    }
  });

  it('can be built and disposed repeatedly without throwing', () => {
    for (const type of FURNITURE_TYPES) {
      for (let i = 0; i < 3; i += 1) {
        const built = buildFurniture(type, createFurnitureParams(type));
        expect(() => built.dispose()).not.toThrow();
      }
    }
  });
});
