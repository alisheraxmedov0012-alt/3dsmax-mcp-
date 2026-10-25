/**
 * Chair builder (W2): seat slab, four legs and a backrest.
 * Params: widthCm (seat), depthCm (seat), heightCm (total), seatHeightCm, backHeightCm.
 */
import { PartBuilder, clampValue, type BuiltFurniture, type PartMaterialOptions } from './parts';
import { gateParam } from './contract';
import type { FurnitureParams } from './types';

export const SEAT_THICKNESS_CM = 4;
export const CHAIR_LEG_THICKNESS_CM = 4;
const BACK_THICKNESS_CM = 3;

export function buildChair(
  params: FurnitureParams,
  material: PartMaterialOptions = {},
): BuiltFurniture {
  const builder = new PartBuilder('chair', params.color, material);
  const { widthCm, depthCm, heightCm } = params;

  // Declared range first, then the geometric bounds (which depend on heightCm).
  const seatHeight = clampValue(
    gateParam('chair', 'seatHeightCm', params.seatHeightCm),
    20,
    heightCm - 5,
    heightCm * 0.5,
  );
  const legHeight = Math.max(seatHeight - SEAT_THICKNESS_CM, 1);

  builder.box(
    'chair-seat',
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
        `chair-leg-${leg}`,
        [CHAIR_LEG_THICKNESS_CM, legHeight, CHAIR_LEG_THICKNESS_CM],
        [x, legHeight / 2, z],
      );
    }
  }

  // The backrest must not rise above the declared total height: when little room
  // is left above the seat, cap it instead of forcing a minimum that overflows.
  const available = Math.max(heightCm - seatHeight, 6);
  const backHeight = Math.min(
    clampValue(gateParam('chair', 'backHeightCm', params.backHeightCm), 6, available, available),
    Math.max(heightCm - seatHeight, 1),
  );
  builder.box(
    'chair-back',
    [widthCm, backHeight, BACK_THICKNESS_CM],
    [0, seatHeight + backHeight / 2, -(depthCm / 2 - BACK_THICKNESS_CM / 2)],
  );

  return { group: builder.group, dispose: () => builder.dispose() };
}
