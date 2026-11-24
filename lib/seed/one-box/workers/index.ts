/**
 * What the social workers do with one-box seed requests (one-box seeding v2). The Stories worker calls `runClaimedSeed`
 * once per poll, after its tick: it claims at most one queued request for its runner and runs it with that vertical's own
 * ledger. A runner never throws; if one does anyway (or the deps cannot be built) the request is failed with its spend so far.
 */
import type { Query } from '@/lib/social/store/pg';
import type { RoaDailyDeps } from '@/lib/stories/roa/daily';
import type { TriviaDailyDeps } from '@/lib/stories/trivia/daily';

import { Ledger } from '../budget';
import { claimRequest, failRequest } from '../requests';
import type { OneBoxInput, SeedVerticalKey } from '../types';
import { runRoaSeed } from './roa';
import { runTriviaSeed } from './trivia';

/** The deps are built only for a claimed request (a poll with nothing queued builds nothing). */
export type SeedDepsFactories = { trivia: () => Promise<TriviaDailyDeps>; roa: () => Promise<RoaDailyDeps> };
export type SeedRunners = { trivia: typeof runTriviaSeed; roa: typeof runRoaSeed };

const WORKER_ERROR = "The worker hit an error; nothing was added.";

export async function runClaimedSeed(i: {
  q: Query;
  runner: 'stories';
  deps: SeedDepsFactories;
  /** Tests stub the runners. */
  run?: Partial<SeedRunners>;
  now?: Date;
}): Promise<{ id: string } | null> {
  const claimed = await claimRequest(i.q, i.runner, i.now);
  if (!claimed) return null;
  const { id, input } = claimed;
  const ledger = new Ledger(input.vertical);
  const trivia = i.run?.trivia ?? runTriviaSeed;
  const roa = i.run?.roa ?? runRoaSeed;
  // One line a vertical; the drama runner adds its own.
  const routes: Partial<Record<SeedVerticalKey, () => Promise<void>>> = {
    ai_trivia: async () => trivia({ q: i.q, id, input, ledger, deps: await i.deps.trivia() }),
    real_or_ai: async () => roa({ q: i.q, id, input, ledger, deps: await i.deps.roa() }),
  };
  try {
    const route = routes[input.vertical];
    if (!route) throw new Error(`no ${i.runner} runner for ${input.vertical}`);
    await route();
  } catch {
    await failRequest(i.q, id, WORKER_ERROR, ledger.spent).catch(() => {});
  }
  return { id };
}
