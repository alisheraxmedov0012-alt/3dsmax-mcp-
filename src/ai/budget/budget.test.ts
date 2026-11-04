import { describe, expect, it } from 'vitest';
import { BudgetGate } from './budget';
import { estimateCost, findModelPrice, type ModelPrice } from './pricing';
import { BudgetStore, createMemoryBudgetStorage } from './store';
import { buildUsageRecord } from './usage';
import { usageWarningMessage } from './messages';
import type { BudgetSettings, UsageRecord } from './types';

const NOW = new Date('2026-01-01T10:00:00.000Z');

function makeGate(settings: Partial<BudgetSettings> = {}) {
  const store = new BudgetStore(createMemoryBudgetStorage(), () => NOW);
  if (Object.keys(settings).length > 0) {
    store.updateSettings(settings);
  }
  return { store, gate: new BudgetGate(store) };
}

let requestCounter = 0;

function recordTokens(
  store: BudgetStore,
  totalTokens: number,
  actualCost = 0,
  timestamp = NOW.toISOString(),
): UsageRecord {
  requestCounter += 1;
  const record: UsageRecord = {
    requestId: `req-${requestCounter}`,
    timestamp,
    provider: 'test-provider',
    model: 'test-model',
    operation: 'create',
    status: 'success',
    inputTokens: totalTokens,
    outputTokens: 0,
    totalTokens,
    estimatedCost: 0,
    actualCost,
    usageType: 'actual',
  };
  store.record(record);
  return record;
}

