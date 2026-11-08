import type { Queryable } from '@/lib/explainers/db';
import { recentPlayers } from '@/lib/reel-ai-drama/development/pool';
import { spineOf } from '@/lib/reel-ai-drama/publish/items';
import { DRAMA_PLACEABLE_RENDERS, dramaPostsPerDay, dramaPublishingLive, dramaRequireApproval, scheduleDramaJob, type DramaScheduleOutcome } from '@/lib/reel-ai-drama/publish/schedule';
import { dramaSpendOn, nyDateOf, requestDramaJob } from '@/lib/reel-ai-drama/requests';
import { loadSettings } from '@/lib/reel-ai-drama/settings';
import { dailyFillOrQuota } from '@/lib/social-hub/fill';
import { markPromoteUsed, readMoves, recordPromoteSkip, type MovesQuery } from '@/lib/social-hub/moves-store';
import { queueOrder } from '@/lib/social-hub/queue';
import { finishNightPlacements } from '@/lib/social-hub/queue-store';
import { quotaFromSlots } from '@/lib/social-hub/slots';
import { tonightMoves, type IdeaAdjustment } from '@/lib/social-hub/views/moves';

/**
 * The nightly fill for AI Drama reels (HUB-WIRING-CONTRACT.md §4.6; mirrors runIdeaCycle's fill). Once per New York day
 * from DRAMA_NIGHT_HOUR_NY, while `auto` is on: the day's quota less what people placed; surviving approved renders
 * are booked (never made again), pooled pitches are requested (trigger 'auto') under the daily caps. No model call here.
 */

export type DramaNightResult =
  | { status: 'skipped'; reason: 'auto_off' | 'already_ran_today' | 'quota_filled' | 'daily_spend_cap' | 'pool_empty' }
  | { status: 'ok'; nightId: string; nyDate: string; quota: number; placed: number; requested: string[]; allocated: Array<{ pitchId: string; jobId: string; scheduled: DramaScheduleOutcome | null }> }
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
  // One row a day: a skipped night is recorded once, the first time (later polls only re-check).
  await db.query(
    `INSERT INTO reel_ai_drama.nights (ny_date, status, quota, skip_reason, finished_at)
     SELECT $1::date, 'skipped', $2, $3, now()
      WHERE NOT EXISTS (SELECT 1 FROM reel_ai_drama.nights WHERE ny_date = $1::date)`,
    [day, quota, reason],
  ).catch(() => undefined);
}

/** How many failed nights a day may have before the night stops trying until tomorrow. */
const NIGHT_TRIES = 2;

