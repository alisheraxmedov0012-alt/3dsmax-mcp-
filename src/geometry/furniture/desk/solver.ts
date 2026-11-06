import {
  createComponent,
  createConnection,
  validateConnections,
  type ComponentConnection,
  type ComponentPart,
} from '../../components';
import { assertValidDeskSpec, GROMMET_EDGE_MARGIN_CM, type DeskSpec } from './spec';
import { solveStandardDesk } from './solverStandard';

/**
 * Coordinate convention (cm, Y up, origin at floor centre):
 * - Tabletop: an extruded plate with a real grommet hole, built in local XY and
 *   rotated 90° about X; its top sits at `height`.
 * - Legs: centres at ±(width/2 - legInset - legWidth/2) on X and
 *   ±(depth/2 - legInset - legDepth/2) on Z; their vertical centre is
 *   (height - T) / 2.
 * - Frame: the Stage 1.2.1 recipe extrudes along local +Z from z=0. The solver
 *   rotates it 90° about X and places its top edge at height - T, so the frame
 *   becomes a horizontal ring just below the tabletop.
 * - Supports are centred rails under the frame. The drawer is deliberately
 *   pushed forward: its front sits 1 cm behind the frame front, below the frame,
 *   and clear of the right leg.
 * - Grommet and hardware are centred revolved/cylindrical parts.
 */
export interface DeskAssemblyPlan {
  readonly spec: DeskSpec;
  readonly components: readonly ComponentPart[];
  readonly componentIds: readonly string[];
  readonly connections: readonly ComponentConnection[];
  readonly warnings: readonly string[];
}

export interface DeskSolveOptions {
  /**
   * `premium` (default) is the Phase 8B product geometry: beveled plate tabletop
   * with a real grommet hole, beveled legs/frame, mounting plates and a detailed
   * drawer. `standard` keeps the pre-8B geometry for the desk variants that
   * adapt base parts by id (gaming/writing desks and the dining table).
   */
  readonly detail?: 'premium' | 'standard';
}

const DRAWER_SIDE_THICKNESS_CM = 1.5;
const DRAWER_BOTTOM_THICKNESS_CM = 1;
const DRAWER_FRONT_THICKNESS_CM = 2;
const DRAWER_FRONT_BEVEL_CM = 0.2;
const DRAWER_REVEAL_CM = 0.3;
const DRAWER_RIGHT_CLEARANCE_CM = 0.5;
const DRAWER_RECESS_CM = 1;
const DRAWER_HANDLE_LENGTH_CM = 20;
const DRAWER_HANDLE_PROJECTION_CM = 3;
const DRAWER_HANDLE_DIAMETER_CM = 1.2;
const DRAWER_HANDLE_MOUNT_CM = 16;
const DRAWER_RUNNER_WIDTH_CM = 2;
const DRAWER_RUNNER_HEIGHT_CM = 1;
const DRAWER_RUNNER_DEPTH_CM = 40;

/** Visible edge roundover on the tabletop; also the plate bevel thickness. */
const TABLETOP_EDGE_BEVEL_CM = 0.25;
const LEG_BEVEL_CM = 0.2;
const LEG_BEVEL_SEGMENTS = 2;
const FRAME_BEVEL_CM = 0.15;
const LEG_PLATE_SIZE_CM = 8;
const LEG_PLATE_THICKNESS_CM = 0.4;

const BOLT_DIAMETERS = {
  shaftDiameter: 0.6,
  length: 4,
  headDiameter: 1.2,
  headHeight: 0.6,
  segments: 8,
} as const;
const SCREW_DIAMETERS = {
  shaftDiameter: 0.4,
  length: 3,
  headDiameter: 0.8,
  headHeight: 0.4,
  segments: 8,
} as const;

