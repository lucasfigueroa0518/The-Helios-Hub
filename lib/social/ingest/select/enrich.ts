/**
 * Give Jev enough text to judge substance (code only, no AI).
 *
 * Each group is scored with the member that has the most text. When the
 * best RSS body is thin, members' full pages are fetched in preference
 * order (native first, longest RSS body) until one clears THIN_BODY_CHARS
 * or the members run out. A fetch that "succeeds" with a paywall lede just
 * doesn't clear the bar, so the next member is tried.
 *
 * Why (live run 2026-10-04): 38 of 47 substance failures were scored on
 * thin text; the Trump/Clayton group scored 0.17 on a 227-char Bloomberg
 * lede while TechCrunch's full article sat in the same group.
 */
import { mapPool } from '@/lib/async-pool';
import { extractArticleBody } from '@/lib/social/ingest/extract-article-body';

import { outletKey, outletName } from './outlets';
import type { IngestArticle, ReadMember, StoryGroup } from './types';

export const THIN_BODY_CHARS = 1500;

/** Returns the page's plain text, or null when it can't be read. */
export type FetchBody = (url: string) => Promise<string | null>;

/** Live fetcher: Readability over the publisher page (Google News links resolved inside). */
export const fetchBodyLive: FetchBody = async (url) => (await extractArticleBody(url))?.text ?? null;

/** Max starting sources handed to the Reporter (Tommy, 2026-10-05). */
export const MAX_STARTING_SOURCES = 4;

function addRead(read: ReadMember[], member: ReadMember): ReadMember[] {
  const key = outletKey(member.outlet);
  const same = read.find((r) => outletKey(r.outlet) === key);
  const next = same && same.chars >= member.chars ? read : [...read.filter((r) => r !== same), member];
  return next.sort((x, y) => y.chars - x.chars);
}

async function tryFetch(fetchBody: FetchBody, url: string): Promise<string | null> {
  try {
    return await fetchBody(url);
  } catch {
    return null;
  }
}

/**
 * Read members until `enough(read)` holds or the members run out. Members
 * whose RSS body already clears the bar count as read without a fetch.
 */
async function readMembers(group: StoryGroup, fetchBody: FetchBody, enough: (g: StoryGroup) => boolean): Promise<StoryGroup> {
  let g = group;
  for (const article of g.articles) {
    if (article.body.length >= THIN_BODY_CHARS && !g.read.some((r) => r.url === article.sourceUrl)) {
      g = { ...g, read: addRead(g.read, { url: article.sourceUrl, outlet: outletName(article), chars: article.body.length }) };
    }
  }
  for (const article of g.articles) {
    if (enough(g)) break;
    if (g.tried.includes(article.sourceUrl) || g.read.some((r) => r.url === article.sourceUrl)) continue;
    const page = await tryFetch(fetchBody, article.sourceUrl);
    g = { ...g, tried: [...g.tried, article.sourceUrl] };
    if (page && page.length >= THIN_BODY_CHARS) {
      g = { ...g, read: addRead(g.read, { url: article.sourceUrl, outlet: outletName(article), chars: page.length }) };
    }
    if (page && page.length > g.body.length) g = { ...g, representative: article, body: page };
  }
  return g;
}

/** Scoring pass: stop as soon as one member gives enough text (spec: score with the member that has the most text). */
export async function enrichGroup(group: StoryGroup, fetchBody: FetchBody): Promise<StoryGroup> {
  const best: IngestArticle = group.articles.reduce((a, b) => (b.body.length > a.body.length ? b : a));
  const g = await readMembers({ ...group, representative: best, body: best.body }, fetchBody, (x) => x.body.length >= THIN_BODY_CHARS);
  return g;
}

/** Shortlist pass: keep reading members until MAX_STARTING_SOURCES outlets have been read. */
export async function topUpReadSources(group: StoryGroup, fetchBody: FetchBody): Promise<StoryGroup> {
  return readMembers(group, fetchBody, (x) => x.read.length >= MAX_STARTING_SOURCES);
}

/** The Reporter's starting sources: read members only, most text first, at most 4. */
export function startingSources(group: Pick<StoryGroup, 'read'>): string[] {
  return group.read.slice(0, MAX_STARTING_SOURCES).map((r) => r.url);
}

export async function enrichThinBodies(groups: StoryGroup[], fetchBody: FetchBody): Promise<StoryGroup[]> {
  return mapPool(groups, 6, (group) => enrichGroup(group, fetchBody));
}
