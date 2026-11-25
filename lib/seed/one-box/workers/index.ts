/**
 * What the social workers do with one-box seed requests (one-box seeding v2). The Stories worker calls `runClaimedSeed`
 * once per poll, after its tick, and the drama worker once per poll, right after its requests step: it claims at most one
 * queued request for its runner and runs it with that vertical's own ledger. A runner never throws; if one does anyway (or
 * the deps cannot be built) the request is failed with its spend so far.
 */
import type { Queryable } from '@/lib/explainers/db';
import type { DevelopmentDeps } from '@/lib/reel-ai-drama/development/session';
import type { ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import type { Query } from '@/lib/social/store/pg';
import type { RoaDailyDeps } from '@/lib/stories/roa/daily';
import type { TriviaDailyDeps } from '@/lib/stories/trivia/daily';

import { Ledger } from '../budget';
import { claimRequest, failRequest } from '../requests';
import type { OneBoxInput, SeedVerticalKey } from '../types';
import { runDramaSeed } from './drama';
import { runRoaSeed } from './roa';
import { runTriviaSeed } from './trivia';

/** What the drama seed runs with: the drama database, tonight's settings and a Develop click's deps. */
export type DramaSeedDeps = { db: Queryable; settings: ReelAiDramaSettings; deps: DevelopmentDeps };

/**
 * The deps are built only for a claimed request (a poll with nothing queued builds nothing). Each worker supplies its own
 * runner's factories; a claimed request whose factory is missing fails like any other build error.
 */
export type SeedDepsFactories = {
  trivia?: () => Promise<TriviaDailyDeps>;
  roa?: () => Promise<RoaDailyDeps>;
  drama?: () => Promise<DramaSeedDeps>;
};
/** The Stories worker's factories (Trivia and Real or AI?); the drama worker supplies only `drama`. */
export type StoriesSeedDepsFactories = Required<Pick<SeedDepsFactories, 'trivia' | 'roa'>>;
export type SeedRunners = { trivia: typeof runTriviaSeed; roa: typeof runRoaSeed; drama: typeof runDramaSeed };

const WORKER_ERROR = "The worker hit an error; nothing was added.";

export async function runClaimedSeed(i: {
  q: Query;
  runner: 'stories' | 'drama';
  deps: SeedDepsFactories;
  /** Tests stub the runners. */
  run?: Partial<SeedRunners>;
  now?: Date;
  /** The worker's logger: told the cause when a runner throws, and when failing the request fails too. */
  log?: (message: string, err: unknown) => void;
}): Promise<{ id: string } | null> {
  const claimed = await claimRequest(i.q, i.runner, i.now);
  if (!claimed) return null;
  const { id, input } = claimed;
  const ledger = new Ledger(input.vertical);
  const trivia = i.run?.trivia ?? runTriviaSeed;
  const roa = i.run?.roa ?? runRoaSeed;
  const drama = i.run?.drama ?? runDramaSeed;
  const build = <T>(f: (() => Promise<T>) | undefined, name: string): Promise<T> => (f ? f() : Promise.reject(new Error(`no ${name} deps`)));
  // One line a vertical.
  const routes: Partial<Record<SeedVerticalKey, () => Promise<void>>> = {
    ai_trivia: async () => trivia({ q: i.q, id, input, ledger, deps: await build(i.deps.trivia, 'trivia') }),
    real_or_ai: async () => roa({ q: i.q, id, input, ledger, deps: await build(i.deps.roa, 'roa') }),
    reel_ai_drama: async () => drama({ q: i.q, id, input, ledger, ...(await build(i.deps.drama, 'drama')), now: i.now ?? new Date() }),
  };
  try {
    const route = routes[input.vertical];
    if (!route) throw new Error(`no ${i.runner} runner for ${input.vertical}`);
    await route();
  } catch (err) {
    // The card keeps the plain message; the cause goes to the worker's log.
    i.log?.(`seed request ${id} (${input.vertical}) threw`, err);
    await failRequest(i.q, id, WORKER_ERROR, ledger.spent).catch((failErr: unknown) => i.log?.(`seed request ${id}: could not mark it failed`, failErr));
  }
  return { id };
}
