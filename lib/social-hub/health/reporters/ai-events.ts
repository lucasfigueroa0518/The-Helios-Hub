import type { HubQuery } from '@/lib/social-hub/db';
import { reasonFor } from '@/lib/social-hub/health/reasons';
import { emptyReport, funnelFrom, publishingFor, withPublishing, type Reporter } from '@/lib/social-hub/health/reporters/shared';
import { cycleBounds } from '@/lib/social-hub/health/time';
import type { FailureEvent } from '@/lib/social-hub/health/types';

type RunRow = { id: string; status: string; stop_reason: string | null; error: string | null; total_usd: number; cap_usd: number; at: string };

/**
 * The public events calendar's networking.publish_state row (lib/networking/public-snapshot.ts
 * EVENTS_FEED_STATE_ID; copied, since that module uploads and hub read code may not reach it).
 * tests/ai-events-hub.test.ts pins the copy.
 */
export const EVENTS_FEED_STATE_ID = 'events.v1';

/** The snapshot is republished at least weekly (the Sunday ingest, the ranking run, the post); past this it is stale. */
export const SNAPSHOT_STALE_DAYS = 8;

export const SNAPSHOT_STALE_LABEL = 'Events calendar snapshot';

/**
 * When the public events calendar was last published, and whether that is more than
 * SNAPSHOT_STALE_DAYS before `at`. Never published, or a database without the networking
 * schema, is not stale: there is nothing live to go stale yet.
 */
export async function snapshotStale(q: HubQuery, at: Date): Promise<{ stale: boolean; lastPublishedAt: string | null }> {
  try {
    const { rows } = await q<{ last_published_at: string | null }>(
      `SELECT last_published_at::text AS last_published_at FROM networking.publish_state WHERE id = $1`,
      [EVENTS_FEED_STATE_ID],
    );
    const last = rows[0]?.last_published_at ?? null;
    if (!last) return { stale: false, lastPublishedAt: null };
    return { stale: at.getTime() - Date.parse(last) > SNAPSHOT_STALE_DAYS * 86_400_000, lastPublishedAt: new Date(last).toISOString() };
  } catch {
    return { stale: false, lastPublishedAt: null };
  }
}

/**
 * AI Events' night. Its Sunday 12:00 PM run and its 6:00–7:00 PM post both fall in
 * Monday's cycle (night N runs 08:00 on N−1 to 07:30 on N), so Monday's night reports
 * them: the scheduled builds in the cycle, and Sunday's slot as "yesterday" (publishingFor
 * reads N−1). quotaFor maps the same way. A manual Generate or Rebuild post is a person's,
 * not the night's. A scheduled run skipped because the week already had a post (a person
 * made it) counts as made. The calendar snapshot older than SNAPSHOT_STALE_DAYS is flagged
 * on every night, due or not.
 */
export const reportAiEvents: Reporter = async (q: HubQuery, { night, posting }) => {
  const { start, end } = cycleBounds(night);
  const runs = (await q<RunRow>(
    `SELECT id::text, status, stop_reason, error, total_usd::float8 AS total_usd, cap_usd::float8 AS cap_usd,
            COALESCE(started_at, requested_at)::text AS at
       FROM ai_events.runs
      WHERE trigger = 'scheduled' AND kind = 'build'
        AND COALESCE(started_at, requested_at) >= $1 AND COALESCE(started_at, requested_at) < $2
      ORDER BY requested_at`,
    [start.toISOString(), end.toISOString()],
  )).rows;
  const failures: FailureEvent[] = [];
  const postExists = (r: RunRow) => r.status === 'skipped' && (r.stop_reason ?? '').startsWith('post-exists');
  for (const run of runs) {
    const at = new Date(run.at).toISOString();
    if (run.status === 'failed') {
      failures.push({ vertical: 'ai_events', night, at, stage: 'run', reason: reasonFor('run', run.error ?? run.stop_reason), severity: 'failed', rawError: run.error ?? run.stop_reason ?? undefined, runId: run.id, spentUsd: run.total_usd });
    } else if (run.status === 'skipped' && !postExists(run)) {
      // No city had an event above the bar: no post this week. Worth a look, not a fault.
      failures.push({ vertical: 'ai_events', night, at, stage: 'run', reason: 'no_picks', severity: 'warning', rawError: run.stop_reason ?? undefined, runId: run.id, spentUsd: run.total_usd });
    }
  }
  const stale = await snapshotStale(q, end);
  if (stale.stale) {
    failures.push({
      vertical: 'ai_events', night, at: end.toISOString(), stage: 'snapshot', reason: 'snapshot_stale', severity: 'warning',
      rawError: `networking.publish_state ${EVENTS_FEED_STATE_ID} last published ${stale.lastPublishedAt}`,
    });
  }
  const made = runs.filter((r) => r.status === 'ok' || r.status === 'partial' || postExists(r)).length;
  const base = {
    ...emptyReport('ai_events', night),
    ran: runs.some((r) => ['ok', 'partial', 'failed', 'skipped'].includes(r.status)),
    made,
    funnel: funnelFrom(runs.length, [['run', runs.filter((r) => r.status === 'failed').length]]),
    failures,
    spendUsd: runs.reduce((n, r) => n + r.total_usd, 0),
    feedsStale: stale.stale ? [SNAPSHOT_STALE_LABEL] : [],
    nearCap: runs.some((r) => r.cap_usd > 0 && r.total_usd >= 0.9 * r.cap_usd),
  };
  return withPublishing(base, posting, await publishingFor(q, 'ai_events', night));
};
