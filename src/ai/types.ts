import type { TableParams } from '../geometry/tableParams';

export interface ModelGenerationRequest {
  text: string;
  /** Optional image file name. Real image→3D needs a selected AI service (not yet chosen). */
  imageFileName?: string;
}

export interface AiCapabilities {
  text: boolean;
  image: boolean;
}

export type ProposalConfidence = 'high' | 'medium' | 'low';

/**
 * Normalised result of a generation request: a valid parameter set for the
 * geometry layer plus human-readable notes and quality-control warnings.
 */
export interface ModelProposal {
  adapterId: string;
  params: TableParams;
  confidence: ProposalConfidence;
  notes: string[];
  warnings: string[];
}

/**
 * Abstraction over any AI model-generation service. Until a real service is
 * selected the project ships a local implementation; a future service only has
 * to implement this interface. No network or credentials are required here.
 */
export interface AiModelAdapter {
  readonly id: string;
  readonly capabilities: AiCapabilities;
  generate(request: ModelGenerationRequest): Promise<ModelProposal>;
}

export class AiAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiAdapterError';
  }
}
