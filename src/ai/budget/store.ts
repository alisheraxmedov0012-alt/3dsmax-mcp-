/**
 * Stage 3.5 — budget persistence.
 *
 * Settings, the daily/monthly aggregates and a bounded request history live in
 * one small document. It is additive: an older build simply ignores the key, and
 * a corrupt or missing document falls back to safe defaults instead of throwing.
 * Storage failures are reported (`usage_persistence_failed`) but never propagate
 * into the scene.
 */
import {
  DEFAULT_BUDGET_SETTINGS,
  type BudgetBucket,
  type BudgetErrorCode,
  type BudgetRecordResult,
  type BudgetSettings,
  type BudgetSnapshot,
  type UsageRecord,
} from './types';

export const BUDGET_STORAGE_KEY = '3d-studio-ai:ai-budget:v1';
export const MAX_USAGE_HISTORY = 500;
const STORAGE_VERSION = 1;

export interface BudgetStorage {
  read(): string | null;
  write(value: string): void;
}

export function createMemoryBudgetStorage(initial: string | null = null): BudgetStorage {
  let value = initial;
  return {
    read: () => value,
    write: (next) => {
      value = next;
    },
  };
}

/** Uses localStorage when the build runs in a browser, memory otherwise. */
export function createDefaultBudgetStorage(): BudgetStorage {
  const memory = createMemoryBudgetStorage();
  return {
    read: () => {
      if (typeof localStorage === 'undefined') {
        return memory.read();
      }
      // Let the store record an unreadable storage instead of silently showing
      // zeros: a failed read is not the same as "nothing was used".
      return localStorage.getItem(BUDGET_STORAGE_KEY);
    },
    write: (value) => {
      try {
        if (typeof localStorage === 'undefined') {
          memory.write(value);
          return;
        }
        localStorage.setItem(BUDGET_STORAGE_KEY, value);
      } catch {
        memory.write(value);
        throw new Error('budget storage unavailable');
      }
    },
  };
}

export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function limitValue(value: unknown, fallback: number): number {
  if (!isFiniteNumber(value) || value < 0) {
    return fallback;
  }
  return Math.round(value * 1000) / 1000;
}

export function normalizeBudgetSettings(value: unknown): BudgetSettings {
  const record =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    dailyTokenLimit: limitValue(record.dailyTokenLimit, DEFAULT_BUDGET_SETTINGS.dailyTokenLimit),
    monthlyTokenLimit: limitValue(
      record.monthlyTokenLimit,
      DEFAULT_BUDGET_SETTINGS.monthlyTokenLimit,
    ),
    dailyCostLimit: limitValue(record.dailyCostLimit, DEFAULT_BUDGET_SETTINGS.dailyCostLimit),
    monthlyCostLimit: limitValue(record.monthlyCostLimit, DEFAULT_BUDGET_SETTINGS.monthlyCostLimit),
    perRequestTokenLimit: limitValue(
      record.perRequestTokenLimit,
      DEFAULT_BUDGET_SETTINGS.perRequestTokenLimit,
    ),
    currency:
      typeof record.currency === 'string' && record.currency.trim() !== ''
        ? record.currency.trim().slice(0, 8)
        : DEFAULT_BUDGET_SETTINGS.currency,
  };
}

function emptyBucket(): BudgetBucket {
  return { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0, actualCost: 0 };
}

function addToBucket(bucket: BudgetBucket, record: UsageRecord): BudgetBucket {
  return {
    requests: bucket.requests + 1,
    inputTokens: bucket.inputTokens + record.inputTokens,
    outputTokens: bucket.outputTokens + record.outputTokens,
    totalTokens: bucket.totalTokens + record.totalTokens,
    estimatedCost: Math.round((bucket.estimatedCost + record.estimatedCost) * 1_000_000) / 1_000_000,
    actualCost: Math.round((bucket.actualCost + record.actualCost) * 1_000_000) / 1_000_000,
  };
}

function normalizeBucket(value: unknown): BudgetBucket | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const numbers = ['requests', 'inputTokens', 'outputTokens', 'totalTokens', 'estimatedCost', 'actualCost'];
  if (numbers.some((key) => !isFiniteNumber(record[key]) || (record[key] as number) < 0)) {
    return null;
  }
  return {
    requests: record.requests as number,
    inputTokens: record.inputTokens as number,
    outputTokens: record.outputTokens as number,
    totalTokens: record.totalTokens as number,
    estimatedCost: record.estimatedCost as number,
    actualCost: record.actualCost as number,
  };
}

function normalizeBuckets(value: unknown): Record<string, BudgetBucket> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const buckets: Record<string, BudgetBucket> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const bucket = normalizeBucket(entry);
    if (bucket) {
      buckets[key] = bucket;
    }
  }
  return buckets;
}

function isUsageKind(value: unknown): value is UsageRecord['usageType'] {
  return value === 'actual' || value === 'estimated' || value === 'none';
}

