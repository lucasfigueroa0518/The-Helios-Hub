/**
 * Offline fixture day for M1 selection tests: feed articles plus stubbed
 * Jev answers. No answers here were recorded from live Jev; they are
 * hand-set to exercise each rule in spec §5B / §5B-1.
 *
 * NOW is Tuesday 2026-10-06 15:00Z (11:00 in New York) → 24h window.
 */
import type { FeedConfig } from '@/lib/social/feeds';
import type { JevAsk } from '@/lib/social/jev/client';
import * as DifferentStory from '@/lib/social/jev/questions/different-story.v1';
import * as SameEvent from '@/lib/social/jev/questions/same-event.v1';
import * as Scoring from '@/lib/social/jev/questions/story-scoring.v2';
import { createStubJev, stubKey, type StubTable } from '@/lib/social/jev/stub';
import type { IngestArticle } from '@/lib/social/ingest/select/types';

export const NOW = new Date('2026-10-06T15:00:00Z');

const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const longBody = (lede: string) => `${lede} ${'Further reporting and context. '.repeat(60)}`.trim();

export const FEEDS: FeedConfig[] = [
  { slug: 'verge', name: 'The Verge', url: 'https://verge.example/rss', kind: 'native' },
  { slug: 'techcrunch', name: 'TechCrunch', url: 'https://tc.example/rss', kind: 'native' },
  { slug: 'bloomberg', name: 'Bloomberg', url: 'https://bbg.example/rss', kind: 'native' },
  { slug: 'wired', name: 'Wired', url: 'https://wired.example/rss', kind: 'native' },
  { slug: 'reuters', name: 'Reuters', url: 'https://reuters.example/rss', kind: 'native' },
  { slug: 'gnews', name: 'Google News', url: 'https://news.google.com/rss/search?q=ai', kind: 'google-news' },
  { slug: 'empty-feed', name: 'Empty Feed', url: 'https://empty.example/rss', kind: 'native' },
];

/** Real hosts, so outlet naming works as it does on live feeds. */
const HOST: Record<string, string> = {
  verge: 'www.theverge.com',
  techcrunch: 'techcrunch.com',
  bloomberg: 'www.bloomberg.com',
  wired: 'www.wired.com',
  reuters: 'www.reuters.com',
  gnews: 'news.google.com/rss/articles',
};

const art = (
  slug: string,
  feedSlug: string,
  source: string,
  headline: string,
  ageHours: number,
  body: string = longBody(headline),
  feedKind: 'native' | 'google-news' = 'native',
): IngestArticle => ({
  feedSlug,
  feedKind,
  source,
  sourceUrl: `https://${HOST[feedSlug]}/${slug}`,
  headline,
  byline: null,
  body,
  publishedAt: hoursAgo(ageHours),
});

// Story X: one launch, three outlets.
export const A1 = art('a1', 'verge', 'The Verge', 'OpenAI launches GPT-6 with agent mode', 3, longBody('OpenAI launched GPT-6 today. '.repeat(10)));
export const A2 = art('a2', 'techcrunch', 'TechCrunch', 'OpenAI launches GPT-6, its new agent model', 4);
export const A4 = art('a4', 'bloomberg', 'Bloomberg', 'OpenAI GPT-6 launch puts agents front and centre', 5);
// Story K: same company/topic as X, different event.
export const K1 = art('k1', 'techcrunch', 'TechCrunch', 'OpenAI GPT-6 pricing draws developer criticism', 6);
// Story B: one outlet, seen twice (native + Google News copy).
export const B1 = art('b1', 'wired', 'Wired', 'Anthropic raises $10 billion from sovereign funds', 7, longBody('Anthropic raised $10 billion. '.repeat(10)));
export const B2 = art('b2', 'gnews', 'WIRED', 'Anthropic raises $10 billion from sovereign funds - WIRED', 7, 'Anthropic raises $10 billion.', 'google-news');
// Story C: defense business news (allowed by the skip-list carve-out), two outlets.
export const C1 = art('c1', 'reuters', 'Reuters', 'Pentagon signs AI contract with Scale AI', 8, longBody('The Pentagon signed a contract. '.repeat(10)));
export const C2 = art('c2', 'bloomberg', 'Bloomberg', 'Scale AI wins Pentagon contract', 9);
// Story D: skip list (weapons test).
export const D1 = art('d1', 'verge', 'The Verge', 'Autonomous AI drone test ends in explosion at range', 10);
// Story E: already posted.
export const E1 = art('e1', 'techcrunch', 'TechCrunch', 'Google unveils Gemini 4 for phones', 11);
// Story F: listicle (code filter).
export const F1 = art('f1', 'wired', 'Wired', '10 best AI tools for writing in 2026', 2);
// Story G: AI is a side detail; thin RSS body (enrichment fetch).
export const G1 = art('g1', 'bloomberg', 'Bloomberg', 'Nvidia shares dip after export ruling', 12, 'Nvidia shares fell.');
// Outside 24h, inside 48h.
export const H1 = art('h1', 'verge', 'The Verge', 'Meta releases Llama 5 open model', 30);
export const I1 = art('i1', 'wired', 'Wired', 'Microsoft AI chief warns on model welfare', 40);

