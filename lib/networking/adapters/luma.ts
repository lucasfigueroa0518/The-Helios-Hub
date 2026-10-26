import { mapPool } from '@/lib/async-pool';
import { addCandidateBatch } from '@/lib/networking/adapters/merge';
import { LUMA_CALENDARS, type LumaCalendarAllowlist } from '@/lib/networking/allowlists';
import { METRO_PROFILES, cleanLocation } from '@/lib/networking/cities';
import { fetchJson } from '@/lib/networking/http';
import { proseMirrorToText } from '@/lib/networking/prosemirror';
import { lumaPosterUrl } from '@/lib/networking/poster';
import { lumaHosts, pickFields, tagSlug } from '@/lib/networking/signals';
import {
  METROS,
  type AdapterFetchResult,
  type CandidateEvent,
  type CandidateSignals,
  type EventSignalExtras,
  type Metro,
} from '@/lib/networking/types';

const BASE_URL = 'https://api.luma.com/discover/get-paginated-events';
/** Resolves a calendar slug to its api id. `calendar/get?slug=` now answers HTTP 400. */
const URL_RESOLVE = 'https://api.luma.com/url';
const CALENDAR_ITEMS = 'https://api.luma.com/calendar/get-items';
const PAGE_LIMIT = 50;
const MAX_PER_QUERY = 400;
const DISCOVER_CONCURRENCY = 6;

/** Luma discover place slugs. `new-york` and `san-francisco` answer HTTP 400. */
const DISCOVER_PLACE_SLUGS: Record<Metro, string> = {
  boston: 'boston',
  miami: 'miami',
  nyc: 'nyc',
  sf: 'sf',
};

type RawGeoInfo = {
  city?: string;
  region?: string;
  region_short?: string;
  country?: string;
  /** Set alone on manual addresses ("Frontier Tower @ Spaceship 995 Market Street, San Francisco"). */
  address?: string;
  city_state?: string;
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
  coordinate?: { latitude: number; longitude: number } | null;
  description?: string;
  /** False hides the guest list; `guest_count` then reads 0 and means unknown. */
  show_guest_list?: boolean;
  recurrence_id?: string | null;
  /** The organizer's poster. Discover and `event/get` both set this. */
  cover_url?: string;
};

type RawCalendar = {
  api_id?: string;
  name?: string;
  slug?: string | null;
  is_personal?: boolean;
  is_verified?: boolean;
};

type RawTicketInfo = {
  price?: { cents?: number | null; currency?: string | null } | null;
  max_price?: { cents?: number | null; currency?: string | null } | null;
  is_free?: boolean | null;
  is_sold_out?: boolean | null;
  spots_remaining?: number | null;
  is_near_capacity?: boolean | null;
  require_approval?: boolean | null;
};

/**
 * A discover or calendar-items entry. `event/get` answers in the same shape plus the detail
 * fields. `featured_guests` (attendee profiles) is deliberately not typed: it is never read.
 */
export type LumaRawEntry = {
  api_id?: string;
  event?: RawEvent;
  start_at?: string;
  calendar?: RawCalendar | null;
  hosts?: unknown;
  guest_count?: number | null;
  ticket_count?: number | null;
  ticket_info?: RawTicketInfo | null;
  waitlist_active?: boolean | null;
  registration_availability?: string | null;
  /** Calendar-items entries: the calendar's own labels ("Executive Peer Group"). */
  tags?: Array<{ name?: string }> | null;
};

type DiscoverResponse = {
  entries?: LumaRawEntry[];
  has_more?: boolean;
  next_cursor?: string;
};

type UrlResolveResponse = {
  kind?: string;
  data?: { calendar?: { api_id?: string; name?: string; slug?: string } };
};

type CalendarItemsResponse = {
  entries?: LumaRawEntry[];
  has_more?: boolean;
  next_cursor?: string;
};

export type LumaDiscoverQuery = { slug: string; latitude?: number; longitude?: number };

const lumaHeaders = (referer: string) => ({ Origin: 'https://luma.com', Referer: referer });

function isOnline(ev: RawEvent): boolean {
  if (ev.location_type === 'online') return true;
  // Manual addresses come back offline with no city, region or coordinate.
  if (ev.location_type === 'offline') return false;
  const geo = ev.geo_address_info;
  return !geo?.city && !geo?.region && !geo?.address && !ev.coordinate;
}

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const bool = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);

