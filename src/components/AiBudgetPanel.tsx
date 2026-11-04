import { useState, useSyncExternalStore } from 'react';
import {
  CURRENT_PROVIDER,
  budgetStore,
  dayKey,
  monthKey,
  type BudgetSettings,
  type BudgetStore,
} from '../ai/budget';

interface AiBudgetPanelProps {
  /** Injection point for tests; production uses the app-wide store. */
  store?: BudgetStore;
}

interface LimitField {
  readonly key: keyof Pick<
    BudgetSettings,
    | 'dailyTokenLimit'
    | 'monthlyTokenLimit'
    | 'dailyCostLimit'
    | 'monthlyCostLimit'
    | 'perRequestTokenLimit'
  >;
  readonly label: string;
  readonly integer: boolean;
}

const LIMIT_FIELDS: readonly LimitField[] = [
  { key: 'dailyTokenLimit', label: 'Kunlik token limiti', integer: true },
  { key: 'monthlyTokenLimit', label: 'Oylik token limiti', integer: true },
  { key: 'perRequestTokenLimit', label: 'Bitta so‘rov uchun token limiti', integer: true },
  { key: 'dailyCostLimit', label: 'Kunlik xarajat limiti', integer: false },
  { key: 'monthlyCostLimit', label: 'Oylik xarajat limiti', integer: false },
];

function formatTokens(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(value));
}

function formatCost(value: number, currency: string): string {
  const digits = value > 0 && value < 1 ? 4 : 2;
  return `${value.toFixed(digits)} ${currency}`;
}

function percent(used: number, limit: number): number {
  if (limit <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((used / limit) * 100));
}

/**
 * Stage 3.5 — compact AI usage and budget dashboard.
 *
 * It reports what actually happened: the offline parser shows real zeros and
 * says so, and no cost is displayed for a model without a configured price.
 */
