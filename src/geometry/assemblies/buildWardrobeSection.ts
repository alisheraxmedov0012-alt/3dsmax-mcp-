/**
 * W14 — wardrobe section builder.
 *
 * One corpus divided into sections by vertical dividers, each section holding
 * the same number of shelves, with door fronts. Members: the corpus plus its
 * dividers/shelves as one selectable unit, and the doors as separate rows so a
 * workshop can treat them as a distinct order line.
 */
import { assembleParts, type AssembleOptions, type BuiltAssembly } from './assembleParts';
import { checkContainment, checkFloorContact, checkNonOverlap } from './constraints';
import { buildPartGraph } from './graph';
import { AssemblyError } from './limits';
import { validateAssemblyParams } from './params';
import type { WardrobeSectionParams } from './params';

export const WARDROBE_SECTION = 'wardrobe-section' as const;

export function buildWardrobeSection(
  params: WardrobeSectionParams,
  options: AssembleOptions = {},
): BuiltAssembly {
  // Defence in depth: the caller is expected to pass validated parameters, but a
  // hand-crafted object must still be refused rather than producing a degenerate
  // or empty construction.
  const checked = validateAssemblyParams(WARDROBE_SECTION, params);
  if (checked === null) {
    throw new AssemblyError(
      'assembly_invalid_params',
      "Assembly parametrlari noto'g'ri yoki ruxsat etilgan oraliqdan tashqarida.",
    );
  }
  const nodes = buildPartGraph(WARDROBE_SECTION, checked);

  const violations = [
    ...checkContainment(nodes),
    ...checkNonOverlap(nodes),
    ...checkFloorContact(nodes),
  ];
  if (violations.length > 0) {
    throw new AssemblyError('assembly_invalid_params', violations[0].message);
  }

  const bodyParts = nodes
    .filter((node) => node.role !== 'door')
    .map((node) => node.id);
  const doorParts = nodes.filter((node) => node.role === 'door').map((node) => node.id);

  const members = [
    { objectId: 'corpus', label: 'Shkaf korpusi', partIds: bodyParts },
    ...(doorParts.length > 0
      ? [{ objectId: 'doors', label: 'Eshiklar', partIds: doorParts }]
      : []),
  ];

  return assembleParts(WARDROBE_SECTION, nodes, members, checked.color, options);
}
