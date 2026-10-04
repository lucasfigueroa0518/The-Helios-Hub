import { dbQuery } from '@/lib/db';
import { ADAPTERS } from '@/lib/reels/adapters';
import { metaConfigured } from '@/lib/reels/music/meta';
import { songPickApproved } from '@/lib/reels/music/pick';
import { publishMix } from '@/lib/reels/music/store';
import { publishingLive } from '@/lib/reels/publish/schedule';
import type { RunStats, SourceResult } from '@/lib/reels/types';
import { calendarDateKey, zonedTime } from '@/lib/reels/schedule';
import { RUN_TIMEZONE } from '@/lib/reels/config';
import { addCalendarDays } from '@/lib/reels/analytics/rollups';
import { healthVerdict, publishFailureLine, sourceTone, staleDays, type HealthVerdict, type SourceTone } from '@/lib/reels/health-status';

export type HealthSource = {
  id: string;
  name: string;
  phase: 'primary' | 'derived';
  tone: SourceTone;
  ingested: number;
  seen: number;
  published: number;
  lastSuccessAt: string | null;
  lastError: string | null;
};

export type HealthPage = {
  verdict: HealthVerdict;
  night: {
    status: string | null;
    finishedAt: string | null;
    ideasScored: number;
    reelsFinished: number;
    reelsPublished: number;
  };
  inFlight: { copy: number; frame: number; video: number; song: number; publish: number };
  publishPath: { live: boolean; meta: boolean; songPick: boolean; mix: string };
  sources: HealthSource[];
  windowDays: number;
  peak: number;
};

type RunHead = {
  status: string;
  started_at: string | null;
  finished_at: string | null;
  requested_at: string;
  source_results: SourceResult[];
  stats: Partial<RunStats>;
};

function nyMidnight(now: Date): Date {
  return nyMidnightFromKey(calendarDateKey(now, RUN_TIMEZONE));
}

function nyMidnightFromKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return zonedTime(year, month, day, 0, 0, RUN_TIMEZONE);
}

