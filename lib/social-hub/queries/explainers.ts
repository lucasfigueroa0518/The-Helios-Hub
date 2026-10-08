import type { HubQuery } from '@/lib/social-hub/db';
import { settingIsOn, type InsightRow } from '@/lib/social-hub/queries/reels';

/** Explainer Reels reads (SELECT only). Post = render job; idea = topic (spec §9a). */

export type ExplainerJobRow = {
  job_id: string;
  topic_id: string;
  status: string;
  trigger: string;
  mode: string;
  spend_usd: number | string;
  requested_at: string;
  finished_at: string | null;
  error: string | null;
  title: string;
  scope: string | null;
  source_url: string | null;
  origin: string;
  audience_fit: number | string | null;
  teachability_45s: number | string | null;
  analogy_potential: number | string | null;
  visual_potential: number | string | null;
  accuracy_under_simplification: number | string | null;
  hook_strength: number | string | null;
  weighted_score: number | string | null;
  verdict: string | null;
  tags: string[] | null;
  feedback_at: string | null;
  video_artifact_id: string | null;
  video_location: string | null;
};

export type ExplainerAttemptRow = {
  attempt_id: string;
  job_id: string;
  status: string;
  trigger: string;
  requested_at: string;
  finished_at: string | null;
  media_id: string | null;
  permalink: string | null;
  error: string | null;
  caption: string;
  schedule_id: string | null;
  slot: string | null;
  publish_at: string | null;
};

export type ExplainerScheduleRow = {
  schedule_id: string;
  job_id: string;
  ny_date: string;
  slot: string;
  publish_at: string;
  status: string;
  source: string;
  error: string | null;
};

export type ExplainerTopicRow = {
  topic_id: string;
  title: string;
  scope: string | null;
  status: string;
  origin: string;
  weighted_score: number | string | null;
  created_at: string;
  ok_jobs: number;
  last_render_at: string | null;
  published: boolean;
  scheduled: boolean;
};

export type ExplainersRead = {
  jobs: ExplainerJobRow[];
  attempts: ExplainerAttemptRow[];
  schedules: ExplainerScheduleRow[];
  insights: InsightRow[];
  topics: ExplainerTopicRow[];
  requireApproval: boolean;
};

export const EXPLAINER_JOBS_SQL = `
SELECT j.id AS job_id, j.topic_id, j.status, j.trigger, j.mode, j.spend_usd,
       j.requested_at::text AS requested_at, j.finished_at::text AS finished_at, j.error,
       t.title, t.scope, t.source_url, t.origin,
       t.audience_fit, t.teachability_45s, t.analogy_potential, t.visual_potential,
       t.accuracy_under_simplification, t.hook_strength, t.weighted_score,
       f.verdict, f.tags, f.updated_at::text AS feedback_at,
       vid.id AS video_artifact_id, vid.storage_location AS video_location
  FROM explainers.jobs j
  JOIN explainers.topics t ON t.id = j.topic_id
  LEFT JOIN explainers.feedback f ON f.job_id = j.id
  LEFT JOIN LATERAL (
    SELECT a.id, a.storage_location
      FROM explainers.artifacts a
     WHERE a.job_id = j.id AND a.kind = 'video'
     ORDER BY a.seq DESC
     LIMIT 1
  ) vid ON true
 ORDER BY j.seq DESC`;

// Slots, attempts and insights live on the lifecycle spine (social_hub, vertical 'explainers', D36).
export const EXPLAINER_ATTEMPTS_SQL = `
SELECT a.id AS attempt_id, ci.native_ref AS job_id, a.status, a.trigger,
       a.requested_at::text AS requested_at, a.finished_at::text AS finished_at,
       a.media_id, a.permalink, a.error, a.caption,
       s.id AS schedule_id, s.slot, s.publish_at::text AS publish_at
  FROM social_hub.publish_attempts a
  JOIN social_hub.content_items ci ON ci.id = a.content_item_id
  LEFT JOIN LATERAL (
    SELECT id, slot, publish_at FROM social_hub.schedule
     WHERE publish_attempt_id = a.id
     ORDER BY publish_at DESC LIMIT 1
  ) s ON true
 WHERE a.vertical = 'explainers'
 ORDER BY a.requested_at DESC`;

export const EXPLAINER_SCHEDULES_SQL = `
SELECT s.id AS schedule_id, ci.native_ref AS job_id, s.ny_date::text AS ny_date, s.slot, s.publish_at::text AS publish_at,
       s.status, s.source, s.error
  FROM social_hub.schedule s
  JOIN social_hub.content_items ci ON ci.id = s.content_item_id
 WHERE s.vertical = 'explainers'
   AND s.publish_attempt_id IS NULL
   -- A slot marked published with no attempt is the "already published" case; the attempt row is the post.
   AND s.status <> 'published'
 ORDER BY s.publish_at DESC`;

export const EXPLAINER_INSIGHTS_SQL = `
SELECT media_id, ny_date::text AS ny_date, views, reach, likes, comments, saved, shares,
       total_interactions, avg_watch_time_ms, total_watch_time_ms, skip_rate
  FROM social_hub.media_insights
 WHERE vertical = 'explainers'
 ORDER BY media_id, ny_date`;

/** The topic pool (spec §7 Ideas): every live topic with its score and content stock. */
export const EXPLAINER_TOPICS_SQL = `
SELECT t.id AS topic_id, t.title, t.scope, t.status, t.origin, t.weighted_score,
       t.created_at::text AS created_at,
       (SELECT count(*)::int FROM explainers.jobs j WHERE j.topic_id = t.id AND j.status = 'ok') AS ok_jobs,
       (SELECT max(j.finished_at)::text FROM explainers.jobs j WHERE j.topic_id = t.id AND j.status = 'ok') AS last_render_at,
       EXISTS (SELECT 1 FROM social_hub.publish_attempts a JOIN social_hub.content_items ci ON ci.id = a.content_item_id
                WHERE ci.vertical = 'explainers' AND ci.idea_ref = t.id::text AND a.status = 'published') AS published,
       EXISTS (SELECT 1 FROM social_hub.schedule s JOIN social_hub.content_items ci ON ci.id = s.content_item_id
                WHERE ci.vertical = 'explainers' AND ci.idea_ref = t.id::text AND s.status IN ('scheduled', 'publishing')) AS scheduled
  FROM explainers.topics t
 WHERE t.status IN ('pool', 'promoted', 'queued', 'rendered', 'proposed')
 ORDER BY t.weighted_score DESC NULLS LAST, t.created_at DESC
 LIMIT 200`;

export const EXPLAINER_REQUIRE_APPROVAL_SQL = `SELECT value FROM explainers.settings WHERE key = 'require_approval'`;

export async function readExplainers(q: HubQuery): Promise<ExplainersRead> {
  const [jobs, attempts, schedules, insights, topics, approval] = await Promise.all([
    q<ExplainerJobRow>(EXPLAINER_JOBS_SQL),
    q<ExplainerAttemptRow>(EXPLAINER_ATTEMPTS_SQL),
    q<ExplainerScheduleRow>(EXPLAINER_SCHEDULES_SQL),
    q<InsightRow>(EXPLAINER_INSIGHTS_SQL),
    q<ExplainerTopicRow>(EXPLAINER_TOPICS_SQL),
    q<{ value: unknown }>(EXPLAINER_REQUIRE_APPROVAL_SQL),
  ]);
  return {
    jobs: jobs.rows,
    attempts: attempts.rows,
    schedules: schedules.rows,
    insights: insights.rows,
    topics: topics.rows,
    requireApproval: settingIsOn(approval.rows),
  };
}
