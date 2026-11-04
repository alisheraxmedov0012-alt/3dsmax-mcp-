import { describe, expect, it } from 'vitest';
import { getFurnitureParameters, updateFurnitureSpec } from '../../scene/configurator';
import { generateFurnitureIntent } from './service';
import type { SceneSpec } from '../../scene/types';
import { BudgetGate } from '../budget/budget';
import { BudgetStore, createMemoryBudgetStorage, dayKey } from '../budget/store';
import type { BudgetSettings, UsageRecord } from '../budget/types';
import type { IntentProvider, IntentProviderResult } from './types';

function provider(result: IntentProviderResult): IntentProvider {
  return { id: 'test-provider', generate: async () => result };
}

function payloadProvider(payload: unknown): IntentProvider {
  return provider({ kind: 'intent', payload });
}

describe('generateFurnitureIntent with the offline provider', () => {
  it('turns an Uzbek sentence into a canonical spec', async () => {
    const result = await generateFurnitureIntent({
      prompt: '160 sm uzunlikda, 70 sm chuqurlikda, 75 sm balandlikda kompyuter stoli yarat',
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.intent.definitionId).toBe('desk.computer');
    expect(result.spec.width).toBe(160);
    expect(result.spec.depth).toBe(70);
    expect(result.spec.height).toBe(75);
    // Canonical: every declared parameter is present, not just the patch.
    const parameters = getFurnitureParameters('desk.computer');
    expect(Object.keys(result.spec)).toHaveLength(parameters?.parameters.length ?? -1);
    expect(result.source).toBe('local-rule-based');
  });

  it('understands Russian and English prompts', async () => {
    const ru = await generateFurnitureIntent({
      prompt: 'Компьютерный стол шириной 160 см, глубиной 70 см',
    });
    expect(ru.kind).toBe('success');
    if (ru.kind === 'success') {
      expect(ru.intent.language).toBe('ru');
      expect(ru.spec.width).toBe(160);
    }

    const en = await generateFurnitureIntent({
      prompt: 'Create a computer desk 160 cm wide',
    });
    expect(en.kind).toBe('success');
    if (en.kind === 'success') {
      expect(en.intent.language).toBe('en');
      expect(en.spec.width).toBe(160);
    }
  });

  it('asks a question instead of guessing an ambiguous type', async () => {
    const result = await generateFurnitureIntent({ prompt: 'stol yarat' });
    expect(result.kind).toBe('clarification');
    if (result.kind !== 'clarification') return;
    expect(result.question).toContain('Kompyuter stoli');
  });
});

describe('generateFurnitureIntent limits and provider failures', () => {
  it('rejects an empty prompt', async () => {
    const result = await generateFurnitureIntent({ prompt: '   ' });
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.code).toBe('empty_prompt');
  });

  it('rejects an oversized prompt before calling the provider', async () => {
    let called = false;
    const spy: IntentProvider = {
      id: 'spy',
      generate: async () => {
        called = true;
        return { kind: 'error', code: 'provider_failed', message: 'should not run' };
      },
    };
    const result = await generateFurnitureIntent({ prompt: 'x'.repeat(700), provider: spy });
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.code).toBe('prompt_too_long');
    expect(called).toBe(false);
  });

  it('turns a thrown provider error into a clear failure', async () => {
    const result = await generateFurnitureIntent({
      prompt: 'kompyuter stoli',
      provider: {
        id: 'broken',
        generate: async () => {
          throw new Error('provider down');
        },
      },
    });
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.code).toBe('provider_failed');
    expect(result.message).toBe('provider down');
  });

  it('reports a clarification payload from the provider', async () => {
    const result = await generateFurnitureIntent({
      prompt: 'kompyuter stoli',
      provider: provider({ kind: 'clarification', question: 'Qaysi o‘lcham?' }),
    });
    expect(result.kind).toBe('clarification');
    if (result.kind !== 'clarification') return;
    expect(result.question).toBe('Qaysi o‘lcham?');
  });

  it('honours clarificationRequired from a payload', async () => {
    const result = await generateFurnitureIntent({
      prompt: 'kompyuter stoli',
      provider: payloadProvider({
        definitionId: 'desk.computer',
        patch: {},
        language: 'uz',
        clarificationRequired: true,
        clarificationQuestion: 'Kenglik qancha?',
      }),
    });
    expect(result.kind).toBe('clarification');
    if (result.kind !== 'clarification') return;
    expect(result.question).toBe('Kenglik qancha?');
  });
});

