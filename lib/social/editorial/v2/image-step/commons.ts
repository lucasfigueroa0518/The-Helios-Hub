/**
 * Commons candidate finder for a resolved Wikidata entity.
 *
 * Per docs/IMAGES-V1-HANDOFF.md §Accuracy rules: photos must be linked
 * to the exact Wikidata entity, either:
 *   1. P18 — the entity's main image (highest confidence).
 *   2. P180 depicts — Commons files whose structured "depicts" claim
 *      names this Q-id.
 *
 * Free-text Commons search is NEVER used (spec: "Never a free-text
 * search result for a person's name").
 *
 * For each candidate this module pulls imageinfo (license, artist,
 * dimensions, MIME), applies the license filter with preference
 * ordering (PD/CC0 > CC BY > CC BY-SA), size filter, MIME filter,
 * strips HTML from the artist field, and returns a sorted list.
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
  /** Source: 'P18' (main image) or 'P180' (depicts). */
  source: 'P18' | 'P180';
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
      mainsnak?: { datavalue?: { value?: string } };
    }>> }>;
  };
  const p18 = body.entities?.[qid]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  if (typeof p18 !== 'string' || !p18) return null;
  return p18; // "Gavin Newsom by Gage Skidmore 3.jpg"
}

/**
 * Search Commons for files whose structured "depicts" (P180) claim
 * points at the given Q-id. Uses `haswbstatement:P180=<qid>` — a
 * server-side filter, not free-text.
 *
 * Limit stays low (spec caps candidates at 5). Files without P180 —
 * ie photos never marked as depicting the entity — are correctly
 * excluded.
 */
export async function searchCommonsByDepicts(
  qid: string,
  opts: { limit?: number; http?: typeof fetch } = {},
): Promise<string[]> {
  const http = opts.http ?? fetch;
  const limit = opts.limit ?? 5;
  const url = new URL(COMMONS_API);
  url.searchParams.set('action', 'query');
  url.searchParams.set('list', 'search');
  url.searchParams.set('srsearch', `haswbstatement:P180=${qid}`);
  url.searchParams.set('srnamespace', '6'); // File:
  url.searchParams.set('srlimit', String(limit));
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  const res = await http(url.toString(), {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`Commons search failed: HTTP ${res.status}`);
  const body = (await res.json()) as {
    query?: { search?: Array<{ title: string }> };
  };
  return (body.query?.search ?? []).map((s) => s.title); // "File:..."
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
  source: 'P18' | 'P180',
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
    url: info.url,
    width: info.width,
    height: info.height,
    mime: info.mime,
    author,
    license: rawLicense || tier,
    licenseUrl: info.extmetadata?.LicenseUrl?.value ?? null,
    tier,
    source,
  };
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
 * Given a resolved Wikidata entity, find and rank Commons candidates.
 * Preference: P18 first, then P180 depicts. Within each source,
 * preference: PD/CC0 → CC BY → CC BY-SA. Caps at `limit` (default 5).
 */
export async function findCandidates(
  qid: string,
  opts: {
    minShortSide?: number;
    limit?: number;
    http?: typeof fetch;
  } = {},
): Promise<CommonsCandidate[]> {
  const limit = opts.limit ?? 5;
  const titles: Array<{ title: string; source: 'P18' | 'P180' }> = [];

  const p18 = await fetchEntityP18(qid, { http: opts.http });
  if (p18) titles.push({ title: `File:${p18}`, source: 'P18' });

  const depicts = await searchCommonsByDepicts(qid, { limit: 8, http: opts.http });
  for (const t of depicts) {
    if (!titles.some((x) => x.title === t)) titles.push({ title: t, source: 'P180' });
  }
  if (titles.length === 0) return [];

  const info = await fetchImageInfo(titles.map((t) => t.title), { http: opts.http });

  const kept: CommonsCandidate[] = [];
  for (const t of titles) {
    const raw = info[t.title];
    if (!raw) continue;
    const cand = toCandidate(t.title, raw, t.source, { minShortSide: opts.minShortSide });
    if (cand) kept.push(cand);
  }

  const tierRank: Record<LicenseTier, number> = { 'PD/CC0': 0, 'CC BY': 1, 'CC BY-SA': 2 };
  const sourceRank: Record<'P18' | 'P180', number> = { P18: 0, P180: 1 };
  kept.sort((a, b) => {
    if (sourceRank[a.source] !== sourceRank[b.source]) return sourceRank[a.source] - sourceRank[b.source];
    if (tierRank[a.tier] !== tierRank[b.tier]) return tierRank[a.tier] - tierRank[b.tier];
    // Break ties on short side (bigger is better inside the same tier).
    return Math.min(b.width, b.height) - Math.min(a.width, a.height);
  });

  return kept.slice(0, limit);
}

/**
 * Build the caption credit line for a Commons candidate. Format per spec:
 *   Wikimedia: "Photo: <Author> / Wikimedia Commons, <License>."
 */
export function buildCredit(cand: CommonsCandidate): string {
  return `Photo: ${cand.author} / Wikimedia Commons, ${cand.license}.`;
}
