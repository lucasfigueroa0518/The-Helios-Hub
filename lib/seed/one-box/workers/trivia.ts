/**
 * The Trivia one-box seed (one-box seeding v2, spec "Trivia."), run by the Stories worker after it claims the request.
 *
 *   ledger     before the writer call, its worst case (TRIVIA_SEED_SEARCHES searches, SEED_MAX_TOKENS output and an input
 *              allowance at the copy model's Stories price) must fit; else the seed fails with the limit text, spending
 *              nothing. The shortening try is checked the same way. Every response's cost goes into the ledger.
 *   writer     the daily writer's own path (daily.ts writeTriviaBatch) with `seed` set: trivia-seed@1, the topic in the
 *              material, every open active cell offered, SEED_QUESTIONS questions. Then, as on the daily path: the validator,
 *              the repeat check, the shorten retry, numbering, Jev, the pool score and the deposit of cited pages. Each pooled
 *              payload carries `seed: true` (Yours, never cut by a cap).
 *   cap        the trivia pool cap runs as usual afterwards.
 *   end        doneRequest with the first pooled key, or failRequest with the reasons. Never throws.
 *
 * Reads only the trivia cells, the series' own pool and its repeat list (CLAUDE.md rule 2: nothing is swept).
 */
import type Anthropic from '@anthropic-ai/sdk';

import type { Query } from '@/lib/social/store/pg';
import { priceCall } from '@/lib/stories/cost';
import { capTriviaPool, poolDay } from '@/lib/stories/pool';
import { DEFAULT_SETTINGS } from '@/lib/stories/settings';
import { ensureCells, openCellIds } from '@/lib/stories/trivia/cells';
import { SEED_MAX_TOKENS, writeTriviaBatch, type TriviaDailyDeps, type TriviaDailyRecord } from '@/lib/stories/trivia/daily';
import { cellOf, isActive, type Cell } from '@/lib/stories/trivia/map';
import { TRIVIA_SEED_SEARCHES } from '@/lib/stories/trivia/prompts';
import { loadEarlier } from '@/lib/stories/trivia/repeats';
import { responseCostUsd, WEB_SEARCH_USD, type WriterCreate } from '@/lib/stories/writer';

import { limitText, type Ledger } from '../budget';
import { doneRequest, failRequest, setStage } from '../requests';
import type { OneBoxInput } from '../types';

/** Questions one seed asks for (spec: the daily writer averages 4 a call; 2 keeps a seed small). */
export const SEED_QUESTIONS = 2;

/**
 * Assumptions, not measurements: the writer's whole input across its search steps (the offered cells, the asked lists and
 * the search results it re-reads), of which the cached prefix (tool + trivia-seed@1 with the humanizer) is assumed written
 * at the 1-hour rate. Retune from the first live seeds' stories.cost_events (component trivia-seed).
 */
export const SEED_INPUT_ALLOWANCE_TOKENS = 60_000;
const SEED_PREFIX_TOKENS = 12_000;
const SHORTEN_INPUT_ALLOWANCE_TOKENS = 15_000;
const SHORTEN_PREFIX_TOKENS = 12_000;

const money = (n: number) => Number(n.toFixed(6));
const usage = (input: number, prefix: number, output: number) =>
  ({ input_tokens: input - prefix, cache_creation_input_tokens: prefix, cache_read_input_tokens: 0, output_tokens: output }) as Anthropic.Message['usage'];

/** The seed writer's worst case at the copy model's price (lib/stories/cost.ts, as the daily writer is priced). */
export function triviaSeedWorstCaseUsd(model: string = DEFAULT_SETTINGS.models.copy): number {
  return money(priceCall(model, usage(SEED_INPUT_ALLOWANCE_TOKENS, SEED_PREFIX_TOKENS, SEED_MAX_TOKENS)).usd + TRIVIA_SEED_SEARCHES * WEB_SEARCH_USD);
}

/** The shortening try's worst case (no search). */
export function triviaShortenWorstCaseUsd(model: string = DEFAULT_SETTINGS.models.copy): number {
  return money(priceCall(model, usage(SHORTEN_INPUT_ALLOWANCE_TOKENS, SHORTEN_PREFIX_TOKENS, SEED_MAX_TOKENS)).usd);
}

const MAX_MESSAGE = 600;
const clip = (s: string) => (s.length > MAX_MESSAGE ? `${s.slice(0, MAX_MESSAGE - 1)}…` : s);

/** The card's message when nothing pooled: each dropped question's reasons. */
function failureText(rec: TriviaDailyRecord): string {
  if (!rec.rejected.length) return 'The writer found no question on that topic that fits an open cell; nothing was added.';
  const reasons = rec.rejected.map((r, n) => `Question ${n + 1}: ${r.problems.join('; ')}.`).join(' ');
  return clip(`No question passed the checks; nothing was added. ${reasons}`);
}

export async function runTriviaSeed(i: { q: Query; id: string; input: OneBoxInput; deps: TriviaDailyDeps; ledger: Ledger }): Promise<void> {
  const { q, id, input, deps, ledger } = i;
  const model = deps.settings.models.copy;
  // Every response's cost goes into the ledger, the same amounts writeStructured records in stories.cost_events.
  const write: WriterCreate = async (params) => {
    const res = await deps.write(params);
    ledger.add(responseCostUsd(res, String(params.model ?? model)));
    return res;
  };
  try {
    if (!ledger.canAfford(triviaSeedWorstCaseUsd(model))) {
      await failRequest(q, id, limitText('ai_trivia'), ledger.spent);
      return;
    }
    await ensureCells(deps.db);
    const cells = [...(await openCellIds(deps.db))]
      .map((cellId) => cellOf(cellId))
      // AT-63: retired themes and angles are never offered.
      .filter((c): c is Cell => !!c && isActive(c))
      .sort((a, b) => a.cellId.localeCompare(b.cellId));
    if (!cells.length) {
      await failRequest(q, id, 'Every trivia cell is retired; nothing was added.', ledger.spent);
      return;
    }
    await setStage(q, id, 'writing', ledger.spent, deps.now);
    const rec: TriviaDailyRecord = {
      day: poolDay(deps.now), at: deps.now.toISOString(), offered: cells.map((c) => c.cellId),
      pooled: [], rejected: [], shortened: [], dropped: [], spent: [], retired: [],
      intake: { mode: 'legacy', research: 0, deposited: 0, created: 0, failed: 0 },
    };
    await writeTriviaBatch({ ...deps, write }, rec, {
      cells, research: [], iq: deps.intake?.query ?? deps.db, taken: new Set(), earlier: await loadEarlier(deps.db), fresh: [],
      topic: input.blurb, count: SEED_QUESTIONS, seed: true,
      canShorten: () => ledger.canAfford(triviaShortenWorstCaseUsd(model)),
    });
    const first = rec.pooled[0];
    if (!first) {
      await failRequest(q, id, failureText(rec), ledger.spent);
      return;
    }
    // The pool cap as usual; seeded rows are exempt. A failed cap never undoes the seed.
    await capTriviaPool(deps.db, deps.now).catch(() => undefined);
    await doneRequest(q, id, first.key, ledger.spent);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRequest(q, id, clip(`The writer failed: ${msg}`), ledger.spent).catch(() => undefined);
  }
}
