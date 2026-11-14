import type { HubQuery } from '@/lib/social-hub/db';
import { reasonFor } from '@/lib/social-hub/health/reasons';
import { emptyReport, funnelFrom, publishingFor, quotaDay, withPublishing, type Reporter } from '@/lib/social-hub/health/reporters/shared';
import { isStorySeries, STORY_SERIES } from '@/lib/social-hub/slots/types';
import type { FailureEvent } from '@/lib/social-hub/health/types';

const MADE = ['ready', 'approved', 'scheduled', 'publishing', 'published'];
type SetRow = { id: string; series: string; status: string; flagged: boolean; error: string | null; spend_usd: number; at: string; ny_date: string };

/**
 * Stories' night: the auto sets the night made, each series for the date it fills (Bald-Eagle D4: Morning
 * Download the night itself, Guess the Number and Free vs. Paid 2 days on; quotaDay), and what is already
 * booked on those dates.
 */
export const reportStories: Reporter = async (q: HubQuery, { night, posting }) => {
  const target = (series: string) => quotaDay(night, 'stories', isStorySeries(series) ? series : null);
  const dates = [...new Set(STORY_SERIES.map(target))];
  const sets = (await q<SetRow>(
    `SELECT id::text, series, status, flagged, error, spend_usd::float8 AS spend_usd, created_at::text AS at, ny_date::text AS ny_date
       FROM stories.sets WHERE ny_date = ANY($1::date[]) AND trigger = 'auto' AND mode = 'production'`,
    [dates],
  )).rows.filter((s) => String(s.ny_date).slice(0, 10) === target(s.series));
  const failures: FailureEvent[] = [];
  for (const s of sets) {
    const item = { kind: 'story-set', id: s.id, label: s.series.replace(/_/g, ' ') };
    if (s.status === 'failed') failures.push({ vertical: 'stories', night, at: new Date(s.at).toISOString(), stage: 'build', reason: reasonFor('build', s.error), severity: 'failed', rawError: s.error ?? undefined, item });
    if (s.status === 'skipped' && s.error) failures.push({ vertical: 'stories', night, at: new Date(s.at).toISOString(), stage: 'build', reason: reasonFor('build', s.error), severity: 'warning', rawError: s.error, item });
  }
  // Built is not postable: a `ready` set posts only after a person approves it (and never on its own while a frame is
  // flagged). The 07:30 report cannot see the approval that comes later, so say so instead of reading plain green.
  for (const s of sets.filter((x) => x.status === 'ready')) {
    const item = { kind: 'story-set', id: s.id, label: s.series.replace(/_/g, ' ') };
    failures.push({ vertical: 'stories', night, at: new Date(s.at).toISOString(), stage: 'review', reason: 'awaiting_approval', severity: 'warning', rawError: s.flagged ? 'built with flagged frames; needs a person to review and approve it' : 'built; needs a person to approve it', item });
  }
  const made = sets.filter((s) => MADE.includes(s.status)).length;
  const base = {
    ...emptyReport('stories', night),
    ran: sets.length > 0,
    made,
    funnel: funnelFrom(sets.length, [['build', sets.length - made]]),
    failures,
    spendUsd: sets.reduce((n, s) => n + s.spend_usd, 0),
  };
  const publishing = await publishingFor(q, 'stories', night);
  // Bookings on each series' own target date (a booking's slot names its series: `guess_the_number` or `t0510:guess_the_number`).
  let placed = 0;
  let filled = 0;
  for (const date of dates) {
    const own = STORY_SERIES.filter((s) => target(s) === date);
    const { rows } = await q<{ source: string; n: number }>(
      `SELECT source, count(*)::int AS n FROM social_hub.schedule
        WHERE vertical = 'stories' AND ny_date = $1::date AND status <> 'cancelled'
          AND (slot = ANY($2::text[]) OR split_part(slot, ':', 2) = ANY($2::text[]))
        GROUP BY source`,
      [date, own],
    );
    placed += rows.find((r) => r.source === 'user')?.n ?? 0;
    filled += rows.find((r) => r.source === 'auto')?.n ?? 0;
  }
  return withPublishing(base, posting, { ...publishing, placedToday: placed, filledAutoToday: filled });
};
