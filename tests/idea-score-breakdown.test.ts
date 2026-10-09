/**
 * Idea score breakdowns (Lucas, 2026-10-09): every type's bench idea says where
 * its points came from, and Morning Download ranks recent, concrete AI news
 * above warnings and forecasts on one scale for both sources. Offline: pure
 * functions and PGlite, no Claude, no Jev, no web search.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { carouselBreakdown } from '@/lib/social-hub/adapters/carousels';
import { explainerBreakdown } from '@/lib/social-hub/adapters/explainers';
import { reelBreakdown } from '@/lib/social-hub/adapters/reels';
import { storyIdeas } from '@/lib/social-hub/adapters/stories';
import type { CarouselIdeaRow } from '@/lib/social-hub/queries/carousels';
import type { ExplainerTopicRow } from '@/lib/social-hub/queries/explainers';
import type { ReelIdeaRow } from '@/lib/social-hub/queries/reels';
import { MAJOR_NEWS_WEIGHTS, majorNewsScore } from '@/lib/stories/build/morning-download';
import { openLocalStoriesDb } from '@/lib/stories/local-db';
import { MD_POOL_POINTS, morningDownloadScore } from '@/lib/stories/md-score';
import { openPool, refreshStoryPool, type PoolReads } from '@/lib/stories/pool';
import { MAJOR_NEWS } from '@/lib/stories/questions';
import type { StoryCandidate } from '@/lib/stories/sources/reels';

const NOW = new Date('2026-10-09T14:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const sum = (parts: Array<{ points: number | null }>) => parts.reduce((s, p) => s + (p.points ?? 0), 0);

const cand = (headline: string, origin: 'reels' | 'carousel', publishedAt: string | null = hoursAgo(6), blockbuster = 0): StoryCandidate => ({
  key: `news.test/${headline.toLowerCase().replace(/\W+/g, '-')}`,
  origin,
  ref: headline,
  headline,
  sourceName: 'News Test',
  url: `https://news.test/${encodeURIComponent(headline)}`,
  body: '',
  publishedAt,
  nativeScore: 1,
  blockbuster,
});

test('Morning Download: a fresh release from a major lab tops the scale, from either source', () => {
  const r = morningDownloadScore(cand('OpenAI releases GPT-6 with a 2M-token context window', 'reels'), NOW);
  assert.equal(r.score, 1);
  assert.equal(r.breakdown.parts[0]!.points, null, 'the source is shown but adds nothing');
  assert.deepEqual(r.breakdown.parts.map((p) => p.label), ['Source', 'News kind', 'Major player', 'Recent']);
  assert.equal(r.breakdown.parts[1]!.detail, 'Model release');
  assert.equal(r.breakdown.parts[2]!.detail, 'OpenAI');
});

test('Morning Download: a doom headline from Text on Screen scores below concrete news', () => {
  const doom = morningDownloadScore(cand('AI godfather warns superintelligence could wipe out humanity', 'reels'), NOW);
  const policy = morningDownloadScore(cand('EU regulators fine Meta over AI training data', 'reels'), NOW);
  const smallAdvance = morningDownloadScore(cand('Researchers cut transformer training cost in half on a new benchmark', 'carousel', hoursAgo(30)), NOW);
  assert.ok(doom.breakdown.parts.some((p) => p.label === 'Speculation' && (p.points ?? 0) < 0), 'speculation takes points away');
  assert.ok(doom.score < policy.score, `doom ${doom.score} < policy ${policy.score}`);
  assert.ok(doom.score < smallAdvance.score, `doom ${doom.score} < small advance ${smallAdvance.score}`);
  assert.ok(doom.score <= 0.3, `doom stays low: ${doom.score}`);
});

test('Morning Download: the same story scores the same from either source, and parts add up to the score', () => {
  const headline = 'Anthropic raises $13B at a $183B valuation';
  const c = morningDownloadScore(cand(headline, 'carousel'), NOW);
  const r = morningDownloadScore(cand(headline, 'reels'), NOW);
  assert.equal(c.score, r.score);
  for (const x of [c, r]) assert.equal(Number(sum(x.breakdown.parts).toFixed(4)), x.score);
  assert.equal(Number((MD_POOL_POINTS.newsKind + MD_POOL_POINTS.majorPlayer + MD_POOL_POINTS.fresh24h).toFixed(4)), 1, 'the best story scores exactly 1');
});

test('Morning Download: old or undated stories lose the recency points; a question headline counts as speculation', () => {
  const old = morningDownloadScore(cand('Nvidia launches a new data center chip', 'carousel', hoursAgo(80)), NOW);
  assert.equal(old.breakdown.parts.find((p) => p.label === 'Recent')!.points, 0);
  const undated = morningDownloadScore(cand('Nvidia launches a new data center chip', 'carousel', null), NOW);
  assert.equal(undated.breakdown.parts.find((p) => p.label === 'Recent')!.detail, 'No publish time');
  const q = morningDownloadScore(cand('Is AI coming for your job?', 'reels'), NOW);
  assert.ok(q.breakdown.parts.some((p) => p.label === 'Speculation'));
  assert.ok(q.score >= 0, 'the score never goes below 0');
});

const reads = (morning: StoryCandidate[]): PoolReads => ({
  morning: async () => ({ reels: morning.filter((c) => c.origin === 'reels'), carousel: morning.filter((c) => c.origin === 'carousel') }),
  numbers: async () => ({ numbers: [], unbriefed: [] }),
  leads: async () => [{ origin: 'catalog', ref: 'gimp', name: 'GIMP', url: 'https://gimp.org', description: 'Free image editor' }],
});

test('pool refresh: Morning Download orders both sources on the news scale and stores each breakdown', async () => {
  const { db } = await openLocalStoriesDb();
  const doom = cand('Experts warn AI could take your job by 2030', 'reels');
  const news = cand('Google launches Gemini 4 for every Workspace user', 'carousel');
  await refreshStoryPool(db, reads([doom, news]), NOW);
  assert.deepEqual((await openPool(db, 'morning_download')).stories.map((s) => s.key), [news.key, doom.key], 'news first, whatever the source order');
  const { rows } = await db.query<{ series: string; key: string; origin: string; ref: string; title: string; score: number; payload: { source: string; breakdown: unknown; story?: unknown } }>(
    `SELECT series, key, origin, ref, title, score, payload FROM stories.pool ORDER BY series, score DESC`,
  );
  for (const row of rows) assert.ok(row.payload.breakdown, `${row.series} ${row.key} carries a breakdown`);

  // The hub reads the stored breakdown, labels Morning Download as a news score, and keeps source rank for the rest.
  const ideas = storyIdeas(rows.map((r, i) => ({ pool_id: String(i), series: r.series, key: r.key, origin: r.origin, ref: r.ref, title: r.title, source: r.payload.source, score: r.score, refreshed_at: NOW.toISOString(), breakdown: r.payload.breakdown as never })));
  const md = ideas.filter((i) => i.group === 'Morning Download');
  assert.equal(md[0]!.scoreLabel, 'News score (0–1)');
  assert.ok(md.every((i) => i.breakdown?.parts.length));
  assert.equal(ideas.find((i) => i.group === 'Free vs. Paid')!.scoreLabel, 'Source rank');
  assert.equal(ideas.find((i) => i.group === 'Free vs. Paid')!.breakdown!.parts[1]!.detail, '#1 of 1');
});

test('hub: a Morning Download row refreshed before the news score is scored on read, as of its refresh', () => {
  const [idea] = storyIdeas([{
    pool_id: '1', series: 'morning_download', key: 'k', origin: 'reels', ref: 'r', title: 'AI could end humanity, warns founder', source: null, score: 1,
    refreshed_at: NOW.toISOString(), story: { origin: 'reels', headline: 'AI could end humanity, warns founder', publishedAt: hoursAgo(5) },
  }]);
  assert.ok(idea!.score! < 1, 'the old source-rank 1.00 is replaced');
  assert.ok(idea!.breakdown!.parts.some((p) => p.label === 'Speculation'));
});

test('major-news@2: weights reward events and the news kinds, take points for speculation, and match the question set', () => {
  assert.deepEqual(Object.keys(MAJOR_NEWS_WEIGHTS).sort(), Object.keys(MAJOR_NEWS.questions).sort(), 'one weight per question');
  const positive = Object.values(MAJOR_NEWS_WEIGHTS).filter((w) => w > 0).reduce((a, b) => a + b, 0);
  assert.equal(Number(positive.toFixed(4)), 1);
  const yes = (ids: string[]) => Object.fromEntries(Object.keys(MAJOR_NEWS_WEIGHTS).map((k) => [k, { noul: ids.includes(k) ? 1 : 0 }]));
  const event = majorNewsScore(yes(['happened', 'news_kind', 'blockbuster_entity']));
  const doom = majorNewsScore(yes(['blockbuster_entity', 'global_relevance', 'speculative']));
  assert.ok(event > doom);
  assert.equal(majorNewsScore.length, 1, 'the source is not an input');
  assert.equal(majorNewsScore(yes(['speculative'])), 0, 'never below 0');
});

test('Text on Screen breakdown: parts add up to the net', () => {
  const row = {
    post_idea_id: 'p', headline: 'h', net: '2.25', rank: 1, selected: true, origin: 'timely', scored_at: NOW.toISOString(), published: null, scheduled: false, has_video: false, video_count: 0, last_video_at: null,
    psychology: 0.75, bucket_score: 0.5, value_score: 0.6, blockbuster: 0.05, chosen_bucket: 'the_saga', chosen_framework: 'curiosity',
    components: { useful: { score: 0.6 }, knowledge: { score: 0.4 }, entertainment: { score: 0.3 }, blockbusterNouls: { frontierDrop: 0.9, company: 0.2, person: 0.1 } },
  } satisfies ReelIdeaRow;
  const b = reelBreakdown(row)!;
  assert.equal(Number(sum(b.parts).toFixed(3)), 2.25);
  assert.deepEqual(b.parts.map((p) => p.label), ['Psychology', 'Bucket fit ×0.5', 'Value ×2', 'Blockbuster']);
  assert.equal(b.parts[2]!.detail, 'Useful: 0.60');
  assert.equal(b.parts[3]!.detail, 'frontier model');
});

test('Explainers breakdown: six judge scores add up to the weighted score', () => {
  const row = {
    topic_id: 't', title: 'How attention works', scope: null, status: 'pool', origin: 'generated', weighted_score: '75', created_at: NOW.toISOString(), ok_jobs: 0, last_render_at: null, published: false, scheduled: false,
    job_id: null, job_status: null, job_stage: null, job_error: null, job_requested_at: null, job_started_at: null,
    audience_fit: 3, teachability_45s: 3, analogy_potential: 3, visual_potential: 3, accuracy_under_simplification: 3, hook_strength: '3',
  } satisfies ExplainerTopicRow;
  const b = explainerBreakdown(row)!;
  assert.equal(b.parts.length, 6);
  assert.ok(Math.abs(sum(b.parts) - 75) < 0.02, `parts add to ${sum(b.parts)}`);
});

test('Carousels breakdown: the three score questions add up to the judge score; the gates and the real ranking order are explained', () => {
  const row = {
    story_id: 's', title: 't', url: null, score: '2.1', outlet_count: 3, run_started_at: null, post_count: 0, last_post_at: null, published: false, scheduled: false,
    answers: { why_it_matters: 0.9, sourcing: 0.8, photographable_subject: 0.4, ai_main_subject: 0.95, substance: 0.7 }, passes: 2,
  } satisfies CarouselIdeaRow;
  const b = carouselBreakdown(row)!;
  assert.equal(Number(sum(b.parts).toFixed(2)), 2.1);
  assert.equal(b.parts.filter((p) => p.points == null).length, 2, 'gates add nothing');
  assert.match(b.note!, /passed \(2 of 3\).*outlets \(3\)/);
  assert.equal(carouselBreakdown({ ...row, answers: null }), null);
});
