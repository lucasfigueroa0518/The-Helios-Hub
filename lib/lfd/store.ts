/** lfd.* reads and writes, plus the shared 7-day used-photo read (spec §5, §7.1). */
import type { HubQuery } from '@/lib/social-hub/db';

export type PreviousPost = { nyDate: string; ideaIds: string[]; stories: Array<{ headline: string; body: string }> };

/** The last n posts that weren't rejected, newest first. Their stories feed the repeat check (spec §3.3). */
export async function previousPosts(q: HubQuery, n: number): Promise<PreviousPost[]> {
  const { rows } = await q<{ ny_date: string; idea_ids: string[]; stories: Array<{ headline: string; body: string }> }>(
    `SELECT ny_date::text AS ny_date, idea_ids, stories FROM lfd.posts WHERE status <> 'rejected' ORDER BY ny_date DESC, created_at DESC LIMIT $1`,
    [n],
  );
  return rows.map((r) => ({ nyDate: r.ny_date, ideaIds: r.idea_ids, stories: r.stories.map((s) => ({ headline: s.headline, body: s.body })) }));
}

export function usedIdeaIds(previous: PreviousPost[]): Set<string> {
  return new Set(previous.flatMap((p) => p.ideaIds));
}

export async function recentPhotoUrls(q: HubQuery, now: Date, days = 7): Promise<Set<string>> {
  const { rows } = await q<{ url: string }>(
    `SELECT DISTINCT url FROM social.used_photos WHERE used_at > $1::timestamptz - make_interval(days => $2)`,
    [now.toISOString(), days],
  );
  return new Set(rows.map((r) => r.url));
}

/** A run still 'running' after this long died without finishing (crash, killed process); it must not block new runs forever. */
export const ABANDONED_AFTER = '2 hours';

export async function startRun(q: HubQuery, trigger: 'scheduled' | 'manual', capUsd: number, nyDate: string): Promise<string> {
  await q(
    `UPDATE lfd.runs SET status = 'failed', finished_at = now(), stop_reason = 'abandoned'
      WHERE status = 'running' AND started_at < now() - interval '${ABANDONED_AFTER}'`,
  );
  try {
    const { rows } = await q<{ id: string }>(
      `INSERT INTO lfd.runs (trigger, status, started_at, cap_usd, ny_date) VALUES ($1, 'running', now(), $2, $3) RETURNING id`,
      [trigger, capUsd, nyDate],
    );
    return rows[0]!.id;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === '23505' || /idx_lfd_runs_single_running|duplicate key/.test(e.message ?? '')) throw new Error('a Last Few Days run is already in progress');
    throw err;
  }
}

export async function finishRun(
  q: HubQuery,
  id: string,
  o: { status: 'ok' | 'partial' | 'failed' | 'skipped'; stopReason?: string; error?: string; claudeUsd: number; jevUsd: number; record: unknown },
): Promise<boolean> {
  // Only a running run: one the worker already failed (the 30-minute timeout) keeps its failed row.
  const { rows } = await q<{ id: string }>(
    `UPDATE lfd.runs SET status = $2, finished_at = now(), stop_reason = $3, error = $4, claude_usd = $5, jev_usd = $6, total_usd = $5::double precision + $6::double precision, record = $7::jsonb
      WHERE id = $1 AND status = 'running' RETURNING id`,
    [id, o.status, o.stopReason ?? null, o.error ?? null, o.claudeUsd, o.jevUsd, JSON.stringify(o.record)],
  );
  return rows.length > 0;
}

export async function insertPost(
  q: HubQuery,
  p: { runId: string | null; slug: string; nyDate: string; ideaIds: string[]; stories: unknown[]; render: unknown; caption: string; slideObjects: string[]; fitProblems: string[]; renderProblems?: string[]; short: boolean },
): Promise<string> {
  const { rows } = await q<{ id: string }>(
    `INSERT INTO lfd.posts (run_id, slug, ny_date, status, idea_ids, stories, render, caption, slide_objects, fit_problems, render_problems, short)
     VALUES ($1, $2, $3, 'review', $4, $5::jsonb, $6::jsonb, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11) RETURNING id`,
    [p.runId, p.slug, p.nyDate, p.ideaIds, JSON.stringify(p.stories), JSON.stringify(p.render), p.caption, JSON.stringify(p.slideObjects), JSON.stringify(p.fitProblems), JSON.stringify(p.renderProblems ?? []), p.short],
  );
  return rows[0]!.id;
}

export type ClaimedRun = { id: string; trigger: 'scheduled' | 'manual' };

/**
 * Queue a run: the 3:00 clock or the hub's "Make Last Few Days now" (docs/social-overnight.md
 * contract item 1). Null when one is already queued (the single-requested index). Only the worker runs it.
 */
export async function requestRun(q: HubQuery, trigger: 'scheduled' | 'manual', capUsd: number): Promise<string | null> {
  const { rows } = await q<{ id: string }>(
    `INSERT INTO lfd.runs (trigger, status, cap_usd) VALUES ($1, 'requested', $2) ON CONFLICT DO NOTHING RETURNING id::text AS id`,
    [trigger, capUsd],
  );
  return rows[0]?.id ?? null;
}

/** Claim the queued run when none is running. A run left running past ABANDONED_AFTER is failed first, as in startRun. */
export async function claimRun(q: HubQuery, now = new Date()): Promise<ClaimedRun | null> {
  await q(
    `UPDATE lfd.runs SET status = 'failed', finished_at = now(), stop_reason = 'abandoned'
      WHERE status = 'running' AND started_at < now() - interval '${ABANDONED_AFTER}'`,
  );
  try {
    const { rows } = await q<{ id: string; trigger: 'scheduled' | 'manual' }>(
      `UPDATE lfd.runs SET status = 'running', started_at = $1::timestamptz
        WHERE id = (
          SELECT id FROM lfd.runs
           WHERE status = 'requested'
             AND NOT EXISTS (SELECT 1 FROM lfd.runs r WHERE r.status = 'running')
           ORDER BY requested_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1)
        RETURNING id::text AS id, trigger`,
      [now.toISOString()],
    );
    return rows[0] ? { id: rows[0].id, trigger: rows[0].trigger } : null;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return null;
    throw err;
  }
}

/** The claimed run becomes this run: its cap and day are set, nothing new is inserted (spec §7.1 queue). */
export async function adoptRun(q: HubQuery, id: string, capUsd: number, nyDate: string): Promise<string> {
  const { rows } = await q<{ id: string }>(
    `UPDATE lfd.runs SET cap_usd = $2, ny_date = $3::date WHERE id = $1 AND status = 'running' RETURNING id::text AS id`,
    [id, capUsd, nyDate],
  );
  if (!rows[0]) throw new Error(`Last Few Days run ${id} is not running: it was not claimed, or it already finished`);
  return rows[0].id;
}

/** The worker's last word on a claimed run that threw before the engine finished it. */
export async function failRun(q: HubQuery, id: string, error: string): Promise<void> {
  await q(
    `UPDATE lfd.runs SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1 AND status = 'running'`,
    [id, error.slice(0, 2000)],
  );
}
