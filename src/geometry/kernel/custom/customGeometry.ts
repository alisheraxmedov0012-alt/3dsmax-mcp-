import * as THREE from 'three';
import type { CustomGeometryRecipe } from '../types';

function planarUv(positions: Float32Array): Float32Array {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[i + axis]);
      max[axis] = Math.max(max[axis], positions[i + axis]);
    }
  }
  const extents = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const axes = [0, 1, 2].sort(
    (left, right) => extents[right] - extents[left] || left - right,
  );
  const uAxis = axes[0];
  const vAxis = axes[1];
  const span = (axis: number): number => (extents[axis] > 1e-12 ? extents[axis] : 1);
  const uv = new Float32Array(positions.length / 3 * 2);
  for (let i = 0, j = 0; i < positions.length; i += 3, j += 2) {
    uv[j] = (positions[i + uAxis] - min[uAxis]) / span(uAxis);
    uv[j + 1] = (positions[i + vAxis] - min[vAxis]) / span(vAxis);
  }
  return uv;
}

/**
 * Build a custom BufferGeometry from raw data.
 *
 * Missing normals are computed when `computeNormals` is not false; missing UVs
 * use a simple planar XZ fallback so every kernel geometry remains UV-capable.
 * The fallback is metadata (`userData.uvSource`) rather than a claim of a proper
 * authored unwrap.
 */
export function createCustomGeometry(recipe: CustomGeometryRecipe): THREE.BufferGeometry {
  const positions = new Float32Array(recipe.positions);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  if (recipe.indices !== undefined) {
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(recipe.indices), 1));
  }

  if (recipe.normals !== undefined) {
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(recipe.normals), 3));
  } else if (recipe.computeNormals !== false) {
    geometry.computeVertexNormals();
  }

  if (recipe.uvs !== undefined) {
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(recipe.uvs), 2));
    geometry.userData.uvSource = 'provided';
  } else {
    geometry.setAttribute('uv', new THREE.BufferAttribute(planarUv(positions), 2));
    geometry.userData.uvSource = 'planar-fallback';
  }

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