const RAW_ENTRY_KEYS = ['api_id', 'ticket_info', 'waitlist_active', 'registration_availability', 'featured_city'] as const;
const RAW_EVENT_KEYS = [
  'api_id',
  'name',
  'start_at',
  'end_at',
  'timezone',
  'url',
  'location_type',
  'event_type',
  'visibility',
  'show_guest_list',
  'recurrence_id',
  'calendar_api_id',
  'waitlist_enabled',
  'waitlist_status',
  'geo_address_info',
  'coordinate',
  'cover_url',
] as const;
const RAW_CALENDAR_KEYS = [
  'api_id',
  'name',
  'slug',
  'is_personal',
  'is_verified',
  'website',
  'linkedin_handle',
  'luma_plan',
  'description_short',
] as const;

/** A community (non-personal) calendar; personal calendars are named "Personal". */
function communityCalendar(entry: LumaRawEntry): RawCalendar | null {
  const cal = entry.calendar;
  if (!cal || cal.is_personal === true || !cal.name?.trim()) return null;
  return cal;
}

/**
 * Quality signals on a discover or calendar entry (no extra request). The organizer is the
 * community calendar, else the first host of a personal calendar. `featured_guests` is never read.
 */
export function lumaEntrySignals(entry: LumaRawEntry, sourceTag?: string): CandidateSignals {
  const ev = entry.event ?? {};
  const cal = communityCalendar(entry);
  const hosts = lumaHosts(entry.hosts);
  const ti = entry.ticket_info ?? {};
  const guestsShown = ev.show_guest_list !== false;
  const priceMin = num(ti.price?.cents);
  const priceMax = num(ti.max_price?.cents) ?? priceMin;
  const currency = (ti.price?.currency || ti.max_price?.currency || '').trim().toUpperCase() || undefined;
  const slug = cal?.slug?.trim() || undefined;
  const tags = [
    ...(sourceTag ? [sourceTag] : []),
    ...(entry.tags ?? []).flatMap((tag) => (tag?.name ? [`calendar_tag:${tagSlug(tag.name)}`] : [])),
  ];
  const extras: EventSignalExtras = {
    nearCapacity: bool(ti.is_near_capacity),
    registration: entry.registration_availability || undefined,
    lumaCalendarApiId: cal?.api_id || undefined,
    lumaCalendarSlug: slug,
    lumaCalendarVerified: cal ? bool(cal.is_verified) : undefined,
    coverUrl: lumaPosterUrl(ev) ?? undefined,
  };
  const raw: Record<string, unknown> = {
    ...pickFields(entry, RAW_ENTRY_KEYS),
    event: pickFields(ev, RAW_EVENT_KEYS),
    calendar: cal ? pickFields(cal, RAW_CALENDAR_KEYS) : entry.calendar ? { is_personal: true } : undefined,
    hosts: hosts.length ? hosts : undefined,
    guest_count: guestsShown ? num(entry.guest_count) : undefined,
    tags: entry.tags?.length ? entry.tags.map((tag) => tag?.name).filter(Boolean) : undefined,
  };
  return {
    organizerName: cal?.name?.trim() || hosts[0]?.name,
    organizerKind: cal ? 'luma_calendar' : hosts.length ? 'luma_person' : undefined,
    organizerUrl: slug ? `https://luma.com/${slug}` : undefined,
    hosts: hosts.length ? hosts : undefined,
    guestCount: guestsShown ? num(entry.guest_count) : undefined,
    spotsRemaining: num(ti.spots_remaining),
    isSoldOut: bool(ti.is_sold_out),
    waitlistActive: bool(entry.waitlist_active),
    requiresApproval: bool(ti.require_approval),
    isFree: bool(ti.is_free),
    priceMinCents: priceMin,
    priceMaxCents: priceMax,
    priceCurrency: priceMin != null || priceMax != null ? currency : undefined,
    seriesKey: cal?.api_id
      ? `luma:${cal.api_id}`
      : ev.recurrence_id
        ? `luma-series:${ev.recurrence_id}`
        : undefined,
    sourceTags: tags.length ? [...new Set(tags)] : undefined,
    signals: Object.values(extras).some((value) => value !== undefined) ? extras : undefined,
    raw: Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined)),
  };
}

