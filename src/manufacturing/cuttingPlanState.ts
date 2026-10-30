/**
 * Snapshot tag for the C7 result held by the manufacturing panel.
 *
 * A plan is valid only for the exact object and cut list it was computed from.
 * Tagging by object id alone kept a stale layout alive after a parameter or
 * material change, letting an old plan reach the PDF or ZIP.
 */
import type { CutListResult } from './cutList';
import type { CuttingPlan } from './cuttingPlan';

export interface TaggedCuttingPlan {
  objectId: string;
  cutList: CutListResult;
  plan: CuttingPlan;
}

export function currentCuttingPlan(
  state: TaggedCuttingPlan | null,
  objectId: string | null | undefined,
  cutList: CutListResult | null | undefined,
): CuttingPlan | null {
  if (!state || !objectId || !cutList) {
    return null;
  }
  return state.objectId === objectId && state.cutList === cutList ? state.plan : null;
}
