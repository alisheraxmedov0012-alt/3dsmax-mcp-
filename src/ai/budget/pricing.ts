/**
 * Stage 3.5 — model price table.
 *
 * Prices live in configuration only, and only for models this build actually
 * runs. The offline parser is explicitly free; no cloud model is listed because
 * none is enabled and no price has been verified. `estimateCost` therefore can
 * never pretend to know what an unlisted model costs.
 */
export interface ModelPrice {
  readonly providerId: string;
  readonly modelId: string;
  readonly inputPricePerMillion: number;
  readonly outputPricePerMillion: number;
  readonly currency: string;
  readonly enabled: boolean;
}

export const MODEL_PRICES: readonly ModelPrice[] = [
  {
    providerId: 'local-rule-based',
    modelId: 'rule-based',
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
    currency: 'USD',
    enabled: true,
  },
];

export interface CurrentProvider {
  readonly id: string;
  readonly model: string;
  /** True only for providers that bill per token; the offline parser does not. */
  readonly metered: boolean;
  readonly label: string;
}

/** The provider this build ships with. */
export const CURRENT_PROVIDER: CurrentProvider = {
  id: 'local-rule-based',
  model: 'rule-based',
  metered: false,
  label: 'Offline parser',
};

export function findModelPrice(providerId: string, modelId: string): ModelPrice | null {
  return (
    MODEL_PRICES.find(
      (entry) =>
        entry.enabled && entry.providerId === providerId && entry.modelId === modelId,
    ) ?? null
  );
}

/** Cost for a token count pair, or null when no price is configured. */
export function estimateCost(
  price: ModelPrice | null,
  inputTokens: number,
  outputTokens: number,
): number | null {
  if (!price) {
    return null;
  }
  const cost =
    (inputTokens / 1_000_000) * price.inputPricePerMillion +
    (outputTokens / 1_000_000) * price.outputPricePerMillion;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
