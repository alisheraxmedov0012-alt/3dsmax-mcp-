/**
 * Stage 2.1a — materialise a plan through the existing PartBuilder.
 *
 * Slot grouping is the same technique the Premium Desk builder proved: one
 * PartBuilder (and therefore one material) per slot, added to the root in the
 * definition's declared slot order. No geometry is created outside the kernel.
 */
import * as THREE from 'three';
import './definitions';
import type { MaterialSettingsInput } from '../../materials/types';
import { uvOrientationForPart } from '../../materials/uv';
import { PartBuilder } from '../furniture/parts';
import { furnitureDefinitions } from './registry';
import {
  FurniturePlanError,
  type FurniturePlan,
  type FurnitureSlot,
} from './types';

const DEG_TO_RAD = Math.PI / 180;

/**
 * The minimal definition shape the plan builder reads.
 *
 * Kept structural so the category-neutral contract can reuse the exact same
 * materialisation path without the builder knowing about domains.
 */
export interface PlanBuildDefinition {
  readonly id: string;
  readonly slots: readonly FurnitureSlot[];
  readonly groupName?: string;
}

export interface BuiltPlanFurniture {
  readonly group: THREE.Group;
  readonly plan: FurniturePlan;
  readonly materialSlots: readonly string[];
  readonly materialNames: readonly string[];
  dispose: () => void;
}

export interface BuildPlanOptions {
  readonly materialOverrides?: Readonly<Record<string, MaterialSettingsInput>>;
  /**
   * Per-slot physical UV tile, in centimetres. Only the interior builder passes
   * this; furniture builds leave it undefined and keep the 50 cm tile.
   */
  readonly uvTileOverrides?: Readonly<Record<string, number>>;
}

export function buildPlan(
  plan: FurniturePlan,
  options: BuildPlanOptions = {},
): BuiltPlanFurniture {
  const definition = furnitureDefinitions.get(plan.definitionId);
  if (!definition) {
    throw new FurniturePlanError(
      'unknown_definition',
      `Definition "${plan.definitionId}" topilmadi.`,
    );
  }
  return buildPlanWithDefinition(plan, definition, options);
}

/**
 * Materialises a plan against an already-resolved definition.
 *
 * Split out for the category-neutral contract, which resolves its definition
 * from the generic registry. Furniture callers keep using `buildPlan` above, so
 * the lookup and the error behaviour on that path are unchanged.
 */
export function buildPlanWithDefinition(
  plan: FurniturePlan,
  definition: PlanBuildDefinition,
  options: BuildPlanOptions = {},
): BuiltPlanFurniture {
  const slots = new Map(definition.slots.map((slot) => [slot.id, slot]));
  const builders = new Map<string, PartBuilder>();

  for (const part of plan.parts) {
    const slot = slots.get(part.materialSlot);
    if (!slot) {
      throw new FurniturePlanError('invalid_plan', `"${part.id}": materialSlot topilmadi.`, [
        {
          code: 'invalid_material_slot',
          message: `"${part.id}": materialSlot "${part.materialSlot}" topilmadi.`,
          partId: part.id,
        },
      ]);
    }

    let builder = builders.get(slot.id);
    if (!builder) {
      builder = new PartBuilder(slot.groupName, slot.color, {
        materialId: slot.materialId,
        ...options.materialOverrides?.[slot.id],
      });
      builder.setSlotBase(slot.materialId, slot.color);
      builder.setMaterialName(slot.materialName ?? `${slot.groupName}-material`);
      builders.set(slot.id, builder);
    }

    const uvTileCm = options.uvTileOverrides?.[slot.id] ?? part.uvTileCm;
    builder.addGeometry(
      part.id,
      part.geometry,
      [part.position[0], part.position[1], part.position[2]],
      [
        part.rotation[0] * DEG_TO_RAD,
        part.rotation[1] * DEG_TO_RAD,
        part.rotation[2] * DEG_TO_RAD,
      ],
      {
        uv: part.uv ?? 'auto',
        uvOrientation: uvOrientationForPart(part.type),
        ...(uvTileCm === undefined ? {} : { uvTileCm }),
      },
    );
  }

  const group = new THREE.Group();
  group.name = definition.groupName ?? `${definition.id}:assembly`;

  const usedSlots = definition.slots.filter((slot) => builders.has(slot.id));
  for (const slot of usedSlots) {
    const builder = builders.get(slot.id);
    if (builder) {
      group.add(builder.group);
    }
  }

  return {
    group,
    plan,
    materialSlots: usedSlots.map((slot) => slot.id),
    materialNames: usedSlots.map(
      (slot) => slot.materialName ?? `${slot.groupName}-material`,
    ),
    dispose: () => {
      for (const builder of builders.values()) {
        builder.dispose();
      }
      group.clear();
    },
  };
}
