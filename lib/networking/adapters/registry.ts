import { fetchBevyEvents } from '@/lib/networking/adapters/bevy';
import { fetchConferenceEvents } from '@/lib/networking/adapters/conferences';
import { fetchIcsEvents } from '@/lib/networking/adapters/ics';
import { fetchLumaEvents } from '@/lib/networking/adapters/luma';
import { fetchMeetupEvents } from '@/lib/networking/adapters/meetup';
import type { AdapterFetchResult } from '@/lib/networking/types';

/**
 * Sources in the weekly ingest. Eventbrite is left out (AE-07): its listing pages block the
 * worker's IP. The adapter file stays for URL imports and a later return.
 */
export const INGEST_SOURCES: ReadonlyArray<{ name: string; fetch: () => Promise<AdapterFetchResult> }> = [
  { name: 'luma', fetch: fetchLumaEvents },
  { name: 'meetup', fetch: fetchMeetupEvents },
  { name: 'ics', fetch: fetchIcsEvents },
  { name: 'bevy', fetch: fetchBevyEvents },
  { name: 'conferences', fetch: fetchConferenceEvents },
];

export async function fetchAllSources(): Promise<AdapterFetchResult[]> {
  const settled = await Promise.allSettled(INGEST_SOURCES.map((source) => source.fetch()));
  return settled.map((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    return {
      source: INGEST_SOURCES[index].name,
      events: [],
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  });
}
