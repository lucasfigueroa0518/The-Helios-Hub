/**
 * Free photo archives as shared finder sources (Stories Split, SS-22): Wikimedia Commons Featured and Quality pictures,
 * and the NASA image library. Keyless; licence and credit come with every find, and what the camera recorded (EXIF,
 * ../exif.ts) too: Commons returns it in the search, NASA in a metadata file read only for photos a type keeps (`more`).
 *
 * Moved from lib/stories/roa/real.ts (RA-5, RA-26) unchanged, so Real or AI?'s own path (legacy) and the shared
 * finder's archives path (../archive.ts) read the same sources the same way. Every read goes through the injected
 * `http`; tests pass a stub, so nothing here calls Commons or NASA offline. AI Drama's harvest is untouched.
 */
import { commonsCamera, nasaCamera } from '../exif';
import type { ArchiveFind, PhotoCamera } from '../types';

export const USER_AGENT = 'HeliosHub/1.0 (Real or AI? Stories; https://heliosgroup.tech)';
export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
export const NASA_API = 'https://images-api.nasa.gov';
/** Commons categories searched: Featured pictures, then Quality images (one OR search). */
export const COMMONS_CATEGORIES = 'Featured_pictures_on_Wikimedia_Commons|Quality_images';
/** Results read per search. */
export const ARCHIVE_RESULTS = 12;
const THUMB_HEIGHT = 2048;

export const strip = (html: unknown): string =>
  typeof html === 'string'
    ? html
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
    : '';

/**
 * The photographer's name from a Commons Artist field. Many are a whole notice ("This Photo was taken by <name>. Feel
 * free to use…"): the user-page link's text is the name. Else the stripped text.
 */
export function artistName(html: unknown): string {
  if (typeof html !== 'string') return '';
  const user = /<a\b[^>]*href="[^"]*(?:User|Benutzer|Utilisateur|Usuario):[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(html);
  const name = user ? strip(user[1]) : '';
  return name || strip(html);
}
export const yearOf = (s: unknown): string | undefined => /\b(1[89]\d\d|20\d\d)\b/.exec(String(s ?? ''))?.[1];
export const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

async function getJson(http: typeof fetch, url: string): Promise<unknown> {
  const res = await http(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status}`);
  return res.json();
}

const STOPWORDS = new Set(['a', 'an', 'the', 'of', 'at', 'in', 'on', 'over', 'under', 'with', 'and', 'by', 'from', 'to', 'into', 'near']);

/**
 * The searches to try, strictest first: the archives match every word, so a full caption often finds nothing
 * (2026-11-15 live test). Stopwords go, then trailing words drop one at a time, down to two words.
 */
export function queryLadder(words: string): string[] {
  const tokens = words.toLowerCase().split(/[^a-z0-9'-]+/).filter((t) => t && !STOPWORDS.has(t));
  const out: string[] = [];
  for (let n = tokens.length; n >= Math.min(2, tokens.length); n--) if (n > 0) out.push(tokens.slice(0, n).join(' '));
  return out.length ? out : [words];
}

type CommonsPage = {
  title?: string;
  imageinfo?: Array<{ url?: string; thumburl?: string; descriptionurl?: string; width?: number; height?: number; extmetadata?: Record<string, { value?: unknown }>; metadata?: unknown }>;
};

/** Commons Featured and Quality pictures matching the words. */
export function commonsSearchUrl(words: string): string {
  const q = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: `${words} incategory:${COMMONS_CATEGORIES} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: String(ARCHIVE_RESULTS),
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata|metadata',
    iimetadataversion: 'latest',
    iiurlheight: String(THUMB_HEIGHT),
    iiextmetadatafilter: 'LicenseShortName|Artist|Credit|DateTimeOriginal|ImageDescription|ObjectName',
  });
  return `${COMMONS_API}?${q}`;
}

/**
 * Commons Featured and Quality pictures for the words: at least `minHeight` tall, with a licence and an author. Commons
 * hosts free licences only, so every find is `open`.
 */
