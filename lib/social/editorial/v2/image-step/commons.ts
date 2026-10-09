/**
 * Wikimedia Commons plumbing (pulled code; spec §5.1 Photo chain v1):
 * fetch an entity's main image (P18), read file info, and keep a file only
 * when it is usable: an allowed licence (PD / CC0 / CC BY / CC BY-SA, no NC
 * or ND), a credited author, jpg/png, a minimum short side. Used by p18.ts
 * (the subject's P18), logo.ts (licence) and the credit lines.
 */

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const USER_AGENT = 'HeliosHub/1.0 (+https://heliosgroup.ai; helios@heliosgroup.ai)';

export type LicenseTier = 'PD/CC0' | 'CC BY' | 'CC BY-SA';

export type CommonsCandidate = {
  /** Canonical file title, e.g. "File:Gavin Newsom by Gage Skidmore.jpg". */
  file: string;
  /** Preferred URL for download — usually the original file URL. */
  url: string;
  /** Native dimensions. Short side is min(width, height). */
  width: number;
  height: number;
  mime: string;
  /** Author name, HTML stripped, whitespace collapsed. Empty when unknown. */
  author: string;
  /** License short name from extmetadata, canonicalized (e.g. "CC BY 4.0"). */
  license: string;
  /** Optional license URL from extmetadata.LicenseUrl. */
  licenseUrl: string | null;
  /** Preference bucket for sort. */
  tier: LicenseTier;
  /**
   * Source: 'P18' (main image) or 'P180' (depicts) or 'commons-search'
   * (2026-10-01 free-text fallback when the Wikidata entity has no P18
   * and Commons has no depicts-linked files). Free-text hits still go
   * through the vision KIND check downstream so logos get rejected.
   */
  source: 'P18' | 'P180' | 'commons-search';
  /** When the photo was taken (extmetadata DateTimeOriginal, else DateTime), as YYYY-MM-DD or YYYY; null when unknown (photo spec §4 ranking). */
  date?: string | null;
};

/**
 * Fetch the entity's P18 main-image claim from Wikidata. Returns the
 * Commons filename (without the "File:" prefix) or null if the entity
 * has no P18.
 */
