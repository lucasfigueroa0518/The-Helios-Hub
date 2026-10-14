import type { PostingState } from '@/lib/content-type/posting';
import type { HubQuery } from '@/lib/social-hub/db';
import { reasonFor } from '@/lib/social-hub/health/reasons';
import { weekdayIndex } from '@/lib/social-hub/health/time';
import type { FailureEvent, FunnelStep, NightReport } from '@/lib/social-hub/health/types';
import { addDays } from '@/lib/social-hub/time';
import type { Vertical } from '@/lib/social-hub/types';

export type ReportContext = { night: string; posting: PostingState; now: Date };
export type Reporter = (q: HubQuery, ctx: ReportContext) => Promise<NightReport>;

export function quotaFor(posting: PostingState, night: string): number {
  // Last Few Days: one post on each of its days (spec §7.4).
  if (posting.days) return posting.days.includes(weekdayIndex(night)) ? 1 : 0;
  if (posting.series) {
    const day = weekdayIndex(night);
    return posting.series.filter((s) => s.enabled && s.generate && s.days.includes(day)).length;
  }
  return posting.perDay ?? 0;
}

export function funnelFrom(start: number, drops: ReadonlyArray<[string, number]>): FunnelStep[] {
  let current = start;
  return drops.map(([stage, n]) => {
    const step = { stage, in: current, out: Math.max(0, current - Math.max(0, n)) };
    current = step.out;
    return step;
  });
}

export function emptyReport(vertical: Vertical, night: string): NightReport {
  return {
    vertical, night, due: false, ran: false, target: 0, made: 0, needed: 0, ready: 0,
    scheduledYesterday: 0, postedYesterday: 0, retriedOk: 0, funnel: [], failures: [], spendUsd: 0,
    unknownCostCalls: 0, feedsStale: [], nearCap: false, reportError: null,
  };
}

export type Publishing = {
  scheduledYesterday: number;
  postedYesterday: number;
  retriedOk: number;
  failures: FailureEvent[];
  placedToday: number;
  filledAutoToday: number;
};

type SlotRow = { id: string; status: string; error: string | null; publish_at: string; content_item_id: string | null; failed_attempts: number; last_error: string | null };

export async function publishingFor(q: HubQuery, vertical: Vertical, night: string): Promise<Publishing> {
  const yesterday = addDays(night, -1);
  const { rows } = await q<SlotRow>(
    `SELECT s.id::text, s.status, s.error, s.publish_at::text, s.content_item_id::text,
            (SELECT count(*) FROM social_hub.publish_attempts a WHERE a.content_item_id = s.content_item_id AND a.status = 'failed')::int AS failed_attempts,
            (SELECT a.error FROM social_hub.publish_attempts a
              WHERE a.content_item_id = s.content_item_id AND a.status = 'failed'
              ORDER BY a.requested_at DESC LIMIT 1) AS last_error
       FROM social_hub.schedule s
      WHERE s.vertical = $1 AND s.ny_date = $2::date AND s.status <> 'cancelled'`,
    [vertical, yesterday],
  );
  const failures: FailureEvent[] = [];
  let posted = 0;
  let retriedOk = 0;
  for (const r of rows) {
    const item = r.content_item_id ? { kind: 'post', id: r.content_item_id, label: `${yesterday} post` } : undefined;
    if (r.status === 'published') {
      posted++;
      if (r.failed_attempts > 0) {
        retriedOk++;
        failures.push({ vertical, night, at: new Date(r.publish_at).toISOString(), stage: 'publish', reason: reasonFor('publish', r.last_error), severity: 'healed', rawError: r.last_error ?? undefined, item });
      }
    } else if (r.status === 'failed') {
      const raw = r.error ?? r.last_error;
      failures.push({ vertical, night, at: new Date(r.publish_at).toISOString(), stage: 'publish', reason: reasonFor('publish', raw), severity: 'failed', rawError: raw ?? undefined, item });
    }
  }
  const today = await q<{ source: string; n: number }>(
    `SELECT source, count(*)::int AS n FROM social_hub.schedule
      WHERE vertical = $1 AND ny_date = $2::date AND status <> 'cancelled' GROUP BY source`,
    [vertical, night],
  );
  const count = (source: string) => today.rows.find((r) => r.source === source)?.n ?? 0;
  return { scheduledYesterday: rows.length, postedYesterday: posted, retriedOk, failures, placedToday: count('user'), filledAutoToday: count('auto') };
}

/** Fills target/needed/ready/posted from the quota and publishing reads. */
export function withPublishing(r: NightReport, posting: PostingState, p: Publishing): NightReport {
  const quota = quotaFor(posting, r.night);
  // Due follows the GENERATE switch, not `live` (live only gates publishing).
  // `generate === null` (Stories) means each series carries its own switch,
  // which quotaFor already applies. A run that actually happened is always due,
  // so a crash on a night generation was meant to be off still shows.
  const due = (posting.generate !== false && quota > 0) || r.ran;
  return {
    ...r,
    due,
    needed: quota,
    target: Math.max(0, quota - p.placedToday),
    ready: p.placedToday + Math.max(p.filledAutoToday, r.made),
    scheduledYesterday: p.scheduledYesterday,
    postedYesterday: p.postedYesterday,
    retriedOk: p.retriedOk + r.retriedOk,
    failures: [...r.failures, ...p.failures],
  };
}
