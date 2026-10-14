/**
 * Daily cost meter (spec §4.2b: $5/day cap; §6 #11).
 *
 * Every stage's cost is charged here. When spend reaches the cap the
 * orchestrator stops the day and logs `cost-cap`.
 *
 * TARGET AND CEILING (Tommy, 2026-10-14): the cap is a target, with wiggle
 * room above it. Past the target no new story starts; a story already in
 * progress may finish, up to the ceiling (cap + wiggle), the hard stop. A
 * half-paid story is the cheapest post left; cutting it off at the cap wastes
 * what it already cost. Wiggle defaults to 0 (one hard line, as before).
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
  /** Room left under the ceiling. */
  remaining(): number;
  /** Spend has reached the target: start no new story. */
  targetReached(): boolean;
  /** Spend has reached the ceiling: stop now. */
  capReached(): boolean;
  byStage(): Partial<Record<StageName, number>>;
  /** The target. */
  readonly capUsd: number;
  /** The hard stop: target + wiggle. */
  readonly ceilingUsd: number;
};

export function createCostMeter(opts: { capUsd?: number; wiggleUsd?: number; alreadySpentUsd?: number } = {}): CostMeter {
  const capUsd = opts.capUsd ?? DAILY_CAP_USD;
  const wiggleUsd = opts.wiggleUsd ?? 0;
  if (!Number.isFinite(wiggleUsd) || wiggleUsd < 0) throw new Error(`invalid wiggle: ${wiggleUsd}`);
  const ceilingUsd = capUsd + wiggleUsd;
  let total = opts.alreadySpentUsd ?? 0;
  const stages: Partial<Record<StageName, number>> = {};

  function charge(stage: StageName, usd: number): void {
    if (!Number.isFinite(usd) || usd < 0) throw new Error(`invalid charge for ${stage}: ${usd}`);
    total += usd;
    stages[stage] = (stages[stage] ?? 0) + usd;
  }

  return {
    capUsd,
    ceilingUsd,
    charge,
    chargeClaude(stage, message, modelId) {
      const priced = priceAnthropicUsage(usageBucketsFromMessage(message, '1h'), { modelId });
      const usd = Number(priced.costUsd);
      charge(stage, usd);
      return usd;
    },
    spent: () => total,
    remaining: () => Math.max(0, ceilingUsd - total),
    targetReached: () => total >= capUsd,
    capReached: () => total >= ceilingUsd,
    byStage: () => ({ ...stages }),
  };
}
