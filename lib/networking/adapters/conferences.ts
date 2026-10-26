import { METRO_PROFILES, metroFromCityName } from '@/lib/networking/cities';
import { fetchJson, shaShort } from '@/lib/networking/http';
import type { AdapterFetchResult, CandidateEvent, EventAnchor } from '@/lib/networking/types';

const DEVELOPERS_EVENTS_URL = 'https://developers.events/all-events.json';
/** Source prefix of the ids and `networking.anchors.source`. */
export const DEVELOPERS_EVENTS_SOURCE = 'developers.events';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Rows give calendar days only; pin them to a local working day so the date is right in every zone. */
const DAY_START_HOUR = 9;
const DAY_END_HOUR = 18;

/** Sessionize call-for-papers duplicates: "OWASP Global AppSec US 2026 - CFP (San Francisco)". */
const CFP_RE = /\s[-\u2013]\s(CFP|CFT)\b/i;
const SKIP_STATUSES = new Set(['canceled', 'cancelled', 'virtualized']);
const US_COUNTRIES = new Set(['us', 'usa', 'united states', 'united states of america']);

type ConferenceRow = {
  name?: string;
  title?: string;
  url?: string;
  website?: string;
  /** developers.events: the event's site. */
  hyperlink?: string;
  startDate?: string;
  start?: string;
  endDate?: string;
  end?: string;
  /** developers.events: [start] or [start, end], each a UTC-midnight epoch in ms. */
  date?: number[];
  city?: string;
  country?: string;
  /** developers.events: "open", "Canceled", "Virtualized", ... */
  status?: string;
  cfpUrl?: string;
};

/** UTC offset (local minus UTC, in ms) of `timeZone` at an instant. */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instantMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - instantMs;
}

/** The instant of `hour`:00 local time on calendar day `ymd` ("2026-11-10") in `timeZone`. */
function localDayAt(ymd: string, hour: number, timeZone: string): Date {
  const [year, month, day] = ymd.split('-').map(Number);
  const wall = Date.UTC(year, month - 1, day, hour);
  const first = wall - zoneOffsetMs(wall, timeZone);
  return new Date(wall - zoneOffsetMs(first, timeZone));
}

/** A calendar day from an epoch (developers.events) or a "YYYY-MM-DD" string; null for anything else. */
function calendarDay(value: number | string | undefined): string | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? new Date(value).toISOString().slice(0, 10) : null;
  }
  const match = value?.trim().match(/^(\d{4}-\d{2}-\d{2})$/);
  return match ? match[1] : null;
}

/** Day values become local working hours; full timestamps are kept as given. */
function conferenceTime(value: number | string | undefined, hour: number, timeZone: string): Date | null {
  const day = calendarDay(value);
  if (day) return localDayAt(day, hour, timeZone);
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The local calendar day ("YYYY-MM-DD") of an instant in `timeZone`. */
function localDay(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

type ParsedRow = { candidate: CandidateEvent; anchor: EventAnchor };

function parseRow(row: ConferenceRow, sourcePrefix: string, now: Date): ParsedRow | null {
  const title = (row.name || row.title || '').trim();
  const city = row.city?.trim();
  if (!title || !city) return null;
  if (CFP_RE.test(title)) return null;
  if (row.status && SKIP_STATUSES.has(row.status.trim().toLowerCase())) return null;
  const country = row.country?.trim().toLowerCase();
  if (country && !US_COUNTRIES.has(country)) return null;
  const metro = metroFromCityName(city);
  if (!metro) return null;
  const timezone = METRO_PROFILES[metro].timezone;
  const startValue = row.startDate || row.start || row.date?.[0];
  const startAt = conferenceTime(startValue, DAY_START_HOUR, timezone);
  if (!startAt) return null;
  const endValue = row.endDate || row.end || row.date?.[1] || row.date?.[0];
  const endAt =
    conferenceTime(endValue, DAY_END_HOUR, timezone) ??
    (calendarDay(startValue) ? conferenceTime(startValue, DAY_END_HOUR, timezone) : null);
  // The feed is all history; a finished conference would only become an outside_window reject.
  if ((endAt ?? startAt).getTime() < now.getTime() - DAY_MS) return null;
  const url = row.url || row.hyperlink || row.website || row.cfpUrl || '';
  const startsOn = calendarDay(startValue) ?? localDay(startAt, timezone);
  const endsOn = endAt ? (calendarDay(endValue) ?? localDay(endAt, timezone)) : null;
  return {
    candidate: {
      source: 'conferences',
      sourceEventId: shaShort(`${sourcePrefix}:${title}:${calendarDay(startValue) ?? startValue}:${city}`),
      title,
      description: '',
      url,
      startAt,
      endAt: endAt ?? undefined,
      timezone,
      city,
      venueName: city,
      isOnline: false,
      hostName: title,
      organizerName: title,
      organizerKind: 'conference',
      organizerUrl: url || undefined,
      sourceTags: [`conference:${sourcePrefix}`],
      trusted: true,
    },
    anchor: {
      name: title,
      metro,
      startsOn,
      endsOn: endsOn && endsOn !== startsOn ? endsOn : null,
      url: url || null,
      source: sourcePrefix,
    },
  };
}

function parseRows(rows: unknown, sourcePrefix: string, now: Date): ParsedRow[] {
  if (!Array.isArray(rows)) return [];
  const parsed: ParsedRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const result = parseRow(row as ConferenceRow, sourcePrefix, now);
    if (result) parsed.push(result);
  }
  return parsed;
}

export function normalizeConferenceRows(
  rows: unknown,
  sourcePrefix: string,
  now: Date = new Date(),
): CandidateEvent[] {
  return parseRows(rows, sourcePrefix, now).map((row) => row.candidate);
}

/**
 * The same rows as `networking.anchors`: conferences in a metro that nearby events can be
 * satellites of (M2 `satellite` term). One per (name, metro, start day).
 */
export function conferenceAnchors(rows: unknown, sourcePrefix: string, now: Date = new Date()): EventAnchor[] {
  const byKey = new Map<string, EventAnchor>();
  for (const { anchor } of parseRows(rows, sourcePrefix, now)) {
    byKey.set(`${anchor.name}|${anchor.metro}|${anchor.startsOn}`, anchor);
  }
  return [...byKey.values()];
}

export async function fetchConferenceEvents(): Promise<AdapterFetchResult> {
  const events: CandidateEvent[] = [];
  const anchors: EventAnchor[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  const push = (batch: CandidateEvent[]) => {
    for (const event of batch) {
      if (seen.has(event.sourceEventId)) continue;
      seen.add(event.sourceEventId);
      events.push(event);
    }
  };

  try {
    const { ok, status, json } = await fetchJson<unknown>(DEVELOPERS_EVENTS_URL);
    if (ok) {
      const now = new Date();
      push(normalizeConferenceRows(json, DEVELOPERS_EVENTS_SOURCE, now));
      anchors.push(...conferenceAnchors(json, DEVELOPERS_EVENTS_SOURCE, now));
    } else {
      errors.push(`developers.events HTTP ${status}`);
    }
  } catch (err) {
    errors.push(`developers.events: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { source: 'conferences', events, anchors, error: errors.length ? errors.join('; ') : undefined };
}
