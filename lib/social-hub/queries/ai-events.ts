import { SHOWN_POOL_WEEK_SQL } from '@/lib/ai-events/pool-week';
import { EVENT_PICK_VERSION } from '@/lib/networking/pick/score';
import { comingWeek, weekFromKey } from '@/lib/networking/pick/week';
import type { HubQuery } from '@/lib/social-hub/db';
import { settingIsOn, type InsightRow } from '@/lib/social-hub/queries/reels';
import { forVertical, insightRows, type SpineRead } from '@/lib/social-hub/queries/spine';
import type { ScorePart } from '@/lib/social-hub/types';

/**
 * AI Events This Week reads (SELECT only; plan M4). Content lives in schema
 * `ai_events`: a post is an ai_events.posts row (one a week). The Ideas view
 * is the weekly ranked pool (ai_events.pool, written by the ranking run,
 * lib/networking/pick/rank.ts) with each event's listing (networking.events)
 * and its event-pick@1 parts (networking.event_scores). Nothing is ranked or
 * scored on a page view. Slots, attempts, approvals and insights come from
 * the shared spine read (queries/spine.ts, D48).
 */

export type AiEventsPostRow = {
  post_id: string;
  run_id: string | null;
  week_key: string;
  slug: string;
  ny_date: string;
  status: string;
  hook: string;
  look: string;
  caption: string | null;
  cities: unknown;
  event_count: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  render: Record<string, unknown> | null;
  render_version: number;
  slide_count: number | null;
  has_slide_objects: boolean;
  fit_problems: unknown;
  render_problems: unknown;
  /** The ranked post's city (AE-29); null for a four-city post. */
  metro?: string | null;
  /** The history bar tier its picks cleared (AE-28). */
  bar_tier?: string | null;
};

