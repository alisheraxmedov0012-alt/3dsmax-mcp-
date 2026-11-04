import { describe, expect, it } from 'vitest';
import {
  BudgetStore,
  MAX_USAGE_HISTORY,
  createMemoryBudgetStorage,
  dayKey,
  monthKey,
  normalizeBudgetSettings,
  normalizeUsageRecord,
} from './store';
import { DEFAULT_BUDGET_SETTINGS, type UsageRecord } from './types';

const NOW = new Date('2026-03-15T09:30:00.000Z');

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    requestId: 'req-1',
    timestamp: NOW.toISOString(),
    provider: 'local-rule-based',
    model: 'rule-based',
    operation: 'create',
    status: 'success',
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    actualCost: 0,
    usageType: 'none',
    ...overrides,
  };
}

describe('budget store persistence', () => {
  it('starts from safe defaults when nothing is stored', () => {
    const store = new BudgetStore(createMemoryBudgetStorage(), () => NOW);
    const snapshot = store.getSnapshot();

    expect(snapshot.settings).toEqual(DEFAULT_BUDGET_SETTINGS);
    expect(snapshot.history).toEqual([]);
    expect(snapshot.lastError).toBeNull();
  });

  it('persists settings and restores them in a new store', () => {
    const storage = createMemoryBudgetStorage();
    const first = new BudgetStore(storage, () => NOW);
    first.updateSettings({ dailyTokenLimit: 1234, dailyCostLimit: 5 });

    const second = new BudgetStore(storage, () => NOW);
    expect(second.getSnapshot().settings.dailyTokenLimit).toBe(1234);
    expect(second.getSnapshot().settings.dailyCostLimit).toBe(5);
  });

  it('restores usage buckets and history', () => {
    const storage = createMemoryBudgetStorage();
    const first = new BudgetStore(storage, () => NOW);
    first.record(record({ requestId: 'a' }));
    first.record(record({ requestId: 'b', operation: 'edit' }));

    const second = new BudgetStore(storage, () => NOW);
    const snapshot = second.getSnapshot();
    expect(snapshot.history).toHaveLength(2);
    expect(snapshot.daily[dayKey(NOW)]?.requests).toBe(2);
    expect(snapshot.monthly[monthKey(NOW)]?.requests).toBe(2);
  });

  it('falls back to defaults for corrupt or foreign documents', () => {
    const corrupt = new BudgetStore(createMemoryBudgetStorage('{not json'), () => NOW);
    expect(corrupt.getSnapshot().settings).toEqual(DEFAULT_BUDGET_SETTINGS);

    const foreign = new BudgetStore(
      createMemoryBudgetStorage(JSON.stringify({ version: 99, settings: { dailyTokenLimit: 1 } })),
      () => NOW,
    );
    expect(foreign.getSnapshot().settings.dailyTokenLimit).toBe(
      DEFAULT_BUDGET_SETTINGS.dailyTokenLimit,
    );
  });

  it('drops unreadable history entries but keeps the rest', () => {
    const storage = createMemoryBudgetStorage(
      JSON.stringify({
        version: 1,
        settings: DEFAULT_BUDGET_SETTINGS,
        history: [record(), { requestId: 'broken', inputTokens: -5 }],
        daily: {},
        monthly: {},
      }),
    );
    const store = new BudgetStore(storage, () => NOW);

    expect(store.getSnapshot().history.map((entry) => entry.requestId)).toEqual(['req-1']);
  });

  it('caps the stored history', () => {
    const store = new BudgetStore(createMemoryBudgetStorage(), () => NOW);
    for (let index = 0; index < MAX_USAGE_HISTORY + 5; index += 1) {
      store.record(record({ requestId: `r${index}` }));
    }

    expect(store.getSnapshot().history).toHaveLength(MAX_USAGE_HISTORY);
    expect(store.getSnapshot().history[0].requestId).toBe(`r5`);
  });

  it('never counts the same request twice', () => {
    const store = new BudgetStore(createMemoryBudgetStorage(), () => NOW);
    store.record(record({ requestId: 'once', totalTokens: 10 }));
    const second = store.record(record({ requestId: 'once', totalTokens: 10 }));

    expect(second.ok).toBe(true);
    expect(store.getSnapshot().history).toHaveLength(1);
    expect(store.getSnapshot().daily[dayKey(NOW)]?.requests).toBe(1);
    expect(store.getSnapshot().daily[dayKey(NOW)]?.totalTokens).toBe(10);
  });

  it('keeps the snapshot but reports a storage failure', () => {
    const store = new BudgetStore(
      {
        read: () => null,
        write: () => {
          throw new Error('quota');
        },
      },
      () => NOW,
    );

    const result = store.record(record({ requestId: 'lost' }));

    expect(result.ok).toBe(false);
    expect(result.code).toBe('usage_persistence_failed');
    expect(store.getSnapshot().lastError).toBe('usage_persistence_failed');
    // The in-memory view still reflects the request, so the UI does not lie.
    expect(store.getSnapshot().history).toHaveLength(1);
  });
});

describe('budget validation helpers', () => {
  it('replaces invalid limits with defaults', () => {
    const settings = normalizeBudgetSettings({
      dailyTokenLimit: -5,
      monthlyTokenLimit: 'many',
      dailyCostLimit: Number.NaN,
      monthlyCostLimit: 3,
      perRequestTokenLimit: 10,
      currency: '',
    });

    expect(settings.dailyTokenLimit).toBe(DEFAULT_BUDGET_SETTINGS.dailyTokenLimit);
    expect(settings.monthlyTokenLimit).toBe(DEFAULT_BUDGET_SETTINGS.monthlyTokenLimit);
    expect(settings.dailyCostLimit).toBe(DEFAULT_BUDGET_SETTINGS.dailyCostLimit);
    expect(settings.monthlyCostLimit).toBe(3);
    expect(settings.perRequestTokenLimit).toBe(10);
    expect(settings.currency).toBe(DEFAULT_BUDGET_SETTINGS.currency);
  });

  it('rejects an unreadable usage record', () => {
    expect(normalizeUsageRecord({ requestId: 'x' })).toBeNull();
    expect(normalizeUsageRecord(record({ totalTokens: -1 }))).toBeNull();
    expect(normalizeUsageRecord(record())).toEqual(record());
  });
});

describe('budget store - unreadable storage', () => {
  it('flags the failed read instead of presenting zeros as real', () => {
    const store = new BudgetStore(
      {
        read: () => {
          throw new Error('storage denied');
        },
        write: () => {},
      },
      () => NOW,
    );

    const snapshot = store.getSnapshot();
    expect(snapshot.lastError).toBe('usage_persistence_failed');
    expect(snapshot.history).toEqual([]);
    expect(snapshot.settings).toEqual(DEFAULT_BUDGET_SETTINGS);
  });

  it('clears the flag after the next successful write', () => {
    let deny = true;
    const store = new BudgetStore(
      {
        read: () => {
          if (deny) {
            throw new Error('storage denied');
          }
          return null;
        },
        write: () => {
          deny = false;
        },
      },
      () => NOW,
    );
    expect(store.getSnapshot().lastError).toBe('usage_persistence_failed');

    store.record(record({ requestId: 'after-recovery' }));

    expect(store.getSnapshot().lastError).toBeNull();
    expect(store.getSnapshot().history).toHaveLength(1);
  });
});
