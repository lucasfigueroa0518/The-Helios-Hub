/**
 * The refill's spend cap (settings standard D14, D16; planning/settings-standard/CONTRACT.md §4 rule 1). Shared by the
 * three video types' refills (Text on Screen, Explainers, AI Drama): each counts its own spend from its own ledger
 * (`cost_events` by run, idea cycle or session) and stops starting new paid work once the cap is reached. A call
 * already under way finishes, so a refill can end a little over its cap, never by more than one step.
 *
 * Hitting the cap ends the refill cleanly: `refill_capped` is logged once, and what was refilled before it stays.
 * Pure apart from the `spent` read it is given, so tests stub it.
 */
import type { JevRequest, JevRunner, JevTransport } from '@/lib/reels/jev/runner';
import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

export const REFILL_CAPPED_NOTE = 'Refill cap reached';

/** Thrown in place of a paid call once the refill's cap is reached. Callers that catch per item read it as "stop". */
export class RefillCappedError extends Error {
  constructor(readonly capUsd: number) {
    super(`${REFILL_CAPPED_NOTE} ($${capUsd.toFixed(2)}); the rest waits for the next refill.`);
    this.name = 'RefillCappedError';
  }
}

/** True for the cap's error, or a failure note that carries its text (per-item guards keep only the message). */
export function isRefillCapped(error: unknown): boolean {
  if (error instanceof RefillCappedError) return true;
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return text.includes(REFILL_CAPPED_NOTE);
}

/** Failure notes without the cap's own: hitting the cap is not a failure of the items it stopped. */
export function withoutCapped(failures: readonly string[]): string[] {
  return failures.filter((failure) => !isRefillCapped(failure));
}

export type RefillCappedLog = (fields: { capUsd: number; spentUsd: number }) => void;

/**
 * One refill's budget. `capUsd` null: no cap (a person's own run). `spent` reads what this refill's ledger holds so far;
 * spend made inside `outside(...)` (the make step sharing the run's ledger) is not counted against the refill.
 */
export class RefillBudget {
  private excluded = 0;
  private hit = false;

  constructor(
    readonly capUsd: number | null,
    private readonly spent: () => Promise<number>,
    private readonly onCapped: RefillCappedLog = () => undefined,
  ) {}

  /** Whether the cap was reached (sticky: once reached, the refill stays ended). */
  get capped(): boolean {
    return this.hit;
  }

  /** The refill's own spend so far. */
  async spentUsd(): Promise<number> {
    return Math.max(0, (await this.spent()) - this.excluded);
  }

  /** Check before starting paid refill work. Logs `refill_capped` the first time it is true. */
  async reached(): Promise<boolean> {
    if (this.hit) return true;
    if (this.capUsd == null) return false;
    const spentUsd = await this.spentUsd();
    if (spentUsd < this.capUsd) return false;
    this.hit = true;
    this.onCapped({ capUsd: this.capUsd, spentUsd });
    return true;
  }

  /** Run make-step work whose spend lands in the same ledger without counting it against the refill. */
  async outside<T>(work: () => Promise<T>): Promise<T> {
    if (this.capUsd == null) return work();
    const before = await this.spent();
    try {
      return await work();
    } finally {
      this.excluded += Math.max(0, (await this.spent()) - before);
    }
  }
}

/** A Jev transport that refuses instead of calling once the budget is reached (for runners built over a transport). */
export function cappedJevTransport(inner: JevTransport, budget: RefillBudget): JevTransport {
  return {
    async systemOne<const Q extends Questions>(state: EntryType, questions: Q): Promise<SystemOneResult<Q>> {
      if (await budget.reached()) throw new RefillCappedError(budget.capUsd ?? 0);
      return inner.systemOne(state, questions);
    },
  };
}

/** A Jev runner that refuses (RefillCappedError) instead of calling once the refill's budget is reached. */
export class CappedJevRunner implements JevRunner {
  constructor(
    private readonly inner: JevRunner,
    private readonly budget: RefillBudget,
  ) {}

  get callCount(): number {
    return this.inner.callCount;
  }

  async ask<const Q extends Questions>(request: JevRequest<Q>): Promise<SystemOneResult<Q>> {
    if (await this.budget.reached()) throw new RefillCappedError(this.budget.capUsd ?? 0);
    return this.inner.ask(request);
  }
}
