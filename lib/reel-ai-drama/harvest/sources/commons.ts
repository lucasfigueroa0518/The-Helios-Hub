import { fetchImageInfo, photoDate, stripHtml, type RawImageInfo } from '@/lib/social/editorial/v2/image-step/commons';

import { getJson } from '../fetch';
import { namesIn } from '../filters';
import type { RawCandidate, Source, SourceRun, Want } from '../types';

/**
 * Wikimedia Commons (research 04 §3 A). Reuses the photo finder's `fetchImageInfo` (2160px copies,
 * extmetadata), but not its licence allow-list: under MD-02 the licence is recorded, never a filter.
 * The taken date is `DateTimeOriginal` only; Commons' upload date is not when a photo was taken (§5.1).
 */

export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
export const COMMONS_LIMIT = 8;

export async function commonsSearchTitles(run: SourceRun, srsearch: string, limit: number, sort?: 'create_timestamp_desc'): Promise<string[]> {
  const url = new URL(COMMONS_API);
  const params: Record<string, string> = { action: 'query', list: 'search', srsearch, srnamespace: '6', srlimit: String(limit), format: 'json', origin: '*' };
  if (sort) params.srsort = sort;
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const body = await getJson<{ query?: { search?: { title: string }[] } }>(run.deps.http, url.toString());
  return (body.query?.search ?? []).map((x) => x.title);
}

const meta = (info: RawImageInfo, key: string) => stripHtml(info.extmetadata?.[key]?.value ?? '');

export function commonsCandidate(title: string, info: RawImageInfo, want: Want, extra: Partial<RawCandidate> = {}): RawCandidate | null {
  if (info.mime !== 'image/jpeg' && info.mime !== 'image/png') return null;
  const author = meta(info, 'Artist') || 'Unknown author';
  const license = meta(info, 'LicenseShortName') || null;
  const taken = photoDate(info.extmetadata?.DateTimeOriginal?.value ?? '');
  const file = title.replace(/^File:/, '');
  return {
    source: 'commons',
    want: want.id,
    kind: want.kind,
    url: info.thumburl ?? info.url,
    source_page: `https://commons.wikimedia.org/wiki/${encodeURIComponent(`File:${file}`.replace(/ /g, '_'))}`,
    credit: `${author}${license ? `, ${license}` : ''} · Wikimedia Commons`,
    license,
    caption: [file.replace(/\.[a-z0-9]+$/i, ''), meta(info, 'ImageDescription'), meta(info, 'ObjectName')].filter(Boolean).join(' — ').slice(0, 400),
    people: [],
    qids: [],
    place: want.place?.name ?? null,
    date_taken: taken,
    date_basis: taken ? 'commons' : 'unknown',
    width: info.width,
    height: info.height,
    character_image: false,
    made: false,
    trusted: false,
    flags: [],
    ...extra,
  };
}

export async function commonsFiles(run: SourceRun, titles: string[], want: Want, extra: Partial<RawCandidate> = {}): Promise<RawCandidate[]> {
  if (!titles.length) return [];
  const info = await fetchImageInfo(titles, { http: run.deps.http });
  return titles.flatMap((t) => {
    const key = t.startsWith('File:') ? t : `File:${t}`;
    const raw = info[key] ?? info[t];
    const c = raw ? commonsCandidate(key, raw, want, extra) : null;
    return c ? [c] : [];
  });
}

/** Free-text Commons search: bitmap files matching the want's words. For a person, only files whose title or description names them. */
export const commonsSource: Source = async (want, run) => {
  const titles = await commonsSearchTitles(run, `${want.terms} filetype:bitmap`, COMMONS_LIMIT);
  if (!titles.length) run.notes.push(`commons "${want.terms}": nothing found`);
  const found = await commonsFiles(run, titles, want);
  if (want.kind !== 'person_photo') return found;
  return found.flatMap((c) => {
    const people = namesIn(c.caption, want.people);
    return people.length ? [{ ...c, people }] : [];
  });
};
