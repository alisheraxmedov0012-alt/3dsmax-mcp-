// @vitest-environment jsdom
/**
 * Stage 3.5 — budget dashboard shows real zeros for the offline parser and the
 * exact limits it enforces.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AiBudgetPanel } from './AiBudgetPanel';
import { BudgetStore, createMemoryBudgetStorage } from '../ai/budget';
import type { UsageRecord } from '../ai/budget';

const NOW = new Date('2026-02-10T08:00:00.000Z');

function makeStore(): BudgetStore {
  return new BudgetStore(createMemoryBudgetStorage(), () => NOW);
}

function addRecord(store: BudgetStore, overrides: Partial<UsageRecord> = {}): void {
  store.record({
    requestId: `req-${Math.random().toString(36).slice(2, 8)}`,
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
  });
}

function statValues(): string[] {
  return screen.getAllByRole('definition').map((node) => node.textContent ?? '');
}

afterEach(() => {
  cleanup();
});

describe('AiBudgetPanel - offline provider', () => {
  it('states that the offline parser uses no tokens and costs nothing', () => {
    render(<AiBudgetPanel store={makeStore()} />);

    expect(screen.getByRole('heading', { name: 'AI budjeti' })).toBeTruthy();
    expect(screen.getByText(/Offline parser — token ishlatilmaydi, xarajat 0\./)).toBeTruthy();
    expect(screen.getByText(/Offline parser · rule-based/)).toBeTruthy();
  });

  it('counts a request while keeping tokens and cost at zero', () => {
    const store = makeStore();
    addRecord(store);
    render(<AiBudgetPanel store={store} />);

    const values = statValues();
    expect(values[0]).toBe('1'); // requests
    expect(values[1]).toBe('0'); // tokens today
    expect(values[2]).toBe('0'); // tokens this month
    expect(values[3]).toBe('0.00 USD');
    expect(values[4]).toBe('0.00 USD');
  });

  it('shows the usage kind of the last request', () => {
    const store = makeStore();
    addRecord(store);
    render(<AiBudgetPanel store={store} />);

    expect(screen.getByText('token yo‘q')).toBeTruthy();
  });
});

describe('AiBudgetPanel - metered numbers', () => {
  it('shows tokens, cost and the actual usage kind', () => {
    const store = makeStore();
    addRecord(store, {
      requestId: 'metered-1',
      provider: 'cloud',
      model: 'model',
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      actualCost: 0.5,
      usageType: 'actual',
    });
    render(<AiBudgetPanel store={store} />);

    const values = statValues();
    expect(values[1]).toBe('1,500');
    expect(values[3]).toBe('0.5000 USD');
    expect(screen.getByText('aniq')).toBeTruthy();
  });

  it('warns when the daily token limit is reached', () => {
    const store = makeStore();
    store.updateSettings({ dailyTokenLimit: 100 });
    addRecord(store, { totalTokens: 100, inputTokens: 100, usageType: 'actual' });
    render(<AiBudgetPanel store={store} />);

    expect(screen.getByText('Kunlik token limiti tugadi.')).toBeTruthy();
  });
});

describe('AiBudgetPanel - settings', () => {
  it('saves limits through the store', () => {
    const store = makeStore();
    render(<AiBudgetPanel store={store} />);

    fireEvent.change(screen.getByLabelText('Kunlik token limiti'), {
      target: { value: '5000' },
    });
    fireEvent.change(screen.getByLabelText('Kunlik xarajat limiti'), { target: { value: '2.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Limitlarni saqlash' }));

    expect(store.getSnapshot().settings.dailyTokenLimit).toBe(5000);
    expect(store.getSnapshot().settings.dailyCostLimit).toBe(2.5);
    expect(screen.getByText('Limitlar saqlandi.')).toBeTruthy();
  });

  it('rejects a negative or fractional value without changing the settings', () => {
    const store = makeStore();
    const before = store.getSnapshot().settings;
    render(<AiBudgetPanel store={store} />);

    fireEvent.change(screen.getByLabelText('Kunlik token limiti'), { target: { value: '-5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Limitlarni saqlash' }));
    expect(store.getSnapshot().settings).toEqual(before);
    expect(screen.getByRole('status').textContent).toContain('0 yoki musbat son');

    fireEvent.change(screen.getByLabelText('Kunlik token limiti'), { target: { value: '10.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Limitlarni saqlash' }));
    expect(store.getSnapshot().settings.dailyTokenLimit).toBe(before.dailyTokenLimit);
    expect(screen.getByRole('status').textContent).toContain('butun son');
  });
});

describe('AiBudgetPanel - history and mobile', () => {
  it('lists the latest request with its operation', () => {
    const store = makeStore();
    addRecord(store, { requestId: 'edit-1', operation: 'edit' });
    render(<AiBudgetPanel store={store} />);

    expect(screen.getByText('tahrir')).toBeTruthy();
    expect(screen.getByText('bajarildi')).toBeTruthy();
  });

  it('exposes labelled, touch-friendly controls', () => {
    render(<AiBudgetPanel store={makeStore()} />);

    expect(document.querySelector('.budget')).not.toBeNull();
    const daily = screen.getByLabelText('Kunlik token limiti') as HTMLInputElement;
    expect(daily.inputMode).toBe('numeric');

    const cost = screen.getByLabelText('Oylik xarajat limiti') as HTMLInputElement;
    expect(cost.inputMode).toBe('decimal');
    expect(screen.getByRole('button', { name: 'Limitlarni saqlash' }).getAttribute('type')).toBe(
      'button',
    );
  });
});

describe('AiBudgetPanel - persistence failure', () => {
  it('warns when usage could not be stored', () => {
    const store = new BudgetStore(
      {
        read: () => null,
        write: () => {
          throw new Error('quota');
        },
      },
      () => NOW,
    );
    addRecord(store);
    render(<AiBudgetPanel store={store} />);

    expect(screen.getByRole('alert').textContent).toContain('saqlanmadi');
  });
});

describe('AiBudgetPanel - usage errors in the history', () => {
  it('marks a record whose usage could not be counted', () => {
    const store = makeStore();
    addRecord(store, {
      requestId: 'bad-usage',
      provider: 'cloud',
      model: 'model',
      errorCode: 'invalid_usage_data',
    });
    render(<AiBudgetPanel store={store} />);

    expect(screen.getByText('hisoblanmadi')).toBeTruthy();
    expect(screen.queryByText('token yo‘q')).toBeNull();
  });
});
