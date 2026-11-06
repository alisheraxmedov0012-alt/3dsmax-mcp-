/**
 * Pre-8B desk geometry, kept verbatim for the desk variants that share this
 * solver (`desk.gaming`, `desk.writing`, `table.dining`).
 *
 * Phase 8B added bevels, mounting plates, a real grommet hole and a detailed
 * drawer to the Premium Desk. Those changes alter part counts and the drawer
 * layout, and the variants adapt the base parts by id; they are intentionally
 * not migrated in this phase. `solveDesk(spec, { detail: 'standard' })` selects
 * this implementation.
 */
import {
  createComponent,
  createConnection,
  validateConnections,
  type ComponentConnection,
  type ComponentPart,
} from '../../components';
import { assertValidDeskSpec, GROMMET_EDGE_MARGIN_CM, type DeskSpec } from './spec';
import type { DeskAssemblyPlan } from './solver';

/**
 * Coordinate convention (cm, Y up, origin at floor centre):
 * - Tabletop: X width, Y thickness, Z depth; centred at (0, height - T/2, 0).
 * - Legs: centres at ±(width/2 - legInset - legWidth/2) on X and
 *   ±(depth/2 - legInset - legDepth/2) on Z; their vertical centre is
 *   (height - T) / 2.
 * - Frame: the Stage 1.2.1 recipe extrudes along local +Z from z=0. The solver
 *   rotates it 90° about X and places its top edge at height - T, so the frame
 *   becomes a horizontal ring just below the tabletop. This is the only component
 *   whose local origin is not centred.
 * - Supports and drawer are centred boxes/solids; grommet and hardware are
 *   centred revolved/cylindrical parts.
 */
const DRAWER_SIDE_THICKNESS_CM = 1.5;
const DRAWER_BOTTOM_THICKNESS_CM = 1;
const BOLT_DIAMETERS = {
  shaftDiameter: 0.6,
  length: 4,
  headDiameter: 1.2,
  headHeight: 0.6,
} as const;
const SCREW_DIAMETERS = {
  shaftDiameter: 0.4,
  length: 3,
  headDiameter: 0.8,
  headHeight: 0.4,
} as const;

