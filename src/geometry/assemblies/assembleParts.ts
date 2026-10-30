/**
 * W14 — shared assembly assembly (pun intended): part graph -> Three.js.
 *
 * Every kind produces the same shape, so the geometry plumbing lives here once
 * and each builder only describes its parts and its member grouping. This keeps
 * disposal, naming and part tagging identical across kinds, which the tests
 * rely on.
 *
 * A "member" is the unit a user would pick in the UI (a kitchen module, the
 * cabinet, the wardrobe, the stair). It is derived from the graph — nothing is
 * stored — which is what keeps the scene inside the server object budget.
 */
import * as THREE from 'three';
import { applyPhysicalBoxUvs } from '../../materials/uv';
import { AssemblyError, assertMemberBudget, assertPartBudget } from './limits';
import { absoluteCentre, type PartNode } from './partGraph';

export interface AssemblyMember {
  /** Stable member id, derived from the kind and index. */
  objectId: string;
  /** Human-readable group name used in the viewer hierarchy. */
  label: string;
  /** Part ids that belong to this member. */
  partIds: string[];
}

export interface BuiltAssembly {
  group: THREE.Group;
  members: Array<{ objectId: string; label: string; group: THREE.Group }>;
  dispose: () => void;
}

export interface AssembleOptions {
  metalness?: number;
  roughness?: number;
}

/**
 * Build a Three.js group from a part graph.
 *
 * Throws `AssemblyError` when a member references a part that does not exist,
 * so a coding mistake surfaces as a controlled failure instead of an invisible
 * mesh.
 */
export function assembleParts(
  kind: string,
  nodes: readonly PartNode[],
  members: readonly AssemblyMember[],
  color: string,
  options: AssembleOptions = {},
): BuiltAssembly {
  assertPartBudget(nodes.length);
  assertMemberBudget(members.length);

  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const member of members) {
    for (const partId of member.partIds) {
      if (!byId.has(partId)) {
        throw new AssemblyError(
          'assembly_invalid_params',
          `"${member.objectId}" a'zosi uchun "${partId}" qismi topilmadi.`,
        );
      }
    }
  }

  const group = new THREE.Group();
  group.name = `${kind}:assembly`;

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    metalness: options.metalness ?? 0.05,
    roughness: options.roughness ?? 0.6,
  });

  const geometries: THREE.BufferGeometry[] = [];
  const memberGroups: BuiltAssembly['members'] = [];

  for (const member of members) {
    const memberGroup = new THREE.Group();
    memberGroup.name = `${kind}:${member.objectId}`;
    memberGroup.userData.assemblyMemberId = member.objectId;

    for (const partId of member.partIds) {
      const part = byId.get(partId);
      if (!part) {
        continue;
      }
      const geometry = new THREE.BoxGeometry(
        Math.max(part.size[0], 0.1),
        Math.max(part.size[1], 0.1),
        Math.max(part.size[2], 0.1),
      );
      applyPhysicalBoxUvs(geometry, [
        Math.max(part.size[0], 0.1),
        Math.max(part.size[1], 0.1),
        Math.max(part.size[2], 0.1),
      ]);
      geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = partId;
      mesh.userData.partId = partId;
      mesh.userData.partRole = part.role;
      const centre = absoluteCentre(nodes, partId);
      // Member groups sit at the origin, so the part's absolute centre is its
      // position inside the member. Keeping one flat group per member keeps
      // selection and highlighting simple.
      mesh.position.set(centre[0], centre[1], centre[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      memberGroup.add(mesh);
    }

    group.add(memberGroup);
    memberGroups.push({ objectId: member.objectId, label: member.label, group: memberGroup });
  }

  return {
    group,
    members: memberGroups,
    dispose: () => {
      geometries.forEach((geometry) => geometry.dispose());
      material.dispose();
    },
  };
}
