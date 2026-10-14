import { failStaleLfdAttempts, carryLfdAttempt } from '@/lib/lfd/publish';
import { releaseDueLfd } from '@/lib/lfd/schedule';
import { readLfdSettings } from '@/lib/lfd/settings';
import { createCarouselInsightsClient, pollCarouselInsights } from '@/lib/social/overnight/insights';
import type { CarouselMetaClient } from '@/lib/social/overnight/meta';
import type { Query } from '@/lib/social/store/pg';

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
  token: () => string;
}): PublishDriver {
  const settings = () => readLfdSettings(deps.query).catch(() => null);
  const driver: PublishDriver = {
    vertical: 'last_few_days',
    refusesAtRelease: 'cancel',
    live: async () => (await settings())?.publishingLive === true,
    requireApproval: async () => (await settings())?.requireApproval !== false,
    failStale: () => failStaleLfdAttempts(deps.query),
    releaseDue: async () => releaseDueLfd(deps.query, { requireApproval: await driver.requireApproval() }),
    carry: (id) => carryLfdAttempt({ query: deps.query, meta: deps.meta(), signImage: deps.signImage }, id),
    pollInsights: () => pollCarouselInsights(deps.query, createCarouselInsightsClient({ token: deps.token() }), new Date(), 200, 'last_few_days'),
  };
  return driver;
}