export async function fetchEntityP18(
  qid: string,
  opts: { http?: typeof fetch } = {},
): Promise<string | null> {
  const http = opts.http ?? fetch;
  const url = new URL(WIKIDATA_API);
  url.searchParams.set('action', 'wbgetentities');
  url.searchParams.set('ids', qid);
  url.searchParams.set('props', 'claims');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  const res = await http(url.toString(), {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`Wikidata entity fetch failed: HTTP ${res.status}`);
  const body = (await res.json()) as {
    entities?: Record<string, { claims?: Record<string, Array<{
      rank?: 'preferred' | 'normal' | 'deprecated';
      mainsnak?: { datavalue?: { value?: string } };
    }>> }>;
  };
  // Preferred rank first, never deprecated (2026-10-08: the first listed photo can be an old one).
  const claims = (body.entities?.[qid]?.claims?.P18 ?? []).filter((c) => c.rank !== 'deprecated');
  const p18 = (claims.find((c) => c.rank === 'preferred') ?? claims[0])?.mainsnak?.datavalue?.value;
  if (typeof p18 !== 'string' || !p18) return null;
  return p18; // "Gavin Newsom by Gage Skidmore 3.jpg"
}

/**
 * Pull imageinfo for a batch of Commons file titles. One call covers up
 * to 50 titles per Commons policy.
 */
export async function fetchImageInfo(
  titles: string[],
  opts: { http?: typeof fetch } = {},
): Promise<Record<string, RawImageInfo>> {
  const http = opts.http ?? fetch;
  if (titles.length === 0) return {};
  const url = new URL(COMMONS_API);
  url.searchParams.set('action', 'query');
  url.searchParams.set('titles', titles.join('|'));
  url.searchParams.set('prop', 'imageinfo');
  url.searchParams.set('iiprop', 'url|size|mime|extmetadata');
  // A 2160px-wide copy for rendering (originals can be tens of MB); the size fields stay the original's.
  url.searchParams.set('iiurlwidth', '2160');
  url.searchParams.set('iiextmetadatalanguage', 'en');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  const res = await http(url.toString(), {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`Commons imageinfo failed: HTTP ${res.status}`);
  const body = (await res.json()) as {
    query?: { pages?: Record<string, {
      title: string;
      imageinfo?: RawImageInfo[];
    }> };
  };
  const out: Record<string, RawImageInfo> = {};
  for (const page of Object.values(body.query?.pages ?? {})) {
    const info = page.imageinfo?.[0];
    if (info) out[page.title] = info;
  }
  return out;
}

export type RawImageInfo = {
  url: string;
  /** A resized copy (iiurlwidth), when Commons made one: smaller than the original, same licence. */
  thumburl?: string;
  width: number;
  height: number;
  mime: string;
  extmetadata?: Record<string, { value?: string; source?: string } | undefined>;
};

/**
 * Turn raw imageinfo into a CommonsCandidate, applying:
 *  - License allow-list (PD/CC0/CC BY/CC BY-SA) + tier bucketing
 *  - Author required (HTML-stripped)
 *  - MIME jpg/png
 *  - Size gate
 * Returns null when any filter rejects.
 */
export function toCandidate(
  file: string,
  info: RawImageInfo,
  source: 'P18' | 'P180' | 'commons-search',
  opts: { minShortSide?: number } = {},
): CommonsCandidate | null {
  const minShort = opts.minShortSide ?? 1080;
  if (info.mime !== 'image/jpeg' && info.mime !== 'image/png') return null;
  if (Math.min(info.width, info.height) < minShort) return null;

  const rawLicense = info.extmetadata?.LicenseShortName?.value ?? '';
  const tier = classifyLicense(rawLicense);
  if (!tier) return null;

  const rawAuthor = info.extmetadata?.Artist?.value ?? '';
  const author = stripHtml(rawAuthor);
  if (!author) return null;

  return {
    file,
    url: info.thumburl ?? info.url,
    width: info.width,
    height: info.height,
    mime: info.mime,
    author,
    license: rawLicense || tier,
    licenseUrl: info.extmetadata?.LicenseUrl?.value ?? null,
    tier,
    source,
    date: photoDate(info.extmetadata?.DateTimeOriginal?.value ?? info.extmetadata?.DateTime?.value ?? ''),
  };
}

/** The first date in a Commons date field (it may hold HTML or free text): YYYY-MM-DD, else YYYY; null when none. */
export function photoDate(raw: string): string | null {
  const text = stripHtml(raw);
  const full = /\b(1[89]\d\d|20\d\d)-(\d\d)-(\d\d)\b/.exec(text);
  if (full) return `${full[1]}-${full[2]}-${full[3]}`;
  return /\b(1[89]\d\d|20\d\d)\b/.exec(text)?.[1] ?? null;
}

/**
 * License allow-list + tier assignment.
 *   PD / CC0                    → 'PD/CC0'   (preferred)
 *   CC BY (any version)         → 'CC BY'
 *   CC BY-SA (any version)      → 'CC BY-SA' (last resort)
 * Anything containing NC or ND, or unrecognized, → null (rejected).
 */
export function classifyLicense(raw: string): LicenseTier | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (/(^|[^a-z])nc([^a-z]|$)/.test(s) || /non[- ]?commercial/.test(s)) return null;
  if (/(^|[^a-z])nd([^a-z]|$)/.test(s) || /no[- ]?derivatives?/.test(s)) return null;
  if (/fair use|copyrighted|all rights reserved/.test(s)) return null;
  if (/public domain|^pd$|^pd[- ]/.test(s)) return 'PD/CC0';
  if (/^cc0|^cc\s*0/.test(s)) return 'PD/CC0';
  if (/cc[- ]?by[- ]?sa/.test(s)) return 'CC BY-SA';
  if (/cc[- ]?by/.test(s)) return 'CC BY';
  return null;
}

/**
 * Strip HTML tags + collapse whitespace. Commons' Artist field is often
 * HTML like "<a href="...">John Doe</a>" or "<span>Photographer</span>".
 * We never want raw HTML in the caption.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compact per-image credit fragment used when joining multiple photos
 * into one "Photos: …" line. Format:
 *
 *   PD tier    → "<Author> (public domain)"    (or "(CC0)" for CC0)
 *   CC BY / SA → "<Author>, <License>"         (e.g. "Andre m, CC BY-SA 3.0")
 *
 * No trailing period, no "Via Wikimedia Commons" — those live at the
 * whole-line level. See buildAttributionBlock in ./index.ts.
 */
export function buildCredit(cand: Pick<CommonsCandidate, 'author' | 'license' | 'tier'>): string {
  if (cand.tier === 'PD/CC0') {
    const licenseText = /public domain/i.test(cand.license) ? 'public domain' : cand.license;
    return `${cand.author} (${licenseText})`;
  }
  return `${cand.author}, ${cand.license}`;
}
