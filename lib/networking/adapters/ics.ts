import { ICS_FEEDS } from '@/lib/networking/allowlists';
import { METRO_PROFILES } from '@/lib/networking/cities';
import { fetchText, shaShort } from '@/lib/networking/http';
import type { AdapterFetchResult, CandidateEvent, Metro } from '@/lib/networking/types';

function unfoldIcs(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  return normalized.split('\n');
}

function parseIcsDate(value: string, tzid?: string): Date | null {
  const cleaned = value.trim();
  if (/^\d{8}$/.test(cleaned)) {
    const year = Number(cleaned.slice(0, 4));
    const month = Number(cleaned.slice(4, 6)) - 1;
    const day = Number(cleaned.slice(6, 8));
    return new Date(Date.UTC(year, month, day, 12, 0, 0));
  }
  const zulu = cleaned.endsWith('Z');
  const stamp = cleaned.replace(/Z$/, '');
  const match = stamp.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?/);
  if (!match) return null;
  const date = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] || '0'),
  ));
  if (zulu || !tzid) return date;
  return date;
}

type IcsEvent = {
  uid?: string;
  summary?: string;
  description?: string;
  location?: string;
  url?: string;
  dtstart?: string;
  dtend?: string;
  tzid?: string;
};

export function parseIcsEvents(raw: string): IcsEvent[] {
  const lines = unfoldIcs(raw);
  const events: IcsEvent[] = [];
  let current: IcsEvent | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const split = line.indexOf(':');
    if (split < 0) continue;
    const meta = line.slice(0, split);
    const value = line.slice(split + 1);
    const name = meta.split(';')[0].toUpperCase();
    const tzid = /TZID=([^;]+)/i.exec(meta)?.[1];
    if (tzid) current.tzid = tzid;
    if (name === 'UID') current.uid = value;
    else if (name === 'SUMMARY') current.summary = value.replace(/\\n/g, '\n').replace(/\\,/g, ',');
    else if (name === 'DESCRIPTION') current.description = value.replace(/\\n/g, '\n').replace(/\\,/g, ',');
    else if (name === 'LOCATION') current.location = value.replace(/\\,/g, ',');
    else if (name === 'URL') current.url = value;
    else if (name === 'DTSTART') current.dtstart = value;
    else if (name === 'DTEND') current.dtend = value;
  }
  return events;
}

export function icsEventToCandidate(
  event: IcsEvent,
  options: { feedUrl: string; name: string; metro: Metro },
): CandidateEvent | null {
  if (!event.summary || !event.dtstart) return null;
  const startAt = parseIcsDate(event.dtstart, event.tzid);
  if (!startAt) return null;
  const uid = event.uid || shaShort(`${options.feedUrl}:${event.summary}:${event.dtstart}`);
  return {
    source: 'ics',
    sourceEventId: uid,
    title: event.summary,
    description: event.description || '',
    url: event.url || options.feedUrl,
    startAt,
    endAt: event.dtend ? parseIcsDate(event.dtend, event.tzid) ?? undefined : undefined,
    timezone: event.tzid,
    venueName: event.location,
    address: event.location,
    city: event.location || METRO_PROFILES[options.metro].label,
    isOnline: false,
    hostName: options.name,
    trusted: true,
  };
}

export async function fetchIcsEvents(): Promise<AdapterFetchResult> {
  if (ICS_FEEDS.length === 0) return { source: 'ics', events: [] };
  const events: CandidateEvent[] = [];
  const errors: string[] = [];
  for (const feed of ICS_FEEDS) {
    try {
      const { ok, text } = await fetchText(feed.url);
      if (!ok) throw new Error(`HTTP ${feed.url}`);
      for (const parsed of parseIcsEvents(text)) {
        const candidate = icsEventToCandidate(parsed, {
          feedUrl: feed.url,
          name: feed.name,
          metro: feed.metro,
        });
        if (candidate) events.push(candidate);
      }
    } catch (err) {
      errors.push(`${feed.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { source: 'ics', events, error: errors.length ? errors.join('; ') : undefined };
}
