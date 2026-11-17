/**
 * "Are you smarter than AI?" research through the central intake (Stories split SS-30, SS-33; CONTRACT.md §3 C).
 *
 *   deposit   after the daily writer's call, each page it cited (the URL, the page title and the line it quoted
 *             from it) goes into the intake as a family 'search' item under `search:trivia`
 *             (lib/intake/deposit.ts TRIVIA_DEPOSIT). One insert per page, no model call; a failure is counted and
 *             never breaks the day.
 *   read      in 'intake' mode (intake.settings 'consumers'.trivia, readConsumerMode: a stale intake, or any read
 *             error, falls back to legacy), the order's recent items (TRIVIA_ORDER, 30 days) are handed to the
 *             writer as an optional `research` list in its material. Legacy: no list, today's path.
 *
 * Nothing is swept (CLAUDE.md Rule 2): the deposit touches only the pages this call cited, and the read is one
 * bounded window of the order's own stories. The writer prompt and question writing are unchanged.
 */
import type { AdapterItem } from '@/lib/reels/types';
import type { IntakeQuery, ListStoriesInput, OrderId, ScoredStory } from '@/lib/intake/types';

import type { TriviaWriteItem } from './prompts';

/** One page the writer can draw on: what the intake holds for it. */
export type ResearchItem = { url: string; title: string; quote: string };

/** 'error-fallback': the switch said intake, the intake read failed, so the writer ran without research. */
export type TriviaResearchMode = 'intake' | 'legacy' | 'stale-fallback' | 'error-fallback';

/** At most this many research items reach the writer (newest first). */
export const RESEARCH_LIMIT = 30;
/** A deposited or handed-on quote is cut to this many characters. */
export const QUOTE_CHARS = 400;
/** At most this many cited pages are deposited per writer call. */
export const MAX_DEPOSITS = 15;

export type TriviaIntakeDeps = {
  /** The intake's database (live: the same Postgres as the Stories db). */
  query?: IntakeQuery;
  readMode?: (q: IntakeQuery, order: OrderId, now: Date) => Promise<'intake' | 'legacy' | 'stale-fallback'>;
  listOrderStories?: (q: IntakeQuery, order: OrderId, input: Omit<ListStoriesInput, 'families'>) => Promise<ScoredStory[]>;
  deposit?: (q: IntakeQuery, item: AdapterItem, now: Date) => Promise<{ key: string; created: boolean }>;
};

const clip = (text: string, n: number) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

/** URL identity for matching a question's source to a search result or citation (the intake key canonicalizes again). */
export const sameUrl = (url: string) => url.trim().replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();

type PageInfo = { title: string | null; quotes: string[]; pageAge: string | null };

/**
 * What the writer's responses say about each page: titles and page ages from its web search results, and the lines
 * it quoted from text-block citations. Loose shapes: a block that does not match is skipped.
 */
export function pagesSeen(responses: readonly unknown[]): Map<string, PageInfo> {
  const pages = new Map<string, PageInfo>();
  const page = (url: string) => {
    const key = sameUrl(url);
    let p = pages.get(key);
    if (!p) pages.set(key, (p = { title: null, quotes: [], pageAge: null }));
    return p;
  };
  for (const res of responses) {
    const content = (res as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as Array<Record<string, unknown>>) {
      if (block?.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const r of block.content as Array<Record<string, unknown>>) {
          if (r?.type !== 'web_search_result' || typeof r.url !== 'string') continue;
          const p = page(r.url);
          if (typeof r.title === 'string' && r.title.trim()) p.title ??= r.title.trim();
          if (typeof r.page_age === 'string' && r.page_age.trim()) p.pageAge ??= r.page_age.trim();
        }
      } else if (block?.type === 'text' && Array.isArray(block.citations)) {
        for (const c of block.citations as Array<Record<string, unknown>>) {
          if (typeof c?.url !== 'string') continue;
          const p = page(c.url);
          if (typeof c.title === 'string' && c.title.trim()) p.title ??= c.title.trim();
          const quote = typeof c.cited_text === 'string' ? clip(c.cited_text, QUOTE_CHARS) : '';
          if (quote && !p.quotes.includes(quote)) p.quotes.push(quote);
        }
      }
    }
  }
  return pages;
}

const dateOf = (pageAge: string | null): Date | null => {
  if (!pageAge) return null;
  const t = Date.parse(pageAge);
  return Number.isFinite(t) ? new Date(t) : null;
};

