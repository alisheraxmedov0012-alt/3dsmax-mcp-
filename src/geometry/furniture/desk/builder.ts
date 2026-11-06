import * as THREE from 'three';
import type { MaterialPresetId } from '../../../materials/types';
import { addComponent, type ComponentPart } from '../../components';
import { PartBuilder } from '../parts';
import { DEFAULT_DESK_SPEC } from './spec';
import { solveDesk, type DeskAssemblyPlan } from './solver';
import type { DeskSpec } from './spec';

export type DeskMaterialSlot = 'tabletop' | 'structure' | 'hardware' | 'drawer';

interface MaterialSlotConfig {
  readonly color: string;
  readonly materialId: MaterialPresetId;
  /** Buyer-facing material name; also used by the universal adapter. */
  readonly materialName: string;
}

/**
 * Material slots are real materials, not just metadata. One PartBuilder owns one
 * material and all parts in that slot share it; this keeps the existing
 * single-material PartBuilder contract without rewriting it.
 */
const MATERIAL_SLOTS: Record<DeskMaterialSlot, MaterialSlotConfig> = {
  tabletop: {
    color: '#a9744f',
    materialId: 'wood-oak-premium',
    materialName: 'Desk_Tabletop_Oak',
  },
  structure: {
    color: '#3f4650',
    materialId: 'metal-satin-black',
    materialName: 'Desk_Structure_Steel',
  },
  hardware: {
    color: '#9aa3ad',
    materialId: 'metal-satin-black',
    materialName: 'Desk_Hardware_Steel',
  },
  drawer: {
    color: '#8b5a2b',
    materialId: 'wood-oak-premium',
    materialName: 'Desk_Drawer_Oak',
  },
};

function deskSlot(slot: ComponentPart['materialSlot']): DeskMaterialSlot {
  switch (slot) {
    case 'surface':
      return 'tabletop';
    case 'frame':
      return 'structure';
    case 'panel':
      return 'drawer';
    case 'hardware':
      return 'hardware';
  }
}

export interface BuiltDesk {
  readonly group: THREE.Group;
  readonly spec: DeskSpec;
  readonly plan: DeskAssemblyPlan;
  readonly materialSlots: readonly DeskMaterialSlot[];
  readonly materialNames: readonly string[];
  dispose: () => void;
}

/** Build a real Three.js desk from the deterministic DeskAssemblyPlan. */
export function buildDesk(spec: DeskSpec = DEFAULT_DESK_SPEC): BuiltDesk {
  const plan = solveDesk(spec);
  const group = new THREE.Group();
  group.name = 'desk-assembly';

  const builders = new Map<DeskMaterialSlot, PartBuilder>();
  for (const component of plan.components) {
    const slot = deskSlot(component.materialSlot);
    let builder = builders.get(slot);
    if (!builder) {
      const config = MATERIAL_SLOTS[slot];
      builder = new PartBuilder(`desk-${slot}-group`, config.color, {
        materialId: config.materialId,
      });
      builder.setMaterialName(config.materialName);
      builders.set(slot, builder);
    }
    addComponent(builder, component);
  }

  const slotOrder: DeskMaterialSlot[] = ['tabletop', 'structure', 'drawer', 'hardware'];
  for (const slot of slotOrder) {
    const builder = builders.get(slot);
    if (builder) {
      group.add(builder.group);
    }
  }

  const materialSlots = slotOrder.filter((slot) => builders.has(slot));
  const materialNames = materialSlots.map(
    (slot) => MATERIAL_SLOTS[slot].materialName,
  );
  return {
    group,
    spec: { ...spec },
    plan,
    materialSlots,
    materialNames,
    dispose: () => {
      for (const builder of builders.values()) {
        builder.dispose();
      }
      group.clear();
    },
  };
}

export function createDefaultDesk(): BuiltDesk {
  return buildDesk(DEFAULT_DESK_SPEC);
}
