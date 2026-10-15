/**
 * Dresser / chest-of-drawers builder (W2): corpus, legs, drawer fronts and
 * optional doors.
 * Params: widthCm, heightCm, depthCm, drawerCount, doorCount, legHeightCm.
 */
import { PartBuilder, clampValue, type BuiltFurniture, type PartMaterialOptions } from './parts';
import type { FurnitureParams } from './types';

const WALL_CM = 2;
const FRONT_THICKNESS_CM = 2;

export function buildDresser(
  params: FurnitureParams,
  material: PartMaterialOptions = {},
): BuiltFurniture {
  const builder = new PartBuilder('dresser', params.color, material);
  const { widthCm, heightCm, depthCm } = params;

  const legHeight = clampValue(params.legHeightCm, 0, Math.max(heightCm - 10, 0), 10);
  const bodyHeight = Math.max(heightCm - legHeight, 10);
  const bodyBottom = legHeight;

  // Legs.
  const insetX = Math.max(widthCm / 2 - WALL_CM - 1, 0);
  const insetZ = Math.max(depthCm / 2 - WALL_CM - 1, 0);
  if (legHeight > 0) {
    let leg = 0;
    for (const x of [insetX, -insetX]) {
      for (const z of [insetZ, -insetZ]) {
        leg += 1;
        builder.box(
          `dresser-leg-${leg}`,
          [WALL_CM + 2, legHeight, WALL_CM + 2],
          [x, legHeight / 2, z],
        );
      }
    }
  }

  // Corpus (body).
  builder.box(
    'dresser-body',
    [widthCm, bodyHeight, depthCm],
    [0, bodyBottom + bodyHeight / 2, 0],
  );

  const drawerCount = Math.round(clampValue(params.drawerCount, 1, 6, 3));
  const doorCount = Math.round(clampValue(params.doorCount, 0, 2, 0));
  const frontZ = depthCm / 2 + FRONT_THICKNESS_CM / 2;
  const innerWidth = Math.max(widthCm - 2 * WALL_CM, WALL_CM);
  const frontHeight = Math.max(bodyHeight - WALL_CM, WALL_CM);

  if (doorCount === 0) {
    // Full-width drawer stack.
    const drawerHeight = Math.max(frontHeight / drawerCount - 1, WALL_CM);
    for (let i = 0; i < drawerCount; i += 1) {
      const y = bodyBottom + WALL_CM / 2 + drawerHeight / 2 + i * (frontHeight / drawerCount);
      builder.box(
        `dresser-drawer-${i + 1}`,
        [innerWidth, drawerHeight, FRONT_THICKNESS_CM],
        [0, y, frontZ],
      );
    }
  } else {
    // Doors on the left, a drawer stack on the right.
    const doorZoneWidth = innerWidth * 0.55;
    const drawerZoneWidth = innerWidth - doorZoneWidth - 2;
    const doorWidth = Math.max(doorZoneWidth / doorCount - 1, WALL_CM);
    const doorX0 = -innerWidth / 2 + doorWidth / 2;
    for (let i = 0; i < doorCount; i += 1) {
      builder.box(
        `dresser-door-${i + 1}`,
        [doorWidth, frontHeight, FRONT_THICKNESS_CM],
        [doorX0 + i * (doorZoneWidth / doorCount), bodyBottom + bodyHeight / 2, frontZ],
      );
    }
    const drawerHeight = Math.max(frontHeight / drawerCount - 1, WALL_CM);
    const drawerX = innerWidth / 2 - drawerZoneWidth / 2;
    for (let i = 0; i < drawerCount; i += 1) {
      const y = bodyBottom + WALL_CM / 2 + drawerHeight / 2 + i * (frontHeight / drawerCount);
      builder.box(
        `dresser-drawer-${i + 1}`,
        [drawerZoneWidth, drawerHeight, FRONT_THICKNESS_CM],
        [drawerX, y, frontZ],
      );
    }
  }

  return { group: builder.group, dispose: () => builder.dispose() };
}
