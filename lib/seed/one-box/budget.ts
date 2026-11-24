import { DRAFTING_PRICE_SNAPSHOT } from '@/lib/drafting/cost';
import { priceAnthropicUsage } from '@/lib/anthropic-pricing';
import { B6_MODEL } from '@/lib/reels/config';

import type { SeedVerticalKey } from './types';

/**
 * The one-box spend ledger (design 2026-11-04-one-box-seeding-design, section 5). 35 cents is a hard stop: before each billable
 * call the worst case is checked against what is left, and a call that might pass the cap is not made. The add functions run
 * their own small calls afterwards (Jev scoring; Explainers' scope writer), which this ledger cannot intercept, so they are
 * reserved out of the budget up front.
 */

export const ONE_BOX_MAX_USD = 0.35;
export const ONE_BOX_VERIFY_MODEL = 'claude-haiku-5-5';

export const RESERVE_USD: Record<SeedVerticalKey, number> = {
  reels: 0.02,
  carousels: 0.02,
  last_few_days: 0.02,
  stories: 0.02,
  explainers: 0.08,
  field_notes: 0.02,
  ai_trivia: 0.06,
  real_or_ai: 0.08,
  reel_ai_drama: 0,
};

/** The search call's caps. They bound its cost together with the per-search fee. */
export const SEARCH_MAX_USES = 3;
export const SEARCH_MAX_OUTPUT_TOKENS = 1500;
/**
 * An assumption, not a measurement, and the one place the 35-cent limit is not enforced by the API: a search turn re-bills its
 * results on each server-side step, so its real input is only known after the call. Retune this from the cost the first live
 * seeds record (reels.cost_events, component one-box-seed) before relying on the limit.
 */
export const SEARCH_INPUT_ALLOWANCE_TOKENS = 60_000;
/** The cached prefix (tools + system) is assumed to be written at the 1-hour rate in the worst case. */
const PREFIX_TOKENS = 3_000;

export const VERIFY_MAX_OUTPUT_TOKENS = 200;
const VERIFY_INPUT_ALLOWANCE_TOKENS = 4_000;
const VERIFY_PREFIX_TOKENS = 1_500;

const money = (n: number) => Number(n.toFixed(6));

export function searchWorstCaseUsd(): number {
  const priced = priceAnthropicUsage(
    {
      uncachedInputTokens: SEARCH_INPUT_ALLOWANCE_TOKENS - PREFIX_TOKENS,
      cacheReadInputTokens: 0,
      cacheCreation5mInputTokens: 0,
      cacheCreation1hInputTokens: PREFIX_TOKENS,
      outputTokens: SEARCH_MAX_OUTPUT_TOKENS,
      webSearchRequests: SEARCH_MAX_USES,
    },
    { modelId: B6_MODEL },
  );
  return money(Number(priced.costUsd));
}

export function verifyWorstCaseUsd(): number {
  const priced = priceAnthropicUsage(
    {
      uncachedInputTokens: VERIFY_INPUT_ALLOWANCE_TOKENS,
      cacheReadInputTokens: 0,
      cacheCreation5mInputTokens: 0,
      cacheCreation1hInputTokens: VERIFY_PREFIX_TOKENS,
      outputTokens: VERIFY_MAX_OUTPUT_TOKENS,
      webSearchRequests: 0,
    },
    { modelId: ONE_BOX_VERIFY_MODEL },
  );
  return money(Number(priced.costUsd));
}

/** The per-search fee, exported so a test can show it is the one in the cost snapshot. */
export const SEARCH_FEE_USD = DRAFTING_PRICE_SNAPSHOT.webSearchPerSearchUsd;

export class Ledger {
  spent = 0;
  readonly usable: number;

  constructor(vertical: SeedVerticalKey) {
    this.usable = money(ONE_BOX_MAX_USD - RESERVE_USD[vertical]);
  }

  /** True when a call whose cost could be `worstCase` still fits. */
  canAfford(worstCase: number): boolean {
    return this.spent + worstCase <= this.usable + 1e-9;
  }

  add(usd: number): void {
    this.spent = money(this.spent + (Number.isFinite(usd) && usd > 0 ? usd : 0));
  }

  get exhausted(): boolean {
    return this.spent >= this.usable - 1e-9;
  }
}
