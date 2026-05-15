/**
 * Approximate per-token pricing for cost estimation. These are rough at
 * any given moment — refresh from provider pricing pages before launch.
 * Values are USD per 1 million tokens.
 */

export interface ModelPricing {
  readonly promptPerMillion: number;
  readonly completionPerMillion: number;
}

const KNOWN_MODELS: Record<string, ModelPricing> = {
  'gpt-4o-mini': { promptPerMillion: 0.15, completionPerMillion: 0.6 },
  'gpt-4o': { promptPerMillion: 2.5, completionPerMillion: 10 },
  'gpt-4-turbo': { promptPerMillion: 10, completionPerMillion: 30 },
  'text-embedding-3-small': { promptPerMillion: 0.02, completionPerMillion: 0 },
  'text-embedding-3-large': { promptPerMillion: 0.13, completionPerMillion: 0 },
  'gemini-2.5-flash': { promptPerMillion: 0.3, completionPerMillion: 2.5 },
  'gemini-2.5-pro': { promptPerMillion: 1.25, completionPerMillion: 10 },
  'gemini-2.0-flash': { promptPerMillion: 0.1, completionPerMillion: 0.4 },
  'gemini-embedding-001': { promptPerMillion: 0.15, completionPerMillion: 0 },
  mock: { promptPerMillion: 0, completionPerMillion: 0 },
};

export function getModelPricing(model: string): ModelPricing {
  return (
    KNOWN_MODELS[model] ?? {
      promptPerMillion: 0,
      completionPerMillion: 0,
    }
  );
}

export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const price = getModelPricing(model);
  return (
    (promptTokens * price.promptPerMillion + completionTokens * price.completionPerMillion) /
    1_000_000
  );
}
