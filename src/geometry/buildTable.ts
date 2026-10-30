import * as THREE from 'three';
import { buildPbrMaterial } from '../materials/buildMaterial';
import type { MaterialSettingsInput } from '../materials/types';
import { applyPhysicalBoxUvs } from '../materials/uv';
import type { TableParams } from './tableParams';

export const TABLE_TOP_THICKNESS_CM = 4;
export const TABLE_LEG_THICKNESS_CM = 6;

export interface BuiltTable {
  group: THREE.Group;
  dispose: () => void;
}

/** Material override applied to the whole table (W4 PBR channels). */
export type TableMaterial = MaterialSettingsInput;

/**
 * Table parameters accepted by the builder. The four base dimensions are the
 * Stage 1 model; the W2 extras (top thickness, leg count) are optional and fall
 * back to the Stage 1 constants, so the original geometry is unchanged.
 */
export type TableBuildParams = TableParams & {
  topThicknessCm?: number;
  legCount?: number;
};

/** Clamps the table-top thickness to a positive, finite value below the height. */
function clampThickness(value: number | undefined, heightCm: number): number {
  const fallback = TABLE_TOP_THICKNESS_CM;
  const thickness =
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
  return Math.min(thickness, Math.max(heightCm - 1, 1));
}

/** Even leg count in 4..6; anything else falls back to four legs. */
function normalizeLegCount(value: number | undefined): number {
  if (value === 6) {
    return 6;
  }
  return 4;
}

/**
 * Builds a procedural table from parameters: one top slab and four (or six) legs.
 * The result is plain Three.js geometry/meshes (no WebGL renderer), so the
 * function stays in the geometry layer and can be tested without a browser.
 *
 * `material` optionally overrides the PBR channels (Stage 6 metalness/roughness,
 * extended in W4 with material type, opacity, texture scale and normal
 * strength); defaults preserve the Stage 1–5 appearance.
 */
export function buildTable(params: TableBuildParams, material: TableMaterial = {}): BuiltTable {
  const { widthCm, heightCm, depthCm, color } = params;
  const topThicknessCm = clampThickness(params.topThicknessCm, heightCm);
  const legCount = normalizeLegCount(params.legCount);

  const group = new THREE.Group();
  group.name = 'table';

  const built = buildPbrMaterial(color, material);
  const pbr = built.material;
  pbr.name = 'table-material';
  const geometries: THREE.BufferGeometry[] = [];

  const topGeometry = new THREE.BoxGeometry(widthCm, topThicknessCm, depthCm);
  applyPhysicalBoxUvs(topGeometry, [widthCm, topThicknessCm, depthCm]);
  geometries.push(topGeometry);
  const top = new THREE.Mesh(topGeometry, pbr);
  top.name = 'table-top';
  // Unique, stable part id (matches the name) so parts can be addressed
  // individually — e.g. W4 per-part materials. Other builders already do this.
  top.userData.partId = 'table-top';
  top.position.y = heightCm - topThicknessCm / 2;
  top.castShadow = true;
  top.receiveShadow = true;
  group.add(top);

  const legHeight = Math.max(heightCm - topThicknessCm, 1);
  const legGeometry = new THREE.BoxGeometry(
    TABLE_LEG_THICKNESS_CM,
    legHeight,
    TABLE_LEG_THICKNESS_CM,
  );
  applyPhysicalBoxUvs(legGeometry, [
    TABLE_LEG_THICKNESS_CM,
    legHeight,
    TABLE_LEG_THICKNESS_CM,
  ]);
  geometries.push(legGeometry);

  const offsetX = Math.max(widthCm / 2 - TABLE_LEG_THICKNESS_CM / 2 - 1, 0);
  const offsetZ = Math.max(depthCm / 2 - TABLE_LEG_THICKNESS_CM / 2 - 1, 0);
  // Legs are arranged in two rows (front/back); `legCount` is even so the columns
  // are evenly spaced. 4 legs reproduce the original four corners exactly.
  const columns = legCount / 2;
  const columnX: number[] = [];
  for (let i = 0; i < columns; i += 1) {
    const t = columns === 1 ? 0.5 : i / (columns - 1);
    columnX.push(-offsetX + t * (2 * offsetX));
  }
  const rowZ = [offsetZ, -offsetZ];

  let legIndex = 0;
  for (const z of rowZ) {
    for (const x of columnX) {
      legIndex += 1;
      const leg = new THREE.Mesh(legGeometry, pbr);
      leg.name = `table-leg-${legIndex}`;
      leg.userData.partId = `table-leg-${legIndex}`;
      leg.position.set(x, legHeight / 2, z);
      leg.castShadow = true;
      leg.receiveShadow = true;
      group.add(leg);
    }
  }

  return {
    group,
    dispose: () => {
      geometries.forEach((geometry) => geometry.dispose());
      built.dispose();
    },
  };
}
