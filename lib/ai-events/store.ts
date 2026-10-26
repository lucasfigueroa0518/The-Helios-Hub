/** ai_events.runs and ai_events.posts reads and writes (plan M4; the lib/lfd/store.ts patterns). */
import type { HubQuery } from '@/lib/social-hub/db';

import type { CityPicks } from './types';

export type RunTrigger = 'scheduled' | 'manual';
/** `build` ranks the week (Jev for events not yet scored) and renders; `rebuild` re-renders from the cached scores (AE-04). */
export type RunKind = 'build' | 'rebuild';

export type ClaimedRun = { id: string; trigger: RunTrigger; kind: RunKind; weekKey: string | null; requestedBy: string | null };

/** A run still 'running' after this long died without finishing (crash, killed process); it must not block new runs forever. */
export const ABANDONED_AFTER = '2 hours';

const ABANDON_SQL = `UPDATE ai_events.runs SET status = 'failed', finished_at = now(), stop_reason = 'abandoned'
  WHERE status = 'running' AND started_at < now() - interval '${ABANDONED_AFTER}'`;

/**
 * Queue a run: the Sunday clock, a person's Generate, or Rebuild post (with the week it
 * rebuilds). Null when one is already queued (the single-requested index). Only the worker runs it.
 */
export async function requestRun(
  q: HubQuery,
  trigger: RunTrigger,
  capUsd: number,
  o: { kind?: RunKind; requestedBy?: string | null; weekKey?: string | null } = {},
): Promise<string | null> {
  const { rows } = await q<{ id: string }>(
    `INSERT INTO ai_events.runs (trigger, kind, status, cap_usd, requested_by, week_key)
     VALUES ($1, $2, 'requested', $3, $4, $5) ON CONFLICT DO NOTHING RETURNING id::text AS id`,
    [trigger, o.kind ?? 'build', capUsd, o.requestedBy ?? null, o.weekKey ?? null],
  );
  return rows[0]?.id ?? null;
}

/** Claim the queued run when none is running. A run left running past ABANDONED_AFTER is failed first. */
export async function claimRun(q: HubQuery, now = new Date()): Promise<ClaimedRun | null> {
  await q(ABANDON_SQL);
  try {
    const { rows } = await q<{ id: string; trigger: RunTrigger; kind: RunKind; week_key: string | null; requested_by: string | null }>(
      `UPDATE ai_events.runs SET status = 'running', started_at = $1::timestamptz
        WHERE id = (
          SELECT id FROM ai_events.runs
           WHERE status = 'requested'
             AND NOT EXISTS (SELECT 1 FROM ai_events.runs r WHERE r.status = 'running')
           ORDER BY requested_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1)
        RETURNING id::text AS id, trigger, kind, week_key, requested_by`,
      [now.toISOString()],
    );
    const r = rows[0];
    return r ? { id: r.id, trigger: r.trigger, kind: r.kind, weekKey: r.week_key, requestedBy: r.requested_by } : null;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return null;
    throw err;
  }
}

/** The claimed run's cap, day and week are set; nothing new is inserted. */
export async function adoptRun(q: HubQuery, id: string, o: { capUsd: number; nyDate: string; weekKey: string }): Promise<void> {
  const { rows } = await q<{ id: string }>(
    `UPDATE ai_events.runs SET cap_usd = $2, ny_date = $3::date, week_key = $4 WHERE id = $1 AND status = 'running' RETURNING id::text AS id`,
    [id, o.capUsd, o.nyDate, o.weekKey],
  );
  if (!rows[0]) throw new Error(`AI Events run ${id} is not running: it was not claimed, or it already finished`);
}

/** Only a running run: one the worker already failed (the 30-minute timeout) keeps its failed row. */
export async function finishRun(
  q: HubQuery,
  id: string,
  o: { status: 'ok' | 'partial' | 'failed' | 'skipped'; stopReason?: string; error?: string; jevUsd: number; record: unknown },
): Promise<boolean> {
  const { rows } = await q<{ id: string }>(
    `UPDATE ai_events.runs SET status = $2, finished_at = now(), stop_reason = $3, error = $4, claude_usd = 0, jev_usd = $5,
            total_usd = $5::double precision, record = $6::jsonb
      WHERE id = $1 AND status = 'running' RETURNING id`,
    [id, o.status, o.stopReason ?? null, o.error ? o.error.slice(0, 2000) : null, o.jevUsd, JSON.stringify(o.record ?? {})],
  );
  return rows.length > 0;
}

/** The worker's last word on a claimed run that threw before it was finished. */
export async function failRun(q: HubQuery, id: string, error: string): Promise<void> {
  await q(`UPDATE ai_events.runs SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1 AND status = 'running'`, [id, error.slice(0, 2000)]);
}

