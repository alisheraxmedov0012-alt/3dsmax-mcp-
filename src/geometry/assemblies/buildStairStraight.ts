/**
 * W14 — straight stair builder.
 *
 * Steps ascend along +Z and +Y from the origin, flanked by two stringers. The
 * safety range for the rise is a parameter concern (15–20 cm, see plan OD-4);
 * this builder only rejects constructions that cannot stand, not unusual ones.
 */
import { assembleParts, type AssembleOptions, type BuiltAssembly } from './assembleParts';
import { checkFloorContact, checkNonOverlap } from './constraints';
import { buildPartGraph } from './graph';
import { AssemblyError } from './limits';
import { validateAssemblyParams } from './params';
import type { StairStraightParams } from './params';

export const STAIR_STRAIGHT = 'stair-straight' as const;

export function buildStairStraight(
  params: StairStraightParams,
  options: AssembleOptions = {},
): BuiltAssembly {
  // Defence in depth: the caller is expected to pass validated parameters, but a
  // hand-crafted object must still be refused rather than producing a degenerate
  // or empty construction.
  const checked = validateAssemblyParams(STAIR_STRAIGHT, params);
  if (checked === null) {
    throw new AssemblyError(
      'assembly_invalid_params',
      "Assembly parametrlari noto'g'ri yoki ruxsat etilgan oraliqdan tashqarida.",
    );
  }
  const nodes = buildPartGraph(STAIR_STRAIGHT, checked);

  const violations = [...checkNonOverlap(nodes), ...checkFloorContact(nodes)];
  if (violations.length > 0) {
    throw new AssemblyError('assembly_invalid_params', violations[0].message);
  }

  const stepParts = nodes.filter((node) => node.role === 'step').map((node) => node.id);
  const stringerParts = nodes.filter((node) => node.role === 'stringer').map((node) => node.id);

  const members = [
    { objectId: 'flight', label: "Pog'onalar", partIds: stepParts },
    { objectId: 'stringers', label: 'Kosourlar', partIds: stringerParts },
  ];

  return assembleParts(STAIR_STRAIGHT, nodes, members, checked.color, options);
}
