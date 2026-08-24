import { MEETUP_GROUPS } from '@/lib/networking/allowlists';
import { cleanLocation } from '@/lib/networking/cities';
import { fetchText } from '@/lib/networking/http';
import type { AdapterFetchResult, CandidateEvent } from '@/lib/networking/types';

const FIND_BASE = 'https://www.meetup.com/find/?source=EVENTS&distance=fiftyMiles';
const CATEGORIES = { technology: '546', career: '405' } as const;
const CITIES = { boston: 'us--Boston', miami: 'us--Miami', fort_lauderdale: 'us--Fort-Lauderdale' };

const NEXT_DATA_RE = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/;

type MeetupRawEvent = {
  id?: string;
  title?: string;
  dateTime?: string;
  endTime?: string;
  eventUrl?: string;
  description?: string;
  venue?: {
    name?: string;
    address?: string;
    city?: string;
    lat?: number;
    lng?: number;
  };
  group?: { name?: string; urlname?: string };
  isFree?: boolean;
  fee?: { amount?: number; currency?: string };
  eventType?: string;
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

export function extractMeetupEventsFromApollo(apollo: Record<string, unknown>): MeetupRawEvent[] {
  const events: MeetupRawEvent[] = [];
  for (const [key, val] of Object.entries(apollo)) {
    if (!key.startsWith('Event:')) continue;
    const rec = val as MeetupRawEvent & { __typename?: string };
    if (rec?.__typename === 'Event' && rec.title) events.push(rec);
  }
  return events;
}

export function normalizeMeetupEvent(
  raw: MeetupRawEvent,
  options: { cityFallback: string; trusted: boolean },
): CandidateEvent | null {
  if (!raw.id || !raw.title || !raw.dateTime) return null;
  const isOnline =
    raw.eventType === 'ONLINE' || (!raw.venue?.name && !raw.venue?.address && !raw.venue?.city);
  const venueName = raw.venue?.name || raw.venue?.address || '';
  const hasCoords = Boolean(raw.venue?.lat && raw.venue?.lng);
  const cleaned = cleanLocation(venueName, venueName, hasCoords);
  return {
    source: 'meetup',
    sourceEventId: raw.id,
    title: raw.title,
    description: raw.description || '',
    url: raw.eventUrl || '',
    startAt: new Date(raw.dateTime),
    endAt: raw.endTime ? new Date(raw.endTime) : undefined,
    venueName: cleaned.name || undefined,
    address: cleaned.address || undefined,
    city: raw.venue?.city || options.cityFallback,
    lat: raw.venue?.lat,
    lng: raw.venue?.lng,
    isOnline,
    hostName: raw.group?.name,
    isFree: raw.isFree,
    priceAmount: raw.fee?.amount,
    trusted: options.trusted,
  };
}

async function eventsFromHtml(
  html: string,
  cityFallback: string,
  trusted: boolean,
): Promise<CandidateEvent[]> {
  const nextData = parseNextData(html);
  if (!nextData) return [];
  const pageProps = (nextData.props as { pageProps?: { __APOLLO_STATE__?: Record<string, unknown> } } | undefined)
    ?.pageProps;
  const apollo = pageProps?.__APOLLO_STATE__;
  if (!apollo) return [];
  return extractMeetupEventsFromApollo(apollo)
    .map((raw) => normalizeMeetupEvent(raw, { cityFallback, trusted }))
    .filter((event): event is CandidateEvent => Boolean(event));
}

async function fetchCityCategory(cityVal: string, categoryId: string, cityFallback: string) {
  const url = `${FIND_BASE}&location=${encodeURIComponent(cityVal)}&categoryId=${categoryId}`;
  const { ok, text } = await fetchText(url);
  if (!ok) throw new Error(`Meetup find HTTP ${url}`);
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

  const combos: Array<{ cityVal: string; catId: string; cityFallback: string }> = [];
  for (const catId of Object.values(CATEGORIES)) {
    combos.push({ cityVal: CITIES.boston, catId, cityFallback: 'Boston' });
    combos.push({ cityVal: CITIES.miami, catId, cityFallback: 'Miami' });
    combos.push({ cityVal: CITIES.fort_lauderdale, catId, cityFallback: 'Fort Lauderdale' });
  }

  const findResults = await Promise.allSettled(
    combos.map((combo) => fetchCityCategory(combo.cityVal, combo.catId, combo.cityFallback)),
  );
  for (let i = 0; i < findResults.length; i += 1) {
    const result = findResults[i];
    if (result.status === 'fulfilled') push(result.value);
    else errors.push(`find ${combos[i].cityVal}: ${result.reason}`);
  }

  const groupResults = await Promise.allSettled(
    MEETUP_GROUPS.map((group) =>
      fetchGroup(group.urlname, group.metro === 'boston' ? 'Boston' : 'Miami'),
    ),
  );
  for (let i = 0; i < groupResults.length; i += 1) {
    const result = groupResults[i];
    if (result.status === 'fulfilled') push(result.value);
    else errors.push(`group ${MEETUP_GROUPS[i].urlname}: ${result.reason}`);
  }

  return { source: 'meetup', events, error: errors.length ? errors.join('; ') : undefined };
}
