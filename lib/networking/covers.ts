/**
 * Fill `signals.coverUrl` on already-ingested events (AE-33): discover often had no poster
 * URL stored, and the details job used to ignore `event.cover_url`. A rank run fetches the
 * missing poster from each listing (Luma `event/get`, Meetup event page) and writes it so
 * the next rebuild does not fetch again. Plain HTTP, no model.
 */
import { mapPool } from '@/lib/async-pool';
import { fetchLumaEventDetail } from '@/lib/networking/adapters/luma';
import { fetchMeetupEventDetail } from '@/lib/networking/adapters/meetup';
import { fetchJson, fetchText } from '@/lib/networking/http';
import type { NetworkingQuery } from '@/lib/networking/repository';
import type { StoredNetworkingEvent } from '@/lib/networking/types';

const COVER_CONCURRENCY = 3;

export type CoverFetchDeps = {
  fetchJson?: typeof fetchJson;
  fetchText?: typeof fetchText;
};

const STORE_COVER_SQL = `
UPDATE networking.events
   SET signals = signals || jsonb_build_object('coverUrl', $2::text),
       updated_at = now()
 WHERE id = $1::uuid
   AND COALESCE(signals->>'coverUrl', '') = ''`;

export async function resolveListingCover(
  listing: { source: string; sourceEventId: string; url: string },
  deps: CoverFetchDeps = {},
): Promise<string | null> {
  if (listing.source === 'luma' && listing.sourceEventId) {
    const { detail } = await fetchLumaEventDetail(listing.sourceEventId, deps.fetchJson ?? fetchJson);
    return detail?.coverUrl ?? null;
  }
  if (listing.source === 'meetup' && listing.url) {
    const { detail } = await fetchMeetupEventDetail(listing.url, listing.sourceEventId, deps.fetchText ?? fetchText);
    return detail?.signals.signals?.coverUrl ?? null;
  }
  return null;
}

/** Persist a poster URL on events that do not have one yet. Returns how many were written. */
export async function fillMissingCoverUrls(
  query: NetworkingQuery,
  events: StoredNetworkingEvent[],
  deps: CoverFetchDeps = {},
): Promise<number> {
  const missing = events.filter((event) => !event.signals?.coverUrl && event.listings.length);
  if (!missing.length) return 0;
  let written = 0;
  await mapPool(missing, COVER_CONCURRENCY, async (event) => {
    let coverUrl: string | null = null;
    for (const listing of event.listings) {
      try {
        coverUrl = await resolveListingCover(listing, deps);
      } catch {
        coverUrl = null;
      }
      if (coverUrl) break;
    }
    if (!coverUrl) return;
    event.signals = { ...event.signals, coverUrl };
    await query(STORE_COVER_SQL, [event.id, coverUrl]);
    written += 1;
  });
  return written;
}
