/**
 * Stage 3.1 — shared spec buildability check.
 *
 * The plan pipeline materialises and disposes every part's geometry to prove the
 * budget, which costs ~8 ms per piece. Both scene validation (load/save) and the
 * configurator (one edit) ask the same question — "does this spec build?" — so the
 * answer is memoised here, keyed by `definitionId` + spec.
 *
 * Definitions are static for the life of the process, so a cached answer cannot
 * go stale. The canonical spec is frozen: a caller that mutated it would poison
 * the cache for every later object with the same key.
 */
import { tryCreateFurniturePlan } from '../../geometry/universal/plan';
import type { PlanIssue } from '../../geometry/universal/types';
import { normalizeSceneSpec, type SceneSpec } from '../types';

export type SpecBuildabilityResult =
  | { readonly ok: true; readonly spec: SceneSpec }
  | { readonly ok: false; readonly issues: readonly PlanIssue[] };

const MAX_CACHE_ENTRIES = 512;
const cache = new Map<string, SpecBuildabilityResult>();

/** Parses, solves, validates and canonicalises the spec in one memoised step. */
export function checkSpecBuildable(definitionId: string, spec: SceneSpec): SpecBuildabilityResult {
  const key = `${definitionId}|${JSON.stringify(spec)}`;
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const created = tryCreateFurniturePlan(definitionId, spec);
  let result: SpecBuildabilityResult;
  if (created.ok) {
    const canonical = normalizeSceneSpec(created.plan.spec);
    result = canonical
      ? { ok: true, spec: Object.freeze(canonical) }
      : {
          ok: false,
          issues: [
            {
              code: 'invalid_spec',
              message: `"${definitionId}": spec canonical shaklga keltirilmadi.`,
            },
          ],
        };
  } else {
    result = { ok: false, issues: created.issues };
  }

  if (cache.size >= MAX_CACHE_ENTRIES) {
    cache.clear();
  }
  cache.set(key, result);
  return result;
}
