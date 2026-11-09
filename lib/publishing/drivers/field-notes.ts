import { FIELD_NOTES_SPINE_VERTICAL } from '@/lib/field-notes/config';
import { carryFieldNotesAttempt, failStaleFieldNotesAttempts } from '@/lib/field-notes/publish';
import { releaseDueFieldNotes } from '@/lib/field-notes/schedule';
import { readFieldNotesSettings } from '@/lib/field-notes/settings';
import { createCarouselInsightsClient, pollCarouselInsights } from '@/lib/social/overnight/insights';
import type { CarouselMetaClient } from '@/lib/social/overnight/meta';
import type { Query } from '@/lib/social/store/pg';

import type { PublishDriver } from './types';

/**
 * Field Notes for the publisher: field_notes.settings' own switches, its queue rule and the shared
 * feed-carousel publish (lib/field-notes). An unreadable field_notes schema reads as "not live",
 * so it can never stop the other types' tick.
 */
export function fieldNotesDriver(deps: {
  query: Query;
  meta: () => CarouselMetaClient;
  signImage: (objectPath: string, expiresIn: number) => Promise<string>;
  token: () => string;
}): PublishDriver {
  const settings = () => readFieldNotesSettings(deps.query).catch(() => null);
  const driver: PublishDriver = {
    vertical: FIELD_NOTES_SPINE_VERTICAL,
    refusesAtRelease: 'cancel',
    live: async () => (await settings())?.publishingLive === true,
    requireApproval: async () => (await settings())?.requireApproval !== false,
    failStale: () => failStaleFieldNotesAttempts(deps.query),
    releaseDue: async () => releaseDueFieldNotes(deps.query, { requireApproval: await driver.requireApproval() }),
    carry: (id) => carryFieldNotesAttempt({ query: deps.query, meta: deps.meta(), signImage: deps.signImage }, id),
    pollInsights: () => pollCarouselInsights(deps.query, createCarouselInsightsClient({ token: deps.token() }), new Date(), 200, 'field_notes'),
  };
  return driver;
}
