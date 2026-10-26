import { AI_EVENTS_SPINE_VERTICAL, AI_EVENTS_VERTICAL } from '@/lib/ai-events/config';
import { carryAiEventsAttempt, failStaleAiEventsAttempts, type SnapshotPublisher } from '@/lib/ai-events/publish';
import { releaseDueAiEvents } from '@/lib/ai-events/schedule';
import { readAiEventsSettings } from '@/lib/ai-events/settings';
import { createCarouselInsightsClient, pollCarouselInsights } from '@/lib/social/overnight/insights';
import type { CarouselMetaClient } from '@/lib/social/overnight/meta';
import type { Query } from '@/lib/social/store/pg';

import type { PublishDriver } from './types';

/**
 * AI Events This Week for the publisher: ai_events.settings' own switches, its queue rule and
 * the shared feed-carousel publish (lib/ai-events). A published post publishes the public
 * calendar snapshot again (`snapshot`, its failure only logged). An unreadable ai_events schema
 * reads as "not live", so it can never stop the other types' tick.
 */
export function aiEventsDriver(deps: {
  query: Query;
  meta: () => CarouselMetaClient;
  signImage: (objectPath: string, expiresIn: number) => Promise<string>;
  token: () => string;
  snapshot?: SnapshotPublisher;
  log?: (message: string, fields?: Record<string, unknown>) => void;
}): PublishDriver {
  const settings = () => readAiEventsSettings(deps.query).catch(() => null);
  const driver: PublishDriver = {
    vertical: AI_EVENTS_SPINE_VERTICAL,
    refusesAtRelease: 'cancel',
    live: async () => (await settings())?.publishingLive === true,
    requireApproval: async () => (await settings())?.requireApproval !== false,
    failStale: () => failStaleAiEventsAttempts(deps.query),
    releaseDue: async () => releaseDueAiEvents(deps.query, { requireApproval: await driver.requireApproval() }),
    carry: (id) =>
      carryAiEventsAttempt({ query: deps.query, meta: deps.meta(), signImage: deps.signImage }, id, { snapshot: deps.snapshot, log: deps.log }),
    pollInsights: () => pollCarouselInsights(deps.query, createCarouselInsightsClient({ token: deps.token() }), new Date(), 200, AI_EVENTS_VERTICAL),
  };
  return driver;
}
