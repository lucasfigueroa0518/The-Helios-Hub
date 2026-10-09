import type { HubQuery } from '@/lib/social-hub/db';
import { forVertical, insightRows, type SpineRead } from '@/lib/social-hub/queries/spine';
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
  /** Latest render, when it is still queued, running, or the last try failed. */
  job_id: string | null;
  job_status: string | null;
  job_stage: string | null;
  job_error: string | null;
  job_requested_at: string | null;
  job_started_at: string | null;
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

/** The topic pool (spec §7 Ideas): every live topic with its score and content stock. */
export const EXPLAINER_TOPICS_SQL = `
SELECT t.id AS topic_id, t.title, t.scope, t.status, t.origin, t.weighted_score,
       t.created_at::text AS created_at,
       (SELECT count(*)::int FROM explainers.jobs j WHERE j.topic_id = t.id AND j.status = 'ok') AS ok_jobs,
       (SELECT max(j.finished_at)::text FROM explainers.jobs j WHERE j.topic_id = t.id AND j.status = 'ok') AS last_render_at,
       EXISTS (SELECT 1 FROM social_hub.publish_attempts a JOIN social_hub.content_items ci ON ci.id = a.content_item_id
                WHERE ci.vertical = 'explainers' AND ci.idea_ref = t.id::text AND a.status = 'published') AS published,
       EXISTS (SELECT 1 FROM social_hub.schedule s JOIN social_hub.content_items ci ON ci.id = s.content_item_id
                WHERE ci.vertical = 'explainers' AND ci.idea_ref = t.id::text AND s.status IN ('scheduled', 'publishing')) AS scheduled,
       latest.job_id, latest.job_status, latest.job_stage, latest.job_error,
       latest.job_requested_at, latest.job_started_at
  FROM explainers.topics t
  LEFT JOIN LATERAL (
    SELECT j.id::text AS job_id, j.status AS job_status, j.stage AS job_stage, j.error AS job_error,
           j.requested_at::text AS job_requested_at, j.started_at::text AS job_started_at
      FROM explainers.jobs j
     WHERE j.topic_id = t.id
       AND j.status IN ('requested', 'running', 'failed')
       AND NOT EXISTS (
             SELECT 1 FROM explainers.jobs newer
              WHERE newer.topic_id = j.topic_id AND newer.requested_at > j.requested_at AND newer.status = 'ok'
           )
     ORDER BY j.requested_at DESC, j.seq DESC
     LIMIT 1
  ) latest ON true
 WHERE t.status IN ('pool', 'promoted', 'queued', 'rendered', 'proposed')
 ORDER BY t.weighted_score DESC NULLS LAST, t.created_at DESC
 LIMIT 200`;

export const EXPLAINER_REQUIRE_APPROVAL_SQL = `SELECT value FROM explainers.settings WHERE key = 'require_approval'`;

export async function readExplainers(q: HubQuery, spine: SpineRead): Promise<ExplainersRead> {
  const [jobs, topics, approval] = await Promise.all([
    q<ExplainerJobRow>(EXPLAINER_JOBS_SQL),
    q<ExplainerTopicRow>(EXPLAINER_TOPICS_SQL),
    q<{ value: unknown }>(EXPLAINER_REQUIRE_APPROVAL_SQL),
  ]);
  const mine = forVertical(spine, 'explainers');
  return {
    jobs: jobs.rows,
    // Slots, attempts and insights come from the shared spine read (D48); the render is the item.
    attempts: mine.attempts.filter((a) => a.content_ref).map((a) => ({
      attempt_id: a.attempt_id, job_id: a.content_ref!, status: a.status, trigger: a.trigger,
      requested_at: a.requested_at, finished_at: a.finished_at, media_id: a.media_id, permalink: a.permalink, error: a.error,
      caption: a.caption ?? '', schedule_id: a.schedule_id, slot: a.slot, publish_at: a.publish_at,
    })),
    schedules: mine.schedules.filter((r) => r.content_ref).map((r) => ({
      schedule_id: r.schedule_id, job_id: r.content_ref!, ny_date: r.ny_date, slot: r.slot, publish_at: r.publish_at,
      status: r.status, source: r.source, error: r.error,
    })),
    insights: insightRows(mine.insights, 'explainers'),
    topics: topics.rows,
    requireApproval: settingIsOn(approval.rows),
  };
}
