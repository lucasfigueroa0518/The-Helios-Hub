import type Anthropic from '@anthropic-ai/sdk';

import { newAnthropic } from '@/lib/anthropic-client';
import { cachedSystemText, withToolCache } from '@/lib/anthropic-cache';
import { priceAnthropicMessages } from '@/lib/anthropic-pricing';
import { dbQuery } from '@/lib/db';
import { B6_MODEL, REFERENCE_POOL_HOURS } from '@/lib/reels/config';
import { isPrivateHost } from '@/lib/net/private-host';
import { fetchPageFollowingRedirects, fetchText } from '@/lib/reels/net/http';
import { REPORT_ARTICLES_TOOL, SEED_SEARCH_SYSTEM, buildSeedSearchUserPrompt } from '@/lib/reels/prompts/seed-search';
import { recordCost } from '@/lib/reels/repository';
import { parseFeed } from '@/lib/reels/net/feed';
import { parsePage } from '@/lib/reels/net/html';
import type { JevRunner } from '@/lib/reels/jev/runner';
import { scoreOneIdea } from '@/lib/reels/pipeline/scoring';
import type { InterpretedScore } from '@/lib/reels/scoring/interpret';
import { isGoogleNewsUrl, resolveGoogleNewsUrl } from '@/lib/social/ingest/resolve-google-news';

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
export const OVERLAP_FLOOR = 0.3;
/** Trigram floor for collected stories; the duplicate check uses 0.6. A first guess to tune. */
export const COLLECTED_FLOOR = 0.3;

export type SeedCandidate = { url: string; headline: string; body: string; outlet: string; source: 'collected' | 'news' | 'web' };

const STOP = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'at', 'by', 'is', 'are', 'was', 'were', 'it', 'its', 'as', 'with', 'from', 'that', 'this', 'be', 'has', 'have', 'will', 'new']);

/** A plural and its singular are one word ("models" = "model", "parties" = "party"); "ss", "us" and "is" endings are not plurals. */
const singular = (w: string): string => {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  return w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w;
};

const words = (text: string): string[] => (text.toLowerCase().match(/[a-z0-9]+(?:\.[0-9]+)?/g) ?? []).filter((w) => !STOP.has(w)).map(singular);

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
  // A person's (or a model's) link: refuse private addresses at the first URL and at every redirect hop.
  const page = await fetchPageFollowingRedirects(url, { retries: 0, timeoutMs: 15_000, blockPrivate: true });
  return parsePage(page.html).text;
}

/** A pasted Google News wrapper link's publisher URL, or null when it cannot be unwound. */
export async function resolveWrapperLink(url: string): Promise<string | null> {
  return (await resolveGoogleNewsUrl(url))?.resolvedUrl ?? null;
}

export { isGoogleNewsUrl };

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

export type PickedStory = { candidate: SeedCandidate; score: InterpretedScore };

/**
 * The best related story among the candidates. A candidate whose headline shares under OVERLAP_FLOOR of the seed headline's
 * words is dropped unscored (a high score must not pull in an unrelated story). Up to SEED_MAX_CANDIDATES are scored at once
 * with the same two Jev calls every idea gets (candidates are not stored ideas, so their calls are logged against none);
 * the highest net wins, and its score becomes the idea's score.
 */
export async function pickBest(seedHeadline: string, candidates: readonly SeedCandidate[], jev: JevRunner): Promise<PickedStory | { failed: 'none_related' | 'scoring_unavailable' }> {
  const related = candidates.filter((c) => headlineOverlap(seedHeadline, c.headline) >= OVERLAP_FLOOR).slice(0, SEED_MAX_CANDIDATES);
  if (related.length === 0) return { failed: 'none_related' };
  const settled = await Promise.allSettled(
    related.map((c, i) =>
      scoreOneIdea(null as unknown as string, jev, { id: `candidate:${i}`, lastJoinedMs: Date.now(), members: [{ role: 'primary', sourceName: c.outlet, headline: c.headline, body: c.body }] }, null),
    ),
  );
  if (settled.every((r) => r.status === 'rejected')) return { failed: 'scoring_unavailable' };
  let best: PickedStory | null = null;
  settled.forEach((r, i) => {
    if (r.status !== 'fulfilled' || r.value.net == null) return;
    if (!best || r.value.net > (best.score.net ?? -Infinity)) best = { candidate: related[i]!, score: r.value };
  });
  return best ?? { failed: 'none_related' };
}

