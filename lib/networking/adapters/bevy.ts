import { METRO_PROFILES } from '@/lib/networking/cities';
import { fetchJson } from '@/lib/networking/http';
import { METROS, type AdapterFetchResult, type CandidateEvent, type Metro } from '@/lib/networking/types';

const GDG_SEARCH = 'https://gdg.community.dev/api/search/event/';
const GDG_HOST = 'gdg.community.dev';
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

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
  chapter_url?: string;
  audience_type?: string;
  _geoloc?: { lat?: number; lng?: number };
};

type BevySearchResponse = {
  results?: BevyEvent[];
  links?: { next?: string | null };
  count?: number;
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
    organizerName: raw.chapter_title || undefined,
    organizerKind: raw.chapter_title ? 'gdg_chapter' : undefined,
    organizerUrl: raw.chapter_url || undefined,
    descriptionSource: raw.description_short ? 'bevy' : undefined,
    trusted: true,
  };
}

/** Follow `links.next` only while it stays on the GDG API host. */
function nextPage(next: string | null | undefined): string | null {
  if (!next) return null;
  try {
    return new URL(next).hostname === GDG_HOST ? next : null;
  } catch {
    return null;
  }
}

/**
 * The search honours `latitude`/`longitude` but ignores `lat`/`lng`, every date filter and
 * ordering, so results mix past and future events. Page through and keep the future ones.
 */
export async function searchBevyMetro(metro: Metro, now = new Date()): Promise<CandidateEvent[]> {
  const profile = METRO_PROFILES[metro];
  const first = new URL(GDG_SEARCH);
  first.searchParams.set('latitude', String(profile.center.lat));
  first.searchParams.set('longitude', String(profile.center.lng));
  first.searchParams.set('page_size', String(PAGE_SIZE));
  const cutoff = now.getTime() - 60 * 60 * 1000;
  const events: CandidateEvent[] = [];
  let next: string | null = first.toString();
  for (let page = 0; next && page < MAX_PAGES; page += 1) {
    const { ok, status, json } = await fetchJson<BevySearchResponse>(next, {
      headers: { Accept: 'application/json; version=2024-01-01' },
    });
    if (!ok || !json?.results) {
      if (page === 0) throw new Error(`Bevy search HTTP ${status}`);
      break;
    }
    for (const raw of json.results) {
      const start = raw.start_date_iso ? Date.parse(raw.start_date_iso) : Number.NaN;
      if (!Number.isFinite(start) || start < cutoff) continue;
      const event = normalizeBevyEvent(raw);
      if (event) events.push(event);
    }
    next = nextPage(json.links?.next);
  }
  return events;
}

export async function fetchBevyEvents(): Promise<AdapterFetchResult> {
  const seen = new Set<string>();
  const events: CandidateEvent[] = [];
  const errors: string[] = [];
  for (const metro of METROS) {
    try {
      for (const event of await searchBevyMetro(metro)) {
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