describe('generateFurnitureIntent validates every provider payload', () => {
  it('rejects an extra top-level field', async () => {
    const result = await generateFurnitureIntent({
      prompt: 'kompyuter stoli',
      provider: payloadProvider({
        definitionId: 'desk.computer',
        patch: { width: 170 },
        language: 'uz',
        clarificationRequired: false,
        object3d: {},
      }),
    });
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.code).toBe('invalid_payload');
  });

  it('rejects an undeclared parameter', async () => {
    const result = await generateFurnitureIntent({
      prompt: 'kompyuter stoli',
      provider: payloadProvider({
        definitionId: 'desk.computer',
        patch: { madeUp: 10 },
        language: 'uz',
        clarificationRequired: false,
      }),
    });
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.code).toBe('unknown_parameter');
  });

  it('runs the full Configurator Core validation', async () => {
    // Parseable payload, but the desk cannot be 10 cm wide.
    const result = await generateFurnitureIntent({
      prompt: 'kompyuter stoli',
      provider: payloadProvider({
        definitionId: 'desk.computer',
        patch: { width: 10 },
        language: 'uz',
        clarificationRequired: false,
      }),
    });
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.code).toBe('invalid_spec');
    expect(result.message).toContain('width');
  });

  it('returns the canonical spec for a valid payload', async () => {
    const result = await generateFurnitureIntent({
      prompt: 'kompyuter stoli',
      provider: payloadProvider({
        definitionId: 'desk.computer',
        patch: { width: 170, drawerEnabled: false },
        language: 'en',
        clarificationRequired: false,
      }),
    });
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.spec.width).toBe(170);
    expect(result.spec.drawerEnabled).toBe(false);
    expect(result.intent.language).toBe('en');
  });
});

describe('generateFurnitureIntent in editing mode', () => {
  function defaultsOf(definitionId: string) {
    const parameters = getFurnitureParameters(definitionId);
    if (!parameters) throw new Error(`no parameters for ${definitionId}`);
    return parameters.defaults;
  }

  function editOptions(prompt: string, currentSpec: SceneSpec = defaultsOf('desk.computer')) {
    return { prompt, currentDefinitionId: 'desk.computer', currentSpec };
  }

  it('applies a patch over the current spec and keeps every other value', async () => {
    const current = defaultsOf('desk.computer');
    const result = await generateFurnitureIntent(
      editOptions('Stol kengligini 180 sm qil', current),
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.spec.width).toBe(180);
    expect(result.spec.depth).toBe(current.depth);
    expect(result.spec.height).toBe(current.height);
    expect(result.spec.drawerEnabled).toBe(current.drawerEnabled);
  });

  it('understands relative edits in three languages', async () => {
    const current = defaultsOf('desk.computer');

    const uz = await generateFurnitureIntent(editOptions('Balandligini 5 sm oshir', current));
    expect(uz.kind).toBe('success');
    if (uz.kind === 'success') expect(uz.spec.height).toBe(80);

    const ru = await generateFurnitureIntent(editOptions('Уменьши ширину на 10 см', current));
    expect(ru.kind).toBe('success');
    if (ru.kind === 'success') expect(ru.spec.width).toBe(150);

    const en = await generateFurnitureIntent(editOptions('Make it 10 cm deeper', current));
    expect(en.kind).toBe('success');
    if (en.kind === 'success') expect(en.spec.depth).toBe(90);
  });

  it('asks instead of switching to another furniture type', async () => {
    const result = await generateFurnitureIntent(editOptions('shkaf yarat'));
    expect(result.kind).toBe('clarification');
  });

  it('rejects a value the Configurator Core refuses', async () => {
    const result = await generateFurnitureIntent(editOptions('kengligi 10 sm qil'));
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.code).toBe('invalid_spec');
    expect(result.message).toContain('width');
  });

  it('rejects an unusable current spec', async () => {
    const result = await generateFurnitureIntent(editOptions('kengligini 180 sm qil', { nope: 1 }));
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.code).toBe('invalid_current_spec');
  });

  it('blocks a provider that changes the definition behind an edit', async () => {
    const result = await generateFurnitureIntent({
      ...editOptions('kompyuter stoli'),
      provider: payloadProvider({
        definitionId: 'desk.gaming',
        patch: { width: 170 },
        language: 'uz',
        clarificationRequired: false,
      }),
    });

    expect(result.kind).toBe('clarification');
    if (result.kind !== 'clarification') return;
    expect(result.question).toContain('mebel turi');
  });

  it('applies a provider patch on top of the current spec, not the defaults', async () => {
    const current = updateFurnitureSpecDefaults('desk.computer', { width: 200 });
    const result = await generateFurnitureIntent({
      ...editOptions('kompyuter stoli', current),
      provider: payloadProvider({
        definitionId: 'desk.computer',
        patch: { drawerEnabled: false },
        language: 'uz',
        clarificationRequired: false,
      }),
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.spec.width).toBe(200);
    expect(result.spec.drawerEnabled).toBe(false);
  });

  function updateFurnitureSpecDefaults(
    definitionId: string,
    patch: Record<string, number | boolean>,
  ) {
    const defaults = defaultsOf(definitionId);
    const result = updateFurnitureSpec(definitionId, defaults, patch);
    if (!result.ok) throw new Error('unexpected validation failure');
    return result.spec;
  }
});