/** The paid search's output cap, and the input a search is assumed to read at most; with the 3 searches they bound the cost. */
export const PAID_MAX_OUTPUT_TOKENS = 1000;
/** An assumption, not a measurement: what 3 searches' results add to the input. The cost test is only as good as this. */
export const PAID_INPUT_ALLOWANCE_TOKENS = 30_000;

/** What the drawer quotes before a paid search runs: about 7 to 10 cents in practice, quoted at the top of that. */
export function estimatePaidSearchUsd(): number {
  return 0.1;
}

/** The paid search stays off until Tommy approves the prompt wording (lib/reels/prompts/seed-search.ts) and sets this. */
export function seedSearchApproved(): boolean {
  return process.env.REELS_SEED_SEARCH_PROMPT_APPROVED === 'true';
}

export type PaidSearchDeps = {
  client: { messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> } };
  readPage?: (url: string) => Promise<string | null>;
};

/**
 * One model call with the web_search tool (at most SEED_WEB_SEARCHES searches, PAID_MAX_OUTPUT_TOKENS out). The model reports
 * links only; each page is read with the plain page reader, so the idea is built from the real article. The spend is
 * recorded and returned.
 */
export async function webCandidates(headline: string, deps: PaidSearchDeps): Promise<{ candidates: SeedCandidate[]; usd: number }> {
  const tools: Anthropic.MessageCreateParams['tools'] = [
    { type: 'web_search_20250305', name: 'web_search', max_uses: SEED_WEB_SEARCHES },
    withToolCache(REPORT_ARTICLES_TOOL as Anthropic.Tool),
  ];
  const message = await deps.client.messages.create({
    model: B6_MODEL,
    max_tokens: PAID_MAX_OUTPUT_TOKENS,
    system: cachedSystemText(SEED_SEARCH_SYSTEM),
    messages: [{ role: 'user', content: buildSeedSearchUserPrompt(headline) }],
    tools,
  });
  const priced = priceAnthropicMessages([message], { modelId: B6_MODEL, fallbackCacheTtl: '1h' });
  const usd = Number(priced.costUsd);
  await recordCost({
    runId: null,
    vendor: 'anthropic',
    component: 'seed-search',
    inputTokens: priced.uncached_input_tokens + priced.cache_read_input_tokens + priced['cache_creation.ephemeral_5m_input_tokens'] + priced['cache_creation.ephemeral_1h_input_tokens'],
    outputTokens: priced.output_tokens,
    usd,
  });
  if (usd > SEED_MAX_USD) console.error(JSON.stringify({ ts: new Date().toISOString(), component: 'reels-seed', message: 'paid_search_over_ceiling', usd, ceiling: SEED_MAX_USD }));

  const reported: Array<{ url: string; headline: string; outlet: string }> = [];
  for (const block of message.content) {
    if (block.type !== 'tool_use' || block.name !== REPORT_ARTICLES_TOOL.name) continue;
    const articles = (block.input as { articles?: unknown }).articles;
    if (!Array.isArray(articles)) continue;
    for (const a of articles as Array<Record<string, unknown>>) {
      if (typeof a?.url === 'string' && typeof a.headline === 'string' && /^https?:\/\//i.test(a.url)) {
        reported.push({ url: a.url, headline: a.headline, outlet: typeof a.outlet === 'string' && a.outlet ? a.outlet : new URL(a.url).hostname.replace(/^www\./, '') });
      }
    }
  }
  const readPage = deps.readPage ?? readPageText;
  const opened = await Promise.all(
    reported.slice(0, SEED_WEB_SEARCHES).map(async (a): Promise<SeedCandidate | null> => {
      try {
        if (isPrivateHost(new URL(a.url).hostname)) return null;
        const body = (await readPage(a.url))?.trim() ?? '';
        return body.length >= MIN_BODY_CHARS ? { url: a.url, headline: a.headline, body, outlet: a.outlet, source: 'web' } : null;
      } catch {
        return null;
      }
    }),
  );
  return { candidates: opened.filter((c): c is SeedCandidate => c != null), usd };
}

/** The real paid search: a client from ANTHROPIC_API_KEY. Throws when there is none. */
export async function runPaidSearch(headline: string): Promise<{ candidates: SeedCandidate[]; usd: number }> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set.');
  return webCandidates(headline, { client: newAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) });
}