export function normalizeLumaEvent(
  entry: LumaRawEntry,
  options: { trusted: boolean; hostName?: string; sourceTag?: string },
): CandidateEvent | null {
  const ev = entry.event;
  if (!ev?.name || !ev.api_id || !ev.start_at) return null;
  const quality = lumaEntrySignals(entry, options.sourceTag);
  const geo = ev.geo_address_info;
  const cityName = geo?.city || geo?.region || '';
  const rawShort = geo?.short_address || '';
  const rawFull = geo?.full_address || geo?.address || '';
  const rawName = rawShort
    ? `${rawShort}${cityName && !rawShort.toLowerCase().includes(cityName.toLowerCase()) ? `, ${cityName}` : ''}`
    : rawFull || cityName;
  const hasCoords = Boolean(ev.coordinate);
  const cleaned = cleanLocation(rawName, rawFull, hasCoords);
  const slug = ev.url?.replace(/^\//, '') || '';
  const description = ev.description || '';
  // Paid Luma tickets feed `inferAccess` (dollars), so `access` reads "paid" instead of "open".
  const priceAmount = quality.priceMinCents && quality.priceMinCents > 0 ? quality.priceMinCents / 100 : undefined;
  return {
    ...quality,
    source: 'luma',
    sourceEventId: ev.api_id,
    title: ev.name,
    description,
    descriptionSource: description ? 'luma' : undefined,
    priceAmount,
    url: slug ? `https://luma.com/${slug}` : `https://luma.com/${ev.api_id}`,
    startAt: new Date(ev.start_at),
    endAt: ev.end_at ? new Date(ev.end_at) : undefined,
    timezone: ev.timezone,
    venueName: cleaned.name || undefined,
    address: cleaned.address || undefined,
    city: cityName || undefined,
    region: geo?.region_short || geo?.region || undefined,
    lat: ev.coordinate?.latitude,
    lng: ev.coordinate?.longitude,
    isOnline: isOnline(ev),
    hostName: options.hostName ?? quality.organizerName,
    trusted: options.trusted,
  };
}

/** The place feed for every metro, plus the `tech` and `ai` feeds anchored at each metro center. */
export function lumaDiscoverQueries(): LumaDiscoverQuery[] {
  return [
    ...METROS.map((metro) => ({ slug: DISCOVER_PLACE_SLUGS[metro] })),
    ...(['tech', 'ai'] as const).flatMap((slug) =>
      METROS.map((metro) => ({
        slug,
        latitude: METRO_PROFILES[metro].center.lat,
        longitude: METRO_PROFILES[metro].center.lng,
      })),
    ),
  ];
}

async function fetchPaginated(params: LumaDiscoverQuery, trusted: boolean): Promise<CandidateEvent[]> {
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
      headers: lumaHeaders('https://luma.com/discover'),
    });
    if (!ok || !json) break;
    for (const entry of json.entries || []) {
      const normalized = normalizeLumaEvent(entry, { trusted, sourceTag: `discover:${params.slug}` });
      if (normalized) events.push(normalized);
    }
    if (!json.has_more || !json.next_cursor) break;
    cursor = json.next_cursor;
  }
  return events;
}

export async function resolveLumaCalendarApiId(slug: string): Promise<string | undefined> {
  const { ok, status, json } = await fetchJson<UrlResolveResponse>(
    `${URL_RESOLVE}?url=${encodeURIComponent(slug)}`,
    { headers: lumaHeaders(`https://luma.com/${slug}`) },
  );
  if (!ok) throw new Error(`Luma url resolve HTTP ${status}`);
  return json?.kind === 'calendar' ? json.data?.calendar?.api_id || undefined : undefined;
}

