/**
 * W14 — assembly dispatch.
 *
 * The single entry point the UI and the BOM layer call. It validates the
 * parameters, routes to the kind's builder and returns the same
 * `{ group, members, dispose }` shape for every kind, so callers stay
 * kind-agnostic — mirroring `buildFurniture` in the furniture layer.
 */
import type { AssemblyKind } from '../../scene/types';
import { type AssembleOptions, type BuiltAssembly } from './assembleParts';
import { buildKitchenBaseRun, KITCHEN_BASE_RUN } from './buildKitchenBaseRun';
import { buildStairStraight, STAIR_STRAIGHT } from './buildStairStraight';
import { buildWallCabinet, WALL_CABINET } from './buildWallCabinet';
import { buildWardrobeSection, WARDROBE_SECTION } from './buildWardrobeSection';
import {
  type AssemblyParamsByKind,
  type AssemblyParams,
  type KitchenBaseRunParams,
  type StairStraightParams,
  type WallCabinetParams,
  type WardrobeSectionParams,
} from './params';

export function buildAssembly<K extends AssemblyKind>(
  kind: K,
  params: AssemblyParamsByKind[K],
  options: AssembleOptions = {},
): BuiltAssembly {
  switch (kind) {
    case KITCHEN_BASE_RUN:
      return buildKitchenBaseRun(params as KitchenBaseRunParams, options);
    case WALL_CABINET:
      return buildWallCabinet(params as WallCabinetParams, options);
    case WARDROBE_SECTION:
      return buildWardrobeSection(params as WardrobeSectionParams, options);
    case STAIR_STRAIGHT:
      return buildStairStraight(params as StairStraightParams, options);
    default: {
      const exhaustive: never = kind;
      throw new Error(`Noma'lum assembly turi: ${String(exhaustive)}`);
    }
  }
}

/** Part ids that belong to an assembly, for measuring/BOM without geometry. */
export function assemblyPartIds(kind: AssemblyKind, params: AssemblyParams): string[] {
  const built = buildAssembly(kind, params as never);
  const ids: string[] = [];
  built.members.forEach((member) => {
    member.group.children.forEach((child) => {
      if (child.name) {
        ids.push(child.name);
      }
    });
  });
  built.dispose();
  return ids;
}

export { assembleParts } from './assembleParts';
export type { AssembleOptions, AssemblyMember, BuiltAssembly } from './assembleParts';
export { buildKitchenBaseRun } from './buildKitchenBaseRun';
export { buildWallCabinet } from './buildWallCabinet';
export { buildWardrobeSection } from './buildWardrobeSection';
export { buildStairStraight } from './buildStairStraight';
