import { dbQuery } from '@/lib/db';
import { MONTHLY_WATCH_USD, RUN_TIMEZONE } from '@/lib/reels/config';
import { KLING_USD_PER_CLIP } from '@/lib/reels/insights';
import { monthToDateUsd, productionSpendSince } from '@/lib/reels/repository';
import {
  ACTIVITY_COMPONENTS,
  COPY_CALL_COMPONENTS,
  activityOf,
  assembleReport,
  capPace,
  daysInRange,
  periodRange,
  vendorKey,
  type ActivityId,
  type CostPeriod,
  type CostReport,
  type Ledger,
  type MoneyRow,
  type ReportFacts,
} from '@/lib/reels/analytics/rollups';

export type DrillLine = { at: string; title: string; detail: string; usd: number | null };

export type DrillFactor = { label: string; value: number; kind: 'usd' | 'count' };

export type DrillDetail = { factors: DrillFactor[]; lines: DrillLine[] };

export type CostPage = {
  report: CostReport;
  drills: Record<string, DrillDetail>;
  cap: { spent: number; watch: number; left: number; perDay: number; daysLeft: number; projected: number };
  period: CostPeriod;
  ledger: Ledger;
  from: string;
  to: string;
};

type GroupRow = { day: string; vendor: string; component: string; calls: number; usd: number };

function windowClause(column: string, ledger: Ledger): string {
  const range = `${column} >= $1 AND ${column} < $2`;
  if (ledger === 'production') return `${range} AND ${column} >= $3`;
  if (ledger === 'development') return `${range} AND ${column} < $3`;
  return range;
}

function params(start: Date, end: Date, ledger: Ledger, cutoff: Date): unknown[] {
  const base = [start.toISOString(), end.toISOString()];
  return ledger === 'all' ? base : [...base, cutoff.toISOString()];
}

async function count(sql: string, values: unknown[]): Promise<number> {
  const { rows } = await dbQuery<{ n: number }>(sql, values);
  return rows[0]?.n ?? 0;
}

async function money(sql: string, values: unknown[]): Promise<number> {
  const { rows } = await dbQuery<{ n: string | null }>(sql, values);
  return Number(rows[0]?.n ?? 0);
}

export function parsePeriod(value: string | undefined): CostPeriod {
  if (value === '30d' || value === 'month' || value === 'custom' || value === '7d') return value;
  return '7d';
}

export function parseLedger(value: string | undefined): Ledger {
  if (value === 'development' || value === 'all' || value === 'production') return value;
  return 'production';
}

