/**
 * The AI Drama one-box seed (one-box seeding v2, spec "AI Drama."), run by the drama worker after it claims the request.
 *
 *   cap        tonight's development spend (since the last 22:00 New York, the window a Develop click is held to) plus the
 *              producer's worst case must fit `nightly_dev_cap_usd`; else the seed fails before any call, spending nothing.
 *   producer   producer-seed@1 (producer.ts produceSeedPitch): the producer's system and roster blocks unchanged, the same
 *              submit_pitches tool, the person's story (and link) only in the user turn. Every producer call is priced from
 *              the exact request before it is made (dramaSeedWorstCaseUsd) and is not made when that might pass the ledger;
 *              its actual cost goes in the ledger. Costs are recorded in reel_ai_drama.cost_events as `producer_seed`, mode
 *              `development` (the CHECK allows only development and production), so they count toward the nightly cap.
 *   validate   validatePitch on the candidate (no cell).
 *   insert     origin 'seed', status 'new', the same columns seedCalibrationPitches uses. No session.
 *   check      the session's own checkPitch at once (dedupe, drama, material, visuals, pool), sessionId null, with the
 *              visuals check capped at min(setting, what the ledger has left), and held when tonight's cap is reached.
 *              Jev and visuals costs are recorded against the pitch and added to the ledger afterwards (reserve 0: Jev is
 *              about free and the visuals check stops at its cap).
 *   low        under MIN_CHECK_USD left in the ledger before the checks: no check, held (below).
 *   stage      'writing' before the producer and again before each producer turn, 'checking' before the checks; each
 *              refresh writes the real time (the runner's clock), so a long seed's card does not read as timed out.
 *   end        pooled → done with the pitch id; duplicate or rejected → failed with the reason; held → failed, the pitch
 *              left `new` for the next development session. Never throws.
 *
 * Reads only reel_ai_drama: tonight's cost rows, and the pitches the duplicate check reads (CLAUDE.md rule 2: nothing is
 * swept).
 */
import type Anthropic from '@anthropic-ai/sdk';