export async function runDramaNight(deps: { db: Queryable; moves?: MovesQuery; now?: Date; log?: (e: string, f?: Record<string, unknown>) => void }): Promise<DramaNightResult> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const log = deps.log ?? (() => undefined);
  const movesQ: MovesQuery = deps.moves ?? ((text, params) => db.query(text, params as never) as never);
  const movesReadAt = new Date();
  const settings = await loadSettings(db);
  if (!settings.auto) return { status: 'skipped', reason: 'auto_off' };
  const day = nyDateOf(now);

  // One night a day. A failed night may be retried once (a passing outage), never more: each try requests jobs.
  const { rows: ran } = await db.query<{ done: boolean; failed: number | string }>(
    `SELECT bool_or(status IN ('running', 'ok')) AS done, count(*) FILTER (WHERE status = 'failed') AS failed
       FROM reel_ai_drama.nights WHERE ny_date = $1::date`,
    [day],
  );
  if (ran[0]?.done || Number(ran[0]?.failed ?? 0) >= NIGHT_TRIES) return { status: 'skipped', reason: 'already_ran_today' };

  // A failed slot read throws (ruling P2); a failed read of placements fills the whole quota.
  const quota = (await quotaFromSlots((text, params) => db.query(text, params) as never, 'reel_ai_drama', day)) ?? (await dramaPostsPerDay(db));
  const fill = await dailyFillOrQuota(spineOf(db), 'reel_ai_drama', day, quota, (error) =>
    log('fill_failed', { nyDate: day, error: error instanceof Error ? error.message : String(error) }),
  );
  if (fill.making < 1) {
    await writeSkipped(db, day, 'quota_filled', quota);
    return { status: 'skipped', reason: 'quota_filled' };
  }
  if ((await dramaSpendOn(db, day)) >= settings.daily_spend_cap_usd) {
    await writeSkipped(db, day, 'daily_spend_cap', quota);
    return { status: 'skipped', reason: 'daily_spend_cap' };
  }

  const moves: IdeaAdjustment[] = await readMoves(movesQ, 'reel_ai_drama').catch(() => []);
  const all = await candidates(db, await dramaRequireApproval(db));
  const ordered = queueOrder(all.map((c) => ({ id: ideaOfPitch(c.pitchId), score: c.score, c })), moves.filter((m) => m.vertical === 'reel_ai_drama'));
  // MD-32 spread: one documentary per player within spread_days, counting tonight's picks. A surviving render is exempt
  // (it is already made); a pinned pitch too (a person's call).
  const blocked = await recentPlayers(db, settings.spread_days, now);
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
    return { status: 'skipped', reason: 'pool_empty' };
  }

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO reel_ai_drama.nights (ny_date, status, quota) VALUES ($1::date, 'running', $2) ON CONFLICT DO NOTHING RETURNING id`,
    [day, quota],
  );
  const nightId = rows[0]?.id;
  if (!nightId) return { status: 'skipped', reason: 'already_ran_today' };
  // A skipped row recorded earlier today gives way to the night that ran.
  await db.query(`DELETE FROM reel_ai_drama.nights WHERE ny_date = $1::date AND status = 'skipped'`, [day]);

  try {
    const makeable = new Set(all.map((c) => ideaOfPitch(c.pitchId)));
    for (const pin of tonightMoves(moves, 'reel_ai_drama').pins) {
      if (!makeable.has(pin.ideaId)) await recordPromoteSkip(movesQ, 'reel_ai_drama', pin.ideaId, DRAMA_GONE).catch(() => false);
    }
    const handMoved = new Set(moves.filter((m) => m.kind === 'pin' || m.kind === 'promote' || m.kind === 'place').map((m) => m.ideaId));
    const live = await dramaPublishingLive(db);
    const requested: string[] = [];
    const allocated: Array<{ pitchId: string; jobId: string; scheduled: DramaScheduleOutcome | null }> = [];
    let capped = false;
    for (const c of chosen) {
      const idea = ideaOfPitch(c.pitchId);
      if (c.jobId) {
        const scheduled = live ? await scheduleDramaJob(db, c.jobId, 'auto', now) : null;
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
        log('night_request_refused', { pitchId: c.pitchId, reason: req.reason });
        if (req.reason === 'daily_render_cap' || req.reason === 'daily_spend_cap') capped = true;
      }
    }
    if (!capped) await finishNightPlacements(movesQ, 'reel_ai_drama', undefined, movesReadAt);
    const placed = requested.length + allocated.length;
    await db.query(
      `UPDATE reel_ai_drama.nights SET status = 'ok', finished_at = now(), placed = $2, requested = $3::jsonb, allocated = $4::jsonb,
              skip_reason = CASE WHEN $5::boolean THEN 'daily_cap' ELSE NULL END WHERE id = $1`,
      [nightId, placed, JSON.stringify(requested), JSON.stringify(allocated), capped],
    );
    return { status: 'ok', nightId, nyDate: day, quota, placed, requested, allocated };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.query(`UPDATE reel_ai_drama.nights SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1`, [nightId, message]).catch(() => undefined);
    log('night_failed', { nightId, error: message });
    return { status: 'failed', nightId, error: message };
  }
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
