import { DRAFTING_PRICE_SNAPSHOT } from '@/lib/drafting/cost';
import { priceAnthropicUsage } from '@/lib/anthropic-pricing';
import { B6_MODEL } from '@/lib/reels/config';

import type { SeedVerticalKey } from './types';

/**
 * The one-box spend ledger (design 2026-11-04-one-box-seeding-design, section 5). each type's limit (LIMIT_USD) is a hard stop: before each billable
 * call the worst case is checked against what is left, and a call that might pass the cap is not made. The add functions run
 * their own small calls afterwards (Jev scoring; Explainers' scope writer), which this ledger cannot intercept, so they are
 * reserved out of the budget up front.
 */

export const ONE_BOX_VERIFY_MODEL = 'claude-haiku-5-5';

/** The most one seed of each type may spend. */
export const LIMIT_USD: Record<SeedVerticalKey, number> = {
  reels: 0.35,
  carousels: 0.35,
  last_few_days: 0.35,
  stories: 0.35,
  explainers: 0.35,
  field_notes: 0.35,
  ai_trivia: 0.35,
  real_or_ai: 0.6,
  reel_ai_drama: 0.5,
};

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
 * An assumption, not a measurement, and the one place the seed limit is not enforced by the API: a search turn re-bills its
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

export const CLASSIFY_MAX_OUTPUT_TOKENS = 200;
const CLASSIFY_INPUT_ALLOWANCE_TOKENS = 1_500;
const CLASSIFY_PREFIX_TOKENS = 800;

/** Field Notes with a link: one tiny Haiku call that picks the kind and the want. */
export function classifyWorstCaseUsd(): number {
  const priced = priceAnthropicUsage(
    {
      uncachedInputTokens: CLASSIFY_INPUT_ALLOWANCE_TOKENS,
      cacheReadInputTokens: 0,
      cacheCreation5mInputTokens: 0,
      cacheCreation1hInputTokens: CLASSIFY_PREFIX_TOKENS,
      outputTokens: CLASSIFY_MAX_OUTPUT_TOKENS,
      webSearchRequests: 0,
    },
    { modelId: ONE_BOX_VERIFY_MODEL },
  );
  return money(Number(priced.costUsd));
}

/** The per-search fee, exported so a test can show it is the one in the cost snapshot. */
export const SEARCH_FEE_USD = DRAFTING_PRICE_SNAPSHOT.webSearchPerSearchUsd;

const cents = (v: SeedVerticalKey) => Math.round(LIMIT_USD[v] * 100);

/** The verifier's reason when it stopped at the limit; run.ts matches on it. */
export const limitReason = (v: SeedVerticalKey) => `Stopped at the ${cents(v)}-cent limit.`;

/** What the request row says when a seed stops at its type's limit. */
export const limitText = (v: SeedVerticalKey) => `Stopped at the ${cents(v)}-cent limit; nothing was added.`;

export class Ledger {
  spent = 0;
  readonly usable: number;

  constructor(vertical: SeedVerticalKey) {
    this.usable = money(LIMIT_USD[vertical] - RESERVE_USD[vertical]);
  }

  /** True when a call whose cost could be `worstCase` still fits. */
  canAfford(worstCase: number): boolean {
    return this.spent + worstCase <= this.usable + 1e-9;
  }

  add(usd: number): void {
    this.spent = money(this.spent + (Number.isFinite(usd) && usd > 0 ? usd : 0));
  }

  /** What is left to spend, never below zero. */
  remaining(): number {
    return Math.max(0, money(this.usable - this.spent));
  }

  get exhausted(): boolean {
    return this.spent >= this.usable - 1e-9;
  }
}
