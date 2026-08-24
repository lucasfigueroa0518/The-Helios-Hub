import { METRO_PROFILES } from '@/lib/networking/cities';
import { fetchJson } from '@/lib/networking/http';
import type { AdapterFetchResult, CandidateEvent } from '@/lib/networking/types';

const GDG_SEARCH = 'https://gdg.community.dev/api/search/event/';

type BevyEvent = {
  id?: number | string;
  title?: string;
  description_short?: string;
  start_date_iso?: string;
  end_date_iso?: string;
  event_timezone?: string;
  url?: string;
  venue_name?: string;
  venue_address?: string;
  venue_city?: string;
  chapter_city?: string;
  chapter_title?: string;
  audience_type?: string;
  _geoloc?: { lat?: number; lng?: number };
};

type BevySearchResponse = {
  results?: BevyEvent[];
};

export function normalizeBevyEvent(raw: BevyEvent): CandidateEvent | null {
  if (!raw.id || !raw.title || !raw.start_date_iso) return null;
  const audience = (raw.audience_type || '').toLowerCase();
  const isOnline = audience === 'virtual' || audience === 'online';
  return {
    source: 'bevy',
    sourceEventId: String(raw.id),
    title: raw.title,
    description: raw.description_short || '',
    url: raw.url || `https://gdg.community.dev/events/${raw.id}/`,
    startAt: new Date(raw.start_date_iso),
    endAt: raw.end_date_iso ? new Date(raw.end_date_iso) : undefined,
    timezone: raw.event_timezone,
    venueName: raw.venue_name,
    address: raw.venue_address,
    city: raw.venue_city || raw.chapter_city,
    lat: raw._geoloc?.lat,
    lng: raw._geoloc?.lng,
    isOnline,
    hostName: raw.chapter_title,
    trusted: true,
  };
}

async function searchMetro(metro: 'boston' | 'miami'): Promise<CandidateEvent[]> {
  const profile = METRO_PROFILES[metro];
  const start = new Date();
  const end = new Date(start.getTime() + 90 * 24 * 60 * 60 * 1000);
  const url = new URL(GDG_SEARCH);
  url.searchParams.set('start_date', start.toISOString().slice(0, 10));
  url.searchParams.set('end_date', end.toISOString().slice(0, 10));
  url.searchParams.set('query', '');
  url.searchParams.set('lat', String(profile.center.lat));
  url.searchParams.set('lng', String(profile.center.lng));
  const { ok, json } = await fetchJson<BevySearchResponse>(url.toString(), {
    headers: { Accept: 'application/json; version=2024-01-01' },
  });
  if (!ok || !json?.results) return [];
  return json.results
    .map(normalizeBevyEvent)
    .filter((event): event is CandidateEvent => Boolean(event));
}

export async function fetchBevyEvents(): Promise<AdapterFetchResult> {
  const seen = new Set<string>();
  const events: CandidateEvent[] = [];
  const errors: string[] = [];
  for (const metro of ['boston', 'miami'] as const) {
    try {
      for (const event of await searchMetro(metro)) {
        if (seen.has(event.sourceEventId)) continue;
        seen.add(event.sourceEventId);
        events.push(event);
      }
    } catch (err) {
      errors.push(`${metro}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { source: 'bevy', events, error: errors.length ? errors.join('; ') : undefined };
}
