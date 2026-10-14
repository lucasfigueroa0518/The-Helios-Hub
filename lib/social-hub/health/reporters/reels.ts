import { klingClipUsdSql } from '@/lib/reels/insights';
import type { HubQuery } from '@/lib/social-hub/db';
import { reasonFor } from '@/lib/social-hub/health/reasons';
import { emptyReport, funnelFrom, publishingFor, withPublishing, type Reporter } from '@/lib/social-hub/health/reporters/shared';
import { cycleBounds } from '@/lib/social-hub/health/time';
import type { FailureEvent } from '@/lib/social-hub/health/types';

type Job = { stage: string; id: string; idea: string; status: string; error: string | null; at: string };

export const reportReels: Reporter = async (q: HubQuery, { night, posting }) => {
  const { start, end } = cycleBounds(night);
  const range = [start.toISOString(), end.toISOString()];
  const runs = (await q<{ id: string; status: string; note: string | null; at: string }>(
    `SELECT id::text, status, note, requested_at::text AS at FROM reels.runs
      WHERE trigger = 'scheduled' AND requested_at >= $1 AND requested_at < $2`,
    range,
  )).rows;
  const jobs = (await q<Job>(
    `SELECT 'copy' AS stage, id::text, post_idea_id::text AS idea, status, error, finished_at::text AS at FROM reels.copy_jobs WHERE finished_at >= $1 AND finished_at < $2
     UNION ALL SELECT 'frame', id::text, post_idea_id::text, status, error, finished_at::text FROM reels.visual_jobs WHERE finished_at >= $1 AND finished_at < $2
     UNION ALL SELECT 'video', id::text, post_idea_id::text, status, error, finished_at::text FROM reels.video_jobs WHERE finished_at >= $1 AND finished_at < $2
     UNION ALL SELECT 'song', id::text, post_idea_id::text, status, error, finished_at::text FROM reels.song_picks WHERE finished_at >= $1 AND finished_at < $2
     ORDER BY at`,
    range,
  )).rows;
  const spend = (await q<{ usd: number }>(
    `SELECT (COALESCE((SELECT sum(usd) FROM reels.cost_events WHERE created_at >= $1 AND created_at < $2), 0)
           + COALESCE((SELECT sum(${klingClipUsdSql('finished_at')}) FROM reels.video_jobs
                        WHERE higgsfield_job_id IS NOT NULL AND finished_at >= $1 AND finished_at < $2), 0))::float8 AS usd`,
    range,
  )).rows[0]?.usd ?? 0;
  const stale = (await q<{ adapter_id: string }>(
    `SELECT adapter_id FROM reels.watermarks WHERE last_success_at < $1::timestamptz - interval '3 days' ORDER BY adapter_id`,
    [end.toISOString()],
  )).rows.map((r) => r.adapter_id);

  const failures: FailureEvent[] = [];
  let retriedOk = 0;
  for (const run of runs.filter((r) => r.status === 'failed')) {
    failures.push({ vertical: 'reels', night, at: new Date(run.at).toISOString(), stage: 'run', reason: reasonFor('run', run.note), severity: 'failed', rawError: run.note ?? undefined, runId: run.id });
  }
  for (const j of jobs) {
    const broken = j.status === 'failed' || j.status === 'rejected_background' || j.status === 'copy_does_not_fit';
    if (!broken) continue;
    const recovered = jobs.some((k) => k.stage === j.stage && k.idea === j.idea && k.status === 'ok' && new Date(k.at) > new Date(j.at));
    if (recovered) retriedOk++;
    failures.push({
      vertical: 'reels', night, at: new Date(j.at).toISOString(), stage: j.stage, reason: reasonFor(j.stage, j.error ?? j.status),
      severity: recovered ? 'healed' : 'failed', rawError: j.error ?? j.status, item: { kind: 'idea', id: j.idea, label: `Idea ${j.idea.slice(0, 8)}` },
    });
  }
  const okBy = (stage: string) => new Set(jobs.filter((j) => j.stage === stage && j.status === 'ok').map((j) => j.idea)).size;
  const ideas = new Set(jobs.map((j) => j.idea)).size;
  const made = okBy('video');
  const base = {
    ...emptyReport('reels', night),
    ran: runs.some((r) => ['ok', 'partial', 'failed', 'skipped'].includes(r.status)),
    made,
    retriedOk,
    funnel: funnelFrom(ideas, [['copy', ideas - okBy('copy')], ['frame', okBy('copy') - okBy('frame')], ['video', okBy('frame') - made]]),
    failures,
    spendUsd: spend,
    feedsStale: stale,
  };
  return withPublishing(base, posting, await publishingFor(q, 'reels', night));
};
