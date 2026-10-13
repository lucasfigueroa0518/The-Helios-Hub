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

export async function startRun(q: HubQuery, trigger: 'scheduled' | 'manual', capUsd: number, nyDate: string): Promise<string> {
  const { rows } = await q<{ id: string }>(
    `INSERT INTO lfd.runs (trigger, status, started_at, cap_usd, ny_date) VALUES ($1, 'running', now(), $2, $3) RETURNING id`,
    [trigger, capUsd, nyDate],
  );
  return rows[0]!.id;
}

export async function finishRun(
  q: HubQuery,
  id: string,
  o: { status: 'ok' | 'partial' | 'failed' | 'skipped'; stopReason?: string; error?: string; claudeUsd: number; jevUsd: number; record: unknown },
): Promise<void> {
  await q(
    `UPDATE lfd.runs SET status = $2, finished_at = now(), stop_reason = $3, error = $4, claude_usd = $5, jev_usd = $6, total_usd = $5::double precision + $6::double precision, record = $7::jsonb WHERE id = $1`,
    [id, o.status, o.stopReason ?? null, o.error ?? null, o.claudeUsd, o.jevUsd, JSON.stringify(o.record)],
  );
}

export async function insertPost(
  q: HubQuery,
  p: { runId: string | null; slug: string; nyDate: string; ideaIds: string[]; stories: unknown[]; render: unknown; caption: string; slideObjects: string[]; fitProblems: string[]; short: boolean },
): Promise<string> {
  const { rows } = await q<{ id: string }>(
    `INSERT INTO lfd.posts (run_id, slug, ny_date, status, idea_ids, stories, render, caption, slide_objects, fit_problems, short)
     VALUES ($1, $2, $3, 'review', $4, $5::jsonb, $6::jsonb, $7, $8::jsonb, $9::jsonb, $10) RETURNING id`,
    [p.runId, p.slug, p.nyDate, p.ideaIds, JSON.stringify(p.stories), JSON.stringify(p.render), p.caption, JSON.stringify(p.slideObjects), JSON.stringify(p.fitProblems), p.short],
  );
  return rows[0]!.id;
}