export const ARTICLES: IngestArticle[] = [A1, A2, A4, K1, B1, B2, C1, C2, D1, E1, F1, G1, H1, I1];

export const POSTED = [{ headline: 'Google unveils Gemini 4', postedAt: '2026-10-04T14:00:00Z' }];

/** Same-event pairs by headline (unordered). Every other neighbour pair answers 0.2. */
const SAME_EVENT = [
  [A1, A2],
  [A1, A4],
  [A2, A4],
  [B1, B2],
  [C1, C2],
].map(([x, y]) => [x!.headline, y!.headline].sort().join(' | '));

/** Same company/topic as winner #1 (by headline). */
const SAME_TOPIC = new Set([K1.headline]);

const ok = (bonus: [number, number, number], extra: Record<string, number> = {}) => ({
  '*': 0.02,
  ai_main_subject: 0.92,
  substance: 0.85,
  why_it_matters: bonus[0],
  sourcing: bonus[1],
  photographable_subject: bonus[2],
  ...extra,
});

/** Story scoring answers, keyed by group id (= representative URL). */
export const SCORING: StubTable = {
  [stubKey(Scoring.VERSION, A1.sourceUrl)]: ok([0.55, 0.55, 0.55]), // passes 3, sum 1.65, 3 outlets
  [stubKey(Scoring.VERSION, K1.sourceUrl)]: ok([0.6, 0.6, 0.6]), // passes 3, sum 1.8, 1 outlet
  [stubKey(Scoring.VERSION, C1.sourceUrl)]: ok([0.7, 0.6, 0.0], { skip_weapons_war: 0.2 }), // passes 2, sum 1.3, 2 outlets
  [stubKey(Scoring.VERSION, B1.sourceUrl)]: ok([0.95, 0.95, 0.05]), // passes 2, sum 1.95, 1 outlet
  [stubKey(Scoring.VERSION, D1.sourceUrl)]: ok([0.9, 0.9, 0.9], { skip_weapons_war: 0.95 }),
  [stubKey(Scoring.VERSION, E1.sourceUrl)]: ok([0.9, 0.9, 0.9], { already_posted: 0.9 }),
  [stubKey(Scoring.VERSION, G1.sourceUrl)]: ok([0.9, 0.9, 0.9], { ai_main_subject: 0.3 }),
  [stubKey(Scoring.VERSION, H1.sourceUrl)]: ok([0.6, 0.6, 0.6]),
  [stubKey(Scoring.VERSION, I1.sourceUrl)]: ok([0.6, 0.6, 0.6], { substance: 0.4 }),
};

type State = { article?: { headline: string }; neighbours?: Array<{ headline: string }>; first?: { headline: string }; candidates?: Array<{ headline: string }> };

const sameEventHandler: JevAsk = async (request) => {
  const state = request.state as State;
  const answers: Record<string, { noul: number }> = {};
  state.neighbours!.forEach((n, k) => {
    const key = [state.article!.headline, n.headline].sort().join(' | ');
    answers[SameEvent.neighbourId(k)] = { noul: SAME_EVENT.includes(key) ? 0.95 : 0.2 };
  });
  return { answers, usage: { input_tokens: Math.ceil(JSON.stringify(request).length / 4), output_tokens: 0 }, model: 'stub-jev' };
};

const differentStoryHandler: JevAsk = async (request) => {
  const state = request.state as State;
  const answers: Record<string, { noul: number }> = {};
  state.candidates!.forEach((c, k) => {
    answers[DifferentStory.candidateId(k)] = { noul: SAME_TOPIC.has(c.headline) ? 0.9 : 0.1 };
  });
  return { answers, usage: { input_tokens: Math.ceil(JSON.stringify(request).length / 4), output_tokens: 0 }, model: 'stub-jev' };
};

export function fixtureJev(): JevAsk {
  return createStubJev(SCORING, {
    [SameEvent.VERSION]: sameEventHandler,
    [DifferentStory.VERSION]: differentStoryHandler,
  });
}

/** Full-text fetch stub: only G1 is thin; returns a longer page for it. */
export const FULL_TEXT: Record<string, string> = {
  [G1.sourceUrl]: longBody('Nvidia shares fell after a US export ruling on chips.'),
};
