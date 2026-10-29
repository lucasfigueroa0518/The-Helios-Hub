import type { CostMeter, FixKind, Vertical } from './types';

export type Cap = { capUsd: number; ceilingUsd: number };

/**
 * Per-vertical, per-fix-kind spend caps. Every vertical is null until Tommy
 * approves real values; null means revisions are refused. Do not invent numbers.
 */
export type CapsConfig = Partial<Record<Vertical, Partial<Record<FixKind, Cap>> | null>>;

export const CAPS: CapsConfig = {
  reels: null,
  explainers: null,
  carousels: null,
  stories: null,
  last_few_days: null,
  ai_events: null,
};

let active: CapsConfig = CAPS;

/** Test hook: replace the active config. `setCapsForTest({})` = nothing approved. Reset with resetCapsForTest(). */
export function setCapsForTest(overrides: CapsConfig): void {
  active = overrides;
}

export function resetCapsForTest(): void {
  active = CAPS;
}

/** The approved cap and hard ceiling for a vertical and fix, or null (refused). */
export function capFor(vertical: Vertical, fix: FixKind): Cap | null {
  return active[vertical]?.[fix] ?? null;
}

export class CeilingReached extends Error {
  constructor(readonly spent: number, readonly ceilingUsd: number) {
    super(`Revision spend $${spent.toFixed(4)} passed the ceiling $${ceilingUsd.toFixed(4)}.`);
    this.name = 'CeilingReached';
  }
}

/** Records every spend (including the one that crosses the ceiling), then throws. */
export function createCostMeter(ceilingUsd: number): CostMeter {
  let spent = 0;
  return {
    spend(usd: number) {
      if (!Number.isFinite(usd) || usd < 0) throw new RangeError(`CostMeter.spend needs a finite, non-negative amount, got ${usd}.`);
      spent += usd;
      if (spent > ceilingUsd) throw new CeilingReached(spent, ceilingUsd);
    },
    get spent() {
      return spent;
    },
  };
}
