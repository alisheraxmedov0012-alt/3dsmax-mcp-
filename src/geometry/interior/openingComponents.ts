/**
 * Phase 9A.2.4 — parametric door/window components.
 *
 * The opening spec is the only source: frames, leaf/glass, sill, handle and
 * mullion/transom parts are derived here as ordinary `PlanPart`s. The generic
 * `buildPlanWithDefinition` pipeline materialises them; no Three.js object is
 * created in this module.
 */
import type { ComponentDimensions } from '../components';
import type { Vec3Tuple } from '../kernel';
import type { ParametricPartType, PlanPart } from '../universal/types';
import {
  DEFAULT_DOOR_HINGE_COUNT,
  resolveDoorConfig,
  resolveWindowConfig,
} from './roomSpec';
import type {
  DoorAssemblyPlan,
  RoomBounds3,
  RoomOpeningPlan,
  RoomOpeningSpec,
  RoomWallLayout,
  WindowAssemblyPlan,
} from './types';

export interface OpeningAssembly {
  readonly parts: readonly PlanPart[];
  readonly plan: RoomOpeningPlan;
}

function wallRotation(wall: RoomWallLayout): Vec3Tuple {
  return wall.side === 'east' || wall.side === 'west' ? [0, -90, 0] : [0, 0, 0];
}

/**
 * Wall-local (u, y, v) -> world centre. `u` runs along the wall, `v` runs
 * through its thickness in the local orientation of the wall mesh.
 */
function wallPoint(
  wall: RoomWallLayout,
  u: number,
  y: number,
  v: number,
): Vec3Tuple {
  return wall.side === 'north' || wall.side === 'south'
    ? [u, y, wall.center[2] + v]
    : [wall.center[0] - v, y, u];
}

function interiorSign(wall: RoomWallLayout): 1 | -1 {
  return wall.side === 'north' || wall.side === 'east' ? 1 : -1;
}

function openingU(wall: RoomWallLayout, opening: RoomOpeningSpec): number {
  return opening.offsetCm - wall.lengthCm / 2 + opening.widthCm / 2;
}

function openingBounds(
  wall: RoomWallLayout,
  opening: RoomOpeningSpec,
  center: Vec3Tuple,
): RoomBounds3 {
  const halfWidth = opening.widthCm / 2;
  const halfThickness = wall.dimensions.depth / 2;
  const yMin = opening.sillHeightCm;
  const yMax = opening.sillHeightCm + opening.heightCm;
  if (wall.side === 'north' || wall.side === 'south') {
    return {
      min: [center[0] - halfWidth, yMin, center[2] - halfThickness],
      max: [center[0] + halfWidth, yMax, center[2] + halfThickness],
    };
  }
  return {
    min: [center[0] - halfThickness, yMin, center[2] - halfWidth],
    max: [center[0] + halfThickness, yMax, center[2] + halfWidth],
  };
}

function boxPart(
  id: string,
  type: ParametricPartType,
  materialSlot: string,
  dimensions: ComponentDimensions,
  position: Vec3Tuple,
  rotation: Vec3Tuple,
): PlanPart {
  return {
    id,
    type,
    role: type,
    dimensions,
    geometry: {
      kind: 'box',
      width: dimensions.width,
      height: dimensions.height,
      depth: dimensions.depth,
    },
    position,
    rotation,
    materialSlot,
    uv: 'physical-box',
  };
}

function commonPlan(
  wall: RoomWallLayout,
  opening: RoomOpeningSpec,
  center: Vec3Tuple,
): RoomOpeningPlan {
  return {
    id: opening.id,
    type: opening.type,
    wallId: wall.side,
    offsetCm: opening.offsetCm,
    widthCm: opening.widthCm,
    heightCm: opening.heightCm,
    sillHeightCm: opening.sillHeightCm,
    center,
    bounds: openingBounds(wall, opening, center),
  };
}

