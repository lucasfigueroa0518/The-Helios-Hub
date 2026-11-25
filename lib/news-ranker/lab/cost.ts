/**
 * Lab spend (D6): one hard cap of $1.00 across every lab run, checked before
 * each run from stored cost and again before each call during the run.
 */
import { JEV_INPUT_USD_PER_MTOK } from '@/lib/social/jev/client';

export const LAB_CAP_USD = 1.0;
/** Estimates are padded: real tokenizers count differently from chars/4. */
export const ESTIMATE_MARGIN = 1.3;
/** claude-sonnet-5-5: $2 in, $10 out per Mtok; a 1h cache write bills 2× input. */
export const SONNET_MODEL = 'claude-sonnet-5-5';
const SONNET_IN = 2;
const SONNET_OUT = 10;
const FINAL_OUT_TOKENS = 1000;

export const tokensOf = (chars: number) => Math.ceil(chars / 4);

export function jevEstimateUsd(requestChars: readonly number[]): number {
  const tokens = requestChars.reduce((s, c) => s + tokensOf(c), 0);
  return ((tokens * JEV_INPUT_USD_PER_MTOK) / 1e6) * ESTIMATE_MARGIN;
}

/** Worst case: the whole prompt billed as a cache write. */
export function sonnetEstimateUsd(promptChars: number): number {
  return (((tokensOf(promptChars) * SONNET_IN * 2) + FINAL_OUT_TOKENS * SONNET_OUT) / 1e6) * ESTIMATE_MARGIN;
}

export class CapError extends Error {}

/** Throws when spent + estimate would pass the cap. */
export function assertWithinCap(spentUsd: number, estimateUsd: number, capUsd = LAB_CAP_USD): void {
  if (spentUsd + estimateUsd > capUsd) {
    throw new CapError(`lab cap $${capUsd.toFixed(2)}: spent $${spentUsd.toFixed(4)} + estimate $${estimateUsd.toFixed(4)} would pass it`);
  }
}

/** A running budget for one run: refuses a call once remaining is spent. */
export function budget(spentUsd: number, capUsd = LAB_CAP_USD) {
  let used = 0;
  return {
    get used() {
      return used;
    },
    check(nextUsd = 0) {
      assertWithinCap(spentUsd + used, nextUsd, capUsd);
    },
    add(usd: number) {
      used += usd;
    },
  };
}
