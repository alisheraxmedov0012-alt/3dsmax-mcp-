import { describe, expect, it } from 'vitest';
import { validateConnections, type ComponentPart } from '../../components';
import {
  DEFAULT_DESK_SPEC,
  DeskSpecError,
  assertValidDeskSpec,
  createDeskSpec,
  solveDesk,
  validateDeskSpec,
  type DeskAssemblyPlan,
} from './index';

function component(plan: DeskAssemblyPlan, id: string): ComponentPart {
  const found = plan.components.find((part) => part.id === id);
  if (!found) {
    throw new Error(`Missing component ${id}`);
  }
  return found;
}

function expectInvalid(overrides: Partial<typeof DEFAULT_DESK_SPEC>, fragment?: string): void {
  const spec = createDeskSpec(overrides);
  const result = validateDeskSpec(spec);
  expect(result.valid, JSON.stringify(overrides)).toBe(false);
  if (fragment) {
    expect(result.errors.join(' ')).toContain(fragment);
  }
  expect(() => solveDesk(spec)).toThrowError(DeskSpecError);
}

describe('DeskSpec V1 — defaults and validation', () => {
  it('exports realistic default dimensions in centimetres', () => {
    expect(DEFAULT_DESK_SPEC).toMatchObject({
      width: 160,
      depth: 80,
      height: 75,
      tabletopThickness: 3,
      legWidth: 5,
      legDepth: 5,
      legInset: 5,
      frameThickness: 3,
      frameHeight: 6,
      frameInset: 5,
      supportThickness: 2,
      cornerRadius: 1,
      grommetEnabled: true,
      grommetDiameter: 8,
      drawerEnabled: true,
      drawerWidth: 45,
      drawerHeight: 20,
      drawerDepth: 50,
    });
    expect(validateDeskSpec(DEFAULT_DESK_SPEC)).toEqual({ valid: true, errors: [] });
  });

  it('merges overrides without silently correcting them', () => {
    const spec = createDeskSpec({ width: 0, drawerEnabled: false });
    expect(spec.width).toBe(0);
    expect(validateDeskSpec(spec).valid).toBe(false);
    expect(() => assertValidDeskSpec(spec)).toThrowError(DeskSpecError);
  });

  it('rejects non-positive and non-finite dimensions', () => {
    expectInvalid({ width: 0 }, 'width');
    expectInvalid({ depth: Number.NaN }, 'depth');
    expectInvalid({ height: Number.POSITIVE_INFINITY }, 'height');
    expectInvalid({ tabletopThickness: 0 }, 'tabletopThickness');
    expectInvalid({ legWidth: 0 }, 'legWidth');
    expectInvalid({ legDepth: -1 }, 'legDepth');
    expectInvalid({ frameThickness: 0 }, 'frameThickness');
    expectInvalid({ frameHeight: Number.NaN }, 'frameHeight');
    expectInvalid({ supportThickness: 0 }, 'supportThickness');
  });

  it('rejects legs, frame, corner radius and grommet outside their limits', () => {
    expectInvalid({ legInset: 80 }, 'width');
    expectInvalid({ frameInset: 80 }, 'frameInset');
    expectInvalid({ frameThickness: 100 }, 'frameThickness');
    expectInvalid({ frameHeight: 100 }, 'height');
    expectInvalid({ supportThickness: 100 }, 'supportThickness');
    expectInvalid({ cornerRadius: 10 }, 'cornerRadius');
    expectInvalid({ grommetDiameter: 200 }, 'grommetDiameter');
  });

  it('rejects enabled drawer dimensions that do not fit', () => {
    expectInvalid({ drawerWidth: 200 }, 'drawerWidth');
    expectInvalid({ drawerDepth: 200 }, 'drawerDepth');
    expectInvalid({ drawerHeight: 100 }, 'drawerHeight');
    expectInvalid({ drawerWidth: 0 }, 'drawer');
    expectInvalid({ drawerWidth: Number.NaN }, 'drawerWidth');
  });

  it('accepts disabled optional components with zero sizes', () => {
    const spec = createDeskSpec({
      drawerEnabled: false,
      drawerWidth: 0,
      drawerHeight: 0,
      drawerDepth: 0,
      grommetEnabled: false,
      grommetDiameter: 0,
    });
    expect(validateDeskSpec(spec).valid).toBe(true);
  });
});

