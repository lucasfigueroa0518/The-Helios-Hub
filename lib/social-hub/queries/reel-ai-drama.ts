import type { HubQuery } from '@/lib/social-hub/db';
import { forVertical, insightRows, type SpineRead } from '@/lib/social-hub/queries/spine';
import { settingIsOn, type InsightRow } from '@/lib/social-hub/queries/reels';
import {
  DRAMA_JOBS_SQL,
  DRAMA_PITCHES_SQL,
  DRAMA_REQUIRE_APPROVAL_SQL,
  dramaSchemaReady,
  type DramaJobRow,
  type DramaPitchRow,
} from '@/lib/reel-ai-drama/hub-read';

/**
 * AI Drama Reels reads (SELECT only), the Explainers pattern: post = production
 * job, idea = pitch. The SQL is Builder A's (lib/reel-ai-drama/hub.ts §4.5); the
 * slots, attempts and insights come from the shared spine read (D48).
 */

export type DramaAttemptRow = {
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

export type DramaScheduleRow = {
  schedule_id: string;
  job_id: string;
  ny_date: string;
  slot: string;
  publish_at: string;
  status: string;
  source: string;
  error: string | null;
};

export type ReelAiDramaRead = {
  jobs: DramaJobRow[];
  attempts: DramaAttemptRow[];
  schedules: DramaScheduleRow[];
  insights: InsightRow[];
  pitches: DramaPitchRow[];
  requireApproval: boolean;
};

export async function readReelAiDrama(q: HubQuery, spine: SpineRead): Promise<ReelAiDramaRead> {
  const [jobs, pitches, approval] = await Promise.all([
    q<DramaJobRow>(DRAMA_JOBS_SQL),
    q<DramaPitchRow>(DRAMA_PITCHES_SQL),
    q<{ value: unknown }>(DRAMA_REQUIRE_APPROVAL_SQL),
  ]);
  const mine = forVertical(spine, 'reel_ai_drama');
  return {
    jobs: jobs.rows,
    attempts: mine.attempts.filter((a) => a.content_ref).map((a) => ({
      attempt_id: a.attempt_id, job_id: a.content_ref!, status: a.status, trigger: a.trigger,
      requested_at: a.requested_at, finished_at: a.finished_at, media_id: a.media_id, permalink: a.permalink, error: a.error,
      caption: a.caption ?? '', schedule_id: a.schedule_id, slot: a.slot, publish_at: a.publish_at,
    })),
    schedules: mine.schedules.filter((r) => r.content_ref).map((r) => ({
      schedule_id: r.schedule_id, job_id: r.content_ref!, ny_date: r.ny_date, slot: r.slot, publish_at: r.publish_at,
      status: r.status, source: r.source, error: r.error,
    })),
    insights: insightRows(mine.insights, 'reel_ai_drama'),
    pitches: pitches.rows,
    // A missing row reads as on, the launch default (require_approval true).
    requireApproval: settingIsOn(approval.rows),
  };
}

/** No rows: the drama schema is not applied on this database yet. */
export const EMPTY_DRAMA_READ: ReelAiDramaRead = { jobs: [], attempts: [], schedules: [], insights: [], pitches: [], requireApproval: true };

/**
 * The hub's read: an unapplied drama schema shows no AI Drama posts rather
 * than an error on every page (contract §4: hub reads skip drama when
 * `dramaSchemaReady` is false). Any other failure still reports itself.
 */
export async function readReelAiDramaIfReady(q: HubQuery, spine: SpineRead): Promise<ReelAiDramaRead> {
  if (!(await dramaSchemaReady(q))) return EMPTY_DRAMA_READ;
  return readReelAiDrama(q, spine);
}