export async function loadCostPage(
  input: { period?: string; ledger?: string; from?: string; to?: string },
  now = new Date(),
): Promise<CostPage> {
  const period = parsePeriod(input.period);
  const ledger = parseLedger(input.ledger);
  const range = periodRange(period, now, { from: input.from, to: input.to });
  const cutoff = await productionSpendSince();
  const values = params(range.start, range.end, ledger, cutoff);
  const on = (column: string) => windowClause(column, ledger);

  const [groups, klingDays, nights, ingestRuns, ideasScored, postsWithCopy, imageJobs, postsWithFrame, videoJobs, postsWithVideo, publishedWithVideo, postsGenerated, postsPublished, ideaProduction, publishedProduction, failedJobs, failedKling, unshippedCopy, recentEvents, recentJobs] =
    await Promise.all([
      dbQuery<GroupRow>(
        `SELECT to_char((created_at AT TIME ZONE '${RUN_TIMEZONE}')::date, 'YYYY-MM-DD') AS day,
                vendor, component, count(*)::int AS calls, COALESCE(sum(usd), 0)::float8 AS usd
           FROM reels.cost_events
          WHERE ${on('created_at')}
          GROUP BY 1, 2, 3`,
        values,
      ),
      dbQuery<{ day: string; clips: number }>(
        `SELECT to_char((finished_at AT TIME ZONE '${RUN_TIMEZONE}')::date, 'YYYY-MM-DD') AS day,
                count(*)::int AS clips
           FROM reels.video_jobs
          WHERE higgsfield_job_id IS NOT NULL AND ${on('finished_at')}
          GROUP BY 1`,
        values,
      ),
      count(
        `SELECT count(*)::int AS n FROM reels.runs
          WHERE status IN ('ok', 'partial', 'failed') AND ${on('COALESCE(finished_at, started_at, requested_at)')}`,
        values,
      ),
      count(
        `SELECT count(*)::int AS n
           FROM reels.runs r
           CROSS JOIN LATERAL jsonb_array_elements(r.source_results) e
          WHERE ${on('COALESCE(r.finished_at, r.started_at, r.requested_at)')}`,
        values,
      ),
      count(
        `SELECT count(DISTINCT s.post_idea_id)::int AS n
           FROM reels.idea_scores s
           JOIN reels.score_slates sl ON sl.id = s.slate_id
          WHERE ${on('sl.scored_at')}`,
        values,
      ),
      count(
        `SELECT count(DISTINCT post_idea_id)::int AS n FROM reels.copy_jobs
          WHERE status = 'ok' AND ${on('finished_at')}`,
        values,
      ),
      count(
        `SELECT count(*)::int AS n FROM reels.visual_jobs WHERE finished_at IS NOT NULL AND ${on('finished_at')}`,
        values,
      ),
      count(
        `SELECT count(DISTINCT post_idea_id)::int AS n FROM reels.visual_jobs
          WHERE status = 'ok' AND ${on('finished_at')}`,
        values,
      ),
      count(
        `SELECT count(*)::int AS n FROM reels.video_jobs WHERE finished_at IS NOT NULL AND ${on('finished_at')}`,
        values,
      ),
      count(
        `SELECT count(DISTINCT post_idea_id)::int AS n FROM reels.video_jobs
          WHERE status = 'ok' AND ${on('finished_at')}`,
        values,
      ),
      count(
        `SELECT count(DISTINCT v.post_idea_id)::int AS n
           FROM reels.video_jobs v
           JOIN reels.published_status p ON p.post_idea_id = v.post_idea_id AND p.published
          WHERE v.status = 'ok' AND ${on('v.finished_at')}`,
        values,
      ),
      count(
        `SELECT count(*)::int AS n FROM (
           SELECT post_idea_id FROM reels.copy_jobs WHERE status = 'ok' AND ${on('finished_at')}
           INTERSECT
           SELECT post_idea_id FROM reels.visual_jobs WHERE status = 'ok' AND ${on('finished_at')}
           INTERSECT
           SELECT post_idea_id FROM reels.video_jobs WHERE status = 'ok' AND ${on('finished_at')}
         ) done`,
        values,
      ),
      count(
        `SELECT count(*)::int AS n FROM reels.published_status
          WHERE published AND ${on('published_at')}`,
        values,
      ),
      money(
        `SELECT COALESCE(sum(usd), 0)::text AS n FROM (
           SELECT usd FROM reels.copy_jobs WHERE finished_at IS NOT NULL AND ${on('finished_at')}
           UNION ALL
           SELECT usd FROM reels.visual_jobs WHERE finished_at IS NOT NULL AND ${on('finished_at')}
           UNION ALL
           SELECT usd FROM reels.video_jobs WHERE finished_at IS NOT NULL AND ${on('finished_at')}
         ) jobs`,
        values,
      ),
      money(
        `SELECT COALESCE(sum(usd), 0)::text AS n FROM (
           SELECT j.usd FROM reels.copy_jobs j
             JOIN reels.published_status p ON p.post_idea_id = j.post_idea_id AND p.published
            WHERE j.finished_at IS NOT NULL AND ${on('j.finished_at')}
           UNION ALL
           SELECT j.usd FROM reels.visual_jobs j
             JOIN reels.published_status p ON p.post_idea_id = j.post_idea_id AND p.published
            WHERE j.finished_at IS NOT NULL AND ${on('j.finished_at')}
           UNION ALL
           SELECT j.usd FROM reels.video_jobs j
             JOIN reels.published_status p ON p.post_idea_id = j.post_idea_id AND p.published
            WHERE j.finished_at IS NOT NULL AND ${on('j.finished_at')}
         ) jobs`,
        values,
      ),
      money(
        `SELECT COALESCE(sum(usd), 0)::text AS n FROM (
           SELECT usd FROM reels.copy_jobs WHERE status = 'failed' AND ${on('finished_at')}
           UNION ALL
           SELECT usd FROM reels.visual_jobs
            WHERE status IN ('failed', 'rejected_background', 'copy_does_not_fit') AND ${on('finished_at')}
           UNION ALL
           SELECT usd FROM reels.video_jobs WHERE status = 'failed' AND ${on('finished_at')}
         ) jobs`,
        values,
      ),
      count(
        `SELECT count(*)::int AS n FROM reels.video_jobs
          WHERE status = 'failed' AND higgsfield_job_id IS NOT NULL AND ${on('finished_at')}`,
        values,
      ),
      money(
        `SELECT COALESCE(sum(j.usd), 0)::text AS n
           FROM reels.copy_jobs j
          WHERE j.finished_at IS NOT NULL AND ${on('j.finished_at')}
            AND NOT EXISTS (
              SELECT 1 FROM reels.idea_copy c
               WHERE c.post_idea_id = j.post_idea_id AND c.status = 'ok'
            )`,
        values,
      ),
      dbQuery<{ at: string; vendor: string; component: string; usd: number }>(
        `SELECT created_at::text AS at, vendor, component, usd::float8 AS usd
           FROM (
             SELECT created_at, vendor, component, usd,
                    row_number() OVER (PARTITION BY component ORDER BY created_at DESC) AS n
               FROM reels.cost_events
              WHERE ${on('created_at')}
           ) ranked
          WHERE n <= 8
          ORDER BY created_at DESC`,
        values,
      ),
      dbQuery<{ at: string; stage: string; status: string; usd: number; headline: string | null }>(
        `SELECT j.at::text, j.stage, j.status, j.usd::float8 AS usd,
                (SELECT s.headline FROM reels.post_idea_members m
                   JOIN reels.sources s ON s.id = m.source_id
                  WHERE m.post_idea_id = j.post_idea_id
                  ORDER BY CASE m.role WHEN 'primary' THEN 0 ELSE 1 END
                  LIMIT 1) AS headline
           FROM (
             SELECT finished_at AS at, 'copy' AS stage, status, usd, post_idea_id FROM reels.copy_jobs
              WHERE finished_at IS NOT NULL AND ${on('finished_at')}
             UNION ALL
             SELECT finished_at, 'frame', status, usd, post_idea_id FROM reels.visual_jobs
              WHERE finished_at IS NOT NULL AND ${on('finished_at')}
             UNION ALL
             SELECT finished_at, 'video', status, usd, post_idea_id FROM reels.video_jobs
              WHERE finished_at IS NOT NULL AND ${on('finished_at')}
           ) j
          ORDER BY j.at DESC
          LIMIT 80`,
        values,
      ),
    ]);

  const klingUsd = klingDays.rows.reduce((sum, row) => sum + row.clips * KLING_USD_PER_CLIP, 0);
  const publishedKling = await money(
    `SELECT (count(*) * ${KLING_USD_PER_CLIP})::text AS n
       FROM reels.video_jobs v
       JOIN reels.published_status p ON p.post_idea_id = v.post_idea_id AND p.published
      WHERE v.higgsfield_job_id IS NOT NULL AND ${on('v.finished_at')}`,
    values,
  );

  const rows: MoneyRow[] = groups.rows.map((row) => ({
    day: row.day,
    vendor: vendorKey(row.vendor),
    activity: activityOf(row.component),
    usd: Number(row.usd),
  }));
  for (const day of klingDays.rows) {
    rows.push({ day: day.day, vendor: 'fal', activity: 'video', usd: day.clips * KLING_USD_PER_CLIP });
  }

  const copyCallUsd = groups.rows
    .filter((row) => (COPY_CALL_COMPONENTS as readonly string[]).includes(row.component))
    .reduce((sum, row) => sum + Number(row.usd), 0);
  const copyCalls = groups.rows
    .filter((row) => (COPY_CALL_COMPONENTS as readonly string[]).includes(row.component))
    .reduce((sum, row) => sum + row.calls, 0);
  const scoringCalls = groups.rows
    .filter((row) => ACTIVITY_COMPONENTS.score.includes(row.component))
    .reduce((sum, row) => sum + row.calls, 0);

  const facts: ReportFacts = {
    days: daysInRange(range.start, range.end),
    rows,
    postsGenerated,
    postsPublished,
    ingestRuns,
    nights,
    ideasScored,
    scoringCalls,
    copyCalls,
    postsWithCopy,
    copyCallUsd,
    imageJobs,
    postsWithFrame,
    videoJobs,
    postsWithVideo,
    publishedWithVideo,
    ideaProductionUsd: ideaProduction + klingUsd,
    publishedIdeaProductionUsd: publishedProduction + publishedKling,
    failedJobUsd: failedJobs + failedKling * KLING_USD_PER_CLIP,
    unshippedCopyUsd: unshippedCopy,
  };

  const spent = await monthToDateUsd(now);
  const pace = capPace(spent, MONTHLY_WATCH_USD, now, cutoff);
  return {
    report: assembleReport(facts),
    drills: drillsFrom(groups.rows, recentEvents.rows, recentJobs.rows, klingUsd),
    cap: { spent, watch: MONTHLY_WATCH_USD, ...pace },
    period,
    ledger,
    from: input.from ?? '',
    to: input.to ?? '',
  };
}