describe('DeskSpec solver — default plan', () => {
  const plan = solveDesk(DEFAULT_DESK_SPEC);

  it('builds a deterministic 24-component plan', () => {
    expect(plan.components).toHaveLength(24);
    expect(plan.componentIds).toHaveLength(24);
    expect(new Set(plan.componentIds).size).toBe(24);
    expect(plan.connections).toHaveLength(16);
    expect(plan.warnings).toEqual([]);
    expect(solveDesk(DEFAULT_DESK_SPEC)).toEqual(plan);
  });

  it('places the tabletop as a horizontal beveled plate with a grommet hole', () => {
    const tabletop = component(plan, 'desk-tabletop');
    expect(tabletop.type).toBe('shelf');
    expect(tabletop.role).toBe('panel');
    expect(tabletop.materialSlot).toBe('surface');
    expect(tabletop.dimensions).toEqual({ width: 160, height: 3, depth: 80 });
    expect(tabletop.position).toEqual([0, 74.75, 0]);
    expect(tabletop.rotation).toEqual([90, 0, 0]);
    expect(tabletop.geometry.kind).toBe('extrude');
    expect(tabletop.uv).toBe('box');
    expect(tabletop.metadata.hole).toEqual({ x: 0, z: -31, radius: 4 });
  });

  it('places four legs inset from every tabletop edge', () => {
    const legs = plan.components.filter((part) => part.type === 'leg');
    expect(legs).toHaveLength(4);
    expect(legs.map((leg) => leg.dimensions)).toEqual(
      Array.from({ length: 4 }, () => ({ width: 5, height: 72, depth: 5 })),
    );
    expect(legs.map((leg) => leg.position)).toEqual([
      [-72.5, 36, -32.5],
      [72.5, 36, -32.5],
      [-72.5, 36, 32.5],
      [72.5, 36, 32.5],
    ]);
  });

  it('places the frame horizontally just below the tabletop', () => {
    const frame = component(plan, 'desk-frame');
    expect(frame.type).toBe('frame');
    expect(frame.dimensions).toEqual({ width: 150, height: 70, depth: 6 });
    expect(frame.position).toEqual([0, 71.85, 0]);
    expect(frame.rotation).toEqual([90, 0, 0]);
    expect(frame.geometry.kind).toBe('extrude');
  });

  it('places two supports under the tabletop', () => {
    const supports = plan.components.filter((part) => part.type === 'support');
    expect(supports).toHaveLength(2);
    expect(supports.map((part) => part.position)).toEqual([
      [0, 71, -30.5],
      [0, 71, 30.5],
    ]);
    expect(supports[0].dimensions).toEqual({ width: 134, height: 2, depth: 3 });
  });

  it('places a forward-facing drawer assembly on the right', () => {
    const drawer = component(plan, 'desk-drawer');
    expect(drawer.type).toBe('drawer');
    expect(drawer.dimensions).toEqual({ width: 45, height: 20, depth: 48 });
    expect(drawer.position).toEqual([47, 55.7, 8]);
    expect(drawer.metadata.sideThickness).toBe(1.5);

    const front = component(plan, 'desk-drawer-front');
    expect(front.type).toBe('panel');
    expect(front.dimensions).toEqual({ width: 45, height: 20, depth: 2 });
    // ExtrudeGeometry's origin is offset by the bevel; the finished panel is
    // still centred on z = 33 cm (32..34 cm).
    expect(front.position).toEqual([47, 55.7, 32.2]);

    const handle = component(plan, 'desk-drawer-handle');
    expect(handle.type).toBe('handle');
    expect(handle.position).toEqual([47, 55.7, 35.5]);
    expect(handle.rotation).toEqual([-90, 0, 0]);

    const runners = plan.components.filter((part) =>
      part.id.startsWith('desk-drawer-runner-'),
    );
    expect(runners).toHaveLength(2);
    expect(runners.map((runner) => runner.position[0])).toEqual([28.5, 65.5]);
  });

  it('places the grommet inside the tabletop hole', () => {
    const grommet = component(plan, 'desk-grommet');
    expect(grommet.type).toBe('grommet');
    expect(grommet.position).toEqual([0, 73.5, -31]);
    expect(grommet.dimensions.width).toBeCloseTo(7.92, 6);
    expect(grommet.dimensions.height).toBe(3);
    expect(grommet.dimensions.depth).toBeCloseTo(7.92, 6);
  });
});

