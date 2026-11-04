/**
 * Stage 3.3 — intent generation service.
 *
 * The service owns the trust chain: prompt limits → provider → strict schema →
 * definition/parameter checks → `updateFurnitureSpec` (the only full validation
 * point) → canonical spec. It never touches the scene and never builds geometry;
 * the caller either dispatches the returned spec or nothing at all.
 */
import {
  canonicalizeFurnitureSpec,
  updateFurnitureSpec,
  type SpecUpdateErrorCode,
} from '../../scene/configurator';
import { getFurnitureDefinition } from '../../geometry/universal/registry';
import type { SceneSpec } from '../../scene/types';
import { BudgetGate, budgetGate } from '../budget/budget';
import { buildUsageRecord } from '../budget/usage';
import type { BudgetErrorCode, BudgetOperation } from '../budget/types';
import { detectLanguage, localIntentProvider } from './localProvider';
import { parseFurnitureIntentPayload } from './schema';
import {
  MAX_INTENT_PROMPT_LENGTH,
  type IntentFailureCode,
  type IntentGeneration,
  type IntentProvider,
} from './types';

export interface GenerateIntentOptions {
  readonly prompt: string;
  /** Editing mode: the selected object's definition. */
  readonly currentDefinitionId?: string;
  /** Editing mode: the spec the patch is applied over. */
  readonly currentSpec?: SceneSpec;
  /** Injected in tests; production uses the offline provider. */
  readonly provider?: IntentProvider;
  /** Budget gate to reserve against; defaults to the app-wide one. */
  readonly budget?: BudgetGate;
  /** Deterministic id (and clock) for tests. */
  readonly requestId?: string;
  readonly now?: () => Date;
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function error(
  message: string,
  code: IntentFailureCode,
  extra: readonly { code: IntentFailureCode; message: string }[] = [],
): IntentGeneration {
  return { kind: 'error', message, code, issues: extra.length > 0 ? extra : [{ code, message }] };
}

/** Spec-update codes are already the intent's vocabulary, except this pair. */
function toIntentCode(code: SpecUpdateErrorCode): IntentFailureCode {
  if (code === 'invalid_current_spec') {
    return 'invalid_spec';
  }
  if (code === 'unknown_preset') {
    return 'invalid_patch';
  }
  return code;
}

/**
 * Turns a natural-language prompt into a validated canonical spec.
 *
 * Uzbek, Russian and English are understood by the default offline provider. A
 * different (e.g. server-side) provider can be injected without changing the
 * validation path or the UI.
 */
export async function generateFurnitureIntent(
  options: GenerateIntentOptions,
): Promise<IntentGeneration> {
  const prompt = typeof options.prompt === 'string' ? options.prompt.trim() : '';
  const language = detectLanguage(prompt);
  const provider = options.provider ?? localIntentProvider;

  if (prompt === '') {
    return error("Matn bo'sh. Iltimos, mebel tavsifini kiriting.", 'empty_prompt');
  }
  if (prompt.length > MAX_INTENT_PROMPT_LENGTH) {
    return error(
      `Tavsif juda uzun (${MAX_INTENT_PROMPT_LENGTH} belgidan oshmasligi kerak).`,
      'prompt_too_long',
    );
  }

  const editing = options.currentDefinitionId !== undefined;
  let baseSpec: SceneSpec | null = null;
  if (editing) {
    // The current object must be a buildable universal object; otherwise the edit
    // has no trustworthy starting point.
    const current = canonicalizeFurnitureSpec(options.currentDefinitionId as string, options.currentSpec);
    if (!current.ok) {
      const first = current.issues[0];
      return {
        kind: 'error',
        message: first?.message ?? 'Tanlangan obyektning joriy holati noto‘g‘ri.',
        code: 'invalid_current_spec',
        issues: current.issues.map((issue) => ({
          code: 'invalid_current_spec' as const,
          message: issue.message,
        })),
      };
    }
    baseSpec = current.spec;
  }

  const gate = options.budget ?? budgetGate;
  const now = options.now ?? (() => new Date());
  const requestId = options.requestId ?? createRequestId();
  const operation: BudgetOperation = editing ? 'edit' : 'create';
  const metered = provider.metered === true;

  // The only check that runs before the provider: a denied request never reaches
  // it, and an offline (unmetered) request always passes.
  const decision = gate.reserve({ requestId, metered });
  if (!decision.allowed) {
    return error(
      decision.message ?? 'AI budjeti tugadi.',
      (decision.code ?? 'budget_exceeded') as IntentFailureCode,
    );
  }

  let generated;
  try {
    generated = await provider.generate(
      editing
        ? {
            prompt,
            language,
            currentDefinitionId: options.currentDefinitionId,
            currentSpec: baseSpec ?? undefined,
          }
        : { prompt, language },
    );
  } catch (cause) {
    gate.settle(requestId);
    try {
      gate.record(
        buildUsageRecord({
          requestId,
          timestamp: now(),
          operation,
          status: 'failure',
          providerId: provider.id,
          errorCode: 'provider_failed',
        }).record,
      );
    } catch {
      // Usage bookkeeping must never turn a provider failure into a crash.
    }
    return error(
      cause instanceof Error ? cause.message : 'AI xizmatida xatolik yuz berdi.',
      'provider_failed',
    );
  }
  gate.settle(requestId);

  // One record per request, written as soon as the provider has answered.
  const usageOutcome = buildUsageRecord({
    requestId,
    timestamp: now(),
    operation,
    status: generated.kind === 'error' ? 'failure' : 'success',
    providerId: provider.id,
    ...(generated.kind === 'intent' && generated.usage ? { usage: generated.usage } : {}),
    ...(generated.kind === 'error' ? { errorCode: generated.code } : {}),
  });
  // Recording problems are reported on the result, never merged into a provider
  // failure and never allowed to cancel the generation.
  let usageRecordFailure: BudgetErrorCode | undefined;
  try {
    const recorded = gate.record(usageOutcome.record);
    if (!recorded.ok) {
      usageRecordFailure = recorded.code ?? 'usage_persistence_failed';
    }
  } catch {
    usageRecordFailure = 'usage_persistence_failed';
  }

  if (generated.kind === 'error') {
    return error(generated.message, generated.code);
  }

  if (generated.kind === 'clarification') {
    const question = generated.question.trim();
    if (question === '') {
      return error('AI aniqlashtirish savolini qaytarmadi.', 'invalid_payload');
    }
    return {
      kind: 'clarification',
      question,
      language: generated.language ?? language,
      source: provider.id,
    };
  }

  const parsed = parseFurnitureIntentPayload(generated.payload);
  if (!parsed.ok) {
    const first = parsed.issues[0];
    return error(first?.message ?? 'AI javobi noto‘g‘ri.', first?.code ?? 'invalid_payload', parsed.issues);
  }

  const intent = parsed.intent;
  if (intent.clarificationRequired) {
    return {
      kind: 'clarification',
      question: intent.clarificationQuestion ?? 'Aniqlashtirish kerak.',
      language: intent.language,
      source: provider.id,
    };
  }

  if (editing && intent.definitionId !== options.currentDefinitionId) {
    // A provider (or a future model) must not switch the piece type behind an
    // edit; the user has to create a new object instead.
    return {
      kind: 'clarification',
      question:
        'Tahrirlashda mebel turi o‘zgarmaydi. Boshqa turdagi mebel kerak bo‘lsa, uni yangi mebel sifatida yarating.',
      language: intent.language,
      source: provider.id,
    };
  }

  const definition = getFurnitureDefinition(intent.definitionId);
  if (!definition) {
    return error(`Noma’lum definition: "${intent.definitionId}".`, 'unknown_definition');
  }

  const applied = updateFurnitureSpec(
    intent.definitionId,
    editing ? (baseSpec ?? definition.defaults) : definition.defaults,
    intent.patch,
  );
  if (!applied.ok) {
    const first = applied.issues[0];
    return {
      kind: 'error',
      message: first?.message ?? 'AI tavsiya qilgan qiymatlar qabul qilinmadi.',
      code: first ? toIntentCode(first.code) : 'invalid_patch',
      issues: applied.issues.map((issue) => ({
        code: toIntentCode(issue.code),
        message: issue.message,
        ...(issue.keys ? { keys: issue.keys } : {}),
      })),
    };
  }

  const usageError = usageOutcome.error ?? usageRecordFailure;
  return {
    kind: 'success',
    intent,
    spec: applied.spec,
    source: provider.id,
    usage: usageOutcome.record,
    ...(usageError ? { usageError } : {}),
  };
}
