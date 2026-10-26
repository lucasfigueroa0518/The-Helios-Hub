import { mapPool } from '@/lib/async-pool';
import { addCandidateBatch } from '@/lib/networking/adapters/merge';
import { MEETUP_GROUPS } from '@/lib/networking/allowlists';
import { METRO_PROFILES, cleanLocation } from '@/lib/networking/cities';
import { fetchText } from '@/lib/networking/http';
import { meetupPosterUrl } from '@/lib/networking/poster';
import { hasOffsiteRsvp, namedHosts, pickFields, tagSlug } from '@/lib/networking/signals';
import type { AdapterFetchResult, CandidateEvent, CandidateSignals, EventSignalExtras } from '@/lib/networking/types';

const FIND_BASE = 'https://www.meetup.com/find/?source=EVENTS&distance=fiftyMiles';
const CATEGORIES = { technology: '546', career: '405' } as const;
/** `us--New-York` resolves to Buffalo, so NYC and the Bay Area need the state-qualified value. */
export const FIND_LOCATIONS = [
  { cityVal: 'us--Boston', cityFallback: 'Boston' },
  { cityVal: 'us--Miami', cityFallback: 'Miami' },
  { cityVal: 'us--Fort-Lauderdale', cityFallback: 'Fort Lauderdale' },
  { cityVal: 'us--ny--New-York', cityFallback: 'New York' },
  { cityVal: 'us--ca--San-Francisco', cityFallback: 'San Francisco' },
  { cityVal: 'us--ca--San-Jose', cityFallback: 'San Jose' },
] as const;
/** Find pages and group pages share one pool, so meetup.com never sees more than this at once. */
const MAX_CONCURRENT = 4;

const NEXT_DATA_RE = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/;

type MeetupVenue = {
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  lat?: number;
  /** Meetup event pages use `lon`; `lng` is kept for older payloads. */
  lon?: number;
  lng?: number;
};

type MeetupGroup = {
  id?: string;
  name?: string;
  urlname?: string;
  link?: string;
  stats?: {
    memberCounts?: { all?: number } | null;
    /** Find pages say `totalRatings`, group pages `total`. */
    eventRatings?: { average?: number; totalRatings?: number; total?: number } | null;
  } | null;
};

type MeetupCount = { totalCount?: number } | null;

export type MeetupRawEvent = {
  id?: string;
  title?: string;
  dateTime?: string;
  endTime?: string;
  eventUrl?: string;
  description?: string;
  venue?: MeetupVenue | null;
  group?: MeetupGroup | null;
  isFree?: boolean;
  fee?: { amount?: number; currency?: string };
  feeSettings?: { amount?: number; currency?: string } | null;
  eventType?: string;
  status?: string;
  maxTickets?: number;
  series?: { description?: string } | null;
  /** Find pages: total RSVPs, with host edges (`node.isHost`) pointing at members. */
  rsvps?: MeetupCount & { edges?: Array<{ node?: unknown }> | null };
  /** Group pages. */
  going?: MeetupCount;
  /** Resolved while extracting: host names and topic keys, which live behind Apollo refs. */
  hostNames?: string[];
  topicKeys?: string[];
  /** Event pages: `rsvps({"filter":{"rsvpStatus":["YES"]}})` and the WAITLIST twin. */
  yesCount?: number;
  waitlistCount?: number;
  /** Find pages sometimes inline the photo URL. */
  imageUrl?: string;
  /** Event pages: Apollo `EventPhoto` (highResUrl / source / baseUrl). */
  featuredEventPhoto?: { highResUrl?: string; source?: string; baseUrl?: string } | null;
};