export function solveStandardDesk(spec: DeskSpec): DeskAssemblyPlan {
  assertValidDeskSpec(spec);

  const {
    width,
    depth,
    height,
    tabletopThickness,
    legWidth,
    legDepth,
    legInset,
    frameThickness,
    frameHeight,
    frameInset,
    supportThickness,
    cornerRadius,
    grommetEnabled,
    grommetDiameter,
    drawerEnabled,
    drawerWidth,
    drawerHeight,
    drawerDepth,
  } = spec;

  const legHeight = height - tabletopThickness;
  const legX = width / 2 - legInset - legWidth / 2;
  const legZ = depth / 2 - legInset - legDepth / 2;

  const tabletop = createComponent(
    'shelf',
    'desk-tabletop',
    {
      width,
      depth,
      thickness: tabletopThickness,
      cornerRadius,
      segments: 8,
    },
    {
      position: [0, height - tabletopThickness / 2, 0],
      role: 'panel',
      materialSlot: 'surface',
    },
  );

  const legPlacements = [
    { id: 'desk-leg-nw', x: -legX, z: -legZ },
    { id: 'desk-leg-ne', x: legX, z: -legZ },
    { id: 'desk-leg-sw', x: -legX, z: legZ },
    { id: 'desk-leg-se', x: legX, z: legZ },
  ];
  const legs = legPlacements.map(({ id, x, z }) =>
    createComponent(
      'leg',
      id,
      { shape: 'square', width: legWidth, depth: legDepth, height: legHeight },
      { position: [x, legHeight / 2, z] },
    ),
  );

  const frameWidth = width - 2 * frameInset;
  const frameDepth = depth - 2 * frameInset;
  const frame = createComponent(
    'frame',
    'desk-frame',
    {
      width: frameWidth,
      height: frameDepth,
      depth: frameHeight,
      memberThickness: frameThickness,
    },
    {
      position: [0, height - tabletopThickness, 0],
      rotation: [90, 0, 0],
    },
  );

  const supportWidth = frameWidth - 2 * frameThickness - 2 * legWidth;
  const supportDepth = frameThickness;
  const supportZ = frameDepth / 2 - frameThickness - supportDepth / 2;
  const supportY = height - tabletopThickness - supportThickness / 2;
  const supports = [
    createComponent(
      'support',
      'desk-support-front',
      { width: supportWidth, height: supportThickness, depth: supportDepth },
      { position: [0, supportY, -supportZ] },
    ),
    createComponent(
      'support',
      'desk-support-back',
      { width: supportWidth, height: supportThickness, depth: supportDepth },
      { position: [0, supportY, supportZ] },
    ),
  ];

  const components: ComponentPart[] = [tabletop, ...legs, frame, ...supports];
  const connections: ComponentConnection[] = [];

  const bolts = legs.map((leg, index) =>
    createComponent('bolt', `desk-bolt-${index + 1}`, BOLT_DIAMETERS, {
      position: [leg.position[0], height - tabletopThickness, leg.position[2]],
    }),
  );
  components.push(...bolts);

  legs.forEach((leg, index) => {
    connections.push(
      createConnection({
        id: `desk-leg-top-${index + 1}`,
        type: 'bolt',
        componentIds: [leg.id, tabletop.id],
        position: [leg.position[0], height - tabletopThickness, leg.position[2]],
        direction: [0, 1, 0],
        hardwareId: bolts[index].id,
      }),
    );
    connections.push(
      createConnection({
        id: `desk-leg-frame-${index + 1}`,
        type: 'leg-to-frame',
        componentIds: [leg.id, frame.id],
        position: [leg.position[0], height - tabletopThickness, leg.position[2]],
        direction: [0, 1, 0],
      }),
    );
  });

  const screws = supports.map((support, index) =>
    createComponent('screw', `desk-screw-${index + 1}`, SCREW_DIAMETERS, {
      position: support.position,
    }),
  );
  components.push(...screws);
  supports.forEach((support, index) => {
    connections.push(
      createConnection({
        id: `desk-support-frame-${index + 1}`,
        type: 'screw',
        componentIds: [support.id, frame.id],
        position: support.position,
        direction: [0, 1, 0],
        hardwareId: screws[index].id,
      }),
    );
  });

  if (drawerEnabled) {
    const drawerX = frameWidth / 2 - frameThickness - drawerWidth / 2;
    const drawerY = height - tabletopThickness - drawerHeight / 2;
    const drawer = createComponent(
      'drawer',
      'desk-drawer',
      {
        width: drawerWidth,
        height: drawerHeight,
        depth: drawerDepth,
        sideThickness: DRAWER_SIDE_THICKNESS_CM,
        bottomThickness: DRAWER_BOTTOM_THICKNESS_CM,
      },
      { position: [drawerX, drawerY, 0] },
    );
    components.push(drawer);
    connections.push(
      createConnection({
        id: 'desk-drawer-frame',
        type: 'fixed',
        componentIds: [drawer.id, frame.id],
        position: [drawerX, height - tabletopThickness, 0],
        direction: [0, 1, 0],
      }),
    );
  }

  if (grommetEnabled) {
    const outerRadius = grommetDiameter / 2;
    const grommet = createComponent(
      'grommet',
      'desk-grommet',
      {
        outerRadius,
        innerRadius: outerRadius * 0.55,
        thickness: tabletopThickness,
        segments: 32,
      },
      {
        position: [
          0,
          height - tabletopThickness / 2,
          -(depth / 2 - outerRadius - GROMMET_EDGE_MARGIN_CM),
        ],
      },
    );
    components.push(grommet);
    connections.push(
      createConnection({
        id: 'desk-grommet-top',
        type: 'fixed',
        componentIds: [grommet.id, tabletop.id],
        position: grommet.position,
        direction: [0, 1, 0],
      }),
    );
  }

  validateConnections(components, connections);
  return {
    spec: { ...spec },
    components,
    componentIds: components.map((component) => component.id),
    connections,
    warnings: [],
  };
}
