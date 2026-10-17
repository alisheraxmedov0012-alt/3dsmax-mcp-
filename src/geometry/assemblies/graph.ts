/**
 * W14 — deterministic part graphs for the four assembly kinds.
 *
 * Each function turns validated parameters into a flat list of `PartNode`s. The
 * geometry is intentionally simple (axis-aligned boxes, the same primitive the
 * furniture builders use), so the result can be measured by the existing
 * manufacturing layer and checked by the constraint layer without a renderer.
 *
 * Determinism: ids are derived from the kind, the index and the role only, never
 * from a random value or the current time, so rebuilding the same parameters
 * yields the same ids (plan AC-5).
 */
import type { AssemblyKind } from '../../scene/types';
import { assertPartBudget } from './limits';
import {
  ASSEMBLY_DEFAULTS,
  type AssemblyParamsByKind,
  type KitchenBaseRunParams,
  type StairStraightParams,
  type WallCabinetParams,
  type WardrobeSectionParams,
} from './params';
import type { PartNode } from './partGraph';

/** Panel thickness used by the corpus-based assemblies (cm). */
export const PANEL_THICKNESS_CM = 2;
/** Kitchen top slab thickness (cm). */
export const TOP_THICKNESS_CM = 3;

const round = (value: number): number => Math.round(value * 1000) / 1000;

function kitchenBaseRun(params: KitchenBaseRunParams): PartNode[] {
  const { moduleCount, moduleWidthCm, heightCm, depthCm, plinthHeightCm, color: _color } = params;
  const parts: PartNode[] = [];

  const plinth = plinthHeightCm > 0 ? plinthHeightCm : 0;
  const corpusHeight = heightCm - plinth - TOP_THICKNESS_CM;
  const totalWidth = moduleCount * moduleWidthCm;
  const leftEdge = -totalWidth / 2;

  if (plinth > 0) {
    parts.push({
      id: 'kitchen-base-run-plinth',
      role: 'plinth',
      parentId: null,
      offset: [0, round(plinth / 2), 0],
      size: [round(totalWidth), round(plinth), round(depthCm)],
    });
  }

  for (let index = 0; index < moduleCount; index += 1) {
    const centreX = leftEdge + moduleWidthCm * (index + 0.5);
    parts.push({
      id: `kitchen-base-run-module-${index + 1}`,
      role: 'corpus',
      parentId: null,
      offset: [round(centreX), round(plinth + corpusHeight / 2), 0],
      size: [round(moduleWidthCm), round(corpusHeight), round(depthCm)],
    });
    parts.push({
      id: `kitchen-base-run-door-${index + 1}`,
      role: 'door',
      parentId: `kitchen-base-run-module-${index + 1}`,
      // Proud of the corpus face by half the door thickness.
      offset: [0, 0, round(depthCm / 2 + PANEL_THICKNESS_CM / 2)],
      size: [round(moduleWidthCm - 0.5), round(corpusHeight - 0.5), PANEL_THICKNESS_CM],
    });
  }

  parts.push({
    id: 'kitchen-base-run-top',
    role: 'top',
    parentId: null,
    offset: [0, round(heightCm - TOP_THICKNESS_CM / 2), 0],
    size: [round(totalWidth), TOP_THICKNESS_CM, round(depthCm)],
  });

  assertPartBudget(parts.length);
  return parts;
}

function wallCabinet(params: WallCabinetParams): PartNode[] {
  const { widthCm, heightCm, depthCm, doorCount, mountHeightCm, color: _color } = params;
  const parts: PartNode[] = [];

  parts.push({
    id: 'wall-cabinet-corpus',
    role: 'corpus',
    parentId: null,
    offset: [0, round(mountHeightCm + heightCm / 2), 0],
    size: [round(widthCm), round(heightCm), round(depthCm)],
  });

  const doorWidth = widthCm / doorCount;
  for (let index = 0; index < doorCount; index += 1) {
    const centreX = -widthCm / 2 + doorWidth * (index + 0.5);
    parts.push({
      id: `wall-cabinet-door-${index + 1}`,
      role: 'door',
      parentId: 'wall-cabinet-corpus',
      offset: [
        round(centreX),
        0,
        round(depthCm / 2 + PANEL_THICKNESS_CM / 2),
      ],
      size: [round(doorWidth - 0.5), round(heightCm - 0.5), PANEL_THICKNESS_CM],
    });
  }

  assertPartBudget(parts.length);
  return parts;
}

