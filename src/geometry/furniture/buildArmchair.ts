/**
 * Armchair builder (W2): seat, four legs, backrest and two armrests.
 * Params: widthCm, depthCm, heightCm, seatHeightCm, backHeightCm, armHeightCm.
 */
import { SEAT_THICKNESS_CM, CHAIR_LEG_THICKNESS_CM } from './buildChair';
import { PartBuilder, clampValue, type BuiltFurniture, type PartMaterialOptions } from './parts';
import type { FurnitureParams } from './types';

const BACK_THICKNESS_CM = 4;
const ARM_THICKNESS_CM = 6;

export function buildArmchair(
  params: FurnitureParams,
  material: PartMaterialOptions = {},
): BuiltFurniture {
  const builder = new PartBuilder('armchair', params.color, material);
  const { widthCm, depthCm, heightCm } = params;

  const seatHeight = clampValue(params.seatHeightCm, 20, heightCm - 5, heightCm * 0.5);
  const legHeight = Math.max(seatHeight - SEAT_THICKNESS_CM, 1);

  builder.box(
    'armchair-seat',
    [widthCm, SEAT_THICKNESS_CM, depthCm],
    [0, legHeight + SEAT_THICKNESS_CM / 2, 0],
  );

  const insetX = Math.max(widthCm / 2 - CHAIR_LEG_THICKNESS_CM / 2 - 1, 0);
  const insetZ = Math.max(depthCm / 2 - CHAIR_LEG_THICKNESS_CM / 2 - 1, 0);
  let leg = 0;
  for (const x of [insetX, -insetX]) {
    for (const z of [insetZ, -insetZ]) {
      leg += 1;
      builder.box(
        `armchair-leg-${leg}`,
        [CHAIR_LEG_THICKNESS_CM, legHeight, CHAIR_LEG_THICKNESS_CM],
        [x, legHeight / 2, z],
      );
    }
  }

  // Keep the backrest within the declared total height (see buildChair).
  const available = Math.max(heightCm - seatHeight, 6);
  const backHeight = Math.min(
    clampValue(params.backHeightCm, 6, available, available),
    Math.max(heightCm - seatHeight, 1),
  );
  builder.box(
    'armchair-back',
    [widthCm, backHeight, BACK_THICKNESS_CM],
    [0, seatHeight + backHeight / 2, -(depthCm / 2 - BACK_THICKNESS_CM / 2)],
  );

  const armHeight = clampValue(params.armHeightCm, seatHeight + 2, heightCm, heightCm - 5);
  const armLength = Math.max(depthCm - BACK_THICKNESS_CM, 5);
  const armY = armHeight / 2;
  const armZ = BACK_THICKNESS_CM / 2;
  for (const [index, x] of [1, -1].entries()) {
    builder.box(
      `armchair-arm-${index + 1}`,
      [ARM_THICKNESS_CM, armHeight, armLength],
      [x * (widthCm / 2 - ARM_THICKNESS_CM / 2), armY, armZ],
    );
  }

  return { group: builder.group, dispose: () => builder.dispose() };
}
