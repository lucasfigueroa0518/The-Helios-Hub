import { metroFromCityName } from '@/lib/networking/cities';
import { fetchJson, shaShort } from '@/lib/networking/http';
import type { AdapterFetchResult, CandidateEvent } from '@/lib/networking/types';

const DEVELOPERS_EVENTS_URL = 'https://developers.events/all-events.json';
const CONFS_TECH_INDEX =
  'https://raw.githubusercontent.com/tech-conferences/conference-data/main/conferences/2026/javascript.json';

type ConferenceRow = {
  name?: string;
  title?: string;
  url?: string;
  website?: string;
  startDate?: string;
  start?: string;
  endDate?: string;
  end?: string;
  city?: string;
  country?: string;
  cfpUrl?: string;
};

function asCandidate(row: ConferenceRow, sourceId: string): CandidateEvent | null {
  const title = row.name || row.title;
  const start = row.startDate || row.start;
  const city = row.city;
  if (!title || !start || !city) return null;
  const metro = metroFromCityName(city);
  if (!metro) return null;
  const url = row.url || row.website || row.cfpUrl || '';
  return {
    source: 'conferences',
    sourceEventId: sourceId,
    title,
    description: '',
    url,
    startAt: new Date(start),
    endAt: row.endDate || row.end ? new Date(String(row.endDate || row.end)) : undefined,
    city,
    venueName: city,
    isOnline: false,
    hostName: title,
    trusted: true,
  };
}

export function normalizeConferenceRows(rows: unknown, sourcePrefix: string): CandidateEvent[] {
  if (!Array.isArray(rows)) return [];
  const events: CandidateEvent[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as ConferenceRow;
    const id = shaShort(
      `${sourcePrefix}:${rec.name || rec.title || ''}:${rec.startDate || rec.start || ''}:${rec.city || ''}`,
    );
    const candidate = asCandidate(rec, id);
    if (candidate) events.push(candidate);
  }
  return events;
}

export async function fetchConferenceEvents(): Promise<AdapterFetchResult> {
  const events: CandidateEvent[] = [];
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
    const { ok, json } = await fetchJson<unknown>(DEVELOPERS_EVENTS_URL);
    if (ok) push(normalizeConferenceRows(json, 'developers.events'));
    else errors.push('developers.events fetch failed');
  } catch (err) {
    errors.push(`developers.events: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const { ok, json } = await fetchJson<unknown>(CONFS_TECH_INDEX);
    if (ok) push(normalizeConferenceRows(json, 'confs.tech'));
  } catch (err) {
    errors.push(`confs.tech: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { source: 'conferences', events, error: errors.length ? errors.join('; ') : undefined };
}