export async function loadHealthPage(windowDays = 7, now = new Date()): Promise<HealthPage> {
  const days = windowDays === 30 ? 30 : 7;
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const today = nyMidnight(now).toISOString();

  const [run, marks, volume, published, flights, errors, live, mix] = await Promise.all([
    dbQuery<RunHead>(
      `SELECT status, started_at::text, finished_at::text, requested_at::text, source_results, stats
         FROM reels.runs
        ORDER BY requested_at DESC
        LIMIT 1`,
    ),
    dbQuery<{ adapter_id: string; last_success_at: string | null }>(
      `SELECT adapter_id, last_success_at::text FROM reels.watermarks`,
    ),
    dbQuery<{ adapter_id: string; ingested: number; seen: number }>(
      `SELECT adapter_id,
              count(*) FILTER (WHERE drop_reason IS NULL)::int AS ingested,
              count(*)::int AS seen
         FROM reels.sources
        WHERE ingest_time >= $1
        GROUP BY adapter_id`,
      [since],
    ),
    dbQuery<{ adapter_id: string; published: number }>(
      `SELECT s.adapter_id, count(DISTINCT s.id)::int AS published
         FROM reels.sources s
         JOIN reels.post_idea_members m ON m.source_id = s.id
         JOIN reels.published_status p ON p.post_idea_id = m.post_idea_id AND p.published
        WHERE s.ingest_time >= $1
        GROUP BY s.adapter_id`,
      [since],
    ),
    dbQuery<{ stage: string; n: number }>(
      `SELECT stage, count(*)::int AS n FROM (
         SELECT 'copy' AS stage FROM reels.copy_jobs WHERE status IN ('requested', 'running')
         UNION ALL
         SELECT 'frame' FROM reels.visual_jobs WHERE status IN ('requested', 'running')
         UNION ALL
         SELECT 'video' FROM reels.video_jobs WHERE status IN ('requested', 'running')
         UNION ALL
         SELECT 'song' FROM reels.song_picks WHERE status IN ('requested', 'running')
         UNION ALL
         SELECT 'publish' FROM reels.publish_attempts WHERE status NOT IN ('published', 'failed')
       ) jobs
       GROUP BY stage`,
    ),
    dbQuery<{ stage: string; n: number; detail: string | null }>(
      `SELECT stage, count(*)::int AS n,
              (array_agg(detail ORDER BY finished_at DESC))[1] AS detail
         FROM (
         SELECT 'copy' AS stage, j.finished_at, NULL::text AS detail FROM reels.copy_jobs j
          WHERE j.status = 'failed' AND j.finished_at >= $1
            AND NOT EXISTS (
              SELECT 1 FROM reels.copy_jobs later
               WHERE later.post_idea_id = j.post_idea_id AND later.status = 'ok' AND later.finished_at >= j.finished_at
            )
         UNION ALL
         SELECT 'frame', j.finished_at, NULL::text FROM reels.visual_jobs j
          WHERE j.status IN ('failed', 'rejected_background', 'copy_does_not_fit') AND j.finished_at >= $1
            AND NOT EXISTS (
              SELECT 1 FROM reels.visual_jobs later
               WHERE later.post_idea_id = j.post_idea_id AND later.status = 'ok' AND later.finished_at >= j.finished_at
            )
         UNION ALL
         SELECT 'video', j.finished_at, NULL::text FROM reels.video_jobs j
          WHERE j.status = 'failed' AND j.finished_at >= $1
            AND NOT EXISTS (
              SELECT 1 FROM reels.video_jobs later
               WHERE later.post_idea_id = j.post_idea_id AND later.status = 'ok' AND later.finished_at >= j.finished_at
            )
         UNION ALL
         SELECT 'publish', a.finished_at, a.error FROM reels.publish_attempts a
          WHERE a.status = 'failed' AND a.trigger <> 'mix_test' AND a.finished_at >= $1
            AND NOT EXISTS (
              SELECT 1 FROM reels.publish_attempts later
               WHERE later.video_job_id = a.video_job_id
                 AND later.status = 'published'
                 AND later.finished_at >= a.finished_at
            )
       ) jobs
       GROUP BY stage
       ORDER BY n DESC`,
      [today],
    ),
    publishingLive(),
    publishMix(),
  ]);

  const latest = run.rows[0] ?? null;
  const results = new Map((latest?.source_results ?? []).map((result) => [result.adapterId, result]));
  const success = new Map(marks.rows.map((row) => [row.adapter_id, row.last_success_at]));
  const ingested = new Map(volume.rows.map((row) => [row.adapter_id, row.ingested]));
  const seen = new Map(volume.rows.map((row) => [row.adapter_id, row.seen]));
  const shipped = new Map(published.rows.map((row) => [row.adapter_id, row.published]));

  const sources: HealthSource[] = ADAPTERS.map((adapter) => {
    const result = results.get(adapter.id) ?? null;
    const lastSuccessAt = success.get(adapter.id) ?? null;
    const tone = sourceTone(lastSuccessAt, result?.status ?? null, now);
    return {
      id: adapter.id,
      name: adapter.name,
      phase: adapter.phase === 'derived' ? 'derived' : 'primary',
      tone,
      ingested: ingested.get(adapter.id) ?? 0,
      seen: seen.get(adapter.id) ?? 0,
      published: shipped.get(adapter.id) ?? 0,
      lastSuccessAt,
      lastError: result?.status === 'failed' ? result.error ?? 'failed' : null,
    };
  });

  const toneRank: Record<SourceTone, number> = { failed: 0, stale: 1, never: 2, fresh: 3 };
  sources.sort((a, b) => {
    const tone = toneRank[a.tone] - toneRank[b.tone];
    if (tone !== 0) return tone;
    const unusedA = a.ingested > 0 && a.published === 0 ? 0 : 1;
    const unusedB = b.ingested > 0 && b.published === 0 ? 0 : 1;
    if (unusedA !== unusedB) return unusedA - unusedB;
    return b.ingested - a.ingested;
  });

  const failed = sources.find((source) => source.tone === 'failed') ?? null;
  const stale = sources.find((source) => source.phase === 'primary' && (source.tone === 'stale' || source.tone === 'never'));
  const jobError = errors.rows[0] ?? null;
  const flight = Object.fromEntries(flights.rows.map((row) => [row.stage, row.n])) as Partial<Record<string, number>>;
  const nightRunning = latest?.status === 'running' || latest?.status === 'requested';
  const stuck = !nightRunning
    ? (['copy', 'frame', 'video', 'song', 'publish'] as const).find((stage) => (flight[stage] ?? 0) > 0) ?? null
    : null;

  const started = latest ? new Date(latest.started_at ?? latest.requested_at) : null;
  const dayKey = started ? calendarDateKey(started) : null;
  const dayStart = dayKey ? nyMidnightFromKey(dayKey) : null;
  const dayEnd = dayKey ? nyMidnightFromKey(addCalendarDays(dayKey, 1)) : null;
  const [reelsFinished, reelsPublished] = dayStart && dayEnd
    ? await Promise.all([
        dbQuery<{ n: number }>(
          `SELECT count(*)::int AS n FROM reels.video_jobs
            WHERE status = 'ok' AND finished_at >= $1 AND finished_at < $2`,
          [dayStart.toISOString(), dayEnd.toISOString()],
        ),
        dbQuery<{ n: number }>(
          `SELECT count(*)::int AS n FROM reels.published_status
            WHERE published AND published_at >= $1 AND published_at < $2`,
          [dayStart.toISOString(), dayEnd.toISOString()],
        ),
      ])
    : [null, null];

  return {
    verdict: healthVerdict({
      runStatus: latest?.status ?? null,
      failedSourceName: failed?.name ?? null,
      staleSource: stale
        ? { name: stale.name, days: stale.lastSuccessAt ? staleDays(stale.lastSuccessAt, now) : 0 }
        : null,
      jobErrorsToday: jobError
        ? {
            stage: jobError.stage,
            count: jobError.n,
            detail: jobError.stage === 'publish' ? publishFailureLine(jobError.detail) : null,
          }
        : null,
      stuckStage: stuck,
      metaReady: metaConfigured(),
    }),
    night: {
      status: latest?.status ?? null,
      finishedAt: latest?.finished_at ?? null,
      ideasScored: latest?.stats.scored ?? 0,
      reelsFinished: reelsFinished?.rows[0]?.n ?? 0,
      reelsPublished: reelsPublished?.rows[0]?.n ?? 0,
    },
    inFlight: {
      copy: flight.copy ?? 0,
      frame: flight.frame ?? 0,
      video: flight.video ?? 0,
      song: flight.song ?? 0,
      publish: flight.publish ?? 0,
    },
    publishPath: {
      live,
      meta: metaConfigured(),
      songPick: songPickApproved(),
      mix: mix ? `${mix.audioVolume} / ${mix.videoVolume}` : 'Full volume until a mix is chosen',
    },
    sources,
    windowDays: days,
    peak: Math.max(1, ...sources.map((source) => source.ingested)),
  };
}