function drillsFrom(
  groups: GroupRow[],
  events: Array<{ at: string; vendor: string; component: string; usd: number }>,
  jobs: Array<{ at: string; stage: string; status: string; usd: number; headline: string | null }>,
  klingUsd: number,
): Record<string, DrillDetail> {
  const line = (at: string, title: string, detail: string, usd: number | null): DrillLine => ({ at, title, detail, usd });
  const take = <T extends { usd: number }>(rows: T[]): T[] => {
    const paid = rows.filter((row) => Number(row.usd) >= 0.01);
    return (paid.length > 0 ? paid : rows).slice(0, 8);
  };
  const eventLines = (pred: (component: string) => boolean) =>
    take(events.filter((row) => pred(row.component))).map((row) => line(row.at, row.component, row.vendor, Number(row.usd)));
  const jobLines = (stage: string) =>
    take(jobs.filter((row) => row.stage === stage)).map((row) => line(row.at, row.headline ?? row.stage, row.status, Number(row.usd)));

  const parts = (pred: (component: string) => boolean, extra?: DrillFactor): DrillFactor[] => {
    const totals = new Map<string, number>();
    for (const row of groups) {
      if (!pred(row.component)) continue;
      totals.set(row.component, (totals.get(row.component) ?? 0) + Number(row.usd));
    }
    const factors: DrillFactor[] = [...totals.entries()]
      .filter(([, usd]) => usd > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value, kind: 'usd' }));
    if (extra && extra.value > 0) factors.push(extra);
    return factors.sort((a, b) => b.value - a.value);
  };
  const byActivity = (activity: ActivityId) => parts((component) => activityOf(component) === activity);
  const kling: DrillFactor = { label: 'Kling clips', value: klingUsd, kind: 'usd' };
  const videoParts = byActivity('video');
  if (kling.value > 0) videoParts.push(kling);
  videoParts.sort((a, b) => b.value - a.value);

  const functionParts = (['ingest', 'group', 'score', 'copy', 'image', 'video', 'song'] as const).map((activity) => {
    const value = groups
      .filter((row) => activityOf(row.component) === activity)
      .reduce((sum, row) => sum + Number(row.usd), 0) + (activity === 'video' ? klingUsd : 0);
    return { label: activity, value, kind: 'usd' as const };
  }).filter((factor) => factor.value > 0);

  const vendorParts = (vendor: string): DrillFactor[] => {
    const totals = new Map<string, number>();
    for (const row of groups) {
      if (vendorKey(row.vendor) !== vendor) continue;
      const activity = activityOf(row.component);
      totals.set(activity, (totals.get(activity) ?? 0) + Number(row.usd));
    }
    if (vendor === 'fal' && klingUsd > 0) totals.set('video', (totals.get('video') ?? 0) + klingUsd);
    return [...totals.entries()]
      .filter(([, usd]) => usd > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value, kind: 'usd' as const }));
  };

  const ingest = eventLines((component) => activityOf(component) === 'ingest');
  const score = eventLines((component) => activityOf(component) === 'score');
  const copy = eventLines((component) => activityOf(component) === 'copy');
  const copyCalls = eventLines((component) => (COPY_CALL_COMPONENTS as readonly string[]).includes(component));
  const image = eventLines((component) => activityOf(component) === 'image');
  const video = eventLines((component) => activityOf(component) === 'video');
  const paidEvents = take(events);
  const all = paidEvents.map((row) => line(row.at, row.component, row.vendor, Number(row.usd)));
  const detail = (factors: DrillFactor[], lines: DrillLine[]): DrillDetail => ({ factors, lines });

  const byId: Record<string, DrillDetail> = {
    total: detail(functionParts, all),
    'ingest-total': detail(byActivity('ingest'), ingest),
    'ingest-avg': detail(byActivity('ingest'), ingest),
    'ingest-night': detail(byActivity('ingest'), ingest),
    'score-total': detail(byActivity('score'), score),
    'score-avg': detail(byActivity('score'), score),
    'score-call': detail(byActivity('score'), score),
    'copy-total': detail(byActivity('copy'), copy),
    'copy-run': detail(parts((component) => (COPY_CALL_COMPONENTS as readonly string[]).includes(component)), copyCalls),
    'copy-avg': detail(byActivity('copy'), jobLines('copy')),
    'image-total': detail(byActivity('image'), image),
    'image-run': detail(byActivity('image'), jobLines('frame')),
    'image-avg': detail(byActivity('image'), jobLines('frame')),
    'video-total': detail(videoParts, video.length > 0 ? video : jobLines('video')),
    'video-run': detail(videoParts, jobLines('video')),
    'video-avg': detail(videoParts, jobLines('video')),
    'posts-generated': detail([], jobLines('video')),
    'posts-published': detail([], jobLines('video').filter((row) => row.detail === 'ok')),
    'cost-per-published': detail(functionParts, all),
    'production-per-published': detail(functionParts.filter((factor) => ['copy', 'image', 'video'].includes(factor.label)), jobLines('video')),
    'spend-yield': detail(functionParts.filter((factor) => ['copy', 'image', 'video'].includes(factor.label)), jobLines('video')),
    'publish-yield': detail([], jobLines('video')),
    'failed-spend': detail(
      [],
      take(jobs.filter((row) => row.status !== 'ok')).map((row) => line(row.at, row.headline ?? row.stage, row.status, Number(row.usd))),
    ),
    'unshipped-copy': detail(byActivity('copy'), jobLines('copy')),
    'cost-per-video': detail(functionParts.filter((factor) => ['copy', 'image', 'video'].includes(factor.label)), jobLines('video')),
  };
  for (const vendor of ['anthropic', 'openai', 'jev', 'huggingface', 'fal']) {
    byId[`vendor:${vendor}`] = detail(
      vendorParts(vendor),
      take(events.filter((row) => vendorKey(row.vendor) === vendor)).map((row) =>
        line(row.at, row.component, row.vendor, Number(row.usd)),
      ),
    );
  }
  return byId;
}

export type { ActivityId };
