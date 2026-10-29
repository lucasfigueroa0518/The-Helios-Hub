import { dbQuery } from '@/lib/db';
import { REFERENCE_POOL_HOURS } from '@/lib/reels/config';
import { isPrivateHost } from '@/lib/net/private-host';
import { fetchPageFollowingRedirects, fetchText } from '@/lib/reels/net/http';
import { parseFeed } from '@/lib/reels/net/feed';
import { parsePage } from '@/lib/reels/net/html';
import { resolveGoogleNewsUrl } from '@/lib/social/ingest/resolve-google-news';

/**
 * Finding a story to build a Text on Screen seed from when the person gave only a headline, or gave a link that cannot be
 * read (design 2026-10-29-text-on-screen-seeding-design). The free tiers are here: stories already collected, then Google
 * News. Nothing in this file calls a model; choosing among candidates is `pickBest`, and the paid web search is its own tier.
 */

/** The most a seed may cost in total (search fees plus model tokens). */
export const SEED_MAX_USD = 0.15;
/** The paid tier's search cap. */
export const SEED_WEB_SEARCHES = 3;
/** Candidates scored per tier (two Jev calls each). */
export const SEED_MAX_CANDIDATES = 4;
/** A page with less text than this is a paywall stub or an error page, not a story. */
export const MIN_BODY_CHARS = 200;
/** Share of the seed headline's significant words a candidate headline must contain. A first guess to tune. */
export const OVERLAP_FLOOR = 0.4;
/** Trigram floor for collected stories; the duplicate check uses 0.6. A first guess to tune. */
export const COLLECTED_FLOOR = 0.3;

export type SeedCandidate = { url: string; headline: string; body: string; outlet: string; source: 'collected' | 'news' | 'web' };

const STOP = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'at', 'by', 'is', 'are', 'was', 'were', 'it', 'its', 'as', 'with', 'from', 'that', 'this', 'be', 'has', 'have', 'will', 'new']);

const words = (text: string): string[] => (text.toLowerCase().match(/[a-z0-9]+(?:\.[0-9]+)?/g) ?? []).filter((w) => !STOP.has(w));

/** The share of the seed headline's significant words that the candidate headline also has (0 when the seed has none). */
export function headlineOverlap(seedHeadline: string, candidateHeadline: string): number {
  const seed = new Set(words(seedHeadline));
  if (seed.size === 0) return 0;
  const candidate = new Set(words(candidateHeadline));
  let shared = 0;
  for (const w of seed) if (candidate.has(w)) shared += 1;
  return shared / seed.size;
}

/** The text of the page at `url`, or null when it cannot be read. The plain page reader the night uses (no model). */
export async function readPageText(url: string): Promise<string | null> {
  const page = await fetchPageFollowingRedirects(url, { retries: 0, timeoutMs: 15_000 });
  return parsePage(page.html).text;
}

/** Collected stories (not seeds, inside the reference pool window) whose headline is close to this one, best first. */
export async function collectedCandidates(headline: string): Promise<SeedCandidate[]> {
  const { rows } = await dbQuery<{ canonical_url: string; headline: string; body: string; source_name: string | null }>(
    `SELECT s.canonical_url, s.headline, s.body, s.source_name
       FROM reels.sources s
      WHERE s.adapter_id <> 'seed' AND s.drop_reason IS NULL
        AND s.canonical_url NOT LIKE 'seed://%'
        AND s.ingest_time > now() - ($2 || ' hours')::interval
        AND length(s.body) >= $3
        AND greatest(similarity(s.headline, $1), word_similarity(s.headline, $1), word_similarity($1, s.headline)) > $4
      ORDER BY greatest(similarity(s.headline, $1), word_similarity(s.headline, $1), word_similarity($1, s.headline)) DESC
      LIMIT $5`,
    [headline, String(REFERENCE_POOL_HOURS), MIN_BODY_CHARS, COLLECTED_FLOOR, SEED_MAX_CANDIDATES],
  );
  return rows.map((r) => ({ url: r.canonical_url, headline: r.headline, body: r.body, outlet: r.source_name ?? new URL(r.canonical_url).hostname, source: 'collected' as const }));
}

const gnewsSearchUrl = (query: string) => `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;

/** Google News titles end " - Outlet"; split it off. */
function splitOutlet(title: string): { headline: string; outlet: string | null } {
  const at = title.lastIndexOf(' - ');
  return at > 10 ? { headline: title.slice(0, at).trim(), outlet: title.slice(at + 3).trim() || null } : { headline: title.trim(), outlet: null };
}

export type NewsDeps = {
  fetchText?: (url: string) => Promise<string>;
  readPage?: (url: string) => Promise<string | null>;
};

/**
 * Google News results for the headline, each opened and read. Free. A failed feed, a result that will not resolve or read,
 * and a page with too little text are each skipped; any failure at all gives fewer (or no) candidates, never a throw.
 */
export async function newsCandidates(headline: string, deps: NewsDeps = {}): Promise<SeedCandidate[]> {
  const fetchFeed = deps.fetchText ?? ((url: string) => fetchText(url, { retries: 0, timeoutMs: 10_000 }));
  const readPage = deps.readPage ?? readPageText;
  let items: ReturnType<typeof parseFeed>;
  try {
    items = parseFeed(await fetchFeed(gnewsSearchUrl(headline)));
  } catch {
    return [];
  }
  const opened = await Promise.all(
    items.slice(0, SEED_MAX_CANDIDATES * 2).map(async (item): Promise<SeedCandidate | null> => {
      try {
        const resolved = await resolveGoogleNewsUrl(item.link);
        if (!resolved) return null;
        const url = resolved.resolvedUrl;
        if (!/^https?:\/\//i.test(url) || isPrivateHost(new URL(url).hostname)) return null;
        const body = (await readPage(url))?.trim() ?? '';
        if (body.length < MIN_BODY_CHARS) return null;
        const { headline: title, outlet } = splitOutlet(item.title);
        return { url, headline: title, body, outlet: outlet ?? new URL(url).hostname.replace(/^www\./, ''), source: 'news' };
      } catch {
        return null;
      }
    }),
  );
  return opened.filter((c): c is SeedCandidate => c != null).slice(0, SEED_MAX_CANDIDATES);
}
