/**
 * W14 snapshot: the part structure of each assembly must be stable across
 * rebuilds and only change when the parameters change (plan AC-5).
 *
 * The snapshot is a compact table (id, role, size) rather than the whole
 * Three.js tree: it captures what a workshop would notice and stays readable in
 * review.
 */
import { describe, expect, it } from 'vitest';
import { ASSEMBLY_KINDS, type AssemblyKind } from '../../scene/types';
import { buildPartGraph } from './graph';
import { assemblyDefaults, validateAssemblyParams } from './params';

function table(kind: AssemblyKind): string {
  const params = validateAssemblyParams(kind, assemblyDefaults(kind));
  expect(params).not.toBeNull();
  if (!params) return '';
  return buildPartGraph(kind, params as never)
    .map((node) => `${node.id} [${node.role}] ${node.size.join('x')}`)
    .join('\n');
}

describe('W14 assembly part snapshots', () => {
  for (const kind of ASSEMBLY_KINDS) {
    it(`${kind}: default part structure`, () => {
      expect(table(kind)).toMatchSnapshot();
    });
  }

  it('is stable across two builds', () => {
    for (const kind of ASSEMBLY_KINDS) {
      expect(table(kind), kind).toBe(table(kind));
    }
  });
});
