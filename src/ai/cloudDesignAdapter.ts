import {
  ApiRequestError,
  api,
  describeError,
  type AiDesignResponse,
  type AiFurnitureType,
} from '../api/client';
import type { FurnitureParams } from '../geometry/furniture';
import type { MaterialPresetId } from '../materials/types';
import { specToFurnitureParams } from './designSpec';
import { presetIdForMaterialKind } from './materialKind';
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
  /**
   * PBR preset resolved from the AI's `material_kind`, or `null` when the AI
   * named no material (or one this build has no preset for). `null` means "keep
   * the default material".
   */
  materialPresetId: MaterialPresetId | null;
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

/**
 * The service could not answer *right now* — a transport failure, a deadline, a
 * throttle or a provider outage. The request itself was well formed, so the
 * caller may offer the offline analyzer instead.
 */
export interface UnavailableDesign {
  kind: 'unavailable';
  reason: string;
  /** Machine-readable cause: `timeout`, `network_error`, `busy`, `provider`, ... */
  code: string;
}

/**
 * The request was refused on its own merits: the allowance is spent, or the input
 * is invalid/unsupported. Falling back to the offline analyzer here would hide the
 * real reason, so the caller must show `message` and must not apply anything.
 */
export interface RejectedDesign {
  kind: 'rejected';
  message: string;
  code: string;
  /** HTTP status, or 0 for a transport-level refusal. */
  status: number;
}

export type CloudDesignOutcome =
  | AppliedDesign
  | UnsupportedDesign
  | UnavailableDesign
  | RejectedDesign;

/**
 * Whether a failed request is worth retrying with the offline analyzer.
 *
 * The split is about *why* the cloud could not answer, not about HTTP in general:
 *
 * - the service is unavailable for reasons that have nothing to do with this
 *   request (deadline, transport, throttle, provider outage, unconfigured) → the
 *   local analyzer is a legitimate substitute;
 * - the request was refused on its own merits (quota spent, input invalid) →
 *   substituting a different engine would conceal the reason the user needs to
 *   act on.
 */
function isServiceUnavailable(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) {
    // An unexpected client-side failure is treated as "try the offline path".
    return true;
  }
  if (error.status === 0) {
    // timeout / network / cancelled
    return true;
  }
  if (error.status === 429) {
    return true;
  }
  return error.status >= 500;
}

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
    const message = describeError(error);
    if (isServiceUnavailable(error)) {
      const code = error instanceof ApiRequestError ? error.code : 'unknown';
      return { kind: 'unavailable', reason: message, code };
    }
    return {
      kind: 'rejected',
      message,
      code: error instanceof ApiRequestError ? error.code : 'unknown',
      status: error instanceof ApiRequestError ? error.status : 0,
    };
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
    materialPresetId: presetIdForMaterialKind(built.materialKind),
    confidence: spec.confidence,
    notes: [...spec.notes, ...built.notes],
    warnings: [...spec.warnings, ...built.warnings],
    provider: response.provider,
  };
}