describe('DeskSpec solver — connections and hardware', () => {
  const plan = solveDesk(DEFAULT_DESK_SPEC);

  it('validates all component references and hardware identities', () => {
    expect(() => validateConnections(plan.components, plan.connections)).not.toThrow();
    const byId = new Map(plan.components.map((part) => [part.id, part]));
    for (const connection of plan.connections) {
      for (const id of connection.componentIds) {
        expect(byId.has(id), `${connection.id}: ${id}`).toBe(true);
      }
      if (connection.hardwareId) {
        const hardware = byId.get(connection.hardwareId);
        expect(hardware?.type, connection.id).toMatch(/bolt|screw/);
      }
    }
  });

  it('contains four top bolts, four leg-frame joints and two support screws', () => {
    expect(plan.connections.filter((item) => item.type === 'bolt')).toHaveLength(4);
    expect(plan.connections.filter((item) => item.type === 'leg-to-frame')).toHaveLength(4);
    expect(plan.connections.filter((item) => item.type === 'screw')).toHaveLength(2);
    expect(plan.connections.filter((item) => item.type === 'fixed')).toHaveLength(6);
  });

  it('removes drawer component and connection when disabled', () => {
    const spec = createDeskSpec({ drawerEnabled: false });
    const withoutDrawer = solveDesk(spec);
    expect(withoutDrawer.componentIds).not.toContain('desk-drawer');
    expect(withoutDrawer.connections.map((item) => item.id)).not.toContain('desk-drawer-frame');
    expect(withoutDrawer.components).toHaveLength(19);
    expect(withoutDrawer.connections).toHaveLength(11);
  });

  it('removes grommet component and connection when disabled', () => {
    const spec = createDeskSpec({ grommetEnabled: false });
    const withoutGrommet = solveDesk(spec);
    expect(withoutGrommet.componentIds).not.toContain('desk-grommet');
    expect(withoutGrommet.connections.map((item) => item.id)).not.toContain('desk-grommet-top');
    expect(withoutGrommet.components).toHaveLength(23);
    expect(withoutGrommet.connections).toHaveLength(15);
  });
});

describe('DeskSpec solver — parametric changes and determinism', () => {
  it('recomputes tabletop, frame and leg X positions when width changes', () => {
    const plan = solveDesk(createDeskSpec({ width: 200 }));
    expect(component(plan, 'desk-tabletop').dimensions.width).toBe(200);
    expect(component(plan, 'desk-frame').dimensions.width).toBe(190);
    expect(component(plan, 'desk-leg-nw').position[0]).toBe(-92.5);
  });

  it('recomputes frame depth and leg Z positions when depth changes', () => {
    const plan = solveDesk(createDeskSpec({ depth: 100 }));
    expect(component(plan, 'desk-tabletop').dimensions.depth).toBe(100);
    expect(component(plan, 'desk-frame').dimensions.height).toBe(90);
    expect(component(plan, 'desk-leg-nw').position[2]).toBe(-42.5);
  });

  it('recomputes leg height and tabletop height when height changes', () => {
    const plan = solveDesk(createDeskSpec({ height: 90 }));
    expect(component(plan, 'desk-leg-nw').dimensions.height).toBe(87);
    expect(component(plan, 'desk-tabletop').position[1]).toBe(89.75);
    expect(component(plan, 'desk-frame').position[1]).toBe(86.85);
  });

  it('recomputes leg coordinates when legInset changes', () => {
    const plan = solveDesk(createDeskSpec({ legInset: 10 }));
    expect(component(plan, 'desk-leg-nw').position[0]).toBe(-67.5);
    expect(component(plan, 'desk-leg-nw').position[2]).toBe(-27.5);
  });

  it('is deterministic for the same input', () => {
    const spec = createDeskSpec({ width: 180, drawerHeight: 18 });
    expect(JSON.stringify(solveDesk(spec))).toBe(JSON.stringify(solveDesk(spec)));
  });

  it('does not mutate the input spec', () => {
    const spec = createDeskSpec({ width: 180 });
    const before = JSON.stringify(spec);
    solveDesk(spec);
    expect(JSON.stringify(spec)).toBe(before);
  });
});
