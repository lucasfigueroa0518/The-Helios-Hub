import type { MetaClient } from '@/lib/reels/music/meta';
import { carryAttempt, failStaleAttempts } from '@/lib/reels/music/publish';
import { pollDueInsights } from '@/lib/reels/media-insights/poll';
import { publishingLive, releaseDueSchedules, requireApproval } from '@/lib/reels/publish/schedule';

import type { PublishDriver } from './types';

/**
 * Text on Screen for the publisher: lib/reels' own rules, on the spine (D39).
 * Posts only in the Live state (settings standard D16): Generate (auto_run)
 * and publishing_live both on, via publishingLive's stateOf. Approval is
 * always required.
 */
export function reelsDriver(deps: { meta: () => MetaClient }): PublishDriver {
  return {
    vertical: 'reels',
    refusesAtRelease: 'cancel',
    live: () => publishingLive(),
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

