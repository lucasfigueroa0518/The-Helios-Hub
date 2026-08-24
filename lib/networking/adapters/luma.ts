import { LUMA_CALENDARS } from '@/lib/networking/allowlists';
import { METRO_PROFILES, cleanLocation } from '@/lib/networking/cities';
import { fetchJson } from '@/lib/networking/http';
import type { AdapterFetchResult, CandidateEvent, Metro } from '@/lib/networking/types';

const BASE_URL = 'https://api.luma.com/discover/get-paginated-events';
const CALENDAR_GET = 'https://api.luma.com/calendar/get';
const CALENDAR_ITEMS = 'https://api.luma.com/calendar/get-items';
const PAGE_LIMIT = 50;
const MAX_PER_QUERY = 400;

type RawGeoInfo = {
  city?: string;
  region?: string;
  country?: string;
  short_address?: string;
  full_address?: string;
};

type RawEvent = {
  api_id?: string;
  name?: string;
  start_at?: string;
  end_at?: string;
  timezone?: string;
  url?: string;
  location_type?: string;
  geo_address_info?: RawGeoInfo;
  coordinate?: { latitude: number; longitude: number };
  description?: string;
};

type RawEntry = {
  api_id?: string;
  event?: RawEvent;
  start_at?: string;
};

type DiscoverResponse = {
  entries?: RawEntry[];
  has_more?: boolean;
  next_cursor?: string;
};

type CalendarGetResponse = {
  calendar?: { api_id?: string; name?: string; slug?: string };
};

type CalendarItemsResponse = {
  entries?: RawEntry[];
  has_more?: boolean;
  next_cursor?: string;
};

function isOnline(ev: RawEvent): boolean {
  return (
    ev.location_type === 'online' ||
    (!ev.geo_address_info?.city && !ev.geo_address_info?.region && !ev.coordinate)
  );
}