/**
 * The pages the writer cited (every returned question's `sources`, http(s) only, once each), as intake finds: the
 * page title as headline (else the URL), the quoted line as body (else the claim the page confirms: the question and
 * its correct option).
 */
export function citedSources(items: readonly TriviaWriteItem[], responses: readonly unknown[]): AdapterItem[] {
  const pages = pagesSeen(responses);
  const out = new Map<string, AdapterItem>();
  for (const item of items) {
    const urls = Array.isArray(item?.sources) ? item.sources : [];
    const correct = Array.isArray(item?.options) ? item.options.find((o) => o?.letter === item.correct)?.text : undefined;
    const claim = clip(`Confirms: ${String(item?.question ?? '')}${correct ? ` Answer: ${String(correct)}.` : ''}`, QUOTE_CHARS);
    for (const raw of urls) {
      const url = typeof raw === 'string' ? raw.trim() : '';
      if (!/^https?:\/\//i.test(url) || out.has(sameUrl(url))) continue;
      const seen = pages.get(sameUrl(url));
      const quote = seen?.quotes.length ? clip(seen.quotes.slice(0, 2).join(' … '), QUOTE_CHARS) : '';
      out.set(sameUrl(url), {
        canonicalUrl: url,
        headline: seen?.title ?? url,
        body: quote || claim,
        publishTime: dateOf(seen?.pageAge ?? null),
      });
    }
  }
  return [...out.values()].slice(0, MAX_DEPOSITS);
}

export type DepositOutcome = { deposited: number; created: number; failed: number; error?: string };

/** Deposit each cited page. Never throws: a failure is counted (the first error kept) and the day goes on. */
export async function depositCitedSources(q: IntakeQuery, finds: readonly AdapterItem[], now: Date, deposit?: TriviaIntakeDeps['deposit']): Promise<DepositOutcome> {
  const out: DepositOutcome = { deposited: 0, created: 0, failed: 0 };
  if (finds.length === 0) return out;
  let put = deposit;
  if (!put) {
    try {
      const { depositFindAs, TRIVIA_DEPOSIT } = await import('@/lib/intake/deposit');
      put = (dq, item, at) => depositFindAs(dq, item, at, TRIVIA_DEPOSIT);
    } catch (err) {
      return { ...out, failed: finds.length, error: err instanceof Error ? err.message : String(err) };
    }
  }
  for (const find of finds) {
    try {
      const r = await put(q, find, now);
      out.deposited += 1;
      if (r.created) out.created += 1;
    } catch (err) {
      out.failed += 1;
      out.error ??= err instanceof Error ? err.message : String(err);
    }
  }
  return out;
}

/** The research items of the order's stories, newest first, one per page. */
export function researchOf(stories: readonly ScoredStory[], covers: (m: ScoredStory['members'][number]) => boolean, limit = RESEARCH_LIMIT): ResearchItem[] {
  const seen = new Set<string>();
  const out: ResearchItem[] = [];
  for (const story of stories) {
    for (const m of story.members) {
      if (!covers(m) || seen.has(sameUrl(m.url))) continue;
      seen.add(sameUrl(m.url));
      out.push({ url: m.url, title: m.headline, quote: clip(m.body, QUOTE_CHARS) });
    }
  }
  return out.slice(0, limit);
}

/**
 * Which path the writer takes today, and in 'intake' mode the research it gets. Never throws: a mode that cannot be
 * read is 'legacy', and an intake read that fails is 'error-fallback' with no research.
 */
export async function readTriviaResearch(q: IntakeQuery, now: Date, deps: TriviaIntakeDeps = {}): Promise<{ mode: TriviaResearchMode; research: ResearchItem[] }> {
  let mode: TriviaResearchMode;
  try {
    const read = deps.readMode ?? (await import('@/lib/intake/read')).readConsumerMode;
    mode = await read(q, 'trivia', now);
  } catch {
    mode = 'legacy';
  }
  if (mode !== 'intake') return { mode, research: [] };
  try {
    const [{ TRIVIA_ORDER }, { orderCovers }] = await Promise.all([import('@/lib/intake/orders'), import('@/lib/intake/score')]);
    const list = deps.listOrderStories ?? (await import('@/lib/intake/read')).listOrderStories;
    const since = new Date(now.getTime() - TRIVIA_ORDER.lookbackDays * 86_400_000);
    const stories = await list(q, 'trivia', { since, until: now });
    return { mode, research: researchOf(stories, (m) => orderCovers(TRIVIA_ORDER, m)) };
  } catch {
    return { mode: 'error-fallback', research: [] };
  }
}
