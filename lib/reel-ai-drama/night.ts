import type { Queryable } from '@/lib/explainers/db';
import { recentPlayers } from '@/lib/reel-ai-drama/development/pool';
import { spineOf } from '@/lib/reel-ai-drama/publish/items';
import { DRAMA_PLACEABLE_RENDERS, dramaPostsPerDay, dramaPublishingLive, dramaRequireApproval, scheduleDramaJob, type DramaScheduleOutcome } from '@/lib/reel-ai-drama/publish/schedule';
import { dramaSpendOn, nyDateOf, requestDramaJob } from '@/lib/reel-ai-drama/requests';
import { readDramaGate, type DramaGate } from '@/lib/reel-ai-drama/gate';
import { loadSettings } from '@/lib/reel-ai-drama/settings';
import { dailyFillOrQuota } from '@/lib/social-hub/fill';
import { fillDates, leadDaysFor } from '@/lib/social-hub/lead';
import { markPromoteUsed, readMoves, recordPromoteSkip, type MovesQuery } from '@/lib/social-hub/moves-store';
import { queueOrder } from '@/lib/social-hub/queue';
import { finishNightPlacements } from '@/lib/social-hub/queue-store';
import { quotaFromSlots } from '@/lib/social-hub/slots';
import { tonightMoves, type IdeaAdjustment } from '@/lib/social-hub/views/moves';

/**
 * The nightly fill for AI Drama reels (HUB-WIRING-CONTRACT.md §4.6; mirrors runIdeaCycle's fill). From
 * DRAMA_NIGHT_HOUR_NY, while the type makes posts (Approval or Live, D16), the night fills the dates it makes ahead (Bald-Eagle D4, D8;
 * lib/social-hub/lead.ts): `fillDates(runDay, 2)`, the run day through day+2. Each date is filled once (a `reel_ai_drama.nights`
 * row per TARGET date, see below), with that date's quota less every booking already on it; surviving approved renders
 * are booked on that date (never made again), pooled pitches are requested (trigger 'auto', stamped with the date in
 * `night_date`) under that date's caps. No model call here.
 *
 * The once-a-night guard is keyed by the target date (`nights.ny_date` = the date filled; the run day is its
 * `started_at`). A date is filled once whatever happens to its items later, and the run happens once a night: on the
 * cutover night (D8) no date ahead has a row, so day+1 and day+2 are filled (and the run day too, unless the old
 * same-day night already filled it: its row has the same key); every later night finds the run day and day+1 filled
 * by the two nights before and fills only day+2. Freshness (the spread rule) is measured from the run time.
 */

/** `paused`: the type makes no posts (D16); `auto_off` is its older name, no longer returned. */
export type DramaNightSkip = 'paused' | 'auto_off' | 'already_ran_today' | 'quota_filled' | 'daily_spend_cap' | 'pool_empty';

/** What the run did for one date it fills. `already_ran_today`: that date was already filled (by an earlier night). */
export type DramaNightDate =
  | { nyDate: string; status: 'skipped'; reason: DramaNightSkip }
  | { nyDate: string; status: 'ok'; nightId: string; quota: number; placed: number; requested: string[]; allocated: DramaAllocation[] }
  | { nyDate: string; status: 'failed'; nightId: string; error: string };

export type DramaAllocation = { pitchId: string; jobId: string; scheduled: DramaScheduleOutcome | null };

/**
 * The run's outcome. Skipped: no date did anything (the reason of the last date that had one, else
 * `already_ran_today`). Ok: the dates that ran, summed (`nyDate`/`nightId`: the last of them; `dates`: each date).
 * Failed: the first date that failed (a passing outage; the worker's next poll retries it, up to NIGHT_TRIES).
 */
export type DramaNightResult =
  | { status: 'skipped'; reason: DramaNightSkip }
  | { status: 'ok'; nightId: string; nyDate: string; quota: number; placed: number; requested: string[]; allocated: DramaAllocation[]; dates: DramaNightDate[] }
  | { status: 'failed'; nightId: string; error: string };

export const DRAMA_GONE = 'It isn’t in the AI Drama pool any more (made, posted or cut).';
export const ideaOfPitch = (pitchId: string) => `reel_ai_drama:pitch:${pitchId}`;

type Candidate = { pitchId: string; title: string; jobId: string | null; player: string | null; score: number | null };

