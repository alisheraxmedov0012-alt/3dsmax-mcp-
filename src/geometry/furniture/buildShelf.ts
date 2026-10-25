/**
 * Shelf / bookcase builder (W2): two sides, top, bottom, back and N shelves.
 * Params: widthCm, heightCm, depthCm, wallThicknessCm, shelfCount.
 *
 * The board layout lives in `capacity.ts` so the parameter validator can reject
 * a shelf count that would not physically fit, using the same arithmetic.
 */
import { PartBuilder, type BuiltFurniture, type PartMaterialOptions } from './parts';
import { shelfLayout } from './capacity';
import type { FurnitureParams } from './types';

export function buildShelf(
  params: FurnitureParams,
  material: PartMaterialOptions = {},
): BuiltFurniture {
  const builder = new PartBuilder('shelf', params.color, material);
  const { widthCm, heightCm, depthCm } = params;
  const layout = shelfLayout(params);
  const { wallCm: wall, innerWidthCm: innerWidth, innerHeightCm: innerHeight } = layout;

  for (const [index, sign] of [1, -1].entries()) {
    builder.box(
      `shelf-side-${index + 1}`,
      [wall, heightCm, depthCm],
      [sign * (widthCm / 2 - wall / 2), heightCm / 2, 0],
    );
  }

  builder.box('shelf-top', [innerWidth, wall, depthCm], [0, heightCm - wall / 2, 0]);
  builder.box('shelf-bottom', [innerWidth, wall, depthCm], [0, wall / 2, 0]);
  builder.box(
    'shelf-back',
    [innerWidth, innerHeight, wall],
    [0, heightCm / 2, -(depthCm / 2 - wall / 2)],
  );

  for (let i = 1; i <= layout.shelfCount; i += 1) {
    builder.box(
      `shelf-board-${i}`,
      [innerWidth, wall, layout.shelfDepthCm],
      [0, wall + layout.pitchCm * i, wall / 2],
    );
  }

  return { group: builder.group, dispose: () => builder.dispose() };
}
