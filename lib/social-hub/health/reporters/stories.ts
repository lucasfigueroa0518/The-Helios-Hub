import type { HubQuery } from '@/lib/social-hub/db';
import { reasonFor } from '@/lib/social-hub/health/reasons';
import { emptyReport, funnelFrom, publishingFor, quotaDay, withPublishing, type Reporter } from '@/lib/social-hub/health/reporters/shared';
import { SERIES_OF_VERTICAL, verticalOfSeries, type StoryVertical } from '@/lib/social-hub/story-types';
import type { FailureEvent } from '@/lib/social-hub/health/types';

const MADE = ['ready', 'approved', 'scheduled', 'publishing', 'published'];
type SetRow = { id: string; series: string; status: string; flagged: boolean; error: string | null; spend_usd: number; at: string; ny_date: string };

/**
 * A Stories-format type's night (SS-1: Morning Download, Are you smarter than AI? and Real or AI? each report on
 * their own): the auto sets the night made of the type's series, for the date it fills (Bald-Eagle D4: Morning
 * Download the night itself, the other two 2 days on; quotaDay), and what is already booked on that date.
 */
export function makeStoriesReporter(vertical: StoryVertical): Reporter {
  const series = SERIES_OF_VERTICAL[vertical];
  return async (q: HubQuery, { night, posting }) => {
    const date = quotaDay(night, vertical);
    const sets = (await q<SetRow>(
      `SELECT id::text, series, status, flagged, error, spend_usd::float8 AS spend_usd, created_at::text AS at, ny_date::text AS ny_date
         FROM stories.sets WHERE ny_date = $1::date AND trigger = 'auto' AND mode = 'production'`,
      [date],
    )).rows.filter((s) => verticalOfSeries(s.series) === vertical);
    const failures: FailureEvent[] = [];
    for (const s of sets) {
      const item = { kind: 'story-set', id: s.id, label: s.series.replace(/_/g, ' ') };
      if (s.status === 'failed') failures.push({ vertical, night, at: new Date(s.at).toISOString(), stage: 'build', reason: reasonFor('build', s.error), severity: 'failed', rawError: s.error ?? undefined, item });
      if (s.status === 'skipped' && s.error) failures.push({ vertical, night, at: new Date(s.at).toISOString(), stage: 'build', reason: reasonFor('build', s.error), severity: 'warning', rawError: s.error, item });
    }
    // Built is not postable: a `ready` set posts only after a person approves it (and never on its own while a frame is
    // flagged). The 07:30 report cannot see the approval that comes later, so say so instead of reading plain green.
    for (const s of sets.filter((x) => x.status === 'ready')) {
      const item = { kind: 'story-set', id: s.id, label: s.series.replace(/_/g, ' ') };
      failures.push({ vertical, night, at: new Date(s.at).toISOString(), stage: 'review', reason: 'awaiting_approval', severity: 'warning', rawError: s.flagged ? 'built with flagged frames; needs a person to review and approve it' : 'built; needs a person to approve it', item });
    }
    const made = sets.filter((s) => MADE.includes(s.status)).length;
    const base = {
      ...emptyReport(vertical, night),
      ran: sets.length > 0,
      made,
      funnel: funnelFrom(sets.length, [['build', sets.length - made]]),
      failures,
      spendUsd: sets.reduce((n, s) => n + s.spend_usd, 0),
    };
    const publishing = await publishingFor(q, vertical, night);
    // Bookings on the type's target date (a booking's slot names its series: `ai_trivia` or `t0510:ai_trivia`).
    const { rows } = await q<{ source: string; n: number }>(
      `SELECT source, count(*)::int AS n FROM social_hub.schedule
        WHERE vertical = $3 AND ny_date = $1::date AND status <> 'cancelled'
          AND (slot = $2 OR split_part(slot, ':', 2) = $2)
        GROUP BY source`,
      [date, series, vertical],
    );
    const placed = rows.find((r) => r.source === 'user')?.n ?? 0;
    const filled = rows.find((r) => r.source === 'auto')?.n ?? 0;
    return withPublishing(base, posting, { ...publishing, placedToday: placed, filledAutoToday: filled });
  };
}

/** Morning Download's night (the hub id `stories` kept, SS-1). */
export const reportStories: Reporter = makeStoriesReporter('stories');
