/**
 * Open-licensed stock sources (photo spec §2, sixth round): the StockSnap
 * lane, a direct Wikimedia Commons search, and Openverse. Each result passes
 * the Jev metadata pre-screen v4 (title and tags fit the request and suggest
 * no person) before it is ranked; the close-up vision check of a winner is
 * pick.ts's.
 *
 *   StockSnap lane   Openverse filtered to StockSnap and rawpixel: the
 *                    provider that hit best on the bench (large CC0 close-ups
 *                    with generic titles; 3 of 3 passed the vision check).
 *   Commons search   MediaWiki file search (Openverse returned no Commons
 *                    files on the bench): licence, author and size checked
 *                    like every Commons file; capture dates kept.
 *   Openverse        every provider, as before (mostly Flickr).
 */
import { buildCredit, fetchImageInfo, toCandidate } from '@/lib/social/editorial/v2/image-step/commons';
import { buildStockCredit, searchOpenverse, type OpenverseCandidate } from '@/lib/social/editorial/v2/image-step/openverse';
import * as Prescreen from '@/lib/social/jev/questions/stock-prescreen.v5';
import type { VisualRequest } from '@/lib/social/writer/draft';

import { lastTwoWords } from '../tuning';
import { STOCK_MIN_SHORT_SIDE, type Candidate, type CommonsSearch, type PhotoDeps, type Source, type SourceRun, type StockSearch } from '../find';

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'HeliosHub/1.0 (+https://heliosgroup.ai; helios@heliosgroup.ai)';
/** Commons files looked at per request. */
export const COMMONS_SEARCH_LIMIT = 12;
/** The StockSnap lane's Openverse providers. */
export const STOCKSNAP_LANE = ['stocksnap', 'rawpixel'];

/**
 * Search terms for a request: the request, then a shorter retry (Tommy, 2026-10-06). The retry keeps the
 * last two words (2026-10-08): in an English noun phrase the head noun comes last, so "AI research lab"
 * retries as "research lab", never "AI research" (the first two words dropped the noun that disambiguates).
 * A leading and/or/of is dropped ("and documents" → "documents").
 */
export function stockQueries(request: string): string[] {
  const full = request.trim().split(/\s+/).filter(Boolean).join(' ');
  return [...new Set([full, lastTwoWords(full)])].filter(Boolean);
}

/** Jev metadata pre-screen v5 (spec §5A #6; story context since 2026-10-08): the results whose title and tags fit the request, in the story's sense, and suggest no person, in order. */
type Screened = { cand: Candidate; tags: string[]; provider: string };

async function prescreen(scene: string, items: Screened[], run: SourceRun): Promise<Candidate[]> {
  const { deps, steps } = run;
  const shown = items.slice(0, Prescreen.MAX_CANDIDATES);
  if (!shown.length) return [];
  const meta = shown.map((x) => ({ title: x.cand.title, tags: x.tags, source: x.provider }));
  const res = await deps.jev({ state: Prescreen.buildState(scene, meta, run.ctx.brief.the_news.text), questions: Prescreen.buildQuestions(shown.length) }, { version: Prescreen.VERSION, subjectId: scene });
  const n = (id: string) => res.answers[id]?.noul ?? 0;
  const scored = shown.map((x, k) => ({ c: x.cand, fit: n(Prescreen.fitId(k)), people: n(Prescreen.peopleId(k)) }));
  const passing = scored.filter((x) => x.fit >= Prescreen.THRESHOLDS.FIT_MIN && x.people < Prescreen.THRESHOLDS.PEOPLE_MAX);
  steps.push(`pre-screen ${Prescreen.VERSION} "${scene}": ${scored.map((x) => `"${x.c.title.slice(0, 40)}" fit ${x.fit.toFixed(2)} people ${x.people.toFixed(2)}${passing.includes(x) ? ' ✓' : ''}`).join('; ')}`);
  return passing.map((x) => x.c);
}

const fromOpenverse = (c: OpenverseCandidate, lane: 'stocksnap' | 'openverse'): Candidate => ({
  url: c.url,
  credit: buildStockCredit(c),
  source: 'stock',
  width: c.width,
  height: c.height,
  qid: null,
  subject: null,
  lane,
  date: null,
  title: c.title ?? '',
  verified: false,
});

function openverseLane(lane: 'stocksnap' | 'openverse', sources?: string[]): Source {
  const source: Source = async (request: VisualRequest, run: SourceRun) => {
    const search: StockSearch = run.deps.stock ?? ((q, o) => searchOpenverse(q, { http: run.deps.http, minShortSide: o.minShortSide, sources: o.sources, limit: 20 }));
    for (const query of stockQueries(request.query)) {
      const found = (await search(query, { minShortSide: STOCK_MIN_SHORT_SIDE, ...(sources ? { sources } : {}) })).map((c) => ({ cand: fromOpenverse(c, lane), tags: c.tags ?? [], provider: c.source }));
      if (!found.length) {
        run.steps.push(`${lane} "${query}": no results`);
        continue;
      }
      const passing = await prescreen(request.query, found, run);
      if (passing.length) return passing;
      run.steps.push(`${lane} "${query}": nothing passed the pre-screen`);
    }
    return [];
  };
  Object.defineProperty(source, 'name', { value: lane });
  return source;
}

export const stocksnapSource = openverseLane('stocksnap', STOCKSNAP_LANE);
export const openverseSource = openverseLane('openverse');

/** The live Commons file search: bitmap files matching the words, licence, author and size checked (commons.ts toCandidate). */
export function createCommonsSearch(opts: { http?: typeof fetch } = {}): CommonsSearch {
  const http = opts.http ?? fetch;
  return async (query, o) => {
    const url = new URL(COMMONS_API);
    for (const [k, v] of Object.entries({ action: 'query', list: 'search', srsearch: `${query} filetype:bitmap`, srnamespace: '6', srlimit: String(o.limit), format: 'json', origin: '*' })) url.searchParams.set(k, v);
    const res = await http(url.toString(), { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Commons search failed: HTTP ${res.status}`);
    const titles = (((await res.json()) as { query?: { search?: Array<{ title: string }> } }).query?.search ?? []).map((x) => x.title);
    if (!titles.length) return [];
    const info = await fetchImageInfo(titles, { http });
    return titles.flatMap((t): Candidate[] => {
      const c = info[t] ? toCandidate(t, info[t]!, 'commons-search', { minShortSide: o.minShortSide }) : null;
      return c ? [{ url: c.url, credit: `${buildCredit(c)} · Wikimedia Commons`, source: 'commons-search', width: c.width, height: c.height, qid: null, subject: null, lane: 'commons-search', date: c.date ?? null, title: c.file.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''), verified: false }] : [];
    });
  };
}

export const commonsSearchSource: Source = async function commonsSearch(request: VisualRequest, run: SourceRun) {
  const search = run.deps.commons ?? createCommonsSearch({ http: run.deps.http });
  const found = await search(request.query, { minShortSide: STOCK_MIN_SHORT_SIDE, limit: COMMONS_SEARCH_LIMIT });
  if (!found.length) {
    run.steps.push(`commons-search "${request.query}": no usable files`);
    return [];
  }
  return prescreen(request.query, found.map((cand) => ({ cand, tags: [], provider: 'wikimedia' })), run);
};
