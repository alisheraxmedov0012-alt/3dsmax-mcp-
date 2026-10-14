/**
 * Shelf / bookcase builder (W2): two sides, top, bottom, back and N shelves.
 * Params: widthCm, heightCm, depthCm, wallThicknessCm, shelfCount.
 */
import { PartBuilder, clampValue, type BuiltFurniture, type PartMaterialOptions } from './parts';
import type { FurnitureParams } from './types';

export function buildShelf(
  params: FurnitureParams,
  material: PartMaterialOptions = {},
): BuiltFurniture {
  const builder = new PartBuilder('shelf', params.color, material);
  const { widthCm, heightCm, depthCm } = params;

  const wall = clampValue(params.wallThicknessCm, 1, Math.min(widthCm, heightCm, depthCm) / 3, 2);
  const innerWidth = Math.max(widthCm - 2 * wall, wall);
  const innerHeight = Math.max(heightCm - 2 * wall, wall);

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

  const shelfCount = Math.round(clampValue(params.shelfCount, 1, 8, 4));
  const usable = Math.max(innerHeight, wall);
  const gap = usable / (shelfCount + 1);
  const shelfDepth = Math.max(depthCm - wall, wall);
  for (let i = 1; i <= shelfCount; i += 1) {
    builder.box(`shelf-board-${i}`, [innerWidth, wall, shelfDepth], [0, wall + gap * i, wall / 2]);
  }

  return { group: builder.group, dispose: () => builder.dispose() };
}
