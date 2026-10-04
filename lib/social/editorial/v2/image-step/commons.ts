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
  /**
   * Source: 'P18' (main image) or 'P180' (depicts) or 'commons-search'
   * (2026-10-01 free-text fallback when the Wikidata entity has no P18
   * and Commons has no depicts-linked files). Free-text hits still go
   * through the vision KIND check downstream so logos get rejected.
   */
  source: 'P18' | 'P180' | 'commons-search';
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
 * Free-text Commons search fallback. Only called by findCandidates when
 * P18/P180 turn up nothing. Returns file titles for downstream
 * license/size/vision filtering. Namespace is restricted to 6 (File:)
 * and results are capped tight because free-text search has no
 * accuracy guardrails on its own — the vision KIND check downstream
 * still has to reject anything that isn't a real photo of the subject.
 *
 * 2026-10-01 Part 1: added because small nonprofits (METR, Redwood,
 * Apollo) don't have P18 or depicts-linked photos on Wikidata but do
 * have plenty of well-licensed photos on Commons — the free-text
 * search catches those. Never used for people (P18 handles people
 * well; free-text on a person's name is a legendarily wrong-face
 * failure mode).
 */
/**
 * Cheap title-relevance filter for free-text Commons hits. Requires the
 * subject name to appear as a whole word in the first 40 characters of
 * the file title (after the "File:" prefix). Case-insensitive. Rejects
 * the "anthropic figure" / "anthropic principle" class of false matches
 * where the subject appears as an adjective deep in a longer descriptive
 * title. Exported for direct unit testing.
 */
export function titleContainsSubject(title: string, subject: string): boolean {
  const bare = title.replace(/^File:/i, '').slice(0, 40).toLowerCase();
  const s = subject.trim().toLowerCase();
  if (!s) return false;
  const re = new RegExp(`(^|[^a-z0-9])${escapeReForTitle(s)}([^a-z0-9]|$)`, 'i');
  return re.test(bare);
}
function escapeReForTitle(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function searchCommonsFreeText(
  query: string,
  opts: { limit?: number; http?: typeof fetch } = {},
): Promise<string[]> {
  const http = opts.http ?? fetch;
  const limit = opts.limit ?? 6;
  const url = new URL(COMMONS_API);
  url.searchParams.set('action', 'query');
  url.searchParams.set('list', 'search');
  url.searchParams.set('srsearch', query);
  url.searchParams.set('srnamespace', '6');
  url.searchParams.set('srlimit', String(limit));
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  const res = await http(url.toString(), {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`Commons free-text search failed: HTTP ${res.status}`);
  const body = (await res.json()) as { query?: { search?: Array<{ title: string }> } };
  return (body.query?.search ?? []).map((s) => s.title);
}

/**
 * Given a resolved Wikidata entity, find and rank Commons candidates.
 * Preference: P18 first, then P180 depicts. Within each source,
 * preference: PD/CC0 → CC BY → CC BY-SA. Caps at `limit` (default 5).
 *
 * When both P18 and P180 return zero usable files AND the caller passed
 * `fallbackQuery` (subject label — set for orgs but never for people),
 * runs a free-text Commons search with a lower short-side floor
 * (`fallbackMinShortSide`, default 800 px). Files from that fallback
 * still go through the vision KIND check downstream so logos and
 * screenshots are rejected. 2026-10-01 Part 1.
 */
export async function findCandidates(
  qid: string,
  opts: {
    minShortSide?: number;
    limit?: number;
    http?: typeof fetch;
    fallbackQuery?: string;
    fallbackMinShortSide?: number;
  } = {},
): Promise<CommonsCandidate[]> {
  const limit = opts.limit ?? 5;
  const titles: Array<{ title: string; source: 'P18' | 'P180' | 'commons-search' }> = [];

  const p18 = await fetchEntityP18(qid, { http: opts.http });
  if (p18) titles.push({ title: `File:${p18}`, source: 'P18' });

  const depicts = await searchCommonsByDepicts(qid, { limit: 8, http: opts.http });
  for (const t of depicts) {
    if (!titles.some((x) => x.title === t)) titles.push({ title: t, source: 'P180' });
  }

  // Fetch imageinfo for the linked candidates first.
  let info: Record<string, RawImageInfo> = {};
  if (titles.length > 0) {
    info = await fetchImageInfo(titles.map((t) => t.title), { http: opts.http });
  }

  const kept: CommonsCandidate[] = [];
  for (const t of titles) {
    const raw = info[t.title];
    if (!raw) continue;
    const cand = toCandidate(t.title, raw, t.source, { minShortSide: opts.minShortSide });
    if (cand) kept.push(cand);
  }

  // Free-text fallback: when linked sources produce nothing usable AND
  // the caller opted in with fallbackQuery, take a small pass through
  // Commons free-text search at a lower size floor.
  //
  // Title-relevance filter (2026-10-01 second pass): free-text search
  // for a short subject name like "Anthropic" returns an Egyptian
  // textile depicting an "anthropic figure" — same word, wrong subject.
  // Require the subject name to appear as a WHOLE WORD in the first 40
  // characters of the file title (after the "File:" prefix). That gates
  // out substring accidents while still admitting "File:Anthropic HQ.jpg"
  // or "File:METR office 2025.jpg". Vision KIND check still runs
  // downstream so logos and screenshots are also rejected.
  if (kept.length === 0 && opts.fallbackQuery) {
    const fbTitles = await searchCommonsFreeText(opts.fallbackQuery, { limit: 8, http: opts.http });
    const relevant = fbTitles.filter((t) => titleContainsSubject(t, opts.fallbackQuery!));
    if (relevant.length > 0) {
      const fbInfo = await fetchImageInfo(relevant, { http: opts.http });
      const fbMinShort = opts.fallbackMinShortSide ?? 800;
      for (const t of relevant) {
        const raw = fbInfo[t];
        if (!raw) continue;
        const cand = toCandidate(t, raw, 'commons-search', { minShortSide: fbMinShort });
        if (cand) kept.push(cand);
      }
    }
  }

  const tierRank: Record<LicenseTier, number> = { 'PD/CC0': 0, 'CC BY': 1, 'CC BY-SA': 2 };
  const sourceRank: Record<'P18' | 'P180' | 'commons-search', number> = { P18: 0, P180: 1, 'commons-search': 2 };
  kept.sort((a, b) => {
    if (sourceRank[a.source] !== sourceRank[b.source]) return sourceRank[a.source] - sourceRank[b.source];
    if (tierRank[a.tier] !== tierRank[b.tier]) return tierRank[a.tier] - tierRank[b.tier];
    // Break ties on short side (bigger is better inside the same tier).
    return Math.min(b.width, b.height) - Math.min(a.width, a.height);
  });

  return kept.slice(0, limit);
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
