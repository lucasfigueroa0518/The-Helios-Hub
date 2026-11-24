/**
 * The Real or AI? one-box seed (one-box seeding v2, spec "Real or AI?"), run by the Stories worker after it claims the request.
 *
 *   writer   one roa-seed@1 call (roa-write@3's rules plus the seed rule; the person's subject only in the user turn). Every
 *            writer call is priced from the exact request before it is made (cached prefix at the 1-hour write rate, the user
 *            turn, ROA_SEED_MAX_TOKENS output) and is not made when that might pass the ledger; its actual cost goes in the
 *            ledger. Subject `none`: failed before any photo search or image.
 *   spec     the daily run's own spec path (daily.ts runRoaSpec) with `seed` set: the real photo (shared photo finder,
 *            used-photo ledger, bank), then, only when it pooled, the AI image from the same scene's prompt (at most
 *            AI_ATTEMPTS), each through intake. Each image call is made only while ROA_IMAGE_WORST_USD still fits; its actual
 *            cost goes in the ledger. Both pooled payloads carry `seed: true` (Yours, never cut by a cap).
 *   reserve  the reveal and the Jev screens inside intake are not gated: the type's reserve covers them. The reveal's cost is
 *            still added to what the card shows.
 *   cap      the Real or AI? pool cap runs as usual afterwards (seeded rows are exempt).
 *   end      done with the real photo's key (and "The real photo was added; the AI twin didn't pass." when only it pooled), or
 *            failed with the reason. Never throws.
 *
 * Reads only this series' pool, archive and sets (the duplicate check), plus the shared used-photo ledger and photo bank the
 * daily run reads (CLAUDE.md rule 2: nothing is swept). Writes no daily record.
 */
import type Anthropic from '@anthropic-ai/sdk';

import type { Query } from '@/lib/social/store/pg';
import { priceCall } from '@/lib/stories/cost';
import { capRoaPool, poolDay } from '@/lib/stories/pool';
import { material } from '@/lib/stories/prompts';
import { BANK_DRAIN_MS, NO_REAL_TWIN, openRoaRun, runRoaSpec, type RoaDailyDeps, type RoaSpecSink } from '@/lib/stories/roa/daily';
import { ROA_SEED, ROA_SEED_NONE, type RoaSeedMaterial, type RoaWriteOut } from '@/lib/stories/roa/prompts';
import { validateSpecs } from '@/lib/stories/roa/validate';
import { DEFAULT_SETTINGS } from '@/lib/stories/settings';
import { responseCostUsd, writeStructured, type WriterCreate } from '@/lib/stories/writer';

import { limitText, type Ledger } from '../budget';
import { doneRequest, failRequest, setStage } from '../requests';
import type { OneBoxInput } from '../types';

/** One image attempt's worst case (spec section 5: 17¢ an image, the most measured). */
export const ROA_IMAGE_WORST_USD = 0.17;
/** The seed writer's output cap: one short spec, with room for the model's thinking. */
export const ROA_SEED_MAX_TOKENS = 4_000;
/** A conservative 3.5 characters a token for this JSON and prose (an assumption, as in the Trivia seed). */
export const CHARS_PER_TOKEN = 3.5;

export const NO_CATEGORY_TEXT = "That subject doesn't fit Real or AI?'s subjects; nothing was made.";
export const NO_REAL_TEXT = 'No real photo of that found.';
export const REAL_ONLY_TEXT = "The real photo was added; the AI twin didn't pass.";

const money = (n: number) => Number(n.toFixed(6));
const tokensOf = (chars: number) => Math.ceil(Math.max(0, chars) / CHARS_PER_TOKEN);

/** The sizes of one writer call, in characters: the cached prefix (system + tools) and the uncached user turn. */
export type SeedCallSize = { prefixChars: number; userChars: number };

/** One writer call's worst case at the copy model's price: the prefix written at the 1-hour rate, the user turn, full output. */
export function roaSeedWorstCaseUsd(size: SeedCallSize, model: string = DEFAULT_SETTINGS.models.copy): number {
  const usage = { input_tokens: tokensOf(size.userChars), cache_creation_input_tokens: tokensOf(size.prefixChars), cache_read_input_tokens: 0, output_tokens: ROA_SEED_MAX_TOKENS } as Anthropic.Message['usage'];
  return money(priceCall(model, usage, '1h').usd);
}

/** The size of the request about to be sent. */
const sizeOf = (params: Record<string, unknown>): SeedCallSize => ({
  prefixChars: JSON.stringify(params.system ?? '').length + JSON.stringify(params.tools ?? []).length,
  userChars: JSON.stringify(params.messages ?? []).length,
});