/** Future events of one allowlisted calendar. A known `apiId` skips the resolve call. */
export async function fetchLumaCalendar(cal: LumaCalendarAllowlist): Promise<CandidateEvent[]> {
  const apiId = cal.apiId || (await resolveLumaCalendarApiId(cal.slug));
  if (!apiId) throw new Error('slug did not resolve to a calendar');
  const events: CandidateEvent[] = [];
  let cursor: string | undefined;
  for (let page = 0; events.length < MAX_PER_QUERY; page += 1) {
    const url = new URL(CALENDAR_ITEMS);
    url.searchParams.set('calendar_api_id', apiId);
    url.searchParams.set('period', 'future');
    url.searchParams.set('pagination_limit', String(PAGE_LIMIT));
    if (cursor) url.searchParams.set('pagination_cursor', cursor);
    const { ok, status, json } = await fetchJson<CalendarItemsResponse>(url.toString(), {
      headers: lumaHeaders(`https://luma.com/${cal.slug}`),
    });
    if (!ok || !json) {
      if (page === 0) throw new Error(`Luma calendar items HTTP ${status}`);
      break;
    }
    for (const entry of json.entries || []) {
      const normalized = normalizeLumaEvent(entry, {
        trusted: true,
        hostName: cal.name,
        sourceTag: `luma_calendar:${cal.slug.toLowerCase()}`,
      });
      if (normalized) {
        if (cal.metro && !normalized.city) {
          normalized.city = METRO_PROFILES[cal.metro].label;
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
  const byId = new Map<string, CandidateEvent>();
  const errors: string[] = [];
  const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));

  const discoverQueries = lumaDiscoverQueries();
  const discoverResults = await mapPool(discoverQueries, DISCOVER_CONCURRENCY, async (query) => {
    try {
      return { events: await fetchPaginated(query, false) };
    } catch (err) {
      return { events: [] as CandidateEvent[], error: describe(err) };
    }
  });
  discoverResults.forEach((result, i) => {
    addCandidateBatch(byId, result.events);
    if (result.error) errors.push(`discover ${discoverQueries[i].slug}: ${result.error}`);
  });

  // Calendar copies arrive second and carry the host name; they merge into the discover copy.
  const calendarResults = await Promise.allSettled(LUMA_CALENDARS.map((cal) => fetchLumaCalendar(cal)));
  calendarResults.forEach((result, i) => {
    if (result.status === 'fulfilled') addCandidateBatch(byId, result.value);
    else errors.push(`calendar ${LUMA_CALENDARS[i].slug}: ${describe(result.reason)}`);
  });

  return {
    source: 'luma',
    events: [...byId.values()],
    error: errors.length ? errors.join('; ') : undefined,
  };
}

// ── Detail fetches (networking.event_details, AE-06) ───────────────────────

const EVENT_GET = 'https://api.luma.com/event/get';

/** The `event/get` fields the details job reads; the rest of the answer is ignored. */
export type LumaEventDetailResponse = LumaRawEntry & {
  description_mirror?: unknown;
  ticket_types?: Array<{ max_capacity?: number | null }> | null;
  categories?: Array<{ api_id?: string; slug?: string; name?: string }> | null;
};

export type LumaEventDetail = {
  description: string;
  /** Sum of every ticket type's cap; undefined when any type is uncapped (or none is listed). */
  capacity?: number;
  sourceTags: string[];
  /** Organizer poster from `event.cover_url`. */
  coverUrl?: string;
};

export function lumaEventDetail(json: LumaEventDetailResponse): LumaEventDetail {
  const types = Array.isArray(json.ticket_types) ? json.ticket_types : [];
  const caps = types.map((type) => num(type?.max_capacity));
  const capacity =
    caps.length > 0 && caps.every((cap) => cap != null)
      ? caps.reduce<number>((sum, cap) => sum + (cap ?? 0), 0)
      : undefined;
  const sourceTags = (Array.isArray(json.categories) ? json.categories : []).flatMap((category) => {
    const slug = category?.slug || category?.api_id?.replace(/^cat-/, '');
    return slug ? [`category:${tagSlug(slug)}`] : [];
  });
  return {
    description: proseMirrorToText(json.description_mirror),
    capacity,
    sourceTags: [...new Set(sourceTags)],
    coverUrl: lumaPosterUrl(json.event) ?? undefined,
  };
}

export async function fetchLumaEventDetail(
  eventApiId: string,
  fetcher: typeof fetchJson = fetchJson,
): Promise<{ status: number; detail: LumaEventDetail | null }> {
  const { ok, status, json } = await fetcher<LumaEventDetailResponse>(
    `${EVENT_GET}?event_api_id=${encodeURIComponent(eventApiId)}`,
    { headers: lumaHeaders(`https://luma.com/${eventApiId}`) },
  );
  return { status, detail: ok && json ? lumaEventDetail(json) : null };
}

/** Organizer track record from the calendar resolver's `event_start_ats` (every event the calendar has listed). */
export function lumaCalendarTrackRecord(
  json: { kind?: string; data?: { event_start_ats?: unknown } } | null,
  now: Date,
): { pastCount: number; upcomingCount: number } | null {
  if (json?.kind !== 'calendar' || !Array.isArray(json.data?.event_start_ats)) return null;
  let pastCount = 0;
  let upcomingCount = 0;
  for (const value of json.data.event_start_ats) {
    const at = typeof value === 'string' ? Date.parse(value) : Number.NaN;
    if (!Number.isFinite(at)) continue;
    if (at < now.getTime()) pastCount += 1;
    else upcomingCount += 1;
  }
  return { pastCount, upcomingCount };
}

export async function fetchLumaCalendarTrackRecord(
  slug: string,
  now: Date,
  fetcher: typeof fetchJson = fetchJson,
): Promise<{ status: number; record: { pastCount: number; upcomingCount: number } | null }> {
  const { ok, status, json } = await fetcher<{ kind?: string; data?: { event_start_ats?: unknown } }>(
    `${URL_RESOLVE}?url=${encodeURIComponent(slug)}`,
    { headers: lumaHeaders(`https://luma.com/${slug}`) },
  );
  return { status, record: ok ? lumaCalendarTrackRecord(json, now) : null };
}