/** A stored record is kept only when every field can be trusted. */
export function normalizeUsageRecord(value: unknown): UsageRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const tokenFields = ['inputTokens', 'outputTokens', 'totalTokens', 'estimatedCost', 'actualCost'];
  if (tokenFields.some((key) => !isFiniteNumber(record[key]) || (record[key] as number) < 0)) {
    return null;
  }
  if (
    typeof record.requestId !== 'string' ||
    record.requestId === '' ||
    typeof record.timestamp !== 'string' ||
    typeof record.provider !== 'string' ||
    typeof record.model !== 'string' ||
    (record.operation !== 'create' && record.operation !== 'edit') ||
    (record.status !== 'success' && record.status !== 'failure') ||
    !isUsageKind(record.usageType)
  ) {
    return null;
  }
  return {
    requestId: record.requestId,
    timestamp: record.timestamp,
    provider: record.provider,
    model: record.model,
    operation: record.operation,
    status: record.status,
    inputTokens: record.inputTokens as number,
    outputTokens: record.outputTokens as number,
    totalTokens: record.totalTokens as number,
    estimatedCost: record.estimatedCost as number,
    actualCost: record.actualCost as number,
    usageType: record.usageType,
    ...(typeof record.errorCode === 'string' ? { errorCode: record.errorCode } : {}),
  };
}

interface StoredBudget {
  readonly version: number;
  readonly settings: BudgetSettings;
  readonly history: readonly UsageRecord[];
  readonly daily: Readonly<Record<string, BudgetBucket>>;
  readonly monthly: Readonly<Record<string, BudgetBucket>>;
}

function emptySnapshot(): BudgetSnapshot {
  return {
    settings: DEFAULT_BUDGET_SETTINGS,
    history: [],
    daily: {},
    monthly: {},
    lastError: null,
  };
}

function parseStored(text: string | null): BudgetSnapshot {
  if (text === null) {
    return emptySnapshot();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return emptySnapshot();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return emptySnapshot();
  }
  const document = parsed as Partial<StoredBudget>;
  if (document.version !== STORAGE_VERSION) {
    return emptySnapshot();
  }
  const history = Array.isArray(document.history)
    ? document.history
        .map(normalizeUsageRecord)
        .filter((entry): entry is UsageRecord => entry !== null)
        .slice(-MAX_USAGE_HISTORY)
    : [];
  return {
    settings: normalizeBudgetSettings(document.settings),
    history,
    daily: normalizeBuckets(document.daily),
    monthly: normalizeBuckets(document.monthly),
    lastError: null,
  };
}

export class BudgetStore {
  private snapshot: BudgetSnapshot;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly storage: BudgetStorage,
    private readonly now: () => Date = () => new Date(),
  ) {
    let snapshot: BudgetSnapshot;
    try {
      snapshot = parseStored(this.storage.read());
    } catch {
      // The saved counters could not be read; say so instead of presenting them
      // as real zeros.
      snapshot = { ...emptySnapshot(), lastError: 'usage_persistence_failed' };
    }
    this.snapshot = snapshot;
  }

  getSnapshot = (): BudgetSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  nowDate(): Date {
    return this.now();
  }

  updateSettings(
    patch: Partial<BudgetSettings>,
  ): { ok: boolean; code?: BudgetErrorCode; snapshot: BudgetSnapshot } {
    const next = normalizeBudgetSettings({ ...this.snapshot.settings, ...patch });
    this.snapshot = { ...this.snapshot, settings: next, lastError: null };
    const persisted = this.persist();
    return persisted.ok
      ? { ok: true, snapshot: this.snapshot }
      : { ok: false, code: persisted.code, snapshot: this.snapshot };
  }

  /** Records one request. The same requestId is never counted twice. */
  record(entry: UsageRecord): BudgetRecordResult {
    if (this.snapshot.history.some((item) => item.requestId === entry.requestId)) {
      return { ok: true };
    }

    const history = [...this.snapshot.history, entry].slice(-MAX_USAGE_HISTORY);
    const timestamp = new Date(entry.timestamp);
    const day = Number.isNaN(timestamp.getTime()) ? dayKey(this.now()) : dayKey(timestamp);
    const month = Number.isNaN(timestamp.getTime()) ? monthKey(this.now()) : monthKey(timestamp);

    const daily = { ...this.snapshot.daily };
    daily[day] = addToBucket(daily[day] ?? emptyBucket(), entry);
    const monthly = { ...this.snapshot.monthly };
    monthly[month] = addToBucket(monthly[month] ?? emptyBucket(), entry);

    this.snapshot = { ...this.snapshot, history, daily, monthly, lastError: null };
    const persisted = this.persist();
    return persisted.ok ? { ok: true } : { ok: false, code: persisted.code };
  }

  private persist(): { ok: boolean; code?: BudgetErrorCode } {
    const document: StoredBudget = {
      version: STORAGE_VERSION,
      settings: this.snapshot.settings,
      history: this.snapshot.history,
      daily: this.snapshot.daily,
      monthly: this.snapshot.monthly,
    };
    try {
      this.storage.write(JSON.stringify(document));
      return { ok: true };
    } catch {
      this.snapshot = { ...this.snapshot, lastError: 'usage_persistence_failed' };
      return { ok: false, code: 'usage_persistence_failed' };
    } finally {
      for (const listener of this.listeners) {
        listener();
      }
    }
  }
}