function buildDoorAssembly(
  wall: RoomWallLayout,
  opening: RoomOpeningSpec,
): OpeningAssembly {
  const config = resolveDoorConfig(opening, wall.dimensions.depth);
  const rotation = wallRotation(wall);
  const centerU = openingU(wall, opening);
  const width = opening.widthCm;
  const height = opening.heightCm;
  const sill = opening.sillHeightCm;
  const f = config.frameWidthCm;
  const frameDepth = config.frameDepthCm;
  const leafWidth = width - 2 * f - 2 * config.leafInsetCm;
  const leafHeight = height - f - 2 * config.leafInsetCm;
  const leafBottom = sill + config.leafInsetCm;
  const leafCenterY = leafBottom + leafHeight / 2;
  const leafCenter = wallPoint(wall, centerU, leafCenterY, 0);

  const frameIds = [
    `${opening.id}-door-frame-left`,
    `${opening.id}-door-frame-right`,
    `${opening.id}-door-frame-header`,
  ];
  const frameParts: PlanPart[] = [
    boxPart(
      frameIds[0],
      'door-frame',
      'door-frame',
      { width: f, height, depth: frameDepth },
      wallPoint(wall, centerU - width / 2 + f / 2, sill + height / 2, 0),
      rotation,
    ),
    boxPart(
      frameIds[1],
      'door-frame',
      'door-frame',
      { width: f, height, depth: frameDepth },
      wallPoint(wall, centerU + width / 2 - f / 2, sill + height / 2, 0),
      rotation,
    ),
    boxPart(
      frameIds[2],
      'door-frame',
      'door-frame',
      { width: width - 2 * f, height: f, depth: frameDepth },
      wallPoint(wall, centerU, sill + height - f / 2, 0),
      rotation,
    ),
  ];

  const leafPartId = `${opening.id}-door-leaf`;
  const leaf = boxPart(
    leafPartId,
    'door-leaf',
    'door-leaf',
    { width: leafWidth, height: leafHeight, depth: config.leafThicknessCm },
    leafCenter,
    rotation,
  );

  const handleSideSign = config.hingeSide === 'left' ? 1 : -1;
  const handleU = centerU + handleSideSign * Math.max(1, leafWidth / 2 - 3);
  const handleV = interiorSign(wall) * (config.leafThicknessCm / 2 + 3);
  const handlePartId = `${opening.id}-door-handle`;
  const handle = boxPart(
    handlePartId,
    'door-handle',
    'door-hardware',
    { width: 2, height: 2, depth: 6 },
    wallPoint(wall, handleU, config.handleHeightCm, handleV),
    rotation,
  );

  const hingeSign = config.hingeSide === 'left' ? -1 : 1;
  const hingeU = centerU + hingeSign * (leafWidth / 2 - 0.5);
  const hingePositions: Vec3Tuple[] = [];
  for (let index = 0; index < DEFAULT_DOOR_HINGE_COUNT; index += 1) {
    const fraction = (index + 1) / (DEFAULT_DOOR_HINGE_COUNT + 1);
    hingePositions.push(
      wallPoint(wall, hingeU, leafBottom + fraction * leafHeight, 0),
    );
  }
  const pivot = wallPoint(wall, hingeU, leafBottom, 0);
  const directionSign = config.swingDirection === 'inward' ? -1 : 1;
  const openRotationYDeg =
    config.swingAngleDeg === 0
      ? 0
      : config.swingAngleDeg *
        (config.hingeSide === 'left' ? 1 : -1) *
        directionSign;

  const door: DoorAssemblyPlan = Object.freeze({
    framePartIds: Object.freeze(frameIds),
    leafPartId,
    handlePartId,
    hingeCount: DEFAULT_DOOR_HINGE_COUNT,
    hingeSide: config.hingeSide,
    swingDirection: config.swingDirection,
    swingAngleDeg: config.swingAngleDeg,
    pivot,
    hingePositions: Object.freeze(hingePositions),
    closedPosition: leafCenter,
    closedRotationDeg: rotation,
    openRotationYDeg,
  });

  return {
    parts: [...frameParts, leaf, handle],
    plan: {
      ...commonPlan(wall, opening, wallPoint(wall, centerU, sill + height / 2, 0)),
      door,
    },
  };
}

