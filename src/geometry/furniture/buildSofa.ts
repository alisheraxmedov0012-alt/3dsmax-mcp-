/**
 * Sofa builder (W2): base/seat, backrest, two arms and short legs.
 * Params: widthCm, depthCm, heightCm, seatHeightCm, backHeightCm, armHeightCm.
 */
import { PartBuilder, clampValue, type BuiltFurniture, type PartMaterialOptions } from './parts';
import { gateParam } from './contract';
import type { FurnitureParams } from './types';

const SEAT_THICKNESS_CM = 8;
const LEG_THICKNESS_CM = 5;
const LEG_HEIGHT_CM = 8;
const BACK_THICKNESS_CM = 8;
const ARM_THICKNESS_CM = 12;

export function buildSofa(
  params: FurnitureParams,
  material: PartMaterialOptions = {},
): BuiltFurniture {
  const builder = new PartBuilder('sofa', params.color, material);
  const { widthCm, depthCm, heightCm } = params;

  const seatTop = clampValue(
    gateParam('sofa', 'seatHeightCm', params.seatHeightCm),
    25,
    heightCm - 10,
    heightCm * 0.5,
  );
  const seatThickness = Math.min(SEAT_THICKNESS_CM, Math.max(seatTop - LEG_HEIGHT_CM, 2));

  // Legs.
  const insetX = Math.max(widthCm / 2 - LEG_THICKNESS_CM / 2 - 2, 0);
  const insetZ = Math.max(depthCm / 2 - LEG_THICKNESS_CM / 2 - 2, 0);
  let leg = 0;
  for (const x of [insetX, -insetX]) {
    for (const z of [insetZ, -insetZ]) {
      leg += 1;
      builder.box(
        `sofa-leg-${leg}`,
        [LEG_THICKNESS_CM, LEG_HEIGHT_CM, LEG_THICKNESS_CM],
        [x, LEG_HEIGHT_CM / 2, z],
      );
    }
  }

  // Base/seat block.
  const baseBottom = LEG_HEIGHT_CM;
  const baseHeight = Math.max(seatTop - baseBottom, seatThickness);
  // The seat block sits between the two armrests: full width would put it inside
  // them, since the armrests occupy the outer ARM_THICKNESS_CM on each side.
  const seatWidth = Math.max(widthCm - 2 * ARM_THICKNESS_CM, 10);
  builder.box('sofa-seat', [seatWidth, baseHeight, depthCm], [0, baseBottom + baseHeight / 2, 0]);

  // Backrest.
  const available = Math.max(heightCm - seatTop, 8);
  const backHeight = clampValue(
    gateParam('sofa', 'backHeightCm', params.backHeightCm),
    8,
    available,
    available,
  );
  builder.box(
    'sofa-back',
    [widthCm, backHeight, BACK_THICKNESS_CM],
    [0, seatTop + backHeight / 2, -(depthCm / 2 - BACK_THICKNESS_CM / 2)],
  );

  // Arms.
  const armTop = clampValue(
    gateParam('sofa', 'armHeightCm', params.armHeightCm),
    seatTop + 4,
    heightCm,
    heightCm - 5,
  );
  const armHeight = Math.max(armTop - LEG_HEIGHT_CM, 4);
  const armLength = Math.max(depthCm - BACK_THICKNESS_CM, 8);
  const armZ = BACK_THICKNESS_CM / 2;
  for (const [index, sign] of [1, -1].entries()) {
    builder.box(
      `sofa-arm-${index + 1}`,
      [ARM_THICKNESS_CM, armHeight, armLength],
      [sign * (widthCm / 2 - ARM_THICKNESS_CM / 2), LEG_HEIGHT_CM + armHeight / 2, armZ],
    );
  }

  return { group: builder.group, dispose: () => builder.dispose() };
}
