import type { PhotoHashDeps } from '@/lib/photos/published-posts';
import { createCarouselInsightsClient, pollCarouselInsights } from '@/lib/social/overnight/insights';
import type { CarouselMetaClient } from '@/lib/social/overnight/meta';
import { carryAttempt, failStaleAttempts } from '@/lib/social/overnight/publish';
import { releaseDueSchedules } from '@/lib/social/overnight/schedule';
import type { Query } from '@/lib/social/store/pg';
import { postsToInstagram, stateOf } from '@/lib/content-type/state';

import type { PublishDriver } from './types';

/** Carousels for the publisher: lib/social/overnight's own rules, on the spine. Posts only in the Live state (D16). */
export function carouselsDriver(deps: {
  query: Query;
  meta: () => CarouselMetaClient;
  signImage: (objectPath: string, expiresIn: number) => Promise<string>;
  /** The publish-time used-photo write's reader (CI-32); `{}` = live. Absent: no download. */
  photoHashes?: PhotoHashDeps;
  token: () => string;
}): PublishDriver {
  const setting = async (key: string) => (await deps.query(`SELECT value FROM social.settings WHERE key = $1`, [key])).rows[0]?.value;
  const driver: PublishDriver = {
    vertical: 'carousels',
    refusesAtRelease: 'cancel',
    // Live only when the state is Live (D16): Generate (auto_run) and publishing_live both on.
    live: async () => {
      const [generate, live] = await Promise.all([setting('auto_run'), setting('publishing_live')]);
      return postsToInstagram(stateOf(generate === true, live === true).state);
    },
    // Every post needs a person's approval (D16): the stored require_approval is never read.
    requireApproval: async () => true,
    failStale: () => failStaleAttempts(deps.query),
    releaseDue: async () => releaseDueSchedules(deps.query, { requireApproval: await driver.requireApproval() }),
    carry: (id) => carryAttempt({ query: deps.query, meta: deps.meta(), signImage: deps.signImage, photoHashes: deps.photoHashes }, id),
    pollInsights: () => pollCarouselInsights(deps.query, createCarouselInsightsClient({ token: deps.token() })),
  };
  return driver;
}
