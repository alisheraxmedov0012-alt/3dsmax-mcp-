import { api, describeError, type AiDesignResponse, type AiFurnitureType } from '../api/client';
import type { FurnitureParams } from '../geometry/furniture';
import { specToFurnitureParams } from './designSpec';
import type { ProposalConfidence } from './types';

/**
 * Outcome of a cloud (server-side LLM) design request.
 *
 * - `applied`     — a validated, buildable spec. `params` belong to `furniture`;
 *                   the caller creates a NEW object of that type. W13 never
 *                   mutates an existing object.
 * - `unsupported` — the service understood the request but this build cannot
 *                   build that type. Nothing is applied.
 * - `unavailable` — the cloud provider could not be used (not signed in,
 *                   unconfigured, invalid output, ambiguous prompt or network
 *                   error). The caller may fall back to the offline analyzer.
 */
export interface AppliedDesign {
  kind: 'applied';
  furniture: AiFurnitureType;
  params: FurnitureParams;
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

function unsupportedMessage(furniture: AiFurnitureType): string {
  return `"${furniture}" turini bu versiya qura olmaydi — model o'zgartirilmadi.`;
}

/**
 * Ask the backend AI provider for a design spec and turn the result into
 * geometry parameters for that spec's type.
 *
 * The provider and its API key live entirely on the server; nothing secret is
 * handled here.
 */
export async function generateDesignFromCloud(text: string): Promise<CloudDesignOutcome> {
  let response: AiDesignResponse;
  try {
    response = await api.aiDesign(text);
  } catch (error) {
    return { kind: 'unavailable', reason: describeError(error) };
  }

  const spec = response.spec;
  if (!spec.supported) {
    return {
      kind: 'unsupported',
      furniture: spec.furniture,
      message: unsupportedMessage(spec.furniture),
    };
  }

  const built = specToFurnitureParams(spec);
  if (!built) {
    // The geometry layer refused the parameters. Nothing is applied.
    return {
      kind: 'unsupported',
      furniture: spec.furniture,
      message: `"${spec.furniture}" uchun parametrlar tekshiruvdan o'tmadi — model yaratilmadi.`,
    };
  }

  return {
    kind: 'applied',
    furniture: built.type as AiFurnitureType,
    params: built.params,
    confidence: spec.confidence,
    notes: [...spec.notes, ...built.notes],
    warnings: [...spec.warnings, ...built.warnings],
    provider: response.provider,
  };
}