export function parseNextData(html: string): Record<string, unknown> | null {
  const match = html.match(NEXT_DATA_RE);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Apollo normalizes nested records into `{ __ref: "Venue:123" }` pointers. Resolve one level,
 * keeping any inline fields (find pages inline `urlname` next to the ref).
 */
function deref(apollo: Record<string, unknown>, value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const { __ref: ref, ...inline } = value as { __ref?: unknown } & Record<string, unknown>;
  if (typeof ref !== 'string') return value;
  const target = apollo[ref];
  return target && typeof target === 'object' ? { ...inline, ...(target as Record<string, unknown>) } : inline;
}

function record(apollo: Record<string, unknown>, value: unknown): Record<string, unknown> | null {
  const resolved = deref(apollo, value);
  return resolved && typeof resolved === 'object' ? (resolved as Record<string, unknown>) : null;
}

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * Host names: event pages ref `EventHost` records (with `name`); group pages inline
 * `{ memberId }`; find pages mark host RSVPs (`node.isHost`) whose member is a ref.
 */
function hostNamesOf(apollo: Record<string, unknown>, rec: Record<string, unknown>): string[] {
  const names: string[] = [];
  const memberName = (id: unknown) => {
    const member = typeof id === 'string' ? record(apollo, { __ref: `Member:${id}` }) : null;
    return typeof member?.name === 'string' ? member.name : undefined;
  };
  for (const item of Array.isArray(rec.eventHosts) ? rec.eventHosts : []) {
    const host = record(apollo, item);
    const name = typeof host?.name === 'string' ? host.name : memberName(host?.memberId);
    if (name) names.push(name);
  }
  if (names.length) return names;
  const edges = (rec.rsvps as { edges?: unknown } | undefined)?.edges;
  for (const edge of Array.isArray(edges) ? edges : []) {
    const node = record(apollo, (edge as { node?: unknown })?.node);
    if (node?.isHost !== true) continue;
    const member = record(apollo, node.member);
    if (typeof member?.name === 'string') names.push(member.name);
  }
  return names;
}

/** Event topics (event pages), else the group's active topics (group pages). */
function topicKeysOf(apollo: Record<string, unknown>, rec: Record<string, unknown>, group: Record<string, unknown> | null) {
  const edges = (rec.topics as { edges?: unknown } | undefined)?.edges;
  const refs = Array.isArray(edges)
    ? edges.map((edge) => (edge as { node?: unknown })?.node)
    : Array.isArray(group?.activeTopics)
      ? (group.activeTopics as unknown[])
      : [];
  return refs.flatMap((ref) => {
    const topic = record(apollo, ref);
    const key = typeof topic?.urlkey === 'string' ? topic.urlkey : typeof topic?.name === 'string' ? topic.name : '';
    return key ? [key] : [];
  });
}

/** `rsvps({"filter":{"rsvpStatus":["YES"]}})`-style keys carry the event page's counts. */
function filteredCount(rec: Record<string, unknown>, status: 'YES' | 'WAITLIST'): number | undefined {
  for (const [key, value] of Object.entries(rec)) {
    if (!key.startsWith('rsvps(') || !key.includes(`"${status}"`)) continue;
    const count = asNumber((value as MeetupCount)?.totalCount);
    if (count != null) return count;
  }
  return undefined;
}

export function extractMeetupEventsFromApollo(apollo: Record<string, unknown>): MeetupRawEvent[] {
  const events: MeetupRawEvent[] = [];
  for (const [key, val] of Object.entries(apollo)) {
    if (!key.startsWith('Event:')) continue;
    const rec = val as MeetupRawEvent & { __typename?: string } & Record<string, unknown>;
    if (rec?.__typename !== 'Event' || !rec.title) continue;
    const group = record(apollo, rec.group);
    events.push({
      ...rec,
      venue: deref(apollo, rec.venue) as MeetupRawEvent['venue'],
      group: group as MeetupRawEvent['group'],
      hostNames: hostNamesOf(apollo, rec),
      topicKeys: topicKeysOf(apollo, rec, group),
      yesCount: filteredCount(rec, 'YES'),
      waitlistCount: filteredCount(rec, 'WAITLIST'),
      featuredEventPhoto: (record(apollo, rec.featuredEventPhoto) ?? rec.featuredEventPhoto) as MeetupRawEvent['featuredEventPhoto'],
    });
  }
  return events;
}

const RAW_EVENT_KEYS = [
  'id',
  'title',
  'dateTime',
  'endTime',
  'eventUrl',
  'eventType',
  'status',
  'maxTickets',
  'rsvpState',
  'isNetworkEvent',
  'feeSettings',
  'series',
] as const;
const RAW_VENUE_KEYS = ['name', 'address', 'city', 'state', 'country', 'lat', 'lon', 'lng'] as const;
const RAW_GROUP_KEYS = ['id', 'name', 'urlname', 'link', 'timezone', 'joinMode', 'status', 'stats'] as const;

/**
 * Quality signals from one Meetup event record: the group (organizer, rating, members), the
 * going count, hosts, topics and the off-site RSVP flag. RSVP member lists are never kept.
 */
export function meetupEventSignals(raw: MeetupRawEvent): CandidateSignals {
  const group = raw.group ?? undefined;
  const urlname = group?.urlname?.trim() || undefined;
  const ratings = group?.stats?.eventRatings ?? undefined;
  const ratingCount = asNumber(ratings?.totalRatings) ?? asNumber(ratings?.total);
  const rating = asNumber(ratings?.average);
  const going = raw.yesCount ?? asNumber(raw.going?.totalCount) ?? asNumber(raw.rsvps?.totalCount);
  const hosts = namedHosts(raw.hostNames ?? []);
  const tags = (raw.topicKeys ?? []).map((key) => `topic:${tagSlug(key)}`).filter((tag) => tag !== 'topic:');
  const feeAmount = asNumber(raw.feeSettings?.amount) ?? asNumber(raw.fee?.amount);
  const feeCents = feeAmount != null && feeAmount > 0 ? Math.round(feeAmount * 100) : undefined;
  const currency = (raw.feeSettings?.currency || raw.fee?.currency || '').trim().toUpperCase() || undefined;
  const extras: EventSignalExtras = {
    waitlistCount: raw.waitlistCount,
    meetupGroupUrlname: urlname,
    meetupMaxTickets: asNumber(raw.maxTickets) || undefined,
    recurrence: raw.series?.description?.trim() || undefined,
    coverUrl: meetupPosterUrl(raw) ?? undefined,
  };
  const rawPayload: Record<string, unknown> = {
    ...pickFields(raw, RAW_EVENT_KEYS),
    going,
    venue: pickFields(raw.venue, RAW_VENUE_KEYS),
    group: pickFields(group, RAW_GROUP_KEYS),
    hosts: hosts.length ? hosts.map((host) => host.name) : undefined,
    topics: raw.topicKeys?.length ? raw.topicKeys : undefined,
  };
  return {
    organizerName: group?.name?.trim() || undefined,
    organizerKind: group?.name ? 'meetup_group' : undefined,
    organizerUrl: group?.link || (urlname ? `https://www.meetup.com/${urlname}/` : undefined),
    hosts: hosts.length ? hosts : undefined,
    guestCount: going,
    organizerMemberCount: asNumber(group?.stats?.memberCounts?.all),
    // 0 over 0 marks a new group: no rating rather than a zero rating.
    organizerRating: ratingCount ? rating : undefined,
    organizerRatingCount: ratingCount,
    priceMinCents: feeCents,
    priceMaxCents: feeCents,
    priceCurrency: feeCents != null ? currency : undefined,
    seriesKey: urlname ? `meetup:${urlname.toLowerCase()}` : undefined,
    sourceTags: tags.length ? [...new Set(tags)] : undefined,
    rsvpOffsite: hasOffsiteRsvp(raw.description),
    signals: Object.values(extras).some((value) => value !== undefined) ? extras : undefined,
    raw: Object.fromEntries(Object.entries(rawPayload).filter(([, value]) => value !== undefined)),
  };
}

/**
 * `feeSettings: null` is a free RSVP, unless the listing is a funnel to a paid page elsewhere
 * ("PAID EVENT RSVP HERE"): then the price is unknown.
 */
function meetupIsFree(raw: MeetupRawEvent, quality: CandidateSignals): boolean | undefined {
  if (quality.priceMinCents) return false;
  if (raw.feeSettings === null && !quality.rsvpOffsite) return true;
  return undefined;
}

export function normalizeMeetupEvent(
  raw: MeetupRawEvent,
  options: { cityFallback: string; trusted: boolean },
): CandidateEvent | null {
  if (!raw.id || !raw.title || !raw.dateTime) return null;
  const venue = raw.venue ?? undefined;
  const isOnline = raw.eventType === 'ONLINE' || (!venue?.name && !venue?.address && !venue?.city);
  const venueName = venue?.name || venue?.address || '';
  const lat = venue?.lat;
  const lng = venue?.lon ?? venue?.lng;
  const hasCoords = lat != null && lng != null;
  const cleaned = cleanLocation(venueName, venueName, hasCoords);
  const quality = meetupEventSignals(raw);
  const description = raw.description || '';
  return {
    ...quality,
    source: 'meetup',
    sourceEventId: raw.id,
    title: raw.title,
    description,
    descriptionSource: description ? 'meetup' : undefined,
    url: raw.eventUrl || '',
    startAt: new Date(raw.dateTime),
    endAt: raw.endTime ? new Date(raw.endTime) : undefined,
    venueName: cleaned.name || undefined,
    address: cleaned.address || undefined,
    city: venue?.city || options.cityFallback,
    region: venue?.state || undefined,
    lat,
    lng,
    isOnline,
    hostName: raw.group?.name || undefined,
    isFree: raw.isFree ?? meetupIsFree(raw, quality),
    priceAmount: quality.priceMinCents ? quality.priceMinCents / 100 : raw.fee?.amount,
    trusted: options.trusted,
  };
}

/** The Apollo cache a Meetup page server-renders into `__NEXT_DATA__`. */
export function apolloStateOf(html: string): Record<string, unknown> | null {
  const nextData = parseNextData(html);
  const pageProps = (nextData?.props as { pageProps?: { __APOLLO_STATE__?: Record<string, unknown> } } | undefined)
    ?.pageProps;
  return pageProps?.__APOLLO_STATE__ ?? null;
}

async function eventsFromHtml(
  html: string,
  cityFallback: string,
  trusted: boolean,
): Promise<CandidateEvent[]> {
  const apollo = apolloStateOf(html);
  if (!apollo) return [];
  return extractMeetupEventsFromApollo(apollo)
    .map((raw) => normalizeMeetupEvent(raw, { cityFallback, trusted }))
    .filter((event): event is CandidateEvent => Boolean(event));
}

async function fetchCityCategory(cityVal: string, categoryId: string, cityFallback: string) {
  const url = `${FIND_BASE}&location=${encodeURIComponent(cityVal)}&categoryId=${categoryId}`;
  const { ok, status, text } = await fetchText(url);
  if (!ok) throw new Error(`Meetup find HTTP ${status} ${url}`);
  return eventsFromHtml(text, cityFallback, false);
}

async function fetchGroup(urlname: string, cityFallback: string) {
  const url = `https://www.meetup.com/${urlname}/events/`;
  const { ok, text } = await fetchText(url);
  if (!ok) return [];
  const events = await eventsFromHtml(text, cityFallback, true);
  for (const event of events) event.trusted = true;
  return events;
}

export async function fetchMeetupEvents(): Promise<AdapterFetchResult> {
  const byId = new Map<string, CandidateEvent>();
  const errors: string[] = [];

  const jobs: Array<{ label: string; run: () => Promise<CandidateEvent[]> }> = [];
  for (const catId of Object.values(CATEGORIES)) {
    for (const loc of FIND_LOCATIONS) {
      jobs.push({
        label: `find ${loc.cityVal}`,
        run: () => fetchCityCategory(loc.cityVal, catId, loc.cityFallback),
      });
    }
  }
  for (const group of MEETUP_GROUPS) {
    jobs.push({
      label: `group ${group.urlname}`,
      run: () => fetchGroup(group.urlname, METRO_PROFILES[group.metro].label),
    });
  }

  const results = await mapPool(jobs, MAX_CONCURRENT, async (job) => {
    try {
      return { events: await job.run() };
    } catch (err) {
      return { events: [] as CandidateEvent[], error: err instanceof Error ? err.message : String(err) };
    }
  });
  // Find copies come first; a group-page copy of the same event merges in and marks it trusted.
  results.forEach((result, i) => {
    addCandidateBatch(byId, result.events);
    if (result.error) errors.push(`${jobs[i].label}: ${result.error}`);
  });

  return { source: 'meetup', events: [...byId.values()], error: errors.length ? errors.join('; ') : undefined };
}

// ── Event page detail (networking.event_details, AE-06) ────────────────────

export type MeetupEventDetail = {
  /** Full description; the find page sometimes has it already. */
  description: string;
  /** The find page has no end time. */
  endAt?: Date;
  /** YES count as `guestCount`, WAITLIST count, group member count, hosts, topics. */
  signals: CandidateSignals;
};

/** Read one event out of its own page (`/<group>/events/<id>/`). */
export function meetupEventPageDetail(html: string, eventId: string): MeetupEventDetail | null {
  const apollo = apolloStateOf(html);
  if (!apollo) return null;
  const events = extractMeetupEventsFromApollo(apollo);
  const raw = events.find((event) => event.id === eventId) ?? (events.length === 1 ? events[0] : undefined);
  if (!raw) return null;
  const end = raw.endTime ? new Date(raw.endTime) : undefined;
  return {
    description: raw.description || '',
    endAt: end && !Number.isNaN(end.getTime()) ? end : undefined,
    signals: meetupEventSignals(raw),
  };
}

export async function fetchMeetupEventDetail(
  url: string,
  eventId: string,
  fetcher: typeof fetchText = fetchText,
): Promise<{ status: number; detail: MeetupEventDetail | null }> {
  const { ok, status, text } = await fetcher(url);
  return { status, detail: ok ? meetupEventPageDetail(text, eventId) : null };
}
