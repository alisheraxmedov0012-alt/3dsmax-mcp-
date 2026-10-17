/**
 * W14 — kitchen base run builder.
 *
 * A run is N modules placed edge to edge, each with a door, a shared top slab
 * and an optional plinth. Members are the modules (plus the top and plinth as
 * their own rows), which matches how a workshop reads the construction.
 */
import { assembleParts, type AssembleOptions, type BuiltAssembly } from './assembleParts';
import { checkAdjacency, checkContainment, checkFloorContact, checkNonOverlap } from './constraints';
import { buildPartGraph } from './graph';
import { AssemblyError } from './limits';
import { validateAssemblyParams } from './params';
import type { KitchenBaseRunParams } from './params';

export const KITCHEN_BASE_RUN = 'kitchen-base-run' as const;

export function buildKitchenBaseRun(
  params: KitchenBaseRunParams,
  options: AssembleOptions = {},
): BuiltAssembly {
  // Defence in depth: the caller is expected to pass validated parameters, but a
  // hand-crafted object must still be refused rather than producing a degenerate
  // or empty construction.
  const checked = validateAssemblyParams(KITCHEN_BASE_RUN, params);
  if (checked === null) {
    throw new AssemblyError(
      'assembly_invalid_params',
      "Assembly parametrlari noto'g'ri yoki ruxsat etilgan oraliqdan tashqarida.",
    );
  }
  const nodes = buildPartGraph(KITCHEN_BASE_RUN, checked);

  // Fail before geometry exists, so a caller never receives a half-built run.
  const violations = [
    ...checkContainment(nodes),
    ...checkNonOverlap(nodes),
    ...checkFloorContact(nodes),
  ];
  const modules = nodes.filter((node) => node.role === 'corpus');
  for (let index = 1; index < modules.length; index += 1) {
    violations.push(...checkAdjacency(nodes, modules[index - 1].id, modules[index].id, 0));
  }
  if (violations.length > 0) {
    throw new AssemblyError('assembly_invalid_params', violations[0].message);
  }

  const members = [
    ...modules.map((module, index) => ({
      objectId: `module-${index + 1}`,
      label: `Modul ${index + 1}`,
      partIds: [
        module.id,
        `kitchen-base-run-door-${index + 1}`,
      ],
    })),
    { objectId: 'top', label: 'Ustki panel', partIds: ['kitchen-base-run-top'] },
    ...(checked.plinthHeightCm > 0
      ? [{ objectId: 'plinth', label: 'Plintus', partIds: ['kitchen-base-run-plinth'] }]
      : []),
  ];

  return assembleParts(KITCHEN_BASE_RUN, nodes, members, checked.color, options);
}
