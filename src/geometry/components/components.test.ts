import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { GeometryKernelError, geometryStats, validateGeometry } from '../kernel';
import { PartBuilder } from '../furniture/parts';
import {
  addComponent,
  addComponents,
  createComponent,
  createConnection,
  validateConnections,
  type ComponentPart,
  type ComponentType,
} from './index';

const expectedDefaults: Record<ComponentType, { role: ComponentType; materialSlot: string }> = {
  panel: { role: 'panel', materialSlot: 'panel' },
  leg: { role: 'leg', materialSlot: 'frame' },
  frame: { role: 'frame', materialSlot: 'frame' },
  shelf: { role: 'shelf', materialSlot: 'panel' },
  support: { role: 'support', materialSlot: 'frame' },
  drawer: { role: 'drawer', materialSlot: 'panel' },
  door: { role: 'door', materialSlot: 'panel' },
  handle: { role: 'handle', materialSlot: 'hardware' },
  grommet: { role: 'grommet', materialSlot: 'hardware' },
  bolt: { role: 'bolt', materialSlot: 'hardware' },
  screw: { role: 'screw', materialSlot: 'hardware' },
  foot: { role: 'foot', materialSlot: 'hardware' },
};

function validatePart(part: ComponentPart): void {
  const builder = new PartBuilder(`test-${part.type}`, '#a9744f');
  const mesh = addComponent(builder, part);
  const result = validateGeometry(mesh.geometry as THREE.BufferGeometry);
  expect(result.errors, `${part.id}: ${result.errors.join(' ')}`).toEqual([]);
  expect(result.valid, part.id).toBe(true);
  expect(result.vertexCount, part.id).toBeGreaterThan(0);
  expect(result.triangleCount, part.id).toBeGreaterThan(0);
  expect(result.hasNormals, part.id).toBe(true);
  expect(result.hasUv, part.id).toBe(true);
  expect(mesh.name, part.id).toBe(part.id);
  expect(mesh.userData.partId, part.id).toBe(part.id);
  builder.dispose();
}

function allComponents(): ComponentPart[] {
  return [
    createComponent('panel', 'panel-1', {
      width: 80,
      height: 40,
      thickness: 2,
      cornerRadius: 0.5,
      bevel: 0.2,
      segments: 4,
    }),
    createComponent('leg', 'leg-1', {
      shape: 'square',
      width: 5,
      height: 70,
      taper: 0.2,
    }),
    createComponent('frame', 'frame-1', {
      width: 60,
      height: 40,
      depth: 4,
      memberThickness: 3,
    }),
    createComponent('shelf', 'shelf-1', {
      width: 80,
      depth: 30,
      thickness: 2,
      cornerRadius: 0.3,
    }),
    createComponent('support', 'support-1', { width: 10, height: 20, depth: 5 }),
    createComponent('drawer', 'drawer-1', {
      width: 40,
      height: 20,
      depth: 35,
      sideThickness: 1.5,
      bottomThickness: 1,
    }),
    createComponent('door', 'door-1', {
      width: 40,
      height: 70,
      thickness: 2,
      bevel: 0.1,
    }),
    createComponent('handle', 'handle-1', {
      type: 'bar',
      length: 20,
      diameter: 2,
      projection: 4,
      mountingDistance: 16,
      segments: 16,
    }),
    createComponent('grommet', 'grommet-1', {
      outerRadius: 4,
      innerRadius: 3,
      thickness: 1,
      segments: 24,
    }),
    createComponent('bolt', 'bolt-1', {
      shaftDiameter: 0.6,
      length: 4,
      headDiameter: 1.2,
      headHeight: 0.6,
      segments: 12,
    }),
    createComponent('screw', 'screw-1', {
      shaftDiameter: 0.4,
      length: 3,
      headDiameter: 0.8,
      headHeight: 0.4,
      segments: 12,
    }),
    createComponent('foot', 'foot-1', {
      height: 3,
      diameter: 5,
      taper: 0.2,
      segments: 16,
    }),
  ];
}

