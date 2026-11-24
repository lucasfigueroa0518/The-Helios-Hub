/**
 * The Trivia one-box seed (one-box seeding v2, spec "Trivia."), run by the Stories worker after it claims the request.
 *
 *   ledger     before the writer call, its worst case priced from the exact call (system, tool and user turn; searches,
 *              SEED_MAX_TOKENS output, re-read steps; see triviaSeedWorstCaseUsd) must fit; else the seed fails with the
 *              limit text, spending nothing. Each pause_turn continuation and the shortening try are checked the same way.
 *              Every response's cost goes into the ledger.
 *   writer     the daily writer's own path (daily.ts writeTriviaBatch) with `seed` set: trivia-seed@1, the topic in the
 *              material, every open active cell offered, at most SEED_ASKED_PER_THEME asked per theme, SEED_QUESTIONS questions. Then, as on the daily path: the validator,
 *              the repeat check, the shorten retry, numbering, Jev, the pool score and the deposit of cited pages. Each pooled
 *              payload carries `seed: true` (Yours, never cut by a cap).
 *   cap        the trivia pool cap runs as usual afterwards.
 *   end        doneRequest with the first pooled key (also when a later step throws), or failRequest with the reasons.
 *              Never throws.
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
 * The writer's worst case is priced from the call it will make (the exact system prompt, tool and user turn), so it follows
 * the material's size. Assumptions, not measurements (retune from the first live seeds' stories.cost_events, component
 * trivia-seed):
 *   CHARS_PER_TOKEN       a conservative 3.5 characters a token for this JSON and prose
 *   steps                 a search turn samples once per search plus once more, and each step re-reads the uncached user turn
 *   SEARCH_RESULT_TOKENS  each search's results, re-read on every later step (S + (S-1) + ... + 1 reads)
 *   prefix                the cached system and tool: written once at the 1-hour rate, read on every later step
 */
export const CHARS_PER_TOKEN = 3.5;
export const SEARCH_RESULT_TOKENS = 6_000;
const SHORTEN_INPUT_ALLOWANCE_TOKENS = 15_000;
const SHORTEN_PREFIX_TOKENS = 12_000;

const money = (n: number) => Number(n.toFixed(6));
const tokensOf = (chars: number) => Math.ceil(Math.max(0, chars) / CHARS_PER_TOKEN);
const usage = (u: { input: number; write: number; read?: number; output: number }) =>
  ({ input_tokens: u.input, cache_creation_input_tokens: u.write, cache_read_input_tokens: u.read ?? 0, output_tokens: u.output }) as Anthropic.Message['usage'];

/** The sizes of the writer call, in characters: the cached prefix (system + tool) and the uncached user turn. */
export type SeedCallSize = { prefixChars: number; userChars: number };

/** The seed writer's whole-call worst case at the copy model's price (lib/stories/cost.ts, as the daily writer is priced). */
export function triviaSeedWorstCaseUsd(size: SeedCallSize, model: string = DEFAULT_SETTINGS.models.copy): number {
  const s = TRIVIA_SEED_SEARCHES;
  const steps = s + 1;
  const prefix = tokensOf(size.prefixChars);
  const input = tokensOf(size.userChars) * steps + SEARCH_RESULT_TOKENS * ((s * (s + 1)) / 2);
  return money(priceCall(model, usage({ input, write: prefix, read: prefix * (steps - 1), output: SEED_MAX_TOKENS })).usd + s * WEB_SEARCH_USD);
}

/** One more writer turn (a pause_turn continuation): the user turn, every search's results, the prefix, full output and searches. */
export function triviaSeedTurnWorstCaseUsd(size: SeedCallSize, model: string = DEFAULT_SETTINGS.models.copy): number {
  const s = TRIVIA_SEED_SEARCHES;
  const input = tokensOf(size.userChars) + SEARCH_RESULT_TOKENS * s;
  return money(priceCall(model, usage({ input, write: tokensOf(size.prefixChars), output: SEED_MAX_TOKENS })).usd + s * WEB_SEARCH_USD);
}

/** The shortening try's worst case (no search). */
export function triviaShortenWorstCaseUsd(model: string = DEFAULT_SETTINGS.models.copy): number {
  return money(priceCall(model, usage({ input: SHORTEN_INPUT_ALLOWANCE_TOKENS - SHORTEN_PREFIX_TOKENS, write: SHORTEN_PREFIX_TOKENS, output: SEED_MAX_TOKENS })).usd);
}

/** The ledger stopped a call before it was made. */
export class SeedLimitError extends Error {
  constructor() {
    super(limitText('ai_trivia'));
  }
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
  let size: SeedCallSize | null = null;
  let writerTurns = 0;
  // Every response's cost goes into the ledger, the same amounts writeStructured records in stories.cost_events. A writer
  // turn after the first (pause_turn) is made only when one more turn's worst case still fits.
  const write: WriterCreate = async (params) => {
    const searching = Array.isArray(params.tools) && (params.tools as Array<{ name?: string }>).some((t) => t?.name === 'web_search');
    if (searching && writerTurns++ > 0 && (!size || !ledger.canAfford(triviaSeedTurnWorstCaseUsd(size, model)))) throw new SeedLimitError();
    const res = await deps.write(params);
    ledger.add(responseCostUsd(res, String(params.model ?? model)));
    return res;
  };
  let rec: TriviaDailyRecord | null = null;
  try {
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
    rec = {
      day: poolDay(deps.now), at: deps.now.toISOString(), offered: cells.map((c) => c.cellId),
      pooled: [], rejected: [], shortened: [], dropped: [], spent: [], retired: [],
      intake: { mode: 'legacy', research: 0, deposited: 0, created: 0, failed: 0 },
    };
    await writeTriviaBatch({ ...deps, write }, rec, {
      cells, research: [], iq: deps.intake?.query ?? deps.db, taken: new Set(), earlier: await loadEarlier(deps.db), fresh: [],
      topic: input.blurb, count: SEED_QUESTIONS, seed: true,
      // The ledger prices the exact call before it is made; a call that might pass the limit is not made.
      beforeWrite: (call) => {
        size = { prefixChars: call.system.length + JSON.stringify(call.tool).length, userChars: call.user.length };
        if (!ledger.canAfford(triviaSeedWorstCaseUsd(size, model))) throw new SeedLimitError();
      },
      canShorten: () => ledger.canAfford(triviaShortenWorstCaseUsd(model)),
    });
    await finish(q, id, deps, ledger, rec);
  } catch (err) {
    // A question already pooled stays the seed's result.
    if (rec?.pooled[0]) {
      await finish(q, id, deps, ledger, rec).catch(() => undefined);
      return;
    }
    const msg = err instanceof SeedLimitError ? err.message : clip(`The writer failed: ${err instanceof Error ? err.message : String(err)}`);
    await failRequest(q, id, msg, ledger.spent).catch(() => undefined);
  }
}

/** Done with the first pooled key (after the pool cap, which never undoes the seed), or failed with the reasons. */
async function finish(q: Query, id: string, deps: TriviaDailyDeps, ledger: Ledger, rec: TriviaDailyRecord): Promise<void> {
  const first = rec.pooled[0];
  if (!first) {
    await failRequest(q, id, failureText(rec), ledger.spent);
    return;
  }
  // The pool cap as usual; seeded rows are exempt.
  await capTriviaPool(deps.db, deps.now).catch(() => undefined);
  await doneRequest(q, id, first.key, ledger.spent);
}
