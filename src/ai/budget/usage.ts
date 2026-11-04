/**
 * Stage 3.5 — turning provider metadata into a trustworthy usage record.
 *
 * A provider is never trusted to describe itself: every number is validated, and
 * a missing or contradictory report is recorded as "no usage" instead of being
 * filled in with guesses. Only a provider that reports real token counts is
 * labelled `actual`; `estimated` is reserved for values a caller explicitly
 * marked as such.
 */
import { CURRENT_PROVIDER, estimateCost, findModelPrice } from './pricing';
import type {
  BudgetErrorCode,
  BudgetOperation,
  ProviderUsage,
  UsageKind,
  UsageRecord,
  UsageStatus,
} from './types';

export interface UsageInput {
  readonly requestId: string;
  readonly timestamp: Date;
  readonly operation: BudgetOperation;
  readonly status: UsageStatus;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly usage?: ProviderUsage;
  readonly errorCode?: string;
}

export interface UsageOutcome {
  readonly record: UsageRecord;
  readonly error?: BudgetErrorCode;
}

function isTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function isCost(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isUsageKind(value: unknown): value is UsageKind {
  return value === 'actual' || value === 'estimated' || value === 'none';
}

function emptyRecord(
  input: UsageInput,
  provider: string,
  model: string,
  errorCode?: BudgetErrorCode,
): UsageRecord {
  return {
    requestId: input.requestId,
    timestamp: input.timestamp.toISOString(),
    provider,
    model,
    operation: input.operation,
    status: input.status,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    actualCost: 0,
    usageType: 'none',
    ...(errorCode ?? input.errorCode ? { errorCode: errorCode ?? input.errorCode } : {}),
  };
}

export function buildUsageRecord(input: UsageInput): UsageOutcome {
  const usage = input.usage;
  const provider = usage?.provider ?? input.providerId ?? CURRENT_PROVIDER.id;
  const model = usage?.model ?? input.modelId ?? CURRENT_PROVIDER.model;

  // A failed request consumed nothing we can verify.
  if (input.status === 'failure') {
    return { record: emptyRecord(input, provider, model) };
  }

  if (usage === undefined) {
    return { record: emptyRecord(input, provider, model) };
  }

  const declaredKind = usage.usageType;
  if (declaredKind !== undefined && !isUsageKind(declaredKind)) {
    return {
      record: emptyRecord(input, provider, model, 'invalid_usage_data'),
      error: 'invalid_usage_data',
    };
  }

  const hasInput = usage.inputTokens !== undefined;
  const hasOutput = usage.outputTokens !== undefined;
  const hasAnyTokens = hasInput || hasOutput || usage.totalTokens !== undefined;

  if (declaredKind === 'actual' && !hasAnyTokens) {
    // Claiming "actual" without numbers is not usable data.
    return {
      record: emptyRecord(input, provider, model, 'provider_usage_unavailable'),
      error: 'provider_usage_unavailable',
    };
  }

  if (
    (hasInput && !isTokenCount(usage.inputTokens)) ||
    (hasOutput && !isTokenCount(usage.outputTokens)) ||
    (usage.totalTokens !== undefined && !isTokenCount(usage.totalTokens)) ||
    (usage.actualCost !== undefined && !isCost(usage.actualCost))
  ) {
    return {
      record: emptyRecord(input, provider, model, 'invalid_usage_data'),
      error: 'invalid_usage_data',
    };
  }

  const inputTokens = hasInput ? (usage.inputTokens as number) : 0;
  const outputTokens = hasOutput ? (usage.outputTokens as number) : 0;
  const totalTokens =
    usage.totalTokens !== undefined ? usage.totalTokens : inputTokens + outputTokens;

  const usageType: UsageKind =
    declaredKind ?? (hasAnyTokens && totalTokens > 0 ? 'actual' : 'none');

  const price = findModelPrice(provider, model);
  const estimated = estimateCost(price, inputTokens, outputTokens);

  return {
    record: {
      requestId: input.requestId,
      timestamp: input.timestamp.toISOString(),
      provider,
      model,
      operation: input.operation,
      status: input.status,
      inputTokens,
      outputTokens,
      totalTokens,
      // No configured price means no cost claim, never an invented one.
      estimatedCost: estimated ?? 0,
      actualCost: usage.actualCost ?? 0,
      usageType,
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    },
  };
}
