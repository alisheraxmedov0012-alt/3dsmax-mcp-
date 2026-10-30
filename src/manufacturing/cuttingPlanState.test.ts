import { describe, expect, it } from 'vitest';
import { currentCuttingPlan } from './cuttingPlanState';
import type { CutListResult } from './cutList';
import type { CuttingPlan } from './cuttingPlan';

const plan = { status: 'ok' } as CuttingPlan;
const cutListA = { rows: [] } as unknown as CutListResult;
const cutListB = { rows: [] } as unknown as CutListResult;
const tagged = { objectId: 'table-1', cutList: cutListA, plan };

describe('C7/C8 — cutting plan snapshot invalidation', () => {
  it('returns the plan only for the exact object and cut-list snapshot', () => {
    expect(currentCuttingPlan(tagged, 'table-1', cutListA)).toBe(plan);
  });

  it('rejects a plan after the cut list changes', () => {
    expect(currentCuttingPlan(tagged, 'table-1', cutListB)).toBeNull();
  });

  it('rejects a plan for another object or a missing selection', () => {
    expect(currentCuttingPlan(tagged, 'table-2', cutListA)).toBeNull();
    expect(currentCuttingPlan(tagged, null, cutListA)).toBeNull();
    expect(currentCuttingPlan(null, 'table-1', cutListA)).toBeNull();
  });
});
