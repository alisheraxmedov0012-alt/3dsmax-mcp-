/**
 * A3 — one entry point for "turn a prompt into a buildable design".
 *
 * Before this module the panel decided by itself whether to call the cloud, when
 * to fall back and what to say. That policy is domain logic, not presentation, so
 * it lives here once and is unit-tested without a DOM.
 *
 * Fallback rule (unchanged in intent, now applied to all eight types):
 *
 * - The service is *unavailable* (deadline, transport, throttle, provider
 *   outage, unconfigured) -> the offline analyzer may answer. It is a legitimate
 *   substitute for "not right now".
 * - The request was *refused on its merits* (quota spent, invalid input) or the
 *   spec is *unsupported* -> no substitution. A different engine would hide the
 *   reason the reader has to act on.
 *
 * The cloud path stays optional: a frontend-only build skips the request instead
 * of failing it first.
 */
import type { FurnitureParams, FurnitureType } from '../geometry/furniture/types';
import type { MaterialPresetId } from '../materials/types';
import { generateDesignFromCloud, type CloudDesignOutcome } from './cloudDesignAdapter';
import { localDesignAdapter, LOCAL_DESIGN_ADAPTER_ID } from './localDesignAdapter';
import { presetIdForMaterialKind } from './materialKind';
import { AiAdapterError, type DesignAdapter, type ProposalConfidence } from './types';

export interface GeneratedDesign {
  source: 'cloud' | 'local';
  furniture: FurnitureType;
  params: FurnitureParams;
  materialPresetId: MaterialPresetId | null;
  confidence: ProposalConfidence;
  notes: string[];
  warnings: string[];
  /** Provider id reported by the cloud, or the local adapter id. */
  provider: string;
  /** Set when `source` is `local` because the cloud could not answer. */
  fallbackReason?: string;
  /** Machine-readable cause of the fallback (`timeout`, `ai_unconfigured`, ...). */
  fallbackCode?: string;
}

export type DesignGeneration =
  | { kind: 'applied'; design: GeneratedDesign }
  | { kind: 'unsupported'; message: string; furniture: FurnitureType | null }
  | { kind: 'rejected'; message: string; code: string; status: number };

export interface GenerateDesignOptions {
  /**
   * False in a frontend-only build: the request is skipped rather than attempted
   * and failed. Defaults to true, matching the panel's historical behaviour.
   */
  backendConfigured?: boolean;
  /** Injection points for tests; production uses the real adapters. */
  cloud?: (text: string) => Promise<CloudDesignOutcome>;
  local?: DesignAdapter;
}

const EMPTY_PROMPT_MESSAGE = "Matn bo'sh. Iltimos, mebel tavsifini kiriting.";

function localDesign(
  text: string,
  adapter: DesignAdapter,
  fallback?: { reason: string; code: string },
): Promise<DesignGeneration> {
  return adapter.generate({ text }).then(
    (proposal): DesignGeneration => ({
      kind: 'applied',
      design: {
        source: 'local',
        furniture: proposal.furniture,
        params: proposal.params,
        materialPresetId: presetIdForMaterialKind(proposal.materialKind),
        confidence: proposal.confidence,
        notes: proposal.notes,
        warnings: proposal.warnings,
        provider: proposal.adapterId,
        ...(fallback ? { fallbackReason: fallback.reason, fallbackCode: fallback.code } : {}),
      },
    }),
    (error: unknown): DesignGeneration => {
      if (!(error instanceof AiAdapterError)) {
        throw error;
      }
      return {
        kind: 'unsupported',
        furniture: null,
        message: fallback ? `${fallback.reason} ${error.message}` : error.message,
      };
    },
  );
}

/**
 * Resolve a prompt into a design, preferring the server provider and falling back
 * to the offline analyzer only when the server is unavailable.
 */
export async function generateDesign(
  text: string,
  options: GenerateDesignOptions = {},
): Promise<DesignGeneration> {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { kind: 'rejected', message: EMPTY_PROMPT_MESSAGE, code: 'empty_prompt', status: 0 };
  }

  const local = options.local ?? localDesignAdapter;

  if (options.backendConfigured === false) {
    return localDesign(trimmed, local, {
      reason: 'Server AI bu versiyada sozlanmagan.',
      code: 'backend_missing',
    });
  }

  const cloud = options.cloud ?? generateDesignFromCloud;
  const outcome = await cloud(trimmed);

  if (outcome.kind === 'applied') {
    return {
      kind: 'applied',
      design: {
        source: 'cloud',
        furniture: outcome.furniture,
        params: outcome.params,
        materialPresetId: outcome.materialPresetId,
        confidence: outcome.confidence,
        notes: outcome.notes,
        warnings: outcome.warnings,
        provider: outcome.provider,
      },
    };
  }

  if (outcome.kind === 'unsupported') {
    return { kind: 'unsupported', furniture: outcome.furniture, message: outcome.message };
  }

  if (outcome.kind === 'rejected') {
    return {
      kind: 'rejected',
      message: outcome.message,
      code: outcome.code,
      status: outcome.status,
    };
  }

  return localDesign(trimmed, local, { reason: outcome.reason, code: outcome.code });
}

export { LOCAL_DESIGN_ADAPTER_ID };