// ── Posts ───────────────────────────────────────────────────────────────────

export type WeekPost = {
  id: string;
  slug: string;
  status: 'preview' | 'review' | 'published' | 'rejected';
  hook: string;
  look: string;
  renderVersion: number;
};

/**
 * The week's post that is not rejected, or null (at most one per city, AE-29). `metro` names the
 * city; without it, any of the week's posts.
 */
export async function weekPost(q: HubQuery, weekKey: string, metro?: string): Promise<WeekPost | null> {
  const { rows } = await q<{ id: string; slug: string; status: WeekPost['status']; hook: string; look: string; render_version: number }>(
    `SELECT id::text AS id, slug, status, hook, look, render_version FROM ai_events.posts
      WHERE week_key = $1 AND status <> 'rejected' AND ($2::text IS NULL OR metro = $2)
      ORDER BY created_at DESC LIMIT 1`,
    [weekKey, metro ?? null],
  );
  const r = rows[0];
  return r ? { id: r.id, slug: r.slug, status: r.status, hook: r.hook, look: r.look, renderVersion: Number(r.render_version) } : null;
}

/**
 * The hooks and looks of the latest posts that weren't rejected, newest first (AE-13: a new
 * post repeats no hook of the last 4 and no look of the last 2). `exceptWeek` leaves out that
 * week's own post.
 */
export async function recentDraws(q: HubQuery, n: number, exceptWeek: string | null = null): Promise<{ hooks: string[]; looks: string[] }> {
  const { rows } = await q<{ hook: string; look: string }>(
    `SELECT hook, look FROM ai_events.posts
      WHERE status <> 'rejected' AND ($2::text IS NULL OR week_key <> $2)
      ORDER BY ny_date DESC, created_at DESC LIMIT $1`,
    [n, exceptWeek],
  );
  return { hooks: rows.map((r) => r.hook), looks: rows.map((r) => r.look) };
}

/** A free slug for the week (and city): `ai-events-2026-w44-miami`, then `-2`, `-3` after rejected posts. */
export async function freeSlug(q: HubQuery, weekKey: string, metro?: string): Promise<string> {
  const base = `ai-events-${weekKey.toLowerCase().replace(/[^a-z0-9]+/g, '-')}${metro ? `-${metro}` : ''}`;
  const { rows } = await q<{ slug: string }>(`SELECT slug FROM ai_events.posts WHERE slug = $1 OR slug LIKE $2`, [base, `${base}-%`]);
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i += 1) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

export type SavedPost = {
  runId: string | null;
  weekKey: string;
  nyDate: string;
  hook: string;
  look: string;
  eventIds: string[];
  cities: CityPicks[];
  render: unknown;
  caption: string;
  slideObjects: string[];
  /** The post's city (AE-29); absent for the four-city post. */
  metro?: string | null;
  /** The history bar tier its picks cleared (AE-28). */
  barTier?: string | null;
};

export async function insertPost(q: HubQuery, slug: string, p: SavedPost): Promise<string> {
  const { rows } = await q<{ id: string }>(
    `INSERT INTO ai_events.posts (run_id, week_key, slug, ny_date, status, hook, look, event_ids, cities, render, caption, render_version, slide_objects, metro, bar_tier)
     VALUES ($1, $2, $3, $4::date, 'review', $5, $6, $7, $8::jsonb, $9::jsonb, $10, 1, $11::jsonb, $12, $13) RETURNING id::text AS id`,
    [p.runId, p.weekKey, slug, p.nyDate, p.hook, p.look, p.eventIds, JSON.stringify(p.cities), JSON.stringify(p.render), p.caption, JSON.stringify(p.slideObjects), p.metro ?? null, p.barTier ?? null],
  );
  return rows[0]!.id;
}

/** A rebuild: the same row gets the new picks, render and slides; its hook, look, spine item and slot stay. Review posts only. */
export async function updatePostRender(q: HubQuery, postId: string, renderVersion: number, p: Omit<SavedPost, 'weekKey' | 'nyDate' | 'hook' | 'look'>): Promise<boolean> {
  const { rows } = await q<{ id: string }>(
    `UPDATE ai_events.posts SET run_id = $2, event_ids = $3, cities = $4::jsonb, render = $5::jsonb, caption = $6, render_version = $7,
            slide_objects = $8::jsonb, fit_problems = '[]'::jsonb, render_problems = '[]'::jsonb, bar_tier = coalesce($9, bar_tier), updated_at = now()
      WHERE id = $1 AND status = 'review' RETURNING id`,
    [postId, p.runId, p.eventIds, JSON.stringify(p.cities), JSON.stringify(p.render), p.caption, renderVersion, JSON.stringify(p.slideObjects), p.barTier ?? null],
  );
  return rows.length > 0;
}
