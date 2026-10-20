// What the assistant's model calls cost, from Anthropic's list prices (US dollars per million tokens, as of
// 2026-10-06), so the admin console can show each question's cost and the month's total. Approximate: the
// bill is Anthropic's, and a model missing here is counted in tokens with no cost.

export interface ModelPrice {
  /** Uncached input. */
  input: number;
  output: number;
  /** Input read from the prompt cache. */
  cacheRead: number;
  /** Input written to the prompt cache (5-minute cache: 1.25 times input). */
  cacheWrite: number;
}

const price = (input: number, output: number, cacheRead = input / 10): ModelPrice => ({ input, output, cacheRead, cacheWrite: input * 1.25 });

export const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-fable-5-1': price(10, 50, 0.25),
  'claude-fable-5': price(10, 50),
  'claude-opus-5-5': price(4, 20, 0.2),
  'claude-opus-5': price(5, 25),
  'claude-opus-4-8': price(5, 25),
  'claude-opus-4-7': price(5, 25),
  'claude-opus-4-6': price(5, 25),
  'claude-sonnet-5-5': price(2, 10, 0.2),
  'claude-sonnet-5': price(2, 10),
  'claude-sonnet-4-6': price(3, 15),
  // Prompts up to 100K tokens; the assistant's stay well under that.
  'claude-haiku-5-5': price(0.1, 0.5),
  'claude-haiku-4-5': price(1, 5),
};

/**
 * A model's prices; a dated or suffixed id ("claude-haiku-4-5-20251001") counts as its family, and a context-window
 * tag ("claude-opus-5-5[1m]") is ignored.
 */
export function priceOf(id: string): ModelPrice | undefined {
  const model = id.replace(/\[[^\]]*\]$/, '');
  if (MODEL_PRICES[model]) return MODEL_PRICES[model];
  const family = Object.keys(MODEL_PRICES).filter((m) => model.startsWith(m + '-')).sort((a, b) => b.length - a.length)[0];
  return family ? MODEL_PRICES[family] : undefined;
}

/** One call's cost in dollars, from the API's usage counts; undefined for a model without a price. */
export function costOf(model: string, u: { input: number; cacheRead: number; cacheWrite: number; output: number }): number | undefined {
  const p = priceOf(model);
  if (!p) return undefined;
  return (u.input * p.input + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite + u.output * p.output) / 1_000_000;
}
