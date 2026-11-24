/**
 * Thin-candidate enrichment, with no model. GitHub search results carry only a
 * description and Show HN items only a title, so before they are scored:
 * - `readme`: the repo's README from raw.githubusercontent.com (a plain file
 *   host, so the unauthenticated GitHub API rate limit does not apply). The
 *   usual file names are tried in turn (README_NAMES) until one answers.
 * - `linked-page`: the page the item links to, through the SSRF-guarded page
 *   fetch the seed path uses (`fetchPageFollowingRedirects` with
 *   `blockPrivate` and a byte cap); a link to a GitHub repo reads its README instead.
 * The run enriches only the candidates that get a scoring slot (registry
 * collectThinCandidates + run.pickScoredTips), never a stored row. Text is
 * truncated to the candidate cap. Any failure keeps the thin item as it was:
 * enrichment never throws.
 */
import { markdownToText, parsePage } from '@/lib/reels/net/html';
import type { AdapterItem } from '@/lib/reels/types';
import { githubRepoOf, UNTRUSTED_MAX_CHARS } from './candidate';
import type { FetchText } from './docs-adapter';

export type EnrichMode = 'readme' | 'linked-page';

/** A page fetch that refuses private addresses at every hop (the seed path's helper). */
export type FetchPage = (url: string) => Promise<{ html: string; finalUrl: string }>;

export type EnrichDeps = { fetchText: FetchText; fetchPage: FetchPage };

/** Fetches in flight at once. */
export const ENRICH_CONCURRENCY = 4;
/** Bytes read from one fetched page or README before the read stops (the live fetchers stream to this cap). */
export const PAGE_MAX_BYTES = 2_000_000;
/** A fetched page is cut to this before parsing, as the seed path does (a guard when a fetcher has no byte cap). */
const PAGE_MAX_CHARS = PAGE_MAX_BYTES;
/** Below this, the fetched text adds nothing over the thin text. */
const MIN_USEFUL_CHARS = 200;

/** README file names tried in order on raw.githubusercontent.com (case-sensitive there); the first 200 wins. */
export const README_NAMES = ['README.md', 'readme.md', 'README.MD', 'Readme.md', 'README.rst', 'README'] as const;

/** One README file of the default branch via raw.githubusercontent.com (`HEAD` resolves the default branch). */
export function readmeUrl(owner: string, repo: string, name: string = README_NAMES[0]): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${name}`;
}

/** A 404 means "not under this name": try the next. Anything else (timeout, 5xx, blocked) ends the README hunt. */
const isNotFound = (error: unknown) => (error as { status?: unknown } | null)?.status === 404;

async function readmeText(url: string, fetchText: FetchText): Promise<string | null> {
  const ref = githubRepoOf(url);
  if (!ref) return null;
  for (const name of README_NAMES) {
    let md: string;
    try {
      md = await fetchText(readmeUrl(ref.owner, ref.repo, name));
    } catch (error) {
      if (isNotFound(error)) continue;
      throw error;
    }
    return markdownToText(md.slice(0, PAGE_MAX_CHARS));
  }
  return null;
}

async function linkedPageText(item: AdapterItem, deps: EnrichDeps): Promise<string | null> {
  const link = item.destinationUrl ?? item.canonicalUrl;
  if (githubRepoOf(link)) return readmeText(link, deps.fetchText);
  // An HN text post links back to HN itself: there is no page beyond the title.
  if (/(^|\.)news\.ycombinator\.com$/i.test(new URL(link).hostname)) return null;
  const page = await deps.fetchPage(link);
  const parsed = parsePage(page.html.slice(0, PAGE_MAX_CHARS));
  return parsed.paywalled ? null : parsed.text;
}

/** One item, enriched or returned unchanged. Never throws. */
export async function enrichItem(item: AdapterItem, mode: EnrichMode, deps: EnrichDeps): Promise<AdapterItem> {
  try {
    const text = mode === 'readme' ? await readmeText(item.canonicalUrl, deps.fetchText) : await linkedPageText(item, deps);
    if (!text || text.trim().length < MIN_USEFUL_CHARS) return item;
    // README mode keeps the description and topics on top; a linked page replaces the feed's stub text.
    const body = (mode === 'readme' && item.body ? `${item.body}\n\n${text}` : text).slice(0, UNTRUSTED_MAX_CHARS);
    return { ...item, body, textIsComplete: true };
  } catch {
    return item;
  }
}

/** `fn` over every value (order kept), at most `limit` at a time. */
export async function mapConcurrent<T, R>(values: readonly T[], limit: number, fn: (v: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(values.length);
  let next = 0;
  const worker = async () => {
    while (next < values.length) {
      const i = next;
      next += 1;
      out[i] = await fn(values[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return out;
}
