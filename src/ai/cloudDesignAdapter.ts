import { api, describeError, type AiDesignResponse, type AiDesignSpec, type AiFurnitureType } from '../api/client';
import type { TableParams } from '../geometry/tableParams';
import { specToTableProposal, isSupportedFurnitureType } from './designSpec';
import { normalizeProposal } from './normalizeProposal';
import type { ProposalConfidence } from './types';

/**
 * Outcome of a cloud (server-side LLM) design request.
 *
 * - `applied`     — a validated, buildable spec; parameters are ready to apply.
 * - `unsupported` — the service understood the request but the furniture type is
 *                   not buildable yet (W2); nothing is applied.
 * - `unavailable` — the cloud provider could not be used (not signed in,
 *                   unconfigured, invalid output or network error). The caller
 *                   should fall back to the offline local analyzer.
 */
export interface AppliedDesign {
  kind: 'applied';
  params: TableParams;
  confidence: ProposalConfidence;
  notes: string[];
  warnings: string[];
  provider: string;
}

export interface UnsupportedDesign {
  kind: 'unsupported';
  furniture: AiFurnitureType;
  message: string;
}

export interface UnavailableDesign {
  kind: 'unavailable';
  reason: string;
}

export type CloudDesignOutcome = AppliedDesign | UnsupportedDesign | UnavailableDesign;

function unsupportedMessage(spec: AiDesignSpec): string {
  const label = spec.furniture;
  return (
    `"${label}" hozircha qo'llab-quvvatlanmaydi — hozir faqat stol yaratish mumkin ` +
    "(boshqa turlar W2 bosqichida qo'shiladi)."
  );
}

/**
 * Ask the backend AI provider for a design spec and turn the result into table
 * parameters. The provider and its API key live entirely on the server; nothing
 * secret is handled here.
 */
export async function generateDesignFromCloud(text: string): Promise<CloudDesignOutcome> {
  let response: AiDesignResponse;
  try {
    response = await api.aiDesign(text);
  } catch (error) {
    return { kind: 'unavailable', reason: describeError(error) };
  }

  const spec = response.spec;
  if (!spec.supported || !isSupportedFurnitureType(spec.furniture)) {
    return { kind: 'unsupported', furniture: spec.furniture, message: unsupportedMessage(spec) };
  }

  // Only buildable types reach here (currently `table`). `normalizeProposal`
  // clamps values into the supported ranges and re-validates via the geometry
  // layer, so a slightly-off LLM value cannot produce an invalid model.
  const normalized = normalizeProposal(specToTableProposal(spec));
  return {
    kind: 'applied',
    params: normalized.params,
    confidence: spec.confidence,
    notes: [...spec.notes, ...normalized.notes],
    warnings: [...spec.warnings, ...normalized.warnings],
    provider: response.provider,
  };
}