/** The ledger stopped a call before it was made. */
export class SeedLimitError extends Error {
  constructor() {
    super(limitText('real_or_ai'));
  }
}

const MAX_MESSAGE = 600;
const clip = (s: string) => (s.length > MAX_MESSAGE ? `${s.slice(0, MAX_MESSAGE - 1)}…` : s);
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function runRoaSeed(i: { q: Query; id: string; input: OneBoxInput; deps: RoaDailyDeps; ledger: Ledger }): Promise<void> {
  const { q, id, input, deps, ledger } = i;
  const model = deps.settings.models.copy;
  // The seed writer: each call priced from the exact request first, its actual cost into the ledger.
  const write: WriterCreate = async (params) => {
    if (!ledger.canAfford(roaSeedWorstCaseUsd(sizeOf(params), String(params.model ?? model)))) throw new SeedLimitError();
    const res = await deps.write(params);
    ledger.add(responseCostUsd(res, String(params.model ?? model)));
    return res;
  };
  // Intake's own calls (the reveal) are covered by the reserve: not gated, but on the card.
  let reserved = 0;
  const intakeWrite: WriterCreate = async (params) => {
    const res = await deps.write(params);
    reserved += responseCostUsd(res, String(params.model ?? model));
    return res;
  };
  const cost = () => money(ledger.spent + reserved);
  const rec: RoaSpecSink = { pooled: [], archived: [], rejected: [], notes: [], imageUsd: 0 };
  let failed = 'The writer failed';
  try {
    const day = poolDay(deps.now);
    await setStage(q, id, 'writing', cost(), deps.now);
    const { ctx, known, photoBank } = await openRoaRun({ ...deps, write: intakeWrite }, rec, day);
    const mat: RoaSeedMaterial = { subject: input.blurb, today: day, recent: known.recent };
    const out = (await writeStructured<RoaWriteOut>({
      create: write, db: deps.db, setId: null, component: 'roa-seed', model,
      system: ROA_SEED.system, tool: ROA_SEED.tool, user: material(mat), maxTokens: ROA_SEED_MAX_TOKENS,
    })).value;
    const first = Array.isArray(out?.specs) ? out.specs[0] : undefined;
    if (!first || String(first.subject) === ROA_SEED_NONE) {
      await failRequest(q, id, NO_CATEGORY_TEXT, cost());
      return;
    }
    const { specs, rejected } = validateSpecs([{ ...first, trap: 'twin' }], 1);
    const spec = specs[0];
    if (!spec) {
      await failRequest(q, id, clip(`The writer's twin didn't pass the checks (${rejected.flatMap((r) => r.problems).join('; ')}); nothing was made.`), cost());
      return;
    }

    failed = 'Making the images failed';
    await setStage(q, id, 'making', cost(), deps.now);
    const res = await runRoaSpec(ctx, spec, {
      seed: true,
      beforeImage: () => ledger.canAfford(ROA_IMAGE_WORST_USD),
      onImageUsd: (usd) => ledger.add(usd),
    });
    if (res.pooled.length) await capRoaPool(deps.db, deps.now).catch(() => undefined);
    if (photoBank?.drain) await photoBank.drain(BANK_DRAIN_MS).catch(() => undefined);

    const realKey = res.pooled[0];
    if (realKey) {
      await doneRequest(q, id, realKey, cost(), res.pooled.length >= 2 ? null : REAL_ONLY_TEXT);
      return;
    }
    const problems = res.rejected.flatMap((r) => r.problems);
    if (problems.includes(NO_REAL_TWIN)) {
      await failRequest(q, id, NO_REAL_TEXT, cost());
      return;
    }
    const why = [...rec.archived.flatMap((a) => a.problems), ...problems];
    await failRequest(q, id, clip(`The real photo didn't pass${why.length ? ` (${why.join('; ')})` : ''}; nothing was made.`), cost());
  } catch (err) {
    // A real photo already pooled stays the seed's result.
    const pooled = rec.pooled[0];
    if (pooled) {
      await doneRequest(q, id, pooled.key, cost(), rec.pooled.length >= 2 ? null : REAL_ONLY_TEXT).catch(() => undefined);
      return;
    }
    const msg = err instanceof SeedLimitError ? err.message : clip(`${failed}: ${errText(err)}`);
    await failRequest(q, id, msg, cost()).catch(() => undefined);
  }
}