describe('generateFurnitureIntent with the budget layer', () => {
  const NOW = new Date('2026-02-10T08:00:00.000Z');

  function budgetFor(settings: Partial<BudgetSettings> = {}) {
    const store = new BudgetStore(createMemoryBudgetStorage(), () => NOW);
    if (Object.keys(settings).length > 0) {
      store.updateSettings(settings);
    }
    return { store, gate: new BudgetGate(store) };
  }

  const meteredProvider: IntentProvider = {
    id: 'test-metered',
    metered: true,
    generate: async () => ({
      kind: 'intent',
      payload: {
        definitionId: 'desk.computer',
        patch: { width: 170 },
        language: 'uz',
        clarificationRequired: false,
      },
      usage: {
        provider: 'test-metered',
        model: 'test-model',
        inputTokens: 100,
        outputTokens: 50,
        usageType: 'actual',
        actualCost: 0.01,
      },
    }),
  };

  it('records a zero-cost request for the offline provider', async () => {
    const { store, gate } = budgetFor();
    const result = await generateFurnitureIntent({
      prompt: 'kompyuter stoli 160 sm kenglikda',
      budget: gate,
      requestId: 'offline-create',
      now: () => NOW,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.usage?.usageType).toBe('none');
    expect(result.usage?.totalTokens).toBe(0);
    expect(result.usage?.estimatedCost).toBe(0);
    expect(result.usage?.actualCost).toBe(0);
    expect(result.usage?.operation).toBe('create');

    const bucket = store.getSnapshot().daily[dayKey(NOW)];
    expect(bucket?.requests).toBe(1);
    expect(bucket?.totalTokens).toBe(0);
  });

  it('marks an edit request as such', async () => {
    const { store, gate } = budgetFor();
    const result = await generateFurnitureIntent({
      prompt: 'Balandligini 5 sm oshir',
      currentDefinitionId: 'desk.computer',
      currentSpec: getFurnitureParameters('desk.computer')?.defaults,
      budget: gate,
      requestId: 'offline-edit',
      now: () => NOW,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.usage?.operation).toBe('edit');
    expect(store.getSnapshot().history[0].operation).toBe('edit');
  });

  it('records real token usage from a metered provider', async () => {
    const { store, gate } = budgetFor({
      dailyTokenLimit: 100_000,
      monthlyTokenLimit: 100_000,
      perRequestTokenLimit: 1_000,
      dailyCostLimit: 1,
      monthlyCostLimit: 1,
    });

    const result = await generateFurnitureIntent({
      prompt: 'kompyuter stoli',
      provider: meteredProvider,
      budget: gate,
      requestId: 'metered-1',
      now: () => NOW,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.usage?.usageType).toBe('actual');
    expect(result.usage?.totalTokens).toBe(150);
    expect(result.usage?.actualCost).toBe(0.01);
    expect(store.getSnapshot().daily[dayKey(NOW)]?.totalTokens).toBe(150);
  });

  it('refuses a metered request before the provider runs when the budget is closed', async () => {
    let called = false;
    const spy: IntentProvider = {
      id: 'test-metered',
      metered: true,
      generate: async () => {
        called = true;
        return { kind: 'error', code: 'provider_failed', message: 'must not run' };
      },
    };
    const { gate } = budgetFor();

    const result = await generateFurnitureIntent({
      prompt: 'kompyuter stoli',
      provider: spy,
      budget: gate,
      requestId: 'denied',
      now: () => NOW,
    });

    expect(called).toBe(false);
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.code).toBe('budget_exceeded');
  });

  it('records a failed provider call without consuming tokens', async () => {
    const { store, gate } = budgetFor();
    const result = await generateFurnitureIntent({
      prompt: 'kompyuter stoli',
      provider: {
        id: 'broken',
        generate: async () => {
          throw new Error('provider down');
        },
      },
      budget: gate,
      requestId: 'failed-1',
      now: () => NOW,
    });

    expect(result.kind).toBe('error');
    const entry: UsageRecord | undefined = store.getSnapshot().history[0];
    expect(entry?.status).toBe('failure');
    expect(entry?.totalTokens).toBe(0);
    expect(entry?.usageType).toBe('none');
  });

  it('keeps the generation result when usage cannot be persisted', async () => {
    const store = new BudgetStore(
      {
        read: () => null,
        write: () => {
          throw new Error('quota');
        },
      },
      () => NOW,
    );
    const gate = new BudgetGate(store);

    const result = await generateFurnitureIntent({
      prompt: 'kompyuter stoli 160 sm kenglikda',
      budget: gate,
      requestId: 'no-storage',
      now: () => NOW,
    });

    expect(result.kind).toBe('success');
    expect(store.getSnapshot().lastError).toBe('usage_persistence_failed');
  });
});

describe('generateFurnitureIntent - usage problems stay secondary', () => {
  const NOW = new Date('2026-02-10T08:00:00.000Z');
  const allowed = {
    dailyTokenLimit: 100_000,
    monthlyTokenLimit: 100_000,
    perRequestTokenLimit: 1_000,
    dailyCostLimit: 1,
    monthlyCostLimit: 1,
  };

  function budgetForUsageTest() {
    const store = new BudgetStore(createMemoryBudgetStorage(), () => NOW);
    store.updateSettings(allowed);
    return { store, gate: new BudgetGate(store) };
  }

  it('keeps the result and reports invalid provider usage', async () => {
    const { store, gate } = budgetForUsageTest();
    const result = await generateFurnitureIntent({
      prompt: 'kompyuter stoli',
      provider: {
        id: 'test-metered',
        metered: true,
        generate: async () => ({
          kind: 'intent',
          payload: {
            definitionId: 'desk.computer',
            patch: { width: 170 },
            language: 'uz',
            clarificationRequired: false,
          },
          usage: { inputTokens: -5 },
        }),
      },
      budget: gate,
      requestId: 'bad-usage',
      now: () => NOW,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.usageError).toBe('invalid_usage_data');
    expect(result.usage?.totalTokens).toBe(0);
    expect(store.getSnapshot().history[0].errorCode).toBe('invalid_usage_data');
  });

  it('reports an "actual" claim without token numbers', async () => {
    const { gate } = budgetForUsageTest();
    const result = await generateFurnitureIntent({
      prompt: 'kompyuter stoli',
      provider: {
        id: 'test-metered',
        metered: true,
        generate: async () => ({
          kind: 'intent',
          payload: {
            definitionId: 'desk.computer',
            patch: { width: 170 },
            language: 'uz',
            clarificationRequired: false,
          },
          usage: { usageType: 'actual' },
        }),
      },
      budget: gate,
      requestId: 'no-usage',
      now: () => NOW,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.usageError).toBe('provider_usage_unavailable');
  });

  it('has no usage warning for the offline provider', async () => {
    const { gate } = budgetForUsageTest();
    const result = await generateFurnitureIntent({
      prompt: 'kompyuter stoli 160 sm kenglikda',
      budget: gate,
      requestId: 'offline-clean',
      now: () => NOW,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.usageError).toBeUndefined();
  });
});

describe('generateFurnitureIntent - usage persistence failure', () => {
  const NOW = new Date('2026-02-11T09:00:00.000Z');

  function failingBudget() {
    return new BudgetGate(
      new BudgetStore(
        {
          read: () => null,
          write: () => {
            throw new Error('quota');
          },
        },
        () => NOW,
      ),
    );
  }

  it('keeps the created spec and reports the storage failure', async () => {
    const result = await generateFurnitureIntent({
      prompt: 'kompyuter stoli 160 sm kenglikda',
      budget: failingBudget(),
      requestId: 'persist-create',
      now: () => NOW,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.usageError).toBe('usage_persistence_failed');
    expect(result.spec.width).toBe(160);
    expect(result.intent.definitionId).toBe('desk.computer');
  });

  it('keeps the edited spec and reports the storage failure', async () => {
    const result = await generateFurnitureIntent({
      prompt: 'Balandligini 5 sm oshir',
      currentDefinitionId: 'desk.computer',
      currentSpec: getFurnitureParameters('desk.computer')?.defaults,
      budget: failingBudget(),
      requestId: 'persist-edit',
      now: () => NOW,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.usageError).toBe('usage_persistence_failed');
    expect(result.spec.height).toBe(80);
  });
});