/** Pooled pitches and pitches whose newest finished reel is placeable and never posted, best first by rank_score. */
async function candidates(db: Queryable, approvalNeeded: boolean): Promise<Candidate[]> {
  const { rows } = await db.query<{ pitch_id: string; title: string; job_id: string | null; player: string | null; score: string | null }>(
    `WITH placeable AS (${DRAMA_PLACEABLE_RENDERS}),
     newest AS (
       SELECT DISTINCT ON (pitch_id) id, pitch_id FROM reel_ai_drama.jobs WHERE status = 'ok'
        ORDER BY pitch_id, finished_at DESC NULLS LAST, seq DESC)
     SELECT p.id::text AS pitch_id, p.title, n.id::text AS job_id, p.central_player_id AS player, p.rank_score::text AS score
       FROM reel_ai_drama.pitches p
       LEFT JOIN newest n ON n.pitch_id = p.id AND p.status = 'made' AND n.id IN (SELECT id FROM placeable)
      WHERE p.status = 'pooled'
         OR (n.id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM reel_ai_drama.jobs j2
                               JOIN social_hub.content_items ci2 ON ci2.vertical = 'reel_ai_drama' AND ci2.native_ref = j2.id::text
                               JOIN social_hub.publish_attempts pa ON pa.content_item_id = ci2.id
                              WHERE j2.pitch_id = p.id AND pa.status = 'published'))
      ORDER BY p.rank_score DESC NULLS LAST, p.created_at`,
    [approvalNeeded],
  );
  return rows.map((r) => ({ pitchId: r.pitch_id, title: r.title, jobId: r.job_id, player: r.player, score: r.score == null ? null : Number(r.score) }));
}

async function writeSkipped(db: Queryable, day: string, reason: string, quota = 0): Promise<void> {
  // One row a date: a skipped date is recorded once, the first time (later polls only re-check).
  await db.query(
    `INSERT INTO reel_ai_drama.nights (ny_date, status, quota, skip_reason, finished_at)
     SELECT $1::date, 'skipped', $2, $3, now()
      WHERE NOT EXISTS (SELECT 1 FROM reel_ai_drama.nights WHERE ny_date = $1::date)`,
    [day, quota, reason],
  ).catch(() => undefined);
}

/** How many failed runs a date may have before the night stops trying to fill it. */
const NIGHT_TRIES = 2;

type RunState = {
  db: Queryable;
  now: Date;
  log: (e: string, f?: Record<string, unknown>) => void;
  movesQ: MovesQuery;
  settings: Awaited<ReturnType<typeof loadSettings>>;
  moves: IdeaAdjustment[] | null;
  /** Survivors this run already placed (on an earlier date): never placed twice in one run. */
  placedJobs: Set<string>;
  /** Players this run already chose (the spread rule counts tonight's picks across the dates it fills). */
  players: Set<string>;
  pinsChecked: boolean;
  capped: boolean;
};

