/**
 * Furniture builder dispatch (W2).
 *
 * Maps a `FurnitureType` to its parametric builder. Every builder returns the
 * same `{ group, dispose }` shape as the existing table builder, so the viewer,
 * the GLB exporter and the scene layer stay type-agnostic.
 *
 * W4 integration note: builders receive a `PartMaterialOptions` ({metalness,
 * roughness}) — the same fields the Stage 6 `ObjectMaterial` already carries — and
 * tag every part with a stable `userData.partId`, so W4's `buildPbrMaterial`
 * (materialId/opacity/texture) can be routed per part without changing this API.
 */
import { buildTable } from '../buildTable';
import { buildArmchair } from './buildArmchair';
import { buildBed } from './buildBed';
import { buildChair } from './buildChair';
import { buildDresser } from './buildDresser';
import { buildShelf } from './buildShelf';
import { buildSofa } from './buildSofa';
import { buildWardrobe } from './buildWardrobe';
import type { BuiltFurniture, PartMaterialOptions } from './parts';
import type { FurnitureParams, FurnitureType } from './types';

export function buildFurniture(
  type: FurnitureType,
  params: FurnitureParams,
  material: PartMaterialOptions = {},
): BuiltFurniture {
  const built = ((): { group: BuiltFurniture['group']; dispose: () => void } => {
    switch (type) {
      case 'table':
        return buildTable(params, material);
      case 'chair':
        return buildChair(params, material);
      case 'armchair':
        return buildArmchair(params, material);
      case 'sofa':
        return buildSofa(params, material);
      case 'bed':
        return buildBed(params, material);
      case 'wardrobe':
        return buildWardrobe(params, material);
      case 'shelf':
        return buildShelf(params, material);
      case 'dresser':
        return buildDresser(params, material);
      default: {
        const exhaustive: never = type;
        throw new Error(`Qo'llab-quvvatlanmaydigan mebel turi: ${String(exhaustive)}`);
      }
    }
  })();

  built.group.name = `${type}:parts`;
  return built;
}
