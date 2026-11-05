/**
 * Phase 5.8 — BoxHelper lifecycle decision.
 *
 * `setScene` runs on every scene edit. Recreating the helper on each run churned
 * geometry/material allocations while the user dragged a slider, so the helper
 * is updated in place and only rebuilt when the selected object itself changes.
 */
export type SelectionHelperAction = 'none' | 'create' | 'update' | 'recreate' | 'dispose';

export function selectionHelperAction(
  currentTarget: object | null,
  nextTarget: object | null,
): SelectionHelperAction {
  if (nextTarget === null) {
    return currentTarget === null ? 'none' : 'dispose';
  }
  if (currentTarget === null) {
    return 'create';
  }
  return currentTarget === nextTarget ? 'update' : 'recreate';
}
