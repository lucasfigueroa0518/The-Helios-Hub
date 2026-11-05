import { VERTICAL_LABELS } from './labels';
import type { CostMeter, FixKind, Vertical } from './types';

export type Cap = { capUsd: number; ceilingUsd: number };

/**
 * Per-vertical, per-fix-kind spend caps. Every vertical is null until Tommy
 * approves real values; null means revisions are refused. Do not invent numbers.
 */
export type CapsConfig = Partial<Record<Vertical, Partial<Record<FixKind, Cap>> | null>>;

const c = (capUsd: number, ceilingUsd: number): Cap => ({ capUsd, ceilingUsd });
const RENDER_ONLY = c(0.05, 0.1);

/** Approved by Tommy 2026-11-01. Cap = expected spend per revision; ceiling = hard stop. Changing one needs a worker redeploy. */
export const CAPS: CapsConfig = {
  carousels: { photo: c(0.15, 0.4), wording: c(0.4, 1.0), color: RENDER_ONLY, layout: RENDER_ONLY },
  stories: { photo: c(0.2, 0.5), wording: c(0.15, 0.4), color: RENDER_ONLY, layout: RENDER_ONLY },
  last_few_days: { photo: c(0.15, 0.4), wording: c(0.4, 1.0), layout: RENDER_ONLY },
  ai_events: { photo: c(0.15, 0.4), wording: c(0.1, 0.3), layout: RENDER_ONLY },
  reels: { wording: c(0.15, 0.4), photo: c(0.5, 1.25), motion: c(0.75, 1.5), color: c(0.75, 1.5) },
  explainers: { photo: c(0.75, 1.5), wording: c(0.75, 1.5), color: c(0.75, 1.5), layout: c(0.75, 1.5) },
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

/**
 * True when the type has at least one approved cap (any fix kind). With none, nothing about a request
 * can run, so it is refused before the paid interpreter call (worker) and at submit (the revise verb).
 */
export function hasAnyCap(vertical: Vertical): boolean {
  const caps = active[vertical];
  return !!caps && Object.values(caps).some((c) => !!c);
}

/** The plain note for a type (or one of its fix kinds) with no approved cap. */
export function noCapNote(vertical: Vertical, fix?: FixKind): string {
  return `There is no approved cap for ${VERTICAL_LABELS[vertical]}${fix ? ` (${fix} fixes)` : ''} yet, so nothing was run.`;
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
