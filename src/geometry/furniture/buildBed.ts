/**
 * Bed builder (W2): four legs, a frame slab, a mattress and a headboard.
 * Params: widthCm, depthCm (length), heightCm (frame top height),
 * mattressHeightCm, headboardHeightCm.
 */
import { PartBuilder, clampValue, type BuiltFurniture, type PartMaterialOptions } from './parts';
import { declaredDefault, gateParam } from './contract';
import type { FurnitureParams } from './types';

const FRAME_THICKNESS_CM = 6;
const LEG_THICKNESS_CM = 8;
const HEADBOARD_THICKNESS_CM = 6;

export function buildBed(
  params: FurnitureParams,
  material: PartMaterialOptions = {},
): BuiltFurniture {
  const builder = new PartBuilder('bed', params.color, material);
  const { widthCm, depthCm, heightCm } = params;

  // `gateParam` keeps a directly-called builder inside the declared range; the
  // geometric bounds after it are unchanged.
  const frameTop = clampValue(
    gateParam('bed', 'heightCm', heightCm),
    FRAME_THICKNESS_CM + 4,
    120,
    declaredDefault('bed', 'heightCm'),
  );
  const legHeight = Math.max(frameTop - FRAME_THICKNESS_CM, 1);
  // Inset legs so their outer faces stay flush with the frame edge (a bigger
  // offset made them stick out by 1 cm beyond the declared width/depth).
  const legInset = LEG_THICKNESS_CM / 2;

  // Corner legs.
  const insetX = Math.max(widthCm / 2 - legInset, 0);
  const insetZ = Math.max(depthCm / 2 - legInset, 0);
  let leg = 0;
  for (const x of [insetX, -insetX]) {
    for (const z of [insetZ, -insetZ]) {
      leg += 1;
      builder.box(
        `bed-leg-${leg}`,
        [LEG_THICKNESS_CM, legHeight, LEG_THICKNESS_CM],
        [x, legHeight / 2, z],
      );
    }
  }

  // Frame slab.
  builder.box(
    'bed-frame',
    [widthCm, FRAME_THICKNESS_CM, depthCm],
    [0, legHeight + FRAME_THICKNESS_CM / 2, 0],
  );

  // Mattress (inset slightly from the frame).
  const mattressHeight = clampValue(
    gateParam('bed', 'mattressHeightCm', params.mattressHeightCm),
    8,
    40,
    declaredDefault('bed', 'mattressHeightCm'),
  );
  const mattressWidth = Math.max(widthCm - 4, 10);
  const mattressDepth = Math.max(depthCm - 4, 10);
  builder.box(
    'bed-mattress',
    [mattressWidth, mattressHeight, mattressDepth],
    [0, frameTop + mattressHeight / 2, 0],
  );

  // Headboard at the back, from the floor.
  const headboardHeight = clampValue(
    gateParam('bed', 'headboardHeightCm', params.headboardHeightCm),
    20,
    200,
    frameTop + 50,
  );
  builder.box(
    'bed-headboard',
    [widthCm, headboardHeight, HEADBOARD_THICKNESS_CM],
    [0, headboardHeight / 2, -(depthCm / 2 - HEADBOARD_THICKNESS_CM / 2)],
  );

  return { group: builder.group, dispose: () => builder.dispose() };
}
