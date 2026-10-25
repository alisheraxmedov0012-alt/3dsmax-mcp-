/**
 * Furniture builder dispatch (W2).
 *
 * Maps a `FurnitureType` to its parametric builder. Every builder returns the
 * same `{ group, dispose }` shape as the existing table builder, so the viewer,
 * the GLB exporter and the scene layer stay type-agnostic.
 *
 * W4 integration: builders receive the full `PartMaterialOptions` (materialId,
 * metalness, roughness, opacity, textureScale, normalStrength) — the same fields
 * the Stage 6 `ObjectMaterial` carries — and tag every part with a stable
 * `userData.partId`. Since A2.1 that material is built through
 * `buildPbrMaterial`, so every type, not just the legacy table, picks up its
 * preset and procedural texture. The per-part tag remains available for a future
 * per-part material override.
 */
import { buildTable } from '../buildTable';
import { sanitizeBaseDimensions } from './params';
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
  // Defence in depth: the validators reject bad input before it reaches here, but
  // a NaN/Infinity base dimension would produce non-finite geometry, so sanitize
  // the base dimensions once for every builder.
  const safeParams = sanitizeBaseDimensions(type, params);
  const built = ((): { group: BuiltFurniture['group']; dispose: () => void } => {
    switch (type) {
      case 'table':
        return buildTable(safeParams, material);
      case 'chair':
        return buildChair(safeParams, material);
      case 'armchair':
        return buildArmchair(safeParams, material);
      case 'sofa':
        return buildSofa(safeParams, material);
      case 'bed':
        return buildBed(safeParams, material);
      case 'wardrobe':
        return buildWardrobe(safeParams, material);
      case 'shelf':
        return buildShelf(safeParams, material);
      case 'dresser':
        return buildDresser(safeParams, material);
      default: {
        const exhaustive: never = type;
        throw new Error(`Qo'llab-quvvatlanmaydigan mebel turi: ${String(exhaustive)}`);
      }
    }
  })();

  built.group.name = `${type}:parts`;
  return built;
}