export function normalizeLumaEvent(
  entry: RawEntry,
  options: { trusted: boolean; hostName?: string },
): CandidateEvent | null {
  const ev = entry.event;
  if (!ev?.name || !ev.api_id || !ev.start_at) return null;
  const cityName = ev.geo_address_info?.city || ev.geo_address_info?.region || '';
  const rawShort = ev.geo_address_info?.short_address || '';
  const rawFull = ev.geo_address_info?.full_address || '';
  const rawName = rawShort
    ? `${rawShort}${cityName && !rawShort.toLowerCase().includes(cityName.toLowerCase()) ? `, ${cityName}` : ''}`
    : rawFull || cityName;
  const hasCoords = Boolean(ev.coordinate);
  const cleaned = cleanLocation(rawName, rawFull, hasCoords);
  const slug = ev.url?.replace(/^\//, '') || '';
  return {
    source: 'luma',
    sourceEventId: ev.api_id,
    title: ev.name,
    description: ev.description || '',
    url: slug ? `https://luma.com/${slug}` : `https://luma.com/${ev.api_id}`,
    startAt: new Date(ev.start_at),
    endAt: ev.end_at ? new Date(ev.end_at) : undefined,
    timezone: ev.timezone,
    venueName: cleaned.name || undefined,
    address: cleaned.address || undefined,
    city: cityName || undefined,
    lat: ev.coordinate?.latitude,
    lng: ev.coordinate?.longitude,
    isOnline: isOnline(ev),
    hostName: options.hostName,
    trusted: options.trusted,
  };
}

async function fetchPaginated(
  params: { slug?: string; latitude?: number; longitude?: number },
  trusted: boolean,
): Promise<CandidateEvent[]> {
  const events: CandidateEvent[] = [];
  let cursor: string | undefined;
  while (events.length < MAX_PER_QUERY) {
    const url = new URL(BASE_URL);
    url.searchParams.set('pagination_limit', String(PAGE_LIMIT));
    if (params.slug) url.searchParams.set('slug', params.slug);
    if (params.latitude != null) url.searchParams.set('latitude', String(params.latitude));
    if (params.longitude != null) url.searchParams.set('longitude', String(params.longitude));
    if (cursor) url.searchParams.set('pagination_cursor', cursor);
    const { ok, json } = await fetchJson<DiscoverResponse>(url.toString(), {
      headers: { Origin: 'https://luma.com', Referer: 'https://luma.com/discover' },
    });
    if (!ok || !json) break;
    for (const entry of json.entries || []) {
      const normalized = normalizeLumaEvent(entry, { trusted });
      if (normalized) events.push(normalized);
    }
    if (!json.has_more || !json.next_cursor) break;
    cursor = json.next_cursor;
  }
  return events;
}

async function fetchCalendarBySlug(slug: string, name: string, metro?: Metro): Promise<CandidateEvent[]> {
  const { json: calendar } = await fetchJson<CalendarGetResponse>(
    `${CALENDAR_GET}?slug=${encodeURIComponent(slug)}`,
    { headers: { Origin: 'https://luma.com', Referer: `https://luma.com/${slug}` } },
  );
  const apiId = calendar?.calendar?.api_id;
  if (!apiId) return [];
  const events: CandidateEvent[] = [];
  let cursor: string | undefined;
  while (events.length < MAX_PER_QUERY) {
    const url = new URL(CALENDAR_ITEMS);
    url.searchParams.set('calendar_api_id', apiId);
    url.searchParams.set('period', 'future');
    url.searchParams.set('pagination_limit', String(PAGE_LIMIT));
    if (cursor) url.searchParams.set('pagination_cursor', cursor);
    const { ok, json } = await fetchJson<CalendarItemsResponse>(url.toString(), {
      headers: { Origin: 'https://luma.com', Referer: `https://luma.com/${slug}` },
    });
    if (!ok || !json) break;
    for (const entry of json.entries || []) {
      const normalized = normalizeLumaEvent(entry, {
        trusted: true,
        hostName: name,
      });
      if (normalized) {
        if (metro && !normalized.city) {
          normalized.city = METRO_PROFILES[metro].label;
        }
        events.push(normalized);
      }
    }
    if (!json.has_more || !json.next_cursor) break;
    cursor = json.next_cursor;
  }
  return events;
}

export async function fetchLumaEvents(): Promise<AdapterFetchResult> {
  const seen = new Set<string>();
  const events: CandidateEvent[] = [];
  const errors: string[] = [];

  const push = (batch: CandidateEvent[]) => {
    for (const event of batch) {
      if (seen.has(event.sourceEventId)) continue;
      seen.add(event.sourceEventId);
      events.push(event);
    }
  };

  const discoverQueries: Array<{ slug: string; latitude?: number; longitude?: number }> = [
    { slug: 'boston' },
    { slug: 'miami' },
    { slug: 'tech', latitude: METRO_PROFILES.boston.center.lat, longitude: METRO_PROFILES.boston.center.lng },
    { slug: 'tech', latitude: METRO_PROFILES.miami.center.lat, longitude: METRO_PROFILES.miami.center.lng },
    { slug: 'ai', latitude: METRO_PROFILES.boston.center.lat, longitude: METRO_PROFILES.boston.center.lng },
    { slug: 'ai', latitude: METRO_PROFILES.miami.center.lat, longitude: METRO_PROFILES.miami.center.lng },
  ];

  const discoverResults = await Promise.allSettled(
    discoverQueries.map((query) =>
      fetchPaginated(
        { slug: query.slug, latitude: query.latitude, longitude: query.longitude },
        false,
      ),
    ),
  );
  for (let i = 0; i < discoverResults.length; i += 1) {
    const result = discoverResults[i];
    if (result.status === 'fulfilled') push(result.value);
    else errors.push(`discover ${discoverQueries[i].slug}: ${result.reason}`);
  }

  const calendarResults = await Promise.allSettled(
    LUMA_CALENDARS.map((cal) => fetchCalendarBySlug(cal.slug, cal.name, cal.metro)),
  );
  for (let i = 0; i < calendarResults.length; i += 1) {
    const result = calendarResults[i];
    if (result.status === 'fulfilled') {
      for (const event of result.value) event.trusted = true;
      push(result.value);
    } else {
      errors.push(`calendar ${LUMA_CALENDARS[i].slug}: ${result.reason}`);
    }
  }

  return {
    source: 'luma',
    events,
    error: errors.length ? errors.join('; ') : undefined,
  };
}