function buildWindowAssembly(
  wall: RoomWallLayout,
  opening: RoomOpeningSpec,
): OpeningAssembly {
  const config = resolveWindowConfig(opening, wall.dimensions.depth);
  const rotation = wallRotation(wall);
  const centerU = openingU(wall, opening);
  const width = opening.widthCm;
  const height = opening.heightCm;
  const sill = opening.sillHeightCm;
  const f = config.frameWidthCm;
  const frameDepth = config.frameDepthCm;
  const sillThickness = config.sillThicknessCm;
  const clearWidth = width - 2 * f;
  const clearHeight = height - sillThickness - 2 * f;
  const glassBottom = sill + sillThickness + f;
  const glassCenterY = glassBottom + clearHeight / 2;
  const frameIds = [
    `${opening.id}-window-frame-left`,
    `${opening.id}-window-frame-right`,
    `${opening.id}-window-frame-top`,
    `${opening.id}-window-frame-bottom`,
  ];
  const frameParts: PlanPart[] = [
    boxPart(
      frameIds[0],
      'window-frame',
      'window-frame',
      { width: f, height: height - sillThickness, depth: frameDepth },
      wallPoint(wall, centerU - width / 2 + f / 2, sill + sillThickness + (height - sillThickness) / 2, 0),
      rotation,
    ),
    boxPart(
      frameIds[1],
      'window-frame',
      'window-frame',
      { width: f, height: height - sillThickness, depth: frameDepth },
      wallPoint(wall, centerU + width / 2 - f / 2, sill + sillThickness + (height - sillThickness) / 2, 0),
      rotation,
    ),
    boxPart(
      frameIds[2],
      'window-frame',
      'window-frame',
      { width: clearWidth, height: f, depth: frameDepth },
      wallPoint(wall, centerU, sill + height - f / 2, 0),
      rotation,
    ),
    boxPart(
      frameIds[3],
      'window-frame',
      'window-frame',
      { width: clearWidth, height: f, depth: frameDepth },
      wallPoint(wall, centerU, sill + sillThickness + f / 2, 0),
      rotation,
    ),
  ];

  const sillPartId = `${opening.id}-window-sill`;
  const sillPart = boxPart(
    sillPartId,
    'window-sill',
    'window-sill',
    { width, height: sillThickness, depth: frameDepth + 4 },
    wallPoint(wall, centerU, sill + sillThickness / 2, 0),
    rotation,
  );

  const barWidth = Math.max(2, f / 2);
  const panelWidth = (clearWidth - config.mullionCount * barWidth) / (config.mullionCount + 1);
  const panelHeight = (clearHeight - config.transomCount * barWidth) / (config.transomCount + 1);
  const glassPartIds: string[] = [];
  const glassParts: PlanPart[] = [];
  for (let row = 0; row <= config.transomCount; row += 1) {
    for (let column = 0; column <= config.mullionCount; column += 1) {
      const id = `${opening.id}-window-glass-${row + 1}-${column + 1}`;
      glassPartIds.push(id);
      glassParts.push(
        boxPart(
          id,
          'window-glass',
          'window-glass',
          {
            width: panelWidth,
            height: panelHeight,
            depth: config.glassThicknessCm,
          },
          wallPoint(
            wall,
            centerU - clearWidth / 2 + panelWidth / 2 + column * (panelWidth + barWidth),
            glassBottom + panelHeight / 2 + row * (panelHeight + barWidth),
            0,
          ),
          rotation,
        ),
      );
    }
  }

  const mullionPartIds: string[] = [];
  const mullionParts: PlanPart[] = [];
  for (let index = 0; index < config.mullionCount; index += 1) {
    const id = `${opening.id}-window-mullion-${index + 1}`;
    mullionPartIds.push(id);
    mullionParts.push(
      boxPart(
        id,
        'mullion',
        'window-frame',
        { width: barWidth, height: clearHeight, depth: frameDepth },
        wallPoint(
          wall,
          centerU - clearWidth / 2 + (index + 1) * panelWidth + index * barWidth + barWidth / 2,
          glassCenterY,
          0,
        ),
        rotation,
      ),
    );
  }

  const transomPartIds: string[] = [];
  const transomParts: PlanPart[] = [];
  for (let index = 0; index < config.transomCount; index += 1) {
    const id = `${opening.id}-window-transom-${index + 1}`;
    transomPartIds.push(id);
    transomParts.push(
      boxPart(
        id,
        'transom',
        'window-frame',
        { width: clearWidth, height: barWidth, depth: frameDepth },
        wallPoint(
          wall,
          centerU,
          glassBottom + (index + 1) * panelHeight + index * barWidth + barWidth / 2,
          0,
        ),
        rotation,
      ),
    );
  }

  const window: WindowAssemblyPlan = Object.freeze({
    framePartIds: Object.freeze(frameIds),
    glassPartIds: Object.freeze(glassPartIds),
    sillPartId,
    mullionPartIds: Object.freeze(mullionPartIds),
    transomPartIds: Object.freeze(transomPartIds),
  });

  return {
    parts: [...frameParts, sillPart, ...glassParts, ...mullionParts, ...transomParts],
    plan: {
      ...commonPlan(wall, opening, wallPoint(wall, centerU, sill + height / 2, 0)),
      window,
    },
  };
}

export function buildOpeningAssembly(
  wall: RoomWallLayout,
  opening: RoomOpeningSpec,
): OpeningAssembly {
  return opening.type === 'door'
    ? buildDoorAssembly(wall, opening)
    : buildWindowAssembly(wall, opening);
}
