/**
 * W15.9 — the mock edit provider.
 *
 * The panel talks to a provider rather than to the parser directly, so a real
 * provider can be plugged in later without touching the UI. Today the only
 * implementation is the deterministic rule-based parser: **no LLM and no paid
 * API is called**, and the UI says so.
 *
 * The provider is async so the panel has a genuine "working" state and so a
 * future network-backed provider keeps the same contract. It resolves on the
 * next microtask and never touches the scene.
 */
import type { AiEditOp } from '../scene/sceneDiff';
import type { SceneObject } from '../scene/types';
import {
  MAX_EDIT_PROMPT_LENGTH,
  parseEditCommand,
  type EditParseFailureReason,
} from './editCommandParser';

export interface EditProposalRequest {
  prompt: string;
  object: SceneObject;
}

export interface EditProposal {
  ops: AiEditOp[];
  notes: string[];
  providerId: string;
}

export type EditProviderErrorReason = EditParseFailureReason | 'render_failed';

export class EditProviderError extends Error {
  readonly reason: EditProviderErrorReason;

  constructor(reason: EditProviderErrorReason, message: string) {
    super(message);
    this.name = 'EditProviderError';
    this.reason = reason;
  }
}

export interface EditProposalProvider {
  readonly id: string;
  readonly label: string;
  propose(request: EditProposalRequest): Promise<EditProposal>;
}

export const MOCK_EDIT_PROVIDER_ID = 'mock-rule-based';

/**
 * Deterministic provider backed by `parseEditCommand`.
 *
 * Failure modes are typed, not thrown strings: the panel maps `reason` to text
 * and never shows a raw code.
 */
export const mockEditProvider: EditProposalProvider = {
  id: MOCK_EDIT_PROVIDER_ID,
  label: 'Mahalliy qoida (mock)',

  async propose({ prompt, object }: EditProposalRequest): Promise<EditProposal> {
    if (prompt.length > MAX_EDIT_PROMPT_LENGTH) {
      throw new EditProviderError(
        'too_long',
        `Buyruq ${MAX_EDIT_PROMPT_LENGTH} belgidan oshmasligi kerak.`,
      );
    }

    const parsed = parseEditCommand(prompt, object);
    if (!parsed.ok) {
      throw new EditProviderError(parsed.reason, parsed.message);
    }

    return { ops: parsed.ops, notes: parsed.notes, providerId: MOCK_EDIT_PROVIDER_ID };
  },
};
