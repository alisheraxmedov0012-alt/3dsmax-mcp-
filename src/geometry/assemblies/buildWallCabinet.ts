/**
 * W14 — wall cabinet builder.
 *
 * A single corpus hung at `mountHeightCm` with door fronts. The defining rule is
 * the wall mount: no part may reach the floor, which the constraint layer
 * enforces before any geometry is created.
 */
import { assembleParts, type AssembleOptions, type BuiltAssembly } from './assembleParts';
import { checkContainment, checkNonOverlap, checkWallMount } from './constraints';
import { buildPartGraph } from './graph';
import { AssemblyError } from './limits';
import { validateAssemblyParams } from './params';
import type { WallCabinetParams } from './params';

export const WALL_CABINET = 'wall-cabinet' as const;

export function buildWallCabinet(
  params: WallCabinetParams,
  options: AssembleOptions = {},
): BuiltAssembly {
  // Defence in depth: the caller is expected to pass validated parameters, but a
  // hand-crafted object must still be refused rather than producing a degenerate
  // or empty construction.
  const checked = validateAssemblyParams(WALL_CABINET, params);
  if (checked === null) {
    throw new AssemblyError(
      'assembly_invalid_params',
      "Assembly parametrlari noto'g'ri yoki ruxsat etilgan oraliqdan tashqarida.",
    );
  }
  const nodes = buildPartGraph(WALL_CABINET, checked);

  const violations = [
    ...checkContainment(nodes),
    ...checkNonOverlap(nodes),
    ...checkWallMount(nodes, checked.mountHeightCm),
  ];
  if (violations.length > 0) {
    throw new AssemblyError('assembly_invalid_params', violations[0].message);
  }

  const doors = nodes.filter((node) => node.role === 'door').map((node) => node.id);
  const members = [
    {
      objectId: 'cabinet',
      label: 'Osma shkaf',
      partIds: ['wall-cabinet-corpus', ...doors],
    },
  ];

  return assembleParts(WALL_CABINET, nodes, members, checked.color, options);
}
