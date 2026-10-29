import type { RawCandidate, Source, SourceRun } from '../types';

/**
 * Serper Google Images (research 04 §3 C): the widest net, and the most watermarked one, so its results
 * go through the domain blocklist before download and the look after. Skipped, with a note, without
 * SERPER_API_KEY (CONTRACT § Secrets).
 */

export const SERPER_IMAGES_URL = 'https://google.serper.dev/images';
/** Serper packs run about $0.30–$1.00 per 1,000 queries; priced at the top of that range. */
export const SERPER_USD_PER_QUERY = 0.001;
/** First pass about 12; the cast top-up adds up to three per person still short (plan.ts). */
export const MAX_SERPER_QUERIES = 30;
export const SERPER_RESULTS = 20;

type SerperImage = { title?: string; imageUrl?: string; imageWidth?: number; imageHeight?: number; source?: string; domain?: string; link?: string };

const mdy = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;

/** News stories search from two weeks before the event to today (MD-09); history stories search all dates. */
export function serperTbs(run: Pick<SourceRun, 'isNews' | 'eventDate' | 'now'>): string | null {
  if (!run.isNews || !run.eventDate) return null;
  const from = new Date(Date.parse(run.eventDate) - 14 * 86_400_000);
  return `cdr:1,cd_min:${mdy(from)},cd_max:${mdy(run.now)}`;
}

export const serperSource: Source = async (want, run) => {
  const key = run.deps.serperKey;
  if (!key) {
    if (!run.notes.includes('serper: skipped (no SERPER_API_KEY)')) run.notes.push('serper: skipped (no SERPER_API_KEY)');
    return [];
  }
  if (run.spend.serperQueries >= MAX_SERPER_QUERIES) {
    run.notes.push(`serper "${want.terms}": skipped (query cap ${MAX_SERPER_QUERIES} reached)`);
    return [];
  }
  const tbs = serperTbs(run);
  run.spend.serperQueries += 1;
  run.spend.serperUsd += SERPER_USD_PER_QUERY;
  const res = await run.deps.http(SERPER_IMAGES_URL, {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: want.terms, num: SERPER_RESULTS, ...(tbs ? { tbs } : {}) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`serper: HTTP ${res.status}`);
  const images = ((await res.json()) as { images?: SerperImage[] }).images ?? [];
  return images.flatMap((img): RawCandidate[] => {
    if (!img.imageUrl) return [];
    return [
      {
        source: 'serper',
        want: want.id,
        kind: want.kind,
        url: img.imageUrl,
        source_page: img.link ?? null,
        credit: img.source ? `${img.source}${img.domain ? ` (${img.domain})` : ''}` : img.domain ?? 'unknown source',
        license: null,
        caption: img.title ?? '',
        // A search for a name proves nothing about who is in the picture; identity is decided in filters.ts.
        people: want.people,
        qids: [],
        place: want.place?.name ?? null,
        date_taken: null,
        date_basis: 'unknown',
        width: img.imageWidth,
        height: img.imageHeight,
        character_image: false,
        made: false,
        trusted: false,
        flags: ['from_search'],
      },
    ];
  });
};
