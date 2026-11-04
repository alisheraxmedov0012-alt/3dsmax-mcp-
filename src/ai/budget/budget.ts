/**
 * Stage 3.5 — the pre-flight budget gate.
 *
 * The gate runs *before* a provider is called. Metered requests reserve their
 * worst-case allowance first, so two overlapping requests cannot both slip under
 * a limit; the reservation is released when the request settles. Offline
 * requests claim no tokens and no money, so they are never blocked by a paid
 * budget.
 */
import { BudgetStore, createDefaultBudgetStorage, dayKey, monthKey } from './store';
import {
  type BudgetDecision,
  type BudgetErrorCode,
  type BudgetLimitId,
  type BudgetRecordResult,
  type UsageRecord,
} from './types';

function deny(
  code: BudgetErrorCode,
  limit: BudgetLimitId,
  message: string,
): BudgetDecision {
  return { allowed: false, code, limit, message };
}

export class BudgetGate {
  private readonly pending = new Map<string, number>();

  constructor(readonly store: BudgetStore) {}

  private pendingTotal(): number {
    let total = 0;
    for (const value of this.pending.values()) {
      total += value;
    }
    return total;
  }

  /**
   * Reserves room for one request. Returns `allowed: false` with the exact limit
   * that would be exceeded; nothing is reserved in that case.
   */
  reserve(request: { requestId: string; metered: boolean }): BudgetDecision {
    if (!request.metered) {
      // Offline parser: no tokens, no cost, nothing to check.
      return { allowed: true };
    }

    const snapshot = this.store.getSnapshot();
    const settings = snapshot.settings;
    const perRequest = Math.round(settings.perRequestTokenLimit);

    if (perRequest <= 0) {
      return deny(
        'request_token_limit_exceeded',
        'per_request',
        'Bitta so‘rov uchun token limiti 0 — pullik so‘rovlar o‘chirilgan.',
      );
    }

    const now = this.store.nowDate();
    const day = snapshot.daily[dayKey(now)]?.totalTokens ?? 0;
    const month = snapshot.monthly[monthKey(now)]?.totalTokens ?? 0;
    const pending = this.pendingTotal();

    if (day + pending + perRequest > settings.dailyTokenLimit) {
      return deny(
        'budget_exceeded',
        'daily_tokens',
        `Kunlik token limiti tugadi (${day + pending}/${settings.dailyTokenLimit}).`,
      );
    }
    if (month + pending + perRequest > settings.monthlyTokenLimit) {
      return deny(
        'budget_exceeded',
        'monthly_tokens',
        `Oylik token limiti tugadi (${month + pending}/${settings.monthlyTokenLimit}).`,
      );
    }

    const dailyCost = snapshot.daily[dayKey(now)]?.actualCost ?? 0;
    const monthlyCost = snapshot.monthly[monthKey(now)]?.actualCost ?? 0;

    if (settings.dailyCostLimit <= 0) {
      return deny(
        'budget_exceeded',
        'daily_cost',
        'Kunlik xarajat limiti 0 — pullik so‘rovlar o‘chirilgan.',
      );
    }
    if (settings.monthlyCostLimit <= 0) {
      return deny(
        'budget_exceeded',
        'monthly_cost',
        'Oylik xarajat limiti 0 — pullik so‘rovlar o‘chirilgan.',
      );
    }
    if (dailyCost >= settings.dailyCostLimit) {
      return deny(
        'budget_exceeded',
        'daily_cost',
        `Kunlik xarajat limiti tugadi (${dailyCost}/${settings.dailyCostLimit} ${settings.currency}).`,
      );
    }
    if (monthlyCost >= settings.monthlyCostLimit) {
      return deny(
        'budget_exceeded',
        'monthly_cost',
        `Oylik xarajat limiti tugadi (${monthlyCost}/${settings.monthlyCostLimit} ${settings.currency}).`,
      );
    }

    this.pending.set(request.requestId, perRequest);
    return { allowed: true };
  }

  /** Releases the reservation (always called, success or failure). */
  settle(requestId: string): void {
    this.pending.delete(requestId);
  }

  pendingTokens(): number {
    return this.pendingTotal();
  }

  record(entry: UsageRecord): BudgetRecordResult {
    return this.store.record(entry);
  }
}

/** Application-wide store and gate. */
export const budgetStore = new BudgetStore(createDefaultBudgetStorage());
export const budgetGate = new BudgetGate(budgetStore);
