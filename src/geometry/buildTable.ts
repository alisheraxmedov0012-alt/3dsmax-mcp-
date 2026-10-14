import * as THREE from 'three';
import type { TableParams } from './tableParams';

export const TABLE_TOP_THICKNESS_CM = 4;
export const TABLE_LEG_THICKNESS_CM = 6;

export interface BuiltTable {
  group: THREE.Group;
  dispose: () => void;
}

export interface TableMaterial {
  metalness?: number;
  roughness?: number;
}

/**
 * Builds a procedural table from parameters: one top slab and four legs.
 * The result is plain Three.js geometry/meshes (no WebGL renderer), so the
 * function stays in the geometry layer and can be tested without a browser.
 *
 * `material` optionally overrides the PBR metalness/roughness (Stage 6);
 * defaults preserve the Stage 1–5 appearance.
 */
export function buildTable(params: TableParams, material: TableMaterial = {}): BuiltTable {
  const { widthCm, heightCm, depthCm, color } = params;

  const group = new THREE.Group();
  group.name = 'table';

  const pbr = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: material.roughness ?? 0.6,
    metalness: material.metalness ?? 0.05,
  });
  const geometries: THREE.BufferGeometry[] = [];

  const topGeometry = new THREE.BoxGeometry(widthCm, TABLE_TOP_THICKNESS_CM, depthCm);
  geometries.push(topGeometry);
  const top = new THREE.Mesh(topGeometry, pbr);
  top.name = 'table-top';
  top.position.y = heightCm - TABLE_TOP_THICKNESS_CM / 2;
  top.castShadow = true;
  top.receiveShadow = true;
  group.add(top);

  const legHeight = Math.max(heightCm - TABLE_TOP_THICKNESS_CM, 1);
  const legGeometry = new THREE.BoxGeometry(
    TABLE_LEG_THICKNESS_CM,
    legHeight,
    TABLE_LEG_THICKNESS_CM,
  );
  geometries.push(legGeometry);

  const offsetX = Math.max(widthCm / 2 - TABLE_LEG_THICKNESS_CM / 2 - 1, 0);
  const offsetZ = Math.max(depthCm / 2 - TABLE_LEG_THICKNESS_CM / 2 - 1, 0);
  const corners: Array<[number, number]> = [
    [offsetX, offsetZ],
    [-offsetX, offsetZ],
    [offsetX, -offsetZ],
    [-offsetX, -offsetZ],
  ];

  corners.forEach(([x, z], index) => {
    const leg = new THREE.Mesh(legGeometry, pbr);
    leg.name = `table-leg-${index + 1}`;
    leg.position.set(x, legHeight / 2, z);
    leg.castShadow = true;
    leg.receiveShadow = true;
    group.add(leg);
  });

  return {
    group,
    dispose: () => {
      geometries.forEach((geometry) => geometry.dispose());
      pbr.dispose();
    },
  };
}
