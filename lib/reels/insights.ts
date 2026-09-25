import { dbQuery } from '@/lib/db';
import { KLING_CLIP_SECONDS, RUN_TIMEZONE } from '@/lib/reels/config';
import { monthStart } from '@/lib/reels/schedule';

/**
 * Kling 3.0 Standard on Fal bills $0.084 per second of clip (D-103). Kling is
 * paid outside `reels.cost_events`, so its spend is counted from the video
 * jobs that reached Fal. Retries inside one job are not counted, so this is a
 * floor, not an invoice.
 */
const KLING_USD_PER_SECOND = 0.084;
export const KLING_USD_PER_CLIP = KLING_USD_PER_SECOND * KLING_CLIP_SECONDS;

export type CostLine = { vendor: string; component: string; calls: number; usd: number };
export type CostDay = { nyDate: string; ledgerUsd: number; klingUsd: number };
export type JobError = { stage: 'copy' | 'frame' | 'video'; at: string; error: string; headline: string | null };

export type ReelsInsights = {
  costs: {
    /** Ledger lines this month, largest first, plus one Kling line. */
    lines: CostLine[];
    monthToDateUsd: number;
    klingClips: number;
    reelsMade: number;
    days: CostDay[];
  };
  /** Failed copy, frame, and video jobs from the last seven days, newest first. */
  recentErrors: JobError[];
};

const DAYS = 14;

function nyDate(at: Date): string {
  return at.toLocaleDateString('en-CA', { timeZone: RUN_TIMEZONE });
}

export async function loadReelsInsights(now = new Date()): Promise<ReelsInsights> {
  const since = monthStart(now).toISOString();
  const windowStart = new Date(now.getTime() - DAYS * 86_400_000).toISOString();

  const [lines, kling, reels, ledgerDays, klingDays, errors] = await Promise.all([
    dbQuery<{ vendor: string; component: string; calls: number; usd: number }>(
      `SELECT vendor, component, count(*)::int AS calls, COALESCE(sum(usd), 0)::float8 AS usd
         FROM reels.cost_events WHERE created_at >= $1
        GROUP BY vendor, component ORDER BY usd DESC`,
      [since],
    ),
    dbQuery<{ clips: number }>(
      `SELECT count(*)::int AS clips FROM reels.video_jobs
        WHERE higgsfield_job_id IS NOT NULL AND finished_at >= $1`,
      [since],
    ),
    dbQuery<{ reels: number }>(
      `SELECT count(*)::int AS reels FROM reels.video_jobs WHERE status = 'ok' AND finished_at >= $1`,
      [since],
    ),
    dbQuery<{ day: string; usd: number }>(
      `SELECT to_char((created_at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS day, sum(usd)::float8 AS usd
         FROM reels.cost_events WHERE created_at >= $1 GROUP BY 1`,
      [windowStart, RUN_TIMEZONE],
    ),
    dbQuery<{ day: string; clips: number }>(
      `SELECT to_char((finished_at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS day, count(*)::int AS clips
         FROM reels.video_jobs
        WHERE higgsfield_job_id IS NOT NULL AND finished_at >= $1 GROUP BY 1`,
      [windowStart, RUN_TIMEZONE],
    ),
    dbQuery<{ stage: JobError['stage']; at: string; error: string | null; headline: string | null }>(
      `SELECT e.stage, e.at::text, e.error,
              (SELECT s.headline FROM reels.post_idea_members m
                 JOIN reels.sources s ON s.id = m.source_id
                WHERE m.post_idea_id = e.post_idea_id
                ORDER BY CASE m.role WHEN 'primary' THEN 0 ELSE 1 END LIMIT 1) AS headline
         FROM (
           SELECT 'copy' AS stage, finished_at AS at, error, post_idea_id FROM reels.copy_jobs
            WHERE status = 'failed' AND finished_at >= now() - interval '7 days'
           UNION ALL
           SELECT 'frame', finished_at, error, post_idea_id FROM reels.visual_jobs
            WHERE status IN ('failed', 'rejected_background', 'copy_does_not_fit')
              AND finished_at >= now() - interval '7 days'
           UNION ALL
           SELECT 'video', finished_at, error, post_idea_id FROM reels.video_jobs
            WHERE status = 'failed' AND finished_at >= now() - interval '7 days'
         ) e
        ORDER BY e.at DESC LIMIT 12`,
    ),
  ]);

  const klingClips = kling.rows[0]?.clips ?? 0;
  const ledgerTotal = lines.rows.reduce((sum, row) => sum + Number(row.usd), 0);
  const costLines: CostLine[] = lines.rows.map((row) => ({
    vendor: row.vendor,
    component: row.component,
    calls: row.calls,
    usd: Number(row.usd),
  }));
  if (klingClips > 0) {
    costLines.push({ vendor: 'fal', component: 'reel-video (Kling)', calls: klingClips, usd: klingClips * KLING_USD_PER_CLIP });
    costLines.sort((a, b) => b.usd - a.usd);
  }

  const ledgerByDay = new Map(ledgerDays.rows.map((row) => [row.day, Number(row.usd)]));
  const klingByDay = new Map(klingDays.rows.map((row) => [row.day, row.clips]));
  const days: CostDay[] = [];
  for (let offset = DAYS - 1; offset >= 0; offset -= 1) {
    const day = nyDate(new Date(now.getTime() - offset * 86_400_000));
    days.push({
      nyDate: day,
      ledgerUsd: ledgerByDay.get(day) ?? 0,
      klingUsd: (klingByDay.get(day) ?? 0) * KLING_USD_PER_CLIP,
    });
  }

  return {
    costs: {
      lines: costLines,
      monthToDateUsd: ledgerTotal + klingClips * KLING_USD_PER_CLIP,
      klingClips,
      reelsMade: reels.rows[0]?.reels ?? 0,
      days,
    },
    recentErrors: errors.rows.map((row) => ({
      stage: row.stage,
      at: row.at,
      error: row.error ?? 'No error text.',
      headline: row.headline,
    })),
  };
}
