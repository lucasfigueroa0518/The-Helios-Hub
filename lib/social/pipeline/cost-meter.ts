/**
 * Daily cost meter (spec §4.2b: $5/day cap; §6 #11).
 *
 * Every stage's cost is charged here. When spend reaches the cap the
 * orchestrator stops the day and logs `cost-cap`.
 */
import {
  priceAnthropicUsage,
  usageBucketsFromMessage,
  type MessageUsageLike,
} from '@/lib/anthropic-pricing';

import type { StageName } from './types';

export const DAILY_CAP_USD = 5;

export type CostMeter = {
  /** Charge a plain USD amount (Jev, or a stub). */
  charge(stage: StageName, usd: number): void;
  /** Price a Claude response with the shared pricing table and charge it. */
  chargeClaude(stage: StageName, message: MessageUsageLike, modelId: string): number;
  spent(): number;
  remaining(): number;
  capReached(): boolean;
  byStage(): Partial<Record<StageName, number>>;
  readonly capUsd: number;
};

export function createCostMeter(opts: { capUsd?: number; alreadySpentUsd?: number } = {}): CostMeter {
  const capUsd = opts.capUsd ?? DAILY_CAP_USD;
  let total = opts.alreadySpentUsd ?? 0;
  const stages: Partial<Record<StageName, number>> = {};

  function charge(stage: StageName, usd: number): void {
    if (!Number.isFinite(usd) || usd < 0) throw new Error(`invalid charge for ${stage}: ${usd}`);
    total += usd;
    stages[stage] = (stages[stage] ?? 0) + usd;
  }

  return {
    capUsd,
    charge,
    chargeClaude(stage, message, modelId) {
      const priced = priceAnthropicUsage(usageBucketsFromMessage(message, '1h'), { modelId });
      const usd = Number(priced.costUsd);
      charge(stage, usd);
      return usd;
    },
    spent: () => total,
    remaining: () => Math.max(0, capUsd - total),
    capReached: () => total >= capUsd,
    byStage: () => ({ ...stages }),
  };
}
