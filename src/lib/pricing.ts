/**
 * Groq LLM pricing and cost calculation.
 *
 * Prices are per-token (converted from per-million-token rates).
 * Source: https://groq.com/pricing/
 */

interface ModelPricing {
  input: number;  // cost per token (USD)
  output: number; // cost per token (USD)
}

const PRICING: Record<string, ModelPricing> = {
  "llama-3.3-70b-versatile": {
    input: 0.59 / 1_000_000,
    output: 0.79 / 1_000_000,
  },
  "llama-3.1-8b-instant": {
    input: 0.05 / 1_000_000,
    output: 0.08 / 1_000_000,
  },
  "llama-3.1-70b-versatile": {
    input: 0.59 / 1_000_000,
    output: 0.79 / 1_000_000,
  },
};

// Default fallback pricing
const DEFAULT_PRICING: ModelPricing = PRICING["llama-3.3-70b-versatile"];

export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

/**
 * Calculate the USD cost for a given number of prompt and completion tokens.
 */
export function calculateCost(
  model: string,
  promptTokens: number,
  completionTokens: number
): CostBreakdown {
  const rates = PRICING[model] || DEFAULT_PRICING;
  const inputCost = promptTokens * rates.input;
  const outputCost = completionTokens * rates.output;
  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
  };
}
