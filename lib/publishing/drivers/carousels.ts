import { createCarouselInsightsClient, pollCarouselInsights } from '@/lib/social/overnight/insights';
import type { CarouselMetaClient } from '@/lib/social/overnight/meta';
import { carryAttempt, failStaleAttempts } from '@/lib/social/overnight/publish';
import { releaseDueSchedules } from '@/lib/social/overnight/schedule';
import type { Query } from '@/lib/social/store/pg';

import type { PublishDriver } from './types';

/** Carousels for the publisher: lib/social/overnight's own rules, on the spine. */
export function carouselsDriver(deps: {
  query: Query;
  meta: () => CarouselMetaClient;
  signImage: (objectPath: string, expiresIn: number) => Promise<string>;
  token: () => string;
}): PublishDriver {
  const setting = async (key: string) => (await deps.query(`SELECT value FROM social.settings WHERE key = $1`, [key])).rows[0]?.value;
  const driver: PublishDriver = {
    vertical: 'carousels',
    live: async () => (await setting('publishing_live')) === true,
    requireApproval: async () => (await setting('require_approval')) !== false,
    failStale: () => failStaleAttempts(deps.query),
    releaseDue: async () => releaseDueSchedules(deps.query, { requireApproval: await driver.requireApproval() }),
    carry: (id) => carryAttempt({ query: deps.query, meta: deps.meta(), signImage: deps.signImage }, id),
    pollInsights: () => pollCarouselInsights(deps.query, createCarouselInsightsClient({ token: deps.token() })),
  };
  return driver;
}