describe('component library — contract and geometry', () => {
  it('creates and validates all twelve components', () => {
    const components = allComponents();
    expect(components).toHaveLength(12);
    for (const component of components) {
      const expected = expectedDefaults[component.type];
      expect(component.role, component.id).toBe(expected.role);
      expect(component.materialSlot, component.id).toBe(expected.materialSlot);
      expect(component.componentVersion, component.id).toBe(1);
      expect(component.metadata.partId, component.id).toBe(component.id);
      expect(component.metadata.role, component.id).toBe(component.role);
      expect(component.metadata.materialSlot, component.id).toBe(component.materialSlot);
      expect(component.dimensions.width, component.id).toBeGreaterThan(0);
      expect(component.dimensions.height, component.id).toBeGreaterThan(0);
      expect(component.dimensions.depth, component.id).toBeGreaterThan(0);
      expect(component.geometry.kind, component.id).toBeTruthy();
      validatePart(component);
    }
  });

  it('builds the drawer as an open five-box body using its thicknesses', () => {
    const part = createComponent('drawer', 'drawer-open', {
      width: 40,
      height: 20,
      depth: 35,
      sideThickness: 1.5,
      bottomThickness: 1,
    });
    const builder = new PartBuilder('drawer-test', '#a9744f');
    const mesh = addComponent(builder, part);
    const stats = geometryStats(mesh.geometry as THREE.BufferGeometry);
    expect(stats.vertices).toBe(40);
    expect(stats.triangles).toBe(60);
    builder.dispose();
  });

  it('preserves explicit material slot and metadata', () => {
    const part = createComponent(
      'panel',
      'panel-custom',
      { width: 60, height: 30, thickness: 2 },
      { materialSlot: 'surface', metadata: { note: 'custom panel' } },
    );
    expect(part.materialSlot).toBe('surface');
    expect(part.metadata.materialSlot).toBe('surface');
    expect(part.metadata.note).toBe('custom panel');
    expect(part.metadata.partId).toBe('panel-custom');
  });

  it('rejects invalid parameters for every component type', () => {
    const cases: Array<() => unknown> = [
      () => createComponent('panel', 'x', { width: 0, height: 30, thickness: 2 }),
      () => createComponent('leg', 'x', { shape: 'square', width: 5, height: 70, taper: 1 }),
      () => createComponent('frame', 'x', {
        width: 40, height: 40, depth: 4, memberThickness: 20,
      }),
      () => createComponent('shelf', 'x', { width: 60, depth: 30, thickness: 0 }),
      () => createComponent('support', 'x', { width: 10, height: Number.NaN, depth: 5 }),
      () => createComponent('drawer', 'x', {
        width: 40, height: 20, depth: 35, sideThickness: 20, bottomThickness: 1,
      }),
      () => createComponent('door', 'x', { width: 40, height: 0, thickness: 2 }),
      () => createComponent('handle', 'x', {
        type: 'bar', length: 10, diameter: 2, projection: 4, mountingDistance: 20,
      }),
      () => createComponent('grommet', 'x', {
        outerRadius: 4, innerRadius: 4, thickness: 1,
      }),
      () => createComponent('bolt', 'x', {
        shaftDiameter: 1, length: 4, headDiameter: 2, headHeight: 4,
      }),
      () => createComponent('screw', 'x', {
        shaftDiameter: 0, length: 3, headDiameter: 1, headHeight: 0.4,
      }),
      () => createComponent('foot', 'x', { height: 3, diameter: 5, taper: 1 }),
    ];
    for (const make of cases) {
      expect(make).toThrowError(GeometryKernelError);
    }
  });

  it('builds multiple components into one PartBuilder', () => {
    const builder = new PartBuilder('component-assembly', '#a9744f');
    const components = allComponents();
    const meshes = addComponents(builder, components);
    expect(meshes).toHaveLength(12);
    expect(new Set(meshes.map((mesh) => mesh.name)).size).toBe(12);
    expect(builder.group.children).toHaveLength(12);
    builder.dispose();
  });

  it('disposes kernel geometries with the builder', () => {
    const builder = new PartBuilder('dispose-test', '#a9744f');
    const component = createComponent('panel', 'panel-dispose', {
      width: 60,
      height: 30,
      thickness: 2,
    });
    const mesh = addComponent(builder, component);
    const spy = vi.spyOn(mesh.geometry as THREE.BufferGeometry, 'dispose');
    builder.dispose();
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe('component connections', () => {
  it('creates normalized fixed, panel, leg-frame and hardware connections', () => {
    const components = allComponents();
    const panel = components.find((component) => component.type === 'panel') as ComponentPart;
    const door = components.find((component) => component.type === 'door') as ComponentPart;
    const leg = components.find((component) => component.type === 'leg') as ComponentPart;
    const frame = components.find((component) => component.type === 'frame') as ComponentPart;
    const bolt = components.find((component) => component.type === 'bolt') as ComponentPart;
    const screw = components.find((component) => component.type === 'screw') as ComponentPart;

    const connections = [
      createConnection({
        id: 'fixed-1',
        type: 'fixed',
        componentIds: [panel.id, door.id],
        position: [0, 0, 0],
        direction: [0, 10, 0],
      }),
      createConnection({
        id: 'panel-1',
        type: 'panel-to-panel',
        componentIds: [panel.id, door.id],
        position: [1, 0, 0],
        direction: [1, 0, 0],
      }),
      createConnection({
        id: 'leg-frame-1',
        type: 'leg-to-frame',
        componentIds: [leg.id, frame.id],
        position: [0, 0, 0],
        direction: [0, 1, 0],
      }),
      createConnection({
        id: 'bolt-1',
        type: 'bolt',
        componentIds: [panel.id, frame.id],
        position: [0, 0, 0],
        direction: [0, 1, 0],
        hardwareId: bolt.id,
      }),
      createConnection({
        id: 'screw-1',
        type: 'screw',
        componentIds: [door.id, frame.id],
        position: [0, 0, 0],
        direction: [0, 1, 0],
        hardwareId: screw.id,
      }),
    ];
    expect(connections[0].direction).toEqual([0, 1, 0]);
    validateConnections(components, connections);
  });

  it('rejects invalid connection metadata and references', () => {
    const components = allComponents();
    const panel = components.find((component) => component.type === 'panel') as ComponentPart;
    const leg = components.find((component) => component.type === 'leg') as ComponentPart;
    const bolt = components.find((component) => component.type === 'bolt') as ComponentPart;

    expect(() =>
      createConnection({
        id: 'same',
        type: 'fixed',
        componentIds: [panel.id, panel.id],
        position: [0, 0, 0],
        direction: [0, 1, 0],
      }),
    ).toThrowError(GeometryKernelError);

    expect(() =>
      createConnection({
        id: 'screw-without-hardware',
        type: 'screw',
        componentIds: [panel.id, leg.id],
        position: [0, 0, 0],
        direction: [0, 1, 0],
      }),
    ).toThrowError(GeometryKernelError);

    expect(() =>
      createConnection({
        id: 'zero-direction',
        type: 'fixed',
        componentIds: [panel.id, leg.id],
        position: [0, 0, 0],
        direction: [0, 0, 0],
      }),
    ).toThrowError(GeometryKernelError);

    const badHardware = createConnection({
      id: 'bad-hardware',
      type: 'screw',
      componentIds: [panel.id, leg.id],
      position: [0, 0, 0],
      direction: [0, 1, 0],
      hardwareId: panel.id,
    });
    expect(() => validateConnections(components, [badHardware])).toThrowError(GeometryKernelError);

    const missingComponent = createConnection({
      id: 'missing-component',
      type: 'fixed',
      componentIds: ['missing-a', 'missing-b'],
      position: [0, 0, 0],
      direction: [0, 1, 0],
    });
    expect(() => validateConnections(components, [missingComponent])).toThrowError(GeometryKernelError);

    const duplicate = createConnection({
      id: 'duplicate',
      type: 'bolt',
      componentIds: [panel.id, leg.id],
      position: [0, 0, 0],
      direction: [0, 1, 0],
      hardwareId: bolt.id,
    });
    expect(() => validateConnections(components, [duplicate, duplicate])).toThrowError(
      GeometryKernelError,
    );
  });
});