import { priceAnthropicMessages, priceAnthropicUsage, type MessageUsageLike } from '@/lib/anthropic-pricing';
import type { Queryable } from '@/lib/explainers/db';
import { developmentSpendSince, spendFor } from '@/lib/reel-ai-drama/cost';
import { eventKey } from '@/lib/reel-ai-drama/development/dedupe';
import {
  ProducerError,
  SEED_FETCH_MAX_CONTENT_TOKENS,
  SEED_FETCHES,
  SEED_MAX_TOKENS,
  SEED_SEARCHES,
  produceSeedPitch,
  producerSeedParams,
  producerSeedUserMessage,
  validatePitch,
  type CreateMessage,
  type SeedStory,
} from '@/lib/reel-ai-drama/development/producer';
import { checkPitch, type DevelopmentDeps } from '@/lib/reel-ai-drama/development/session';
import { centralPlayerId, isoDate } from '@/lib/reel-ai-drama/development/util';
import { RecordingDramaJevRunner } from '@/lib/reel-ai-drama/jev';
import { refillNightStart } from '@/lib/reel-ai-drama/production/schedule';
import { DEFAULT_SETTINGS, type ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import type { Pitch } from '@/lib/reel-ai-drama/types';
import type { Query } from '@/lib/social/store/pg';

import { limitText, type Ledger } from '../budget';
import { doneRequest, failRequest, setStage } from '../requests';
import type { OneBoxInput } from '../types';

export const CAP_REACHED_TEXT = "Tonight's development cap is reached; nothing was spent.";
export const HELD_TEXT = 'Held at the development cap; it will be checked in the next session.';
export const NONE_TEXT = 'The producer found no story there that passes the story test; nothing was added.';
/** Under this much left in the seed's ledger, the checks are not started: the pitch stays `new` for the next session. */
export const MIN_CHECK_USD = 0.02;

/**
 * Assumptions, not measurements (retune from the first live seeds' reel_ai_drama.cost_events, component producer_seed):
 *   CHARS_PER_TOKEN   a conservative 3.5 characters a token for this JSON and prose
 *   RESULT_TOKENS     each search's or fetch's result (a fetch is cut at SEED_FETCH_MAX_CONTENT_TOKENS), re-read on every
 *                     later step: T + (T-1) + ... + 1 reads for T tool uses
 *   steps             a server-tool turn samples once per tool use plus once more; each step re-reads the uncached turn
 *   prefix            the cached system and tools: written once at the 1-hour rate, read on every later step
 */
export const CHARS_PER_TOKEN = 3.5;
export const RESULT_TOKENS = SEED_FETCH_MAX_CONTENT_TOKENS;

const money = (n: number) => Number(n.toFixed(6));
const tokensOf = (chars: number) => Math.ceil(Math.max(0, chars) / CHARS_PER_TOKEN);

/** The sizes of one producer call, in characters: the cached prefix (system + tools) and the uncached messages. */
export type SeedCallSize = { prefixChars: number; userChars: number };

const sizeOf = (params: Anthropic.MessageCreateParamsNonStreaming): SeedCallSize => ({
  prefixChars: JSON.stringify(params.system ?? '').length + JSON.stringify(params.tools ?? []).length,
  userChars: JSON.stringify(params.messages ?? []).length,
});

/** One producer-seed call's worst case at the producer model's price: every search and fetch used, full output. */
export function dramaSeedWorstCaseUsd(size: SeedCallSize, model: string = DEFAULT_SETTINGS.producer_model): number {
  const uses = SEED_SEARCHES + SEED_FETCHES;
  const steps = uses + 1;
  const prefix = tokensOf(size.prefixChars);
  const priced = priceAnthropicUsage(
    {
      uncachedInputTokens: tokensOf(size.userChars) * steps + RESULT_TOKENS * ((uses * (uses + 1)) / 2),
      cacheReadInputTokens: prefix * (steps - 1),
      cacheCreation5mInputTokens: 0,
      cacheCreation1hInputTokens: prefix,
      outputTokens: SEED_MAX_TOKENS,
      webSearchRequests: SEED_SEARCHES,
    },
    { modelId: model },
  );
  return money(Number(priced.costUsd));
}

/** The ledger stopped a call before it was made. */
export class SeedLimitError extends Error {
  constructor() {
    super(limitText('reel_ai_drama'));
  }
}

const MAX_MESSAGE = 600;
const clip = (s: string) => (s.length > MAX_MESSAGE ? `${s.slice(0, MAX_MESSAGE - 1)}…` : s);
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** origin 'seed', status 'new': the columns seedCalibrationPitches uses. */
async function insertSeedPitch(db: Queryable, p: Pitch): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO reel_ai_drama.pitches (origin, title, pitch, event_key, event_date, central_player_id, status)
     VALUES ('seed', $1, $2::jsonb, $3, $4::date, $5, 'new') RETURNING id`,
    [p.title, JSON.stringify(p), eventKey(p), p.event_date, centralPlayerId(p)],
  );
  return rows[0].id;
}

export async function runDramaSeed(i: {
  q: Query;
  id: string;
  input: OneBoxInput;
  db: Queryable;
  deps: DevelopmentDeps;
  settings: ReelAiDramaSettings;
  ledger: Ledger;
  now: Date;
  /** Tests stub the checks. */
  check?: typeof checkPitch;
  /** The time each stage refresh writes (the card's stale clock); tests advance it. `now` stays the run's start (tonight's window). */
  clock?: () => Date;
}): Promise<void> {
  const { q, id, input, db, deps, settings, ledger, now } = i;
  const clock = i.clock ?? (() => new Date());
  const model = settings.producer_model;
  const nightStart = refillNightStart(now);
  const story: SeedStory = { blurb: input.blurb, link: input.link ?? null, today: isoDate(now) };
  let pitchId: string | null = null;
  let checksAdded = false;
  try {
    // Tonight's development cap first: a seed that might pass it makes no call at all.
    const first = producerSeedParams({ loadPrompt: deps.producer.loadPrompt, model }, [{ role: 'user', content: producerSeedUserMessage(story) }]);
    const worst = dramaSeedWorstCaseUsd(sizeOf(first), model);
    if ((await developmentSpendSince(db, nightStart)) + worst > settings.nightly_dev_cap_usd + 1e-9) {
      await failRequest(q, id, CAP_REACHED_TEXT, 0);
      return;
    }

    // The producer: each call priced from the exact request first, its actual cost into the ledger.
    let limited = false;
    const create: CreateMessage = async (params) => {
      if (!ledger.canAfford(dramaSeedWorstCaseUsd(sizeOf(params), String(params.model ?? model)))) {
        limited = true;
        throw new SeedLimitError();
      }
      // Each producer turn refreshes the card, so a long seed is not read as timed out.
      await setStage(q, id, 'writing', ledger.spent, clock());
      const res = await deps.producer.create(params);
      ledger.add(Number(priceAnthropicMessages([res as unknown as MessageUsageLike], { modelId: res.model || String(params.model ?? model) }).costUsd));
      return res;
    };
    await setStage(q, id, 'writing', ledger.spent, clock());
    let candidates: unknown[];
    try {
      candidates = (await produceSeedPitch({ db, create, loadPrompt: deps.producer.loadPrompt, model, sessionId: null }, story)).candidates;
    } catch (err) {
      const msg = limited ? limitText('reel_ai_drama') : clip(`The producer failed: ${err instanceof ProducerError ? err.message.replace(/^producer: /, '') : errText(err)}`);
      await failRequest(q, id, msg, ledger.spent);
      return;
    }

    if (!candidates.length) {
      await failRequest(q, id, NONE_TEXT, ledger.spent);
      return;
    }
    const checked = candidates.map((c) => validatePitch(c, { today: story.today }));
    const ok = checked.find((v) => v.ok);
    if (!ok || !ok.ok) {
      const why = checked.map((v) => (v.ok ? '' : v.why)).filter(Boolean).join('; ');
      await failRequest(q, id, clip(`The producer's pitch didn't pass the checks (${why}); nothing was added.`), ledger.spent);
      return;
    }

    pitchId = await insertSeedPitch(db, ok.pitch);
    // Too little left for the checks: held, the pitch left `new` for the next development session.
    if (ledger.remaining() < MIN_CHECK_USD) {
      checksAdded = true;
      await failRequest(q, id, HELD_TEXT, ledger.spent);
      return;
    }
    await setStage(q, id, 'checking', ledger.spent, clock());
    const jev = new RecordingDramaJevRunner(deps.jevTransport, db, { mode: 'development', sessionId: null });
    const outcome = await (i.check ?? checkPitch)(
      {
        db, jev, deps, sessionId: null, now,
        // The visuals check is the paid step: capped at what this seed has left.
        settings: { ...settings, visuals_check_cap_usd: Math.min(settings.visuals_check_cap_usd, ledger.remaining()) },
        capped: async () => (await developmentSpendSince(db, nightStart)) >= settings.nightly_dev_cap_usd,
      },
      pitchId,
      ok.pitch,
    );
    ledger.add(await spendFor(db, { pitchId }));
    checksAdded = true;
    if (outcome === 'pooled') {
      await doneRequest(q, id, pitchId, ledger.spent);
      return;
    }
    if (outcome === 'held') {
      await failRequest(q, id, HELD_TEXT, ledger.spent);
      return;
    }
    const { rows } = await db.query<{ reject_reason: string | null }>('SELECT reject_reason FROM reel_ai_drama.pitches WHERE id = $1', [pitchId]);
    const reason = rows[0]?.reject_reason ?? outcome;
    await failRequest(q, id, clip(outcome === 'duplicate' ? `Already pitched: ${reason}.` : `Rejected: ${reason}.`), ledger.spent);
  } catch (err) {
    // A pitch left `new` by a failed check is checked again by the next development session.
    if (pitchId && !checksAdded) ledger.add(await spendFor(db, { pitchId }).catch(() => 0));
    const msg = clip(pitchId ? `The checks failed: ${errText(err)}; the pitch is left for the next session.` : `The seed failed: ${errText(err)}`);
    await failRequest(q, id, msg, ledger.spent).catch(() => undefined);
  }
}