export type AiEventsAttemptRow = {
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

export type AiEventsScheduleRow = {
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

export type AiEventsRunRow = {
  id: string;
  kind: string;
  status: string;
  trigger: string;
  week_key: string | null;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  total_usd: number | null;
  stop_reason: string | null;
  error: string | null;
};

/** One event of the week's pool, with its listing and its stored score parts. */
export type AiEventsPoolRow = {
  event_id: string;
  metro: string;
  rank: number | null;
  score: number | null;
  gate: string | null;
  picked: boolean;
  pick_rank: number | null;
  /** The partner host (AE-27), or null. */
  partner?: string | null;
  pinned_by: string | null;
  pinned_at: string | null;
  excluded_by: string | null;
  excluded_at: string | null;
  updated_at: string;
  title: string;
  start_at: string;
  end_at: string | null;
  timezone: string | null;
  organizer_name: string | null;
  host_name: string | null;
  venue_name: string | null;
  city: string | null;
  guest_count: number | null;
  canonical_url: string | null;
  status: string;
  parts: ScorePart[] | null;
  scored_at: string | null;
};

/** The week the pool shows, and whether Pin / Exclude still change it (only the coming week's post can). */
export type AiEventsWeek = { weekKey: string; startDate: string; endDate: string; editable: boolean };

export type AiEventsRead = {
  posts: AiEventsPostRow[];
  attempts: AiEventsAttemptRow[];
  schedules: AiEventsScheduleRow[];
  insights: InsightRow[];
  pool: AiEventsPoolRow[];
  week: AiEventsWeek;
  /** The newest run (any outcome), for the pool's refill time and the type page. */
  latestRun: AiEventsRunRow | null;
  requireApproval: boolean;
  publishingLive: boolean;
};

export const AI_EVENTS_POSTS_SQL = `
SELECT p.id::text AS post_id, p.run_id::text AS run_id, p.week_key, p.slug, p.ny_date::text AS ny_date, p.status, p.hook, p.look,
       p.caption, p.cities, cardinality(p.event_ids) AS event_count,
       p.created_at::text AS created_at, p.updated_at::text AS updated_at, p.published_at::text AS published_at,
       -- Slide outline the hub paints: layout, alt, and the city / pick titles. Cities stay on p.cities.
       CASE WHEN p.render IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object(
         'slides', (
           SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'layoutVariant', s.slide->'layoutVariant',
             'altText', s.slide->'altText',
             'aiEvents', jsonb_strip_nulls(jsonb_build_object(
               'role', s.slide->'aiEvents'->'role',
               'city', s.slide->'aiEvents'->'city',
               'lead', s.slide->'aiEvents'->'lead',
               'lit', s.slide->'aiEvents'->'lit',
               'pick', CASE WHEN jsonb_typeof(s.slide->'aiEvents'->'pick') = 'object'
                 THEN jsonb_strip_nulls(jsonb_build_object('title', s.slide->'aiEvents'->'pick'->'title')) END,
               'mentions', (
                 SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('title', m.mention->'title')) ORDER BY m.ord), '[]'::jsonb)
                 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.slide->'aiEvents'->'mentions') = 'array' THEN s.slide->'aiEvents'->'mentions' ELSE '[]'::jsonb END)
                   WITH ORDINALITY AS m(mention, ord)
               )
             ))
           ) ORDER BY s.ord), '[]'::jsonb)
           FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.render->'slides') = 'array' THEN p.render->'slides' ELSE '[]'::jsonb END)
             WITH ORDINALITY AS s(slide, ord)
         )
       )) END AS render,
       p.render_version,
       COALESCE(jsonb_array_length(p.slide_objects), jsonb_array_length(p.render->'slides')) AS slide_count,
       (jsonb_typeof(p.slide_objects) = 'array' AND jsonb_array_length(p.slide_objects) > 0) AS has_slide_objects,
       p.fit_problems, p.render_problems, p.metro, p.bar_tier
  FROM ai_events.posts p
 ORDER BY p.created_at DESC`;

export const AI_EVENTS_LATEST_RUN_SQL = `
SELECT id::text AS id, kind, status, trigger, week_key, requested_at::text AS requested_at, started_at::text AS started_at,
       finished_at::text AS finished_at, total_usd::float8 AS total_usd, stop_reason, error
  FROM ai_events.runs
 ORDER BY COALESCE(started_at, requested_at) DESC
 LIMIT 1`;

/** The newest pooled week up to the coming one: during the week that is the week in progress, from Sunday noon the next. */
/** Shared with the pool actions (lib/ai-events/pool.ts), so both always use the same week. */
export const AI_EVENTS_POOL_WEEK_SQL = SHOWN_POOL_WEEK_SQL;

export const AI_EVENTS_POOL_SQL = `
SELECT p.event_id::text AS event_id, p.metro, p.rank, p.score::float8 AS score, p.gate, p.picked, p.pick_rank, p.partner,
       p.pinned_by, p.pinned_at::text AS pinned_at, p.excluded_by, p.excluded_at::text AS excluded_at, p.updated_at::text AS updated_at,
       e.title, e.start_at::text AS start_at, e.end_at::text AS end_at, e.timezone, e.organizer_name, e.host_name, e.venue_name, e.city,
       e.guest_count, e.canonical_url, e.status, s.parts, s.scored_at::text AS scored_at
  FROM ai_events.pool p
  JOIN networking.events e ON e.id = p.event_id
  LEFT JOIN networking.event_scores s ON s.event_id = p.event_id AND s.set_version = $2
 WHERE p.week_key = $1
 ORDER BY p.metro, p.rank NULLS LAST, p.score DESC NULLS LAST, e.start_at`;

export const AI_EVENTS_SETTINGS_SQL = `SELECT key, value FROM ai_events.settings WHERE key IN ('require_approval', 'publishing_live')`;

export async function readAiEvents(q: HubQuery, spine: SpineRead, now = new Date()): Promise<AiEventsRead> {
  const coming = comingWeek(now);
  const [posts, run, settings, latestWeek] = await Promise.all([
    q<AiEventsPostRow>(AI_EVENTS_POSTS_SQL),
    q<AiEventsRunRow>(AI_EVENTS_LATEST_RUN_SQL),
    q<{ key: string; value: unknown }>(AI_EVENTS_SETTINGS_SQL),
    q<{ week_key: string | null }>(AI_EVENTS_POOL_WEEK_SQL, [coming.weekKey]),
  ]);
  const weekKey = latestWeek.rows[0]?.week_key ?? coming.weekKey;
  const shown = weekKey === coming.weekKey ? coming : weekFromKey(weekKey);
  const pool = await q<AiEventsPoolRow>(AI_EVENTS_POOL_SQL, [weekKey, EVENT_PICK_VERSION]);
  const setting = (key: string) => settings.rows.filter((r) => r.key === key);
  const mine = forVertical(spine, 'ai_events');
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
    insights: insightRows(mine.insights, 'ai_events'),
    pool: pool.rows,
    week: { weekKey, startDate: shown.startDate, endDate: shown.endDate, editable: weekKey === coming.weekKey },
    latestRun: run.rows[0] ?? null,
    requireApproval: settingIsOn(setting('require_approval')),
    // Off unless it is literally true (lib/ai-events/settings.ts).
    publishingLive: setting('publishing_live')[0]?.value === true,
  };
}