function wardrobeSection(params: WardrobeSectionParams): PartNode[] {
  const { widthCm, heightCm, depthCm, sectionCount, shelfCountPerSection, doorCount, color: _color } =
    params;
  const parts: PartNode[] = [];

  parts.push({
    id: 'wardrobe-section-corpus',
    role: 'corpus',
    parentId: null,
    offset: [0, round(heightCm / 2), 0],
    size: [round(widthCm), round(heightCm), round(depthCm)],
  });

  const innerWidth = widthCm - 2 * PANEL_THICKNESS_CM;
  const sectionWidth = innerWidth / sectionCount;

  // Dividers separate the sections; with one section there is nothing to divide.
  for (let index = 1; index < sectionCount; index += 1) {
    const centreX = -innerWidth / 2 + sectionWidth * index;
    parts.push({
      id: `wardrobe-section-divider-${index}`,
      role: 'divider',
      parentId: 'wardrobe-section-corpus',
      offset: [round(centreX), 0, 0],
      size: [PANEL_THICKNESS_CM, round(heightCm - 2 * PANEL_THICKNESS_CM), round(depthCm - 2)],
    });
  }

  // Shelves sit evenly inside each section, clear of the dividers.
  const shelfWidth = sectionWidth - PANEL_THICKNESS_CM;
  const innerHeight = heightCm - 2 * PANEL_THICKNESS_CM;
  for (let section = 0; section < sectionCount; section += 1) {
    const sectionCentreX = -innerWidth / 2 + sectionWidth * (section + 0.5);
    for (let shelf = 0; shelf < shelfCountPerSection; shelf += 1) {
      const y = -innerHeight / 2 + (innerHeight * (shelf + 1)) / (shelfCountPerSection + 1);
      parts.push({
        id: `wardrobe-section-shelf-${section + 1}-${shelf + 1}`,
        role: 'shelf',
        parentId: 'wardrobe-section-corpus',
        offset: [round(sectionCentreX), round(y), 0],
        size: [round(shelfWidth), PANEL_THICKNESS_CM, round(depthCm - 2)],
      });
    }
  }

  const doorWidth = widthCm / Math.max(doorCount, 1);
  for (let index = 0; index < doorCount; index += 1) {
    const centreX = -widthCm / 2 + doorWidth * (index + 0.5);
    parts.push({
      id: `wardrobe-section-door-${index + 1}`,
      role: 'door',
      parentId: 'wardrobe-section-corpus',
      offset: [round(centreX), 0, round(depthCm / 2 + PANEL_THICKNESS_CM / 2)],
      size: [round(doorWidth - 0.5), round(heightCm - 0.5), PANEL_THICKNESS_CM],
    });
  }

  assertPartBudget(parts.length);
  return parts;
}

function stairStraight(params: StairStraightParams): PartNode[] {
  const { stepCount, stepWidthCm, stepDepthCm, riseCm, stringerThicknessCm, color: _color } = params;
  const parts: PartNode[] = [];

  // Steps ascend along +Z and +Y from the origin. Each step occupies its own
  // slab of space, so neighbours touch but never overlap.
  for (let index = 0; index < stepCount; index += 1) {
    parts.push({
      id: `stair-straight-step-${index + 1}`,
      role: 'step',
      parentId: null,
      offset: [
        0,
        round(riseCm * index + riseCm / 2),
        round(stepDepthCm * index + stepDepthCm / 2),
      ],
      size: [round(stepWidthCm), round(riseCm), round(stepDepthCm)],
    });
  }

  // Two stringers flank the flight, outside the step width.
  const totalRun = stepCount * stepDepthCm;
  const totalRise = stepCount * riseCm;
  const stringerLength = Math.hypot(totalRun, totalRise);
  const angle = Math.atan2(totalRise, totalRun);
  for (const side of [-1, 1] as const) {
    parts.push({
      id: `stair-straight-stringer-${side === -1 ? 'left' : 'right'}`,
      role: 'stringer',
      parentId: null,
      offset: [
        round(side * (stepWidthCm / 2 + stringerThicknessCm / 2)),
        round(totalRise / 2),
        round(totalRun / 2),
      ],
      // A stringer is a plate rotated along the flight; its bounding box covers
      // the whole run so the containment/overlap rules stay meaningful.
      size: [round(stringerThicknessCm), round(totalRise), round(stringerLength * Math.cos(angle))],
    });
  }

  assertPartBudget(parts.length);
  return parts;
}

/** Build the part graph for `kind` from already-validated parameters. */
export function buildPartGraph<K extends AssemblyKind>(
  kind: K,
  params: AssemblyParamsByKind[K],
): PartNode[] {
  switch (kind) {
    case 'kitchen-base-run':
      return kitchenBaseRun(params as KitchenBaseRunParams);
    case 'wall-cabinet':
      return wallCabinet(params as WallCabinetParams);
    case 'wardrobe-section':
      return wardrobeSection(params as WardrobeSectionParams);
    case 'stair-straight':
      return stairStraight(params as StairStraightParams);
    default: {
      const exhaustive: never = kind;
      throw new Error(`Noma'lum assembly turi: ${String(exhaustive)}`);
    }
  }
}

/** Convenience for tests and callers that only have the kind. */
export function buildDefaultPartGraph(kind: AssemblyKind): PartNode[] {
  return buildPartGraph(kind, ASSEMBLY_DEFAULTS[kind] as never);
}
