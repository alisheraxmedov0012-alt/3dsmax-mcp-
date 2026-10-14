/**
 * Wardrobe builder (W2): corpus (back/sides/top/bottom), internal shelves and
 * front doors.
 * Params: widthCm, heightCm, depthCm, wallThicknessCm, shelfCount, doorCount.
 */
import { PartBuilder, clampValue, safeSize, type BuiltFurniture, type PartMaterialOptions } from './parts';
import type { FurnitureParams } from './types';

export function buildWardrobe(
  params: FurnitureParams,
  material: PartMaterialOptions = {},
): BuiltFurniture {
  const builder = new PartBuilder('wardrobe', params.color, material);
  const { widthCm, heightCm, depthCm } = params;

  const wall = clampValue(params.wallThicknessCm, 1, Math.min(widthCm, heightCm, depthCm) / 3, 2);
  const innerWidth = Math.max(widthCm - 2 * wall, wall);
  const innerHeight = Math.max(heightCm - 2 * wall, wall);

  // Side panels.
  for (const [index, sign] of [1, -1].entries()) {
    builder.box(
      `wardrobe-side-${index + 1}`,
      [wall, heightCm, depthCm],
      [sign * (widthCm / 2 - wall / 2), heightCm / 2, 0],
    );
  }

  // Top and bottom panels.
  builder.box('wardrobe-top', [innerWidth, wall, depthCm], [0, heightCm - wall / 2, 0]);
  builder.box('wardrobe-bottom', [innerWidth, wall, depthCm], [0, wall / 2, 0]);

  // Back panel.
  builder.box(
    'wardrobe-back',
    [innerWidth, innerHeight, wall],
    [0, heightCm / 2, -(depthCm / 2 - wall / 2)],
  );

  // Internal shelves, evenly spaced.
  const shelfCount = Math.round(clampValue(params.shelfCount, 0, 8, 4));
  if (shelfCount > 0) {
    const usable = Math.max(innerHeight, wall);
    const gap = usable / (shelfCount + 1);
    const shelfDepth = Math.max(depthCm - wall, wall);
    for (let i = 1; i <= shelfCount; i += 1) {
      builder.box(
        `wardrobe-shelf-${i}`,
        [innerWidth, wall, shelfDepth],
        [0, wall + gap * i, wall / 2],
      );
    }
  }

  // Front doors, evenly split across the opening.
  const doorCount = Math.round(clampValue(params.doorCount, 1, 4, 2));
  const doorWidth = Math.max(innerWidth / doorCount - 1, wall);
  const doorHeight = Math.max(innerHeight - 1, wall);
  const doorZ = depthCm / 2 - safeSize(wall * 0.6, 0.5) / 2;
  for (let i = 0; i < doorCount; i += 1) {
    const x = -innerWidth / 2 + doorWidth / 2 + i * (innerWidth / doorCount);
    builder.box(
      `wardrobe-door-${i + 1}`,
      [doorWidth, doorHeight, Math.max(wall * 0.6, 0.5)],
      [x, heightCm / 2, doorZ],
    );
  }

  return { group: builder.group, dispose: () => builder.dispose() };
}
