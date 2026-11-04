/**
 * Stage 3.5 — AI usage and budget model.
 *
 * The shipped provider is the offline rule-based parser: it consumes no tokens
 * and costs nothing, so every number recorded for it is a real zero, not an
 * estimate. The types below keep "actual", "estimated" and "no usage" strictly
 * apart so a future metered provider cannot be mistaken for a free one.
 */
export type UsageKind = 'actual' | 'estimated' | 'none';

export type BudgetOperation = 'create' | 'edit';

export type UsageStatus = 'success' | 'failure';

export type BudgetErrorCode =
  | 'budget_exceeded'
  | 'request_token_limit_exceeded'
  | 'invalid_usage_data'
  | 'usage_persistence_failed'
  | 'provider_usage_unavailable';

export type BudgetLimitId =
  | 'per_request'
  | 'daily_tokens'
  | 'monthly_tokens'
  | 'daily_cost'
  | 'monthly_cost';

export interface BudgetSettings {
  readonly dailyTokenLimit: number;
  readonly monthlyTokenLimit: number;
  readonly dailyCostLimit: number;
  readonly monthlyCostLimit: number;
  readonly perRequestTokenLimit: number;
  readonly currency: string;
}

export const DEFAULT_BUDGET_SETTINGS: BudgetSettings = {
  dailyTokenLimit: 200_000,
  monthlyTokenLimit: 2_000_000,
  // No paid provider is enabled: any metered request is refused until a cost
  // budget is explicitly approved. The offline parser is unaffected.
  dailyCostLimit: 0,
  monthlyCostLimit: 0,
  perRequestTokenLimit: 20_000,
  currency: 'USD',
};

/** Usage metadata a provider may return; everything is optional. */
export interface ProviderUsage {
  readonly provider?: string;
  readonly model?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly actualCost?: number;
  readonly usageType?: UsageKind;
}

export interface UsageRecord {
  readonly requestId: string;
  readonly timestamp: string;
  readonly provider: string;
  readonly model: string;
  readonly operation: BudgetOperation;
  readonly status: UsageStatus;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  /** Cost computed from the configured price table (0 when none is known). */
  readonly estimatedCost: number;
  /** Cost reported by the provider; 0 means "none reported", never invented. */
  readonly actualCost: number;
  readonly usageType: UsageKind;
  readonly errorCode?: string;
}

export interface BudgetBucket {
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimatedCost: number;
  readonly actualCost: number;
}

export interface BudgetSnapshot {
  readonly settings: BudgetSettings;
  readonly history: readonly UsageRecord[];
  readonly daily: Readonly<Record<string, BudgetBucket>>;
  readonly monthly: Readonly<Record<string, BudgetBucket>>;
  readonly lastError: BudgetErrorCode | null;
}

export interface BudgetDecision {
  readonly allowed: boolean;
  readonly code?: BudgetErrorCode;
  readonly limit?: BudgetLimitId;
  readonly message?: string;
}

export interface BudgetRecordResult {
  readonly ok: boolean;
  readonly code?: BudgetErrorCode;
}
