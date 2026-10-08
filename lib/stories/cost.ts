/**
 * What a Stories Claude call cost, from its usage. Stories prices its own
 * models here because the shared helper (lib/anthropic-pricing.ts) prices
 * every Haiku at Haiku 4.5's $1/$5, ten times Haiku 5.5's list price.
 *
 * List prices per million tokens (claude-api reference, 2026-10-06):
 *   claude-haiku-5-5   $0.10 in, $0.50 out (prompts up to 100K tokens)
 *   claude-sonnet-5-5  $2 in, $10 out
 * Cache reads are 0.1× input; 1-hour cache writes 2× input, 5-minute 1.25×.
 */
import type Anthropic from '@anthropic-ai/sdk';

const RATES: Record<string, { input: number; output: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  // A refusal fallback may answer on Opus 5.5 ($4/$20).
  'claude-opus-5-5': { input: 4, output: 20 },
};

export type CallUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  usd: number;
};

/** Usage and price of one response. An unknown model throws: an unpriced call must not count as free. */
export function priceCall(model: string, usage: Anthropic.Message['usage'], cacheTtl: '5m' | '1h' = '1h'): CallUsage {
  const rate = RATES[model];
  if (!rate) throw new Error(`no Stories price for model ${model}`);
  const inputTokens = Math.max(0, usage.input_tokens ?? 0);
  const outputTokens = Math.max(0, usage.output_tokens ?? 0);
  const cacheReadTokens = Math.max(0, usage.cache_read_input_tokens ?? 0);
  const cacheWriteTokens = Math.max(0, usage.cache_creation_input_tokens ?? 0);
  const writeMultiplier = cacheTtl === '1h' ? 2 : 1.25;
  const usd = (inputTokens * rate.input + cacheReadTokens * rate.input * 0.1 + cacheWriteTokens * rate.input * writeMultiplier + outputTokens * rate.output) / 1_000_000;
  return { model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, usd: Math.round(usd * 1e8) / 1e8 };
}
