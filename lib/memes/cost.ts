/**
 * Spend for one Generate click (ME-62): models and the hard cap. A call that
 * could cross the cap is never made; the run stops with what it has.
 */
import { ratesForModel } from '@/lib/anthropic-pricing';

export type MemeModelConfig = { model: string; effort: 'low' | 'medium' | 'high'; maxTokens: number };

/** One setting per Claude stage, never hardcoded at the call site (the pattern of lib/social/pipeline/models.ts). */
export const MEME_MODELS = {
  /** meme-writer@3 step 1: the story's turns (UPGRADE_PLAN U1). */
  turns: { model: 'claude-sonnet-5-5', effort: 'medium', maxTokens: 6_000 },
  /** meme-writer@3 step 2: the memes, built on the kept turns. */
  writer: { model: 'claude-sonnet-5-5', effort: 'high', maxTokens: 8_000 },
  brief: { model: 'claude-sonnet-5-5', effort: 'medium', maxTokens: 8_000 },
} as const satisfies Record<string, MemeModelConfig>;

export const MEME_SPEND_CAP_USD = 0.25;
/** Kept back from every writer call for the Jev judges, so a run can always be judged (M4). */
export const JUDGE_RESERVE_USD = 0.02;

/** 1-hour cache writes cost twice the input rate; reads a tenth. */
const CACHE_WRITE_X = 2;
const CACHE_READ_X = 0.1;
const CHARS_PER_TOKEN = 3.5;

export class SpendCapReached extends Error {
  constructor(readonly spent: number, readonly next: number, readonly cap: number) {
    super(`Spend cap $${cap.toFixed(2)}: $${spent.toFixed(4)} spent, the next call could cost up to $${next.toFixed(4)}`);
  }
}

export class CostMeter {
  spent = 0;
  constructor(readonly cap: number = MEME_SPEND_CAP_USD) {}

  add(usd: number) {
    this.spent += usd;
  }

  /** Throws SpendCapReached when `worstCaseUsd` more would cross the cap. */
  ensure(worstCaseUsd: number) {
    if (this.spent + worstCaseUsd > this.cap) throw new SpendCapReached(this.spent, worstCaseUsd, this.cap);
  }
}

/**
 * The most a Claude call can cost: the cached prefix at the write rate the
 * first time in a run and the read rate after, the rest of the input at the
 * input rate, and every allowed output token.
 */
export function worstCaseCallUsd(cfg: MemeModelConfig, chars: { cachedPrefix: number; rest: number }, prefixAlreadyWritten: boolean): number {
  const r = ratesForModel(cfg.model);
  const prefix = (chars.cachedPrefix / CHARS_PER_TOKEN) * r.inputPerMtokUsd * (prefixAlreadyWritten ? CACHE_READ_X : CACHE_WRITE_X);
  const rest = (chars.rest / CHARS_PER_TOKEN) * r.inputPerMtokUsd;
  return (prefix + rest + cfg.maxTokens * r.outputPerMtokUsd) / 1_000_000;
}