export async function searchCommons(http: typeof fetch, words: string, opts: { minHeight: number }): Promise<ArchiveFind[]> {
  const body = (await getJson(http, commonsSearchUrl(words))) as { query?: { pages?: CommonsPage[] | Record<string, CommonsPage> } };
  const pages = body?.query?.pages;
  const list: CommonsPage[] = Array.isArray(pages) ? pages : pages ? Object.values(pages) : [];
  const out: ArchiveFind[] = [];
  for (const p of list) {
    const ii = p.imageinfo?.[0];
    if (!ii?.descriptionurl || !(ii.thumburl || ii.url)) continue;
    if (Number(ii.height) < opts.minHeight) continue;
    const m = ii.extmetadata ?? {};
    const licence = strip(m.LicenseShortName?.value);
    const artist = cut(artistName(m.Artist?.value) || strip(m.Credit?.value), 60);
    if (!licence || !artist) continue;
    const year = yearOf(strip(m.DateTimeOriginal?.value));
    const camera = commonsCamera(ii.metadata);
    out.push({
      source: 'commons',
      page: ii.descriptionurl,
      imageUrl: ii.thumburl || ii.url!,
      alt: [],
      licence,
      licenceClass: 'open',
      credit: cut(`${artist} / Wikimedia Commons`, 80),
      title: strip(m.ObjectName?.value) || (p.title ?? '').replace(/^File:/, '').replace(/\.[a-z]+$/i, ''),
      description: cut(strip(m.ImageDescription?.value), 400) || undefined,
      ...(year ? { year } : {}),
      ...(camera ? { camera } : {}),
      width: Number(ii.width) || 0,
      height: Number(ii.height) || 0,
      portrait: Number(ii.height) >= Number(ii.width),
    });
  }
  return out;
}

type NasaItem = { data?: Array<{ nasa_id?: string; title?: string; description?: string; date_created?: string; photographer?: string; secondary_creator?: string; center?: string; media_type?: string }> };

export const nasaSearchUrl = (words: string) => `${NASA_API}/search?${new URLSearchParams({ q: words, media_type: 'image' })}`;
export const nasaMetadataUrl = (id: string) => `${NASA_API}/metadata/${encodeURIComponent(id)}`;

/** A kept NASA photo's camera and place: the metadata API points at a metadata.json (EXIF when the file had it). */
export async function nasaMore(http: typeof fetch, id: string): Promise<{ camera?: PhotoCamera; place?: string }> {
  const loc = (await getJson(http, nasaMetadataUrl(id))) as { location?: unknown };
  if (typeof loc?.location !== 'string') return {};
  const meta = (await getJson(http, loc.location)) as Record<string, unknown>;
  const camera = nasaCamera(meta);
  const place = typeof meta?.['AVAIL:Location'] === 'string' ? cut(strip(meta['AVAIL:Location']), 40) : '';
  return { ...(camera ? { camera } : {}), ...(place ? { place } : {}) };
}

/** NASA image library finds for the words: US government work. Their size is known only after download (0 here). */
export async function searchNasa(http: typeof fetch, words: string): Promise<ArchiveFind[]> {
  const body = (await getJson(http, nasaSearchUrl(words))) as { collection?: { items?: NasaItem[] } };
  const out: ArchiveFind[] = [];
  for (const item of (body?.collection?.items ?? []).slice(0, ARCHIVE_RESULTS)) {
    const d = item.data?.[0];
    if (!d?.nasa_id || (d.media_type && d.media_type !== 'image')) continue;
    const id = d.nasa_id;
    const year = yearOf(d.date_created);
    const who = (d.photographer || d.secondary_creator || '').trim();
    const credit = cut(who ? `${who} / NASA` : d.center ? `NASA/${d.center}` : 'NASA', 80);
    const enc = encodeURIComponent(id);
    out.push({
      source: 'nasa',
      page: `https://images.nasa.gov/details/${enc}`,
      imageUrl: `https://images-assets.nasa.gov/image/${enc}/${enc}~large.jpg`,
      alt: [`https://images-assets.nasa.gov/image/${enc}/${enc}~orig.jpg`],
      licence: 'Public domain (NASA)',
      licenceClass: 'government',
      credit,
      title: d.title,
      description: d.description ? cut(strip(d.description), 400) : undefined,
      ...(year ? { year } : {}),
      width: 0,
      height: 0,
      portrait: false,
      more: () => nasaMore(http, id),
    });
  }
  return out;
}
