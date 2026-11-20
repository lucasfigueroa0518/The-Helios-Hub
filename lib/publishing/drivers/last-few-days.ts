import type { PhotoHashDeps } from '@/lib/photos/published-posts';
import { failStaleLfdAttempts, carryLfdAttempt } from '@/lib/lfd/publish';
import { releaseDueLfd } from '@/lib/lfd/schedule';
import { readLfdSettings } from '@/lib/lfd/settings';
import { createCarouselInsightsClient, pollCarouselInsights } from '@/lib/social/overnight/insights';
import type { CarouselMetaClient } from '@/lib/social/overnight/meta';
import type { Query } from '@/lib/social/store/pg';
import { postsToInstagram, stateOf } from '@/lib/content-type/state';

import type { PublishDriver } from './types';

/**
 * Last Few Days for the publisher: lfd.settings' own switches, its queue rule
 * and the shared feed-carousel publish (lib/lfd). An unreadable lfd schema
 * reads as "not live", so it can never stop the other types' tick.
 */
export function lastFewDaysDriver(deps: {
  query: Query;
  meta: () => CarouselMetaClient;
  signImage: (objectPath: string, expiresIn: number) => Promise<string>;
  /** The publish-time used-photo write's reader (CI-32); `{}` = live. Absent: no download. */
  photoHashes?: PhotoHashDeps;
  token: () => string;
}): PublishDriver {
  const settings = () => readLfdSettings(deps.query).catch(() => null);
  const driver: PublishDriver = {
    vertical: 'last_few_days',
    refusesAtRelease: 'cancel',
    // Live only when the state is Live (D16): Generate (auto_run) and publishing_live both on.
    live: async () => {
      const s = await settings();
      return s !== null && postsToInstagram(stateOf(s.autoRun, s.publishingLive).state);
    },
    // Every post needs a person's approval (D16): require_approval is never read as false.
    requireApproval: async () => true,
    failStale: () => failStaleLfdAttempts(deps.query),
    releaseDue: async () => releaseDueLfd(deps.query, { requireApproval: await driver.requireApproval() }),
    carry: (id) => carryLfdAttempt({ query: deps.query, meta: deps.meta(), signImage: deps.signImage, photoHashes: deps.photoHashes }, id),
    pollInsights: () => pollCarouselInsights(deps.query, createCarouselInsightsClient({ token: deps.token() }), new Date(), 200, 'last_few_days'),
  };
  return driver;
}