export function AiBudgetPanel({ store = budgetStore }: AiBudgetPanelProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const settings = snapshot.settings;
  const now = store.nowDate();
  const day = snapshot.daily[dayKey(now)];
  const month = snapshot.monthly[monthKey(now)];

  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const values: Record<string, string> = {};
    for (const field of LIMIT_FIELDS) {
      values[field.key] = String(settings[field.key]);
    }
    return values;
  });
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);

  const dailyTokens = day?.totalTokens ?? 0;
  const monthlyTokens = month?.totalTokens ?? 0;
  const dailyCost = day?.actualCost ?? 0;
  const monthlyCost = month?.actualCost ?? 0;
  // Newest first, without mutating the stored history.
  const recent = snapshot.history
    .slice(-5)
    .map((_, index, list) => list[list.length - 1 - index]);

  const saveSettings = () => {
    const patch: Record<string, number> = {};
    for (const field of LIMIT_FIELDS) {
      const raw = (draft[field.key] ?? '').trim();
      const value = Number(raw);
      if (raw === '' || !Number.isFinite(value) || value < 0) {
        setSettingsMessage(`"${field.label}" uchun 0 yoki musbat son kiriting.`);
        return;
      }
      if (field.integer && !Number.isInteger(value)) {
        setSettingsMessage(`"${field.label}" butun son bo‘lishi kerak.`);
        return;
      }
      patch[field.key] = value;
    }

    const result = store.updateSettings(patch);
    if (!result.ok) {
      setSettingsMessage('Limitlarni saqlab bo‘lmadi.');
      return;
    }
    setSettingsMessage('Limitlar saqlandi.');
  };

  return (
    <section className="budget" aria-labelledby="budget-title">
      <h2 className="budget__title" id="budget-title">
        AI budjeti
      </h2>
      <p className="budget__provider">
        {CURRENT_PROVIDER.label} · {CURRENT_PROVIDER.model}
      </p>
      {!CURRENT_PROVIDER.metered ? (
        <p className="budget__note">Offline parser — token ishlatilmaydi, xarajat 0.</p>
      ) : null}

      <dl className="budget__stats">
        <div>
          <dt>Bugungi so‘rovlar</dt>
          <dd>{day?.requests ?? 0}</dd>
        </div>
        <div>
          <dt>Bugungi tokenlar</dt>
          <dd>{formatTokens(dailyTokens)}</dd>
        </div>
        <div>
          <dt>Oylik tokenlar</dt>
          <dd>{formatTokens(monthlyTokens)}</dd>
        </div>
        <div>
          <dt>Bugungi xarajat</dt>
          <dd>{formatCost(dailyCost, settings.currency)}</dd>
        </div>
        <div>
          <dt>Oylik xarajat</dt>
          <dd>{formatCost(monthlyCost, settings.currency)}</dd>
        </div>
      </dl>

      {snapshot.lastError === 'usage_persistence_failed' ? (
        <p className="field__error" role="alert">
          Foydalanish statistikasi saqlanmadi — hisob faqat shu sessiyada.
        </p>
      ) : null}

      <div className="budget__limit">
        <span className="field__label">
          Kunlik token
          <span className="field__range">
            {formatTokens(dailyTokens)} / {formatTokens(settings.dailyTokenLimit)}
          </span>
        </span>
        <progress max={100} value={percent(dailyTokens, settings.dailyTokenLimit)} />
        {settings.dailyTokenLimit > 0 && dailyTokens >= settings.dailyTokenLimit ? (
          <p className="field__error" role="status">
            Kunlik token limiti tugadi.
          </p>
        ) : null}
      </div>

      <div className="budget__limit">
        <span className="field__label">
          Oylik token
          <span className="field__range">
            {formatTokens(monthlyTokens)} / {formatTokens(settings.monthlyTokenLimit)}
          </span>
        </span>
        <progress max={100} value={percent(monthlyTokens, settings.monthlyTokenLimit)} />
      </div>

      <fieldset className="budget__settings">
        <legend className="field__label">Limitlar</legend>
        {LIMIT_FIELDS.map((field) => (
          <div className="field" key={field.key}>
            <label className="field__label" htmlFor={`budget-${field.key}`}>
              {field.label}
            </label>
            <input
              id={`budget-${field.key}`}
              className="field__input"
              type="number"
              inputMode={field.integer ? 'numeric' : 'decimal'}
              min={0}
              step={field.integer ? 1 : 'any'}
              value={draft[field.key] ?? ''}
              onChange={(event) =>
                setDraft((previous) => ({ ...previous, [field.key]: event.target.value }))
              }
            />
          </div>
        ))}
        <button type="button" className="budget__save" onClick={saveSettings}>
          Limitlarni saqlash
        </button>
        {settingsMessage ? (
          <p className={settingsMessage === 'Limitlar saqlandi.' ? 'budget__saved' : 'field__error'} role="status">
            {settingsMessage}
          </p>
        ) : null}
      </fieldset>

      <div className="budget__history">
        <h3 className="budget__history-title">Oxirgi so‘rovlar</h3>
        {snapshot.history.length === 0 ? (
          <p className="budget__note">Hozircha so‘rov yo‘q.</p>
        ) : (
          <ul className="budget__list">
            {recent.map((record) => (
                <li key={record.requestId}>
                  <span>{record.timestamp.slice(11, 16)}</span>
                  <span>{record.operation === 'edit' ? 'tahrir' : 'yaratish'}</span>
                  <span>{record.status === 'success' ? 'bajarildi' : 'xato'}</span>
                  <span>{formatTokens(record.totalTokens)} token</span>
                  <span>
                    {record.errorCode === 'invalid_usage_data' ||
                    record.errorCode === 'provider_usage_unavailable'
                      ? 'hisoblanmadi'
                      : record.usageType === 'none'
                        ? 'token yo‘q'
                        : record.usageType === 'actual'
                          ? 'aniq'
                          : 'taxminiy'}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </div>
    </section>
  );
}