describe('usage classification', () => {
  const base = {
    requestId: 'r1',
    timestamp: NOW,
    operation: 'create' as const,
    status: 'success' as const,
    providerId: 'local-rule-based',
    modelId: 'rule-based',
  };

  it('reports no usage for the offline provider', () => {
    const { record } = buildUsageRecord(base);

    expect(record.usageType).toBe('none');
    expect(record.inputTokens).toBe(0);
    expect(record.outputTokens).toBe(0);
    expect(record.totalTokens).toBe(0);
    expect(record.estimatedCost).toBe(0);
    expect(record.actualCost).toBe(0);
  });

  it('keeps real provider numbers and labels them actual', () => {
    const { record, error } = buildUsageRecord({
      ...base,
      providerId: 'cloud',
      modelId: 'cloud-model',
      usage: { inputTokens: 100, outputTokens: 50, actualCost: 0.25 },
    });

    expect(error).toBeUndefined();
    expect(record.totalTokens).toBe(150);
    expect(record.usageType).toBe('actual');
    expect(record.actualCost).toBe(0.25);
    // No configured price for this model: no estimated cost is invented.
    expect(record.estimatedCost).toBe(0);
  });

  it('keeps estimated usage separate from actual', () => {
    const { record } = buildUsageRecord({
      ...base,
      usage: { inputTokens: 10, outputTokens: 5, usageType: 'estimated' },
    });
    expect(record.usageType).toBe('estimated');
    expect(record.actualCost).toBe(0);
  });

  it.each([
    ['negative', -1],
    ['NaN', Number.NaN],
    ['fractional', 1.5],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('rejects a %s token count', (_label, value) => {
    const { record, error } = buildUsageRecord({
      ...base,
      usage: { inputTokens: value, outputTokens: 0 },
    });

    expect(error).toBe('invalid_usage_data');
    expect(record.totalTokens).toBe(0);
    expect(record.usageType).toBe('none');
  });

  it('flags an "actual" claim without numbers', () => {
    const { record, error } = buildUsageRecord({
      ...base,
      usage: { usageType: 'actual' },
    });
    expect(error).toBe('provider_usage_unavailable');
    expect(record.usageType).toBe('none');
  });

  it('records nothing for a failed request', () => {
    const { record } = buildUsageRecord({
      ...base,
      status: 'failure',
      usage: { inputTokens: 100, outputTokens: 100 },
    });
    expect(record.totalTokens).toBe(0);
    expect(record.usageType).toBe('none');
  });
});

describe('cost formula', () => {
  const price: ModelPrice = {
    providerId: 'cloud',
    modelId: 'model',
    inputPricePerMillion: 1,
    outputPricePerMillion: 2,
    currency: 'USD',
    enabled: true,
  };

  it('prices input and output separately per million tokens', () => {
    expect(estimateCost(price, 1_000_000, 500_000)).toBe(2);
    expect(estimateCost(price, 0, 0)).toBe(0);
  });

  it('returns null when no price is configured', () => {
    expect(estimateCost(null, 1000, 1000)).toBeNull();
    expect(findModelPrice('unknown-provider', 'unknown-model')).toBeNull();
  });

  it('has a zero price for the offline parser only', () => {
    const offline = findModelPrice('local-rule-based', 'rule-based');
    expect(offline?.inputPricePerMillion).toBe(0);
    expect(offline?.outputPricePerMillion).toBe(0);
  });
});

describe('budget gate', () => {
  it('never blocks the offline provider, even with no paid budget', () => {
    const { gate } = makeGate({
      dailyCostLimit: 0,
      monthlyCostLimit: 0,
      perRequestTokenLimit: 5,
      dailyTokenLimit: 5,
    });

    const decision = gate.reserve({ requestId: 'offline-1', metered: false });
    expect(decision.allowed).toBe(true);
    expect(gate.pendingTokens()).toBe(0);
  });

  it('refuses a metered request when the per-request allowance is zero', () => {
    const { gate } = makeGate({ perRequestTokenLimit: 0, dailyCostLimit: 10, monthlyCostLimit: 10 });
    const decision = gate.reserve({ requestId: 'm1', metered: true });

    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('request_token_limit_exceeded');
    expect(decision.limit).toBe('per_request');
  });

  it('refuses when the daily token limit would be crossed', () => {
    const { store, gate } = makeGate({
      dailyTokenLimit: 1000,
      perRequestTokenLimit: 400,
      dailyCostLimit: 10,
      monthlyCostLimit: 10,
    });
    recordTokens(store, 700);

    const decision = gate.reserve({ requestId: 'm1', metered: true });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('budget_exceeded');
    expect(decision.limit).toBe('daily_tokens');
  });

  it('refuses when the monthly token limit would be crossed', () => {
    const { store, gate } = makeGate({
      dailyTokenLimit: 100_000,
      monthlyTokenLimit: 1000,
      perRequestTokenLimit: 400,
      dailyCostLimit: 10,
      monthlyCostLimit: 10,
    });
    recordTokens(store, 700);

    const decision = gate.reserve({ requestId: 'm1', metered: true });
    expect(decision.allowed).toBe(false);
    expect(decision.limit).toBe('monthly_tokens');
  });

  it('refuses metered requests while the paid budget is zero', () => {
    const { gate } = makeGate({ dailyCostLimit: 0, monthlyCostLimit: 0 });
    const decision = gate.reserve({ requestId: 'm1', metered: true });

    expect(decision.allowed).toBe(false);
    expect(decision.limit).toBe('daily_cost');
  });

  it('refuses once the daily cost limit has been spent', () => {
    const { store, gate } = makeGate({ dailyCostLimit: 1, monthlyCostLimit: 10 });
    recordTokens(store, 100, 1);

    const decision = gate.reserve({ requestId: 'm1', metered: true });
    expect(decision.allowed).toBe(false);
    expect(decision.limit).toBe('daily_cost');
  });

  it('refuses once the monthly cost limit has been spent', () => {
    const { store, gate } = makeGate({ dailyCostLimit: 10, monthlyCostLimit: 1 });
    recordTokens(store, 100, 1);

    const decision = gate.reserve({ requestId: 'm1', metered: true });
    expect(decision.allowed).toBe(false);
    expect(decision.limit).toBe('monthly_cost');
  });

  it('keeps overlapping requests inside the limit through reservations', () => {
    const { gate } = makeGate({
      dailyTokenLimit: 900,
      perRequestTokenLimit: 500,
      dailyCostLimit: 10,
      monthlyCostLimit: 10,
    });

    expect(gate.reserve({ requestId: 'a', metered: true }).allowed).toBe(true);
    expect(gate.pendingTokens()).toBe(500);

    const second = gate.reserve({ requestId: 'b', metered: true });
    expect(second.allowed).toBe(false);
    expect(second.limit).toBe('daily_tokens');

    gate.settle('a');
    expect(gate.pendingTokens()).toBe(0);
    expect(gate.reserve({ requestId: 'b', metered: true }).allowed).toBe(true);
  });
});

describe('usage warning messages', () => {
  it('explains each usable failure in plain language', () => {
    expect(usageWarningMessage('invalid_usage_data')).toContain('haqiqiy sarf 0');
    expect(usageWarningMessage('provider_usage_unavailable')).toContain('hisobga olinmagan');
    expect(usageWarningMessage('usage_persistence_failed')).toContain('sessiyada');
  });

  it('has no message when there is no usage problem', () => {
    expect(usageWarningMessage(undefined)).toBeNull();
    expect(usageWarningMessage('budget_exceeded')).toBeNull();
  });

  it('keeps the reason on a zeroed record', () => {
    const { record } = buildUsageRecord({
      requestId: 'r-bad',
      timestamp: NOW,
      operation: 'create',
      status: 'success',
      providerId: 'cloud',
      modelId: 'model',
      usage: { inputTokens: -5 },
    });

    expect(record.totalTokens).toBe(0);
    expect(record.errorCode).toBe('invalid_usage_data');
  });
});
