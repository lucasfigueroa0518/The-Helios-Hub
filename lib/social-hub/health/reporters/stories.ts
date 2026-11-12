import type { HubQuery } from '@/lib/social-hub/db';
import { reasonFor } from '@/lib/social-hub/health/reasons';
import { emptyReport, funnelFrom, publishingFor, withPublishing, type Reporter } from '@/lib/social-hub/health/reporters/shared';
import type { FailureEvent } from '@/lib/social-hub/health/types';

const MADE = ['ready', 'approved', 'scheduled', 'publishing', 'published'];
type SetRow = { id: string; series: string; status: string; flagged: boolean; error: string | null; spend_usd: number; at: string };

export const reportStories: Reporter = async (q: HubQuery, { night, posting }) => {
  const sets = (await q<SetRow>(
    `SELECT id::text, series, status, flagged, error, spend_usd::float8 AS spend_usd, created_at::text AS at
       FROM stories.sets WHERE ny_date = $1::date AND trigger = 'auto' AND mode = 'production'`,
    [night],
  )).rows;
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
  return withPublishing(base, posting, await publishingFor(q, 'stories', night));
};
