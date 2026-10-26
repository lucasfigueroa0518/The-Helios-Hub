import type { HubQuery } from '@/lib/social-hub/db';
import { settingIsOn, type InsightRow } from '@/lib/social-hub/queries/reels';
import { forVertical, insightRows, type SpineRead } from '@/lib/social-hub/queries/spine';

/**
 * Last Few Days reads (SELECT only; spec §8). Content lives in schema `lfd`:
 * a post is an lfd.posts row; the latest finished run's record feeds the Ideas
 * view. Slots, attempts, approvals and insights come from the shared spine
 * read (queries/spine.ts, D48), mapped to the row shapes below.
 */

export type LfdPostRow = {
  post_id: string;
  run_id: string | null;
  slug: string;
  ny_date: string;
  status: string;
  caption: string | null;
  created_at: string;
  published_at: string | null;
  render: Record<string, unknown> | null;
  stories: unknown;
  slide_count: number | null;
  has_slide_objects: boolean;
  fit_problems: unknown;
  render_problems: unknown;
  short: boolean;
};

export type LfdAttemptRow = {
  attempt_id: string;
  post_id: string;
  status: string;
  trigger: string;
  requested_at: string;
  finished_at: string | null;
  media_id: string | null;
  permalink: string | null;
  error: string | null;
  schedule_id: string | null;
  slot: string | null;
  publish_at: string | null;
  approved_at: string | null;
};

export type LfdScheduleRow = {
  schedule_id: string;
  post_id: string;
  ny_date: string;
  slot: string;
  publish_at: string;
  status: string;
  source: string;
  error: string | null;
  approved_at: string | null;
};

export type LfdRunRow = {
  id: string;
  status: string;
  trigger: string;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  total_usd: number | null;
  stop_reason: string | null;
  record: Record<string, unknown> | null;
};

/** A person's seed (lib/lfd/seeds.ts), as the Ideas view needs it: an lfd.settings row `seed:<storyKey>`. */
export type LfdSeedRow = { key: string; headline: string; url: string; outlet: string; status: string; outcome: string | null; added_at: string | null; expires_at: string | null };

export type LfdRead = {
  posts: LfdPostRow[];
  attempts: LfdAttemptRow[];
  schedules: LfdScheduleRow[];
  insights: InsightRow[];
  /** The newest run that made a post (its record is the Ideas view). */
  latestRun: LfdRunRow | null;
  /** Seeds still waiting (open, not expired, not archived), or made by the latest run. Empty when they cannot be read. */
  seeds: LfdSeedRow[];
  requireApproval: boolean;
};

export const LFD_POSTS_SQL = `
SELECT p.id::text AS post_id, p.run_id::text AS run_id, p.slug, p.ny_date::text AS ny_date, p.status, p.caption,
       p.created_at::text AS created_at, p.published_at::text AS published_at, p.render, p.stories,
       COALESCE(jsonb_array_length(p.slide_objects), jsonb_array_length(p.render->'slides')) AS slide_count,
       (jsonb_typeof(p.slide_objects) = 'array' AND jsonb_array_length(p.slide_objects) > 0) AS has_slide_objects,
       p.fit_problems, p.render_problems, p.short
  FROM lfd.posts p
 ORDER BY p.created_at DESC`;

export const LFD_LATEST_RUN_SQL = `
SELECT id::text AS id, status, trigger, requested_at::text AS requested_at, started_at::text AS started_at,
       finished_at::text AS finished_at, total_usd::float8 AS total_usd, stop_reason, record
  FROM lfd.runs
 WHERE status IN ('ok', 'partial')
 ORDER BY COALESCE(started_at, requested_at) DESC
 LIMIT 1`;

export const LFD_REQUIRE_APPROVAL_SQL = `SELECT value FROM lfd.settings WHERE key = 'require_approval'`;

export const LFD_SEEDS_SQL = `
SELECT substr(s.key, 6) AS key, s.value->>'headline' AS headline, s.value->>'url' AS url, s.value->>'outlet' AS outlet,
       s.value->>'status' AS status, s.value->>'outcome' AS outcome, s.value->>'addedAt' AS added_at, s.value->>'expiresAt' AS expires_at
  FROM lfd.settings s
 WHERE s.key LIKE 'seed:%'
   AND s.value->>'status' = 'open'
   AND (s.value->>'expiresAt')::timestamptz > now()
   AND NOT EXISTS (SELECT 1 FROM social_hub.idea_adjustments a WHERE a.vertical = 'last_few_days' AND a.kind = 'archive' AND a.idea_id = 'last_few_days:story:' || substr(s.key, 6))
 ORDER BY s.value->>'addedAt'`;

export async function readLastFewDays(q: HubQuery, spine: SpineRead): Promise<LfdRead> {
  const [posts, run, approval, seeds] = await Promise.all([
    q<LfdPostRow>(LFD_POSTS_SQL),
    q<LfdRunRow>(LFD_LATEST_RUN_SQL),
    q<{ value: unknown }>(LFD_REQUIRE_APPROVAL_SQL),
    // Seeds never break the page: no table, a bad row, no archive table: none.
    q<LfdSeedRow>(LFD_SEEDS_SQL).then((r) => r.rows, () => [] as LfdSeedRow[]),
  ]);
  const mine = forVertical(spine, 'last_few_days');
  return {
    posts: posts.rows,
    attempts: mine.attempts.filter((a) => a.content_ref).map((a) => ({
      attempt_id: a.attempt_id, post_id: a.content_ref!, status: a.status, trigger: a.trigger,
      requested_at: a.requested_at, finished_at: a.finished_at, media_id: a.media_id, permalink: a.permalink, error: a.error,
      schedule_id: a.schedule_id, slot: a.slot, publish_at: a.publish_at, approved_at: a.approved_at,
    })),
    schedules: mine.schedules.filter((r) => r.content_ref).map((r) => ({
      schedule_id: r.schedule_id, post_id: r.content_ref!, ny_date: r.ny_date, slot: r.slot, publish_at: r.publish_at,
      status: r.status, source: r.source, error: r.error, approved_at: r.approved_at,
    })),
    insights: insightRows(mine.insights, 'last_few_days'),
    latestRun: run.rows[0] ?? null,
    seeds,
    requireApproval: settingIsOn(approval.rows),
  };
}