export function solveDesk(
  spec: DeskSpec,
  options: DeskSolveOptions = {},
): DeskAssemblyPlan {
  assertValidDeskSpec(spec);
  if ((options.detail ?? 'premium') === 'standard') {
    return solveStandardDesk(spec);
  }

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

  const grommetRadius = grommetDiameter / 2;
  const grommetZ = -(depth / 2 - grommetRadius - GROMMET_EDGE_MARGIN_CM);
  const tabletop = createComponent(
    'shelf',
    'desk-tabletop',
    {
      width,
      depth,
      thickness: tabletopThickness,
      cornerRadius,
      bevel: TABLETOP_EDGE_BEVEL_CM,
      segments: 8,
      plate: true,
      ...(grommetEnabled
        ? { hole: { x: 0, z: grommetZ, radius: grommetRadius } }
        : {}),
    },
    {
      position: [0, height - TABLETOP_EDGE_BEVEL_CM, 0],
      rotation: [90, 0, 0],
      role: 'panel',
      materialSlot: 'surface',
      uv: 'box',
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
      {
        shape: 'square',
        width: legWidth,
        depth: legDepth,
        height: legHeight,
        bevel: LEG_BEVEL_CM,
        bevelSegments: LEG_BEVEL_SEGMENTS,
      },
      {
        position: [x, legHeight / 2, z],
        // RoundedBoxGeometry's native face UVs avoid the degenerate corner
        // triangles a normal-based box projection produces on bevels.
        uv: 'geometry',
      },
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
      bevel: FRAME_BEVEL_CM,
    },
    {
      position: [0, height - tabletopThickness - FRAME_BEVEL_CM, 0],
      rotation: [90, 0, 0],
      uv: 'box',
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
      {
        width: supportWidth,
        height: supportThickness,
        depth: supportDepth,
        bevel: 0.15,
        segments: 2,
      },
      { position: [0, supportY, -supportZ] },
    ),
    createComponent(
      'support',
      'desk-support-back',
      {
        width: supportWidth,
        height: supportThickness,
        depth: supportDepth,
        bevel: 0.15,
        segments: 2,
      },
      { position: [0, supportY, supportZ] },
    ),
  ];

  const legPlates = legPlacements.map(({ id, x, z }) =>
    createComponent(
      'shelf',
      `desk-leg-plate-${id.slice(-2)}`,
      {
        width: LEG_PLATE_SIZE_CM,
        depth: LEG_PLATE_SIZE_CM,
        thickness: LEG_PLATE_THICKNESS_CM,
        cornerRadius: 0.2,
        bevel: 0.15,
        segments: 2,
        plate: true,
      },
      {
        position: [
          x,
          height - tabletopThickness - 0.15,
          z,
        ],
        rotation: [90, 0, 0],
        materialSlot: 'frame',
        uv: 'box',
      },
    ),
  );

  const components: ComponentPart[] = [
    tabletop,
    ...legs,
    ...legPlates,
    frame,
    ...supports,
  ];
  const connections: ComponentConnection[] = [];

  const bolts = legPlacements.map(({ x, z }, index) => {
    const inwardX = x - Math.sign(x) * 2.2;
    const inwardZ = z - Math.sign(z) * 2.2;
    return createComponent('bolt', `desk-bolt-${index + 1}`, BOLT_DIAMETERS, {
      position: [
        inwardX,
        height - tabletopThickness - LEG_PLATE_THICKNESS_CM - 0.2,
        inwardZ,
      ],
      rotation: [180, 0, 0],
      materialSlot: 'hardware',
    });
  });
  components.push(...bolts);

  legs.forEach((leg, index) => {
    connections.push(
      createConnection({
        id: `desk-leg-top-${index + 1}`,
        type: 'bolt',
        componentIds: [leg.id, tabletop.id],
        position: bolts[index].position,
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
      position: [0, supportY - supportThickness / 2 - 0.4, support.position[2]],
      rotation: [180, 0, 0],
      materialSlot: 'hardware',
    }),
  );
  components.push(...screws);
  supports.forEach((support, index) => {
    connections.push(
      createConnection({
        id: `desk-support-frame-${index + 1}`,
        type: 'screw',
        componentIds: [support.id, frame.id],
        position: screws[index].position,
        direction: [0, 1, 0],
        hardwareId: screws[index].id,
      }),
    );
  });

  if (drawerEnabled) {
    const drawerFrontZ = frameDepth / 2 - DRAWER_RECESS_CM;
    const carcassDepth = drawerDepth - DRAWER_FRONT_THICKNESS_CM;
    const drawerX =
      width / 2 -
      legInset -
      legWidth -
      DRAWER_RIGHT_CLEARANCE_CM -
      drawerWidth / 2;
    const drawerTopY =
      height - tabletopThickness - frameHeight - DRAWER_REVEAL_CM;
    const drawerY = drawerTopY - drawerHeight / 2;
    const carcassZ = drawerFrontZ - DRAWER_FRONT_THICKNESS_CM - carcassDepth / 2;
    const frontZ = drawerFrontZ - DRAWER_FRONT_THICKNESS_CM / 2;

    const drawer = createComponent(
      'drawer',
      'desk-drawer',
      {
        width: drawerWidth,
        height: drawerHeight,
        depth: carcassDepth,
        sideThickness: DRAWER_SIDE_THICKNESS_CM,
        bottomThickness: DRAWER_BOTTOM_THICKNESS_CM,
        flatShading: true,
      },
      {
        position: [drawerX, drawerY, carcassZ],
        uv: 'box',
      },
    );
    const drawerFront = createComponent(
      'panel',
      'desk-drawer-front',
      {
        width: drawerWidth,
        height: drawerHeight,
        thickness: DRAWER_FRONT_THICKNESS_CM,
        bevel: DRAWER_FRONT_BEVEL_CM,
        segments: 3,
        plate: true,
      },
      {
        // ExtrudeGeometry grows from -bevel to depth+bevel; shift it so the
        // finished 2 cm panel is centred on `frontZ` (32..34 cm).
        position: [
          drawerX,
          drawerY,
          frontZ - (DRAWER_FRONT_THICKNESS_CM / 2 - DRAWER_FRONT_BEVEL_CM),
        ],
        materialSlot: 'panel',
        // Physical box UVs keep the oak grain density equal to the tabletop.
        uv: 'box',
      },
    );
    const handleLength = Math.min(DRAWER_HANDLE_LENGTH_CM, drawerWidth - 6);
    const handle = createComponent(
      'handle',
      'desk-drawer-handle',
      {
        type: 'bar',
        length: handleLength,
        diameter: DRAWER_HANDLE_DIAMETER_CM,
        projection: DRAWER_HANDLE_PROJECTION_CM,
        mountingDistance: Math.min(DRAWER_HANDLE_MOUNT_CM, handleLength - 2),
        segments: 24,
      },
      {
        position: [
          drawerX,
          drawerY,
          drawerFrontZ + DRAWER_HANDLE_PROJECTION_CM / 2,
        ],
        rotation: [-90, 0, 0],
        materialSlot: 'hardware',
        uv: 'geometry',
      },
    );
    const runnerX = drawerWidth / 2 - 4;
    const runnerY =
      drawerY - drawerHeight / 2 - DRAWER_RUNNER_HEIGHT_CM / 2;
    const runners = [-1, 1].map((side) =>
      createComponent(
        'panel',
        `desk-drawer-runner-${side < 0 ? 'left' : 'right'}`,
        {
          width: DRAWER_RUNNER_WIDTH_CM,
          height: DRAWER_RUNNER_HEIGHT_CM,
          thickness: DRAWER_RUNNER_DEPTH_CM,
          bevel: 0.1,
          segments: 1,
        },
        {
          position: [drawerX + side * runnerX, runnerY, carcassZ],
          materialSlot: 'hardware',
          uv: 'geometry',
        },
      ),
    );

    components.push(drawer, drawerFront, handle, ...runners);
    connections.push(
      createConnection({
        id: 'desk-drawer-frame',
        type: 'fixed',
        componentIds: [drawer.id, frame.id],
        position: [drawerX, drawerTopY, drawerFrontZ],
        direction: [0, 1, 0],
      }),
    );
    connections.push(
      createConnection({
        id: 'desk-drawer-front',
        type: 'fixed',
        componentIds: [drawer.id, drawerFront.id],
        position: [drawerX, drawerY, frontZ],
        direction: [0, 0, 1],
      }),
    );
    connections.push(
      createConnection({
        id: 'desk-drawer-handle',
        type: 'fixed',
        componentIds: [drawerFront.id, handle.id],
        position: handle.position,
        direction: [0, 0, 1],
      }),
    );
    runners.forEach((runner) => {
      connections.push(
        createConnection({
          id: `${runner.id}-mount`,
          type: 'fixed',
          componentIds: [drawer.id, runner.id],
          position: runner.position,
          direction: [0, 1, 0],
        }),
      );
    });
  }

  if (grommetEnabled) {
    const outerRadius = grommetRadius * 0.99;
    const grommet = createComponent(
      'grommet',
      'desk-grommet',
      {
        outerRadius,
        innerRadius: outerRadius * 0.55,
        thickness: tabletopThickness,
        segments: 48,
      },
      {
        position: [0, height - tabletopThickness / 2, grommetZ],
        uv: 'geometry',
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

export type { DeskSpec } from './spec';
export { DeskSpecError, DEFAULT_DESK_SPEC } from './spec';
