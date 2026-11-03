import { describe, expect, it } from 'vitest';
import { PartBuilder } from '../furniture/parts';
import {
  addComponents,
  createComponent,
  createConnection,
  validateConnections,
  type ComponentPart,
} from './index';

describe('component library — mini desk assembly integration', () => {
  it('assembles panels, legs, frame, feet and hardware in one builder', () => {
    const top = createComponent(
      'panel',
      'desk-top',
      { width: 120, height: 60, thickness: 3, cornerRadius: 1, segments: 4 },
      { position: [0, 75, 0], metadata: { assembly: 'desk' } },
    );
    const legs = [-1, 1].flatMap((x) =>
      [-1, 1].map((z) =>
        createComponent(
          'leg',
          `desk-leg-${x === -1 ? 'l' : 'r'}${z === -1 ? 'f' : 'b'}`,
          { shape: 'square', width: 5, height: 72, taper: 0.1 },
          { position: [x * 55, 36, z * 26] },
        ),
      ),
    );
    const frame = createComponent(
      'frame',
      'desk-frame',
      { width: 110, height: 56, depth: 4, memberThickness: 3 },
      { position: [0, 36, 0] },
    );
    const feet = [-1, 1].map((x) =>
      createComponent(
        'foot',
        `desk-foot-${x === -1 ? 'l' : 'r'}`,
        { height: 3, diameter: 5, taper: 0.2 },
        { position: [x * 55, 1.5, 0] },
      ),
    );
    const bolt = createComponent('bolt', 'desk-bolt', {
      shaftDiameter: 0.6,
      length: 4,
      headDiameter: 1.2,
      headHeight: 0.6,
    });
    const screw = createComponent('screw', 'desk-screw', {
      shaftDiameter: 0.4,
      length: 3,
      headDiameter: 0.8,
      headHeight: 0.4,
    });
    const components: ComponentPart[] = [top, ...legs, frame, ...feet, bolt, screw];

    const builder = new PartBuilder('desk-assembly', '#a9744f');
    const meshes = addComponents(builder, components);
    expect(meshes).toHaveLength(10);
    expect(builder.group.children).toHaveLength(10);
    expect(meshes.map((mesh) => mesh.name)).toContain('desk-top');
    expect(meshes.map((mesh) => mesh.name)).toContain('desk-frame');

    const connections = [
      createConnection({
        id: 'top-frame',
        type: 'fixed',
        componentIds: [top.id, frame.id],
        position: [0, 36, 0],
        direction: [0, 1, 0],
      }),
      ...legs.map((leg, index) =>
        createConnection({
          id: `leg-frame-${index + 1}`,
          type: 'leg-to-frame',
          componentIds: [leg.id, frame.id],
          position: leg.position,
          direction: [0, 1, 0],
        }),
      ),
      createConnection({
        id: 'screw-top',
        type: 'screw',
        componentIds: [top.id, frame.id],
        position: [0, 36, 0],
        direction: [0, 1, 0],
        hardwareId: screw.id,
      }),
      createConnection({
        id: 'bolt-frame',
        type: 'bolt',
        componentIds: [frame.id, legs[0].id],
        position: [0, 36, 0],
        direction: [0, 1, 0],
        hardwareId: bolt.id,
      }),
    ];
    validateConnections(components, connections);
    expect(connections).toHaveLength(7);
    builder.dispose();
  });
});
