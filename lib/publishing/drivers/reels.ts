import type { MetaClient } from '@/lib/reels/music/meta';
import { carryAttempt, failStaleAttempts } from '@/lib/reels/music/publish';
import { pollDueInsights } from '@/lib/reels/media-insights/poll';
import { releaseDueSchedules, requireApproval } from '@/lib/reels/publish/schedule';

import type { PublishDriver } from './types';

/**
 * Trial Reels for the publisher: lib/reels' own rules, on the spine (D39).
 * Always live: Trial Reels' `publishing_live` switches only the nightly
 * auto-schedule; a person's Approve or Force post goes out while it is off
 * (docs/social-overnight.md), so queued reels are always released and posted.
 */
export function reelsDriver(deps: { meta: () => MetaClient }): PublishDriver {
  return {
    vertical: 'reels',
    refusesAtRelease: 'cancel',
    live: async () => true,
    requireApproval: () => requireApproval(),
    failStale: () => failStaleAttempts(),
    releaseDue: () => releaseDueSchedules(),
    carry: (id) => carryAttempt({ meta: deps.meta() }, id) as Promise<{ id: string; status: 'published' | 'failed' }>,
    pollInsights: async () => {
      const r = await pollDueInsights({});
      return { considered: r.considered, written: r.written, blocked: r.blocked, detail: r.detail ?? null };
    },
  };
}

