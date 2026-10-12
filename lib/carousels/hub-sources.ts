import type { Adapter, AdapterContext, AdapterItem } from '@/lib/reels/types';
import { HELIOS_SOCIAL_FRESHNESS_HOURS, type FeedConfig } from '@/lib/social/feeds';

import type { FetchedArticle } from '@/lib/social/ingest/fetch-feeds';

/**
 * Carousels also read the sources the Trial Reels ingest uses (Tommy,
 * 2026-10-12): Hacker News, Hugging Face papers, GitHub Trending, TLDR,
 * vendor release notes, and the outlets the carousel feeds lack. Their items
 * are mapped into the same article the carousel feeds produce, pooled with
 * them, and the carousel's own scoring (story-scoring@4) filters the lot. The
 * reels' own screen (off-topic, teaser) is not applied.
 *
 * Only the reels' primary adapters run: plain web fetches. The derived ones
 * (awesome lists, Claude web search) call a model and are never run from a
 * carousel run (Rule 1), and the context handed to an adapter has no working
 * model call, so a future adapter cannot spend by accident.
 */

const WINDOW_MS = HELIOS_SOCIAL_FRESHNESS_HOURS * 60 * 60 * 1000;

/** The feed slug a reels adapter shows up as in feed health and on a story's members. */
export const hubFeedSlug = (adapterId: string) => `reels-${adapterId}`;

export type HubFetch = {
  articles: FetchedArticle[];
  /** One per adapter that ran, so the selection's feed health reports each one (an empty one is flagged). */
  feeds: FeedConfig[];
  errors: Array<{ adapterId: string; error: string }>;
};

/** An adapter item as a carousel article. Null when it has no date, headline or text, or is past the freshness gate. */
export function articleFrom(item: AdapterItem, adapter: Pick<Adapter, 'id' | 'name'>, now: Date): FetchedArticle | null {
  const headline = item.headline?.trim();
  const body = item.body?.trim();
  if (!headline || !body || !item.publishTime) return null;
  if (item.publishTime.getTime() < now.getTime() - WINDOW_MS) return null;
  return {
    feedSlug: hubFeedSlug(adapter.id),
    feedKind: 'native',
    source: adapter.name,
    sourceUrl: item.canonicalUrl,
    headline,
    byline: item.author?.trim() || null,
    body,
    publishedAt: item.publishTime,
  };
}

/** Adapters must not be able to call a model from here. */
const NO_MODEL = {
  async ask(): Promise<never> {
    throw new Error('A carousel run does not run judgment adapters.');
  },
} as unknown as AdapterContext['jev'];

/** Every non-derived adapter's items from the freshness window, failures contained per adapter. */
export async function fetchHubSources(adapters: readonly Adapter[], now: Date): Promise<HubFetch> {
  const runnable = adapters.filter((a) => a.phase !== 'derived');
  const since = new Date(now.getTime() - WINDOW_MS);
  const context: AdapterContext = { since, now, runId: `carousel-${now.toISOString()}`, jev: NO_MODEL };
  const out: HubFetch = { articles: [], feeds: [], errors: [] };
  await Promise.all(
    runnable.map(async (adapter) => {
      try {
        const items = await adapter.fetchItems(context);
        const articles = items.map((i) => articleFrom(i, adapter, now)).filter((a): a is FetchedArticle => a !== null);
        out.articles.push(...articles);
      } catch (error) {
        out.errors.push({ adapterId: adapter.id, error: error instanceof Error ? error.message : String(error) });
      }
    }),
  );
  // Stable order for feed health and for the run record, whatever order the fetches finished in.
  out.feeds = runnable.map((a) => ({ slug: hubFeedSlug(a.id), name: a.name, url: '', kind: 'native' as const }));
  out.errors.sort((a, b) => a.adapterId.localeCompare(b.adapterId));
  return out;
}

/** The reels ingest's adapters, loaded on demand (they pull in the reels code, which the tests and the web app do not need). */
export async function liveHubAdapters(): Promise<Adapter[]> {
  const { primaryAdapters } = await import('@/lib/reels/adapters');
  return primaryAdapters();
}
