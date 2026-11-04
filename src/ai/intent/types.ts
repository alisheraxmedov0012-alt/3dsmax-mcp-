/**
 * Stage 3.3 — structured furniture intent.
 *
 * This is the only shape the AI layer may produce: a definition id plus scalar
 * parameter values. It is *not* a scene object and never geometry — the
 * Configurator Core validates and canonicalises it before anything is applied.
 */
import type { SceneSpec } from '../../scene/types';
import type { BudgetErrorCode, ProviderUsage, UsageRecord } from '../budget/types';
export type IntentLanguage = 'uz' | 'ru' | 'en';

export type IntentPatchValue = string | number | boolean;

export interface FurnitureIntent {
  readonly definitionId: string;
  /** Values for parameters the definition declares; never a nested object. */
  readonly patch: Readonly<Record<string, IntentPatchValue>>;
  readonly language: IntentLanguage;
  readonly clarificationRequired: boolean;
  readonly clarificationQuestion?: string;
}

export type IntentFailureCode =
  | 'empty_prompt'
  | 'prompt_too_long'
  | 'provider_failed'
  | 'invalid_payload'
  | 'invalid_current_spec'
  | 'unknown_definition'
  | 'unknown_parameter'
  | 'invalid_value'
  | 'invalid_patch'
  | 'invalid_spec'
  | 'invalid_plan'
  | 'budget_exceeded'
  | 'request_token_limit_exceeded'
  | 'invalid_usage_data'
  | 'usage_persistence_failed'
  | 'provider_usage_unavailable';

export interface IntentIssue {
  readonly code: IntentFailureCode;
  readonly message: string;
  readonly keys?: readonly string[];
}

export type IntentPayloadResult =
  | { readonly ok: true; readonly intent: FurnitureIntent }
  | { readonly ok: false; readonly issues: readonly IntentIssue[] };

/** What a provider may tell the service. Payloads stay untrusted. */
export type IntentProviderResult =
  | {
      readonly kind: 'intent';
      readonly payload: unknown;
      /** Optional billing metadata; absent means "no usage to report". */
      readonly usage?: ProviderUsage;
    }
  | {
      readonly kind: 'clarification';
      readonly question: string;
      readonly language?: IntentLanguage;
    }
  | {
      readonly kind: 'error';
      readonly message: string;
      readonly code: IntentFailureCode;
    };

export interface IntentProviderRequest {
  readonly prompt: string;
  readonly language?: IntentLanguage;
  /** Editing mode: the type of the selected object (it must not change). */
  readonly currentDefinitionId?: string;
  /** Editing mode: the values a patch is applied over. */
  readonly currentSpec?: SceneSpec;
}

export interface IntentProvider {
  readonly id: string;
  /** True only for providers that bill per token. Offline parsers omit it. */
  readonly metered?: boolean;
  generate(request: IntentProviderRequest): Promise<IntentProviderResult>;
}

export type IntentGeneration =
  | {
      readonly kind: 'success';
      readonly intent: FurnitureIntent;
      /** Canonical spec, already validated by `updateFurnitureSpec`. */
      readonly spec: SceneSpec;
      readonly source: string;
      /** What this request cost; zeros with `usageType: 'none'` offline. */
      readonly usage?: UsageRecord;
      /** Set when the provider's usage report was unusable (request still ran). */
      readonly usageError?: BudgetErrorCode;
    }
  | {
      readonly kind: 'clarification';
      readonly question: string;
      readonly language: IntentLanguage;
      readonly source: string;
    }
  | {
      readonly kind: 'error';
      readonly message: string;
      readonly code: IntentFailureCode;
      readonly issues: readonly IntentIssue[];
    };

/** Longest user prompt the intent stage accepts (characters). */
export const MAX_INTENT_PROMPT_LENGTH = 600;
/** Upper bound on a patch produced by a provider. */
export const MAX_INTENT_PATCH_KEYS = 32;
export const MAX_INTENT_TEXT_LENGTH = 120;