/** Fill one target date (once): its quota less every booking on it, under its own caps. */
async function fillDate(st: RunState, day: string): Promise<DramaNightDate> {
  const { db, now, log, movesQ, settings } = st;
  const { rows: ran } = await db.query<{ done: boolean; failed: number | string }>(
    `SELECT bool_or(status IN ('running', 'ok')) AS done, count(*) FILTER (WHERE status = 'failed') AS failed
       FROM reel_ai_drama.nights WHERE ny_date = $1::date`,
    [day],
  );
  if (ran[0]?.done || Number(ran[0]?.failed ?? 0) >= NIGHT_TRIES) return { nyDate: day, status: 'skipped', reason: 'already_ran_today' };

  // A failed slot read throws (ruling P2); a failed read of placements fills the whole quota. Lead time: every booking
  // already on the date counts (the night's own from an earlier run too), not only a person's.
  const quota = (await quotaFromSlots((text, params) => db.query(text, params) as never, 'reel_ai_drama', day)) ?? (await dramaPostsPerDay(db));
  const fill = await dailyFillOrQuota(
    spineOf(db),
    'reel_ai_drama',
    day,
    quota,
    (error) => log('fill_failed', { nyDate: day, error: error instanceof Error ? error.message : String(error) }),
    { lead: leadDaysFor('reel_ai_drama') },
  );
  if (fill.making < 1) {
    await writeSkipped(db, day, 'quota_filled', quota);
    return { nyDate: day, status: 'skipped', reason: 'quota_filled' };
  }
  if ((await dramaSpendOn(db, day)) >= settings.daily_spend_cap_usd) {
    await writeSkipped(db, day, 'daily_spend_cap', quota);
    return { nyDate: day, status: 'skipped', reason: 'daily_spend_cap' };
  }

  st.moves ??= await readMoves(movesQ, 'reel_ai_drama').catch(() => []);
  const moves = st.moves;
  const all = (await candidates(db, await dramaRequireApproval(db))).filter((c) => !(c.jobId && st.placedJobs.has(c.jobId)));
  const ordered = queueOrder(all.map((c) => ({ id: ideaOfPitch(c.pitchId), score: c.score, c })), moves.filter((m) => m.vertical === 'reel_ai_drama'));
  // MD-32 spread: one documentary per player within spread_days of the run, counting tonight's picks (every date this
  // run fills). A surviving render is exempt (it is already made); a pinned pitch too (a person's call).
  const blocked = new Set([...(await recentPlayers(db, settings.spread_days, now)), ...st.players]);
  const chosen: Candidate[] = [];
  for (const q of ordered) {
    if (chosen.length >= fill.making) break;
    const c = q.item.c;
    if (!c.jobId && !q.pinned && c.player && blocked.has(c.player)) continue;
    chosen.push(c);
    if (c.player) blocked.add(c.player);
  }
  if (!chosen.length) {
    await writeSkipped(db, day, 'pool_empty', quota);
    return { nyDate: day, status: 'skipped', reason: 'pool_empty' };
  }

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO reel_ai_drama.nights (ny_date, status, quota) VALUES ($1::date, 'running', $2) ON CONFLICT DO NOTHING RETURNING id`,
    [day, quota],
  );
  const nightId = rows[0]?.id;
  if (!nightId) return { nyDate: day, status: 'skipped', reason: 'already_ran_today' };
  // A skipped row recorded earlier for this date gives way to the run that filled it.
  await db.query(`DELETE FROM reel_ai_drama.nights WHERE ny_date = $1::date AND status = 'skipped'`, [day]);

  try {
    if (!st.pinsChecked) {
      st.pinsChecked = true;
      const makeable = new Set(all.map((c) => ideaOfPitch(c.pitchId)));
      for (const pin of tonightMoves(moves, 'reel_ai_drama').pins) {
        if (!makeable.has(pin.ideaId)) await recordPromoteSkip(movesQ, 'reel_ai_drama', pin.ideaId, DRAMA_GONE).catch(() => false);
      }
    }
    const handMoved = new Set(moves.filter((m) => m.kind === 'pin' || m.kind === 'promote' || m.kind === 'place').map((m) => m.ideaId));
    const live = await dramaPublishingLive(db);
    const requested: string[] = [];
    const allocated: DramaAllocation[] = [];
    let capped = false;
    for (const c of chosen) {
      const idea = ideaOfPitch(c.pitchId);
      if (c.player) st.players.add(c.player);
      if (c.jobId) {
        // A surviving render is booked on the date this run fills, not the earliest open slot.
        const scheduled = live ? await scheduleDramaJob(db, c.jobId, 'auto', now, day, undefined, day) : null;
        st.placedJobs.add(c.jobId);
        allocated.push({ pitchId: c.pitchId, jobId: c.jobId, scheduled });
        if (handMoved.has(idea)) await markPromoteUsed(movesQ, 'reel_ai_drama', idea).catch(() => false);
        continue;
      }
      if (capped) continue;
      const req = await requestDramaJob(db, { pitchId: c.pitchId, by: 'night', now, trigger: 'auto', nightDate: day });
      if (req.ok) {
        requested.push(req.jobId);
        if (handMoved.has(idea)) await markPromoteUsed(movesQ, 'reel_ai_drama', idea).catch(() => false);
      } else {
        log('night_request_refused', { pitchId: c.pitchId, nyDate: day, reason: req.reason });
        if (req.reason === 'daily_render_cap' || req.reason === 'daily_spend_cap') capped = true;
      }
    }
    if (capped) st.capped = true;
    const placed = requested.length + allocated.length;
    await db.query(
      `UPDATE reel_ai_drama.nights SET status = 'ok', finished_at = now(), placed = $2, requested = $3::jsonb, allocated = $4::jsonb,
              skip_reason = CASE WHEN $5::boolean THEN 'daily_cap' ELSE NULL END WHERE id = $1`,
      [nightId, placed, JSON.stringify(requested), JSON.stringify(allocated), capped],
    );
    return { nyDate: day, status: 'ok', nightId, quota, placed, requested, allocated };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.query(`UPDATE reel_ai_drama.nights SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1`, [nightId, message]).catch(() => undefined);
    log('night_failed', { nightId, nyDate: day, error: message });
    return { nyDate: day, status: 'failed', nightId, error: message };
  }
}

/**
 * The make step (D16): runs only while the type makes posts (Approval or Live); it books only while Live
 * (dramaPublishingLive). The pool's refill (tending, weekly development) runs apart from it, in every state.
 */
export async function runDramaNight(deps: { db: Queryable; moves?: MovesQuery; now?: Date; log?: (e: string, f?: Record<string, unknown>) => void; gate?: DramaGate }): Promise<DramaNightResult> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const log = deps.log ?? (() => undefined);
  const movesQ: MovesQuery = deps.moves ?? ((text, params) => db.query(text, params as never) as never);
  const movesReadAt = new Date();
  const settings = await loadSettings(db);
  const gate = deps.gate ?? (await readDramaGate(db));
  if (gate.mismatch) log('state_mismatch', { vertical: 'reel_ai_drama', state: gate.state });
  if (!gate.makes) return { status: 'skipped', reason: 'paused' };

  const st: RunState = { db, now, log, movesQ, settings, moves: null, placedJobs: new Set(), players: new Set(), pinsChecked: false, capped: false };
  const dates: DramaNightDate[] = [];
  // The dates the run fills, earliest first (cutover: day+1 and day+2; then day+2). A failed date stops the run: the
  // worker's next poll retries it (and reaches the later date then).
  for (const day of fillDates(nyDateOf(now), leadDaysFor('reel_ai_drama'))) {
    const out = await fillDate(st, day);
    dates.push(out);
    if (out.status === 'failed') break;
  }

  const ok = dates.filter((d): d is Extract<DramaNightDate, { status: 'ok' }> => d.status === 'ok');
  // The run made its picks: hand placements are used up and the ideas compete by score again (a run that filled no date
  // never reaches here). A capped date left ideas it chose unmade: their placements stay for the next night.
  if (ok.length && !st.capped) await finishNightPlacements(movesQ, 'reel_ai_drama', undefined, movesReadAt);

  const failed = dates.find((d): d is Extract<DramaNightDate, { status: 'failed' }> => d.status === 'failed');
  if (failed) return { status: 'failed', nightId: failed.nightId, error: failed.error };
  if (ok.length) {
    const last = ok[ok.length - 1]!;
    return {
      status: 'ok',
      nightId: last.nightId,
      nyDate: last.nyDate,
      quota: ok.reduce((n, d) => n + d.quota, 0),
      placed: ok.reduce((n, d) => n + d.placed, 0),
      requested: ok.flatMap((d) => d.requested),
      allocated: ok.flatMap((d) => d.allocated),
      dates,
    };
  }
  const reasons = dates.flatMap((d) => (d.status === 'skipped' && d.reason !== 'already_ran_today' ? [d.reason] : []));
  return { status: 'skipped', reason: reasons[reasons.length - 1] ?? 'already_ran_today' };
}

// ── Once a day: tend the pool, regardless of `auto` (§7.1 item 4) ─────────

export async function readWorkerState<T>(db: Queryable, key: string): Promise<T | null> {
  const { rows } = await db.query<{ value: unknown }>(`SELECT value FROM reel_ai_drama.worker_state WHERE key = $1`, [key]);
  const v = rows[0]?.value;
  return (typeof v === 'string' ? JSON.parse(v) : v ?? null) as T | null;
}

export async function writeWorkerState(db: Queryable, key: string, value: unknown): Promise<void> {
  await db.query(
    `INSERT INTO reel_ai_drama.worker_state (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

/** Tend the pool once per New York day (worker_state.pool_tended). Null when it already ran today. */
export async function tendPoolOncePerDay<T>(db: Queryable, tend: () => Promise<T>, now = new Date()): Promise<T | null> {
  const day = nyDateOf(now);
  const last = await readWorkerState<{ nyDate?: string }>(db, 'pool_tended');
  if (last?.nyDate === day) return null;
  const out = await tend();
  await writeWorkerState(db, 'pool_tended', { nyDate: day, at: now.toISOString() });
  return out;
}
