/**
 * W14 — runtime limits and errors for assemblies.
 *
 * These are the numbers the builder trusts. They are enforced at the boundary
 * (validation, graph construction) so a malformed or hand-edited scene cannot
 * exhaust memory.
 *
 * Keep `MAX_ASSEMBLIES_PER_SCENE` in step with the server:
 * `backend/app/services/scene_payload.py` stores the scene and applies the same
 * assembly cap. A backend test asserts the two values do not drift.
 */
import { MAX_ASSEMBLIES_PER_SCENE } from '../../scene/types';

export { MAX_ASSEMBLIES_PER_SCENE };

/**
 * Assemblies never nest: a construction is made of parts, not of other
 * assemblies. Depth 2 therefore means "assembly -> part"; anything deeper is a
 * malformed input, not a feature.
 */
export const MAX_ASSEMBLY_DEPTH = 2;

/** Upper bound on the parts one assembly may produce. */
export const MAX_PARTS_PER_ASSEMBLY = 500;

/** Upper bound on the member rows one assembly may expose. */
export const MAX_MEMBERS_PER_ASSEMBLY = 64;

export type AssemblyErrorCode =
  | 'assembly_too_many'
  | 'assembly_too_deep'
  | 'assembly_too_many_parts'
  | 'assembly_invalid_params'
  | 'assembly_unknown_kind';

/** A user-safe assembly failure. Messages never contain internals. */
export class AssemblyError extends Error {
  readonly code: AssemblyErrorCode;

  constructor(code: AssemblyErrorCode, message: string) {
    super(message);
    this.name = 'AssemblyError';
    this.code = code;
  }
}

export function assertAssemblyBudget(assemblies: unknown[]): void {
  if (assemblies.length > MAX_ASSEMBLIES_PER_SCENE) {
    throw new AssemblyError(
      'assembly_too_many',
      `Sahnada ${MAX_ASSEMBLIES_PER_SCENE} dan ortiq assembly bo'lishi mumkin emas.`,
    );
  }
}

export function assertPartBudget(partCount: number): void {
  if (partCount > MAX_PARTS_PER_ASSEMBLY) {
    throw new AssemblyError(
      'assembly_too_many_parts',
      `Bitta assembly ${MAX_PARTS_PER_ASSEMBLY} dan ortiq detal hosil qilishi mumkin emas.`,
    );
  }
}

export function assertMemberBudget(memberCount: number): void {
  if (memberCount > MAX_MEMBERS_PER_ASSEMBLY) {
    throw new AssemblyError(
      'assembly_too_many_parts',
      `Bitta assembly ${MAX_MEMBERS_PER_ASSEMBLY} dan ortiq a'zo hosil qilishi mumkin emas.`,
    );
  }
}

/**
 * Reject an attempt to nest an assembly inside another one.
 *
 * Assemblies are a flat list of parametric descriptions, so a reference to
 * another assembly inside the parameters is always malformed input. The walk is
 * depth-capped so a pathological payload cannot recurse without bound.
 */
export function assertNoNestedAssemblyRefs(params: unknown, depth = 0): void {
  if (depth > MAX_ASSEMBLY_DEPTH) {
    throw new AssemblyError('assembly_too_deep', 'Assembly parametrlari juda chuqur.');
  }
  if (Array.isArray(params)) {
    params.forEach((entry) => assertNoNestedAssemblyRefs(entry, depth + 1));
    return;
  }
  if (params === null || typeof params !== 'object') {
    return;
  }
  const record = params as Record<string, unknown>;
  if ('assemblyId' in record || 'assemblies' in record) {
    throw new AssemblyError(
      'assembly_too_deep',
      "Assembly ichida boshqa assembly'ga havola bo'lishi mumkin emas.",
    );
  }
  Object.values(record).forEach((value) => assertNoNestedAssemblyRefs(value, depth + 1));
}
