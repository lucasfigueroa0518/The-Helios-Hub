/**
 * The Stories pool and its bench (offline: PGlite and canned source reads,
 * no Claude, no web search). Covers: one ranked bench list with a series tag
 * on each row; a skipped set with no frames is never "ready"; a refresh keeps
 * used ideas used and drops an unused idea it did not bring back.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { MADE_LABEL, STORY_SERIES, typeHubModel } from '@/lib/content-type/model';
import { buildDataset } from '@/lib/social-hub/dataset';
import type { StoriesRead, StoryPoolRow, StorySetRow } from '@/lib/social-hub/queries/stories';
import { openLocalStoriesDb } from '@/lib/stories/local-db';
import { leadKeysForPair, markPoolUsed, openPool, poolDay, refreshPoolIfDue, refreshStoryPool, type PoolReads } from '@/lib/stories/pool';
import { recordHistory } from '@/lib/stories/repository';
import type { StoryCandidate } from '@/lib/stories/sources/reels';

const NOW = new Date('2026-10-09T14:00:00Z'); // 10:00 AM New York

const story = (slug: string, origin: 'reels' | 'carousel' = 'reels'): StoryCandidate => ({
  key: `news.test/${slug}`,
  origin,
  ref: slug,
  headline: `Headline ${slug}`,
  sourceName: 'News Test',
  url: `https://news.test/${slug}`,
  body: 'body',
  publishedAt: null,
  nativeScore: 1,
});

const reads = (morning: StoryCandidate[]): PoolReads => ({
  morning: async () => ({ reels: morning.filter((c) => c.origin === 'reels'), carousel: morning.filter((c) => c.origin === 'carousel') }),
  numbers: async () => ({ numbers: [], unbriefed: [] }),
  leads: async () => [{ origin: 'catalog', ref: 'gimp', name: 'GIMP', url: 'https://gimp.org', description: 'Free image editor' }],
});

async function poolRows(db: Awaited<ReturnType<typeof openLocalStoriesDb>>['db']) {
  const { rows } = await db.query<{ series: string; key: string; used: boolean }>(`SELECT series, key, used_at IS NOT NULL AS used FROM stories.pool ORDER BY series, key`);
  return rows;
}

test('pool refresh: used keys stay used, an unused key the refresh did not return drops', async () => {
  const { db } = await openLocalStoriesDb();
  await refreshStoryPool(db, reads([story('a'), story('b'), story('c', 'carousel')]), NOW);
  assert.deepEqual((await openPool(db, 'morning_download')).stories.map((s) => s.key).sort(), ['news.test/a', 'news.test/b', 'news.test/c']);

  // a ran in a set (stories.history); b was chosen by a build.
  await recordHistory(db, 'morning_download', ['news.test/a'], null);
  assert.equal(await markPoolUsed(db, 'morning_download', ['news.test/b'], NOW), 1);

  // The next night's refresh brings back a and b but not c.
  const next = new Date(NOW.getTime() + 86_400_000);
  const r = await refreshStoryPool(db, reads([story('a'), story('b')]), next);
  assert.equal(r.dropped, 1);
  const rows = await poolRows(db);
  assert.deepEqual(rows.filter((x) => x.series === 'morning_download'), [
    { series: 'morning_download', key: 'news.test/a', used: true },
    { series: 'morning_download', key: 'news.test/b', used: true },
  ]);
  assert.deepEqual((await openPool(db, 'morning_download')).stories, [], 'used ideas never come back as open');

  // A series whose source could not be read keeps its list (it ages out on its freshness window instead).
  const broken: PoolReads = { ...reads([]), leads: async () => { throw new Error('reels.sources unreachable'); } };
  const kept = await refreshStoryPool(db, broken, new Date(next.getTime() + 86_400_000));
  assert.match(kept.errors.join(), /free_vs_paid/);
  assert.equal((await openPool(db, 'free_vs_paid')).leads.length, 1);
});

test('pool refresh runs once per pool day, which turns over at 4:00 AM New York', async () => {
  const { db } = await openLocalStoriesDb();
  let calls = 0;
  const counted = () => (calls++, reads([story('a')]));
  assert.ok(await refreshPoolIfDue(db, counted, NOW));
  assert.equal(await refreshPoolIfDue(db, counted, new Date(NOW.getTime() + 3_600_000)), null);
  assert.equal(calls, 1);
  assert.equal(poolDay(new Date('2026-10-10T07:30:00Z')), '2026-10-09', '3:30 AM is still the previous pool day');
  assert.equal(poolDay(new Date('2026-10-10T08:30:00Z')), '2026-10-10');
  assert.ok(await refreshPoolIfDue(db, counted, new Date('2026-10-10T08:30:00Z')));
  assert.equal(calls, 2);
});

test('Free vs. Paid: a chosen pair uses up the leads it came from', () => {
  const leads = [
    { origin: 'catalog' as const, ref: '1', name: 'GIMP', url: 'https://www.gimp.org/', description: '' },
    { origin: 'github' as const, ref: '2', name: 'ollama/ollama', url: 'https://github.com/ollama/ollama', description: '' },
    { origin: 'catalog' as const, ref: '3', name: 'Inkscape', url: 'https://inkscape.org', description: '' },
  ];
  assert.deepEqual(leadKeysForPair(leads, { paid_tool: 'Photoshop', free_tool: 'GIMP', free_url: 'https://gimp.org/downloads' }), ['gimp.org']);
});

const set = (over: Partial<StorySetRow>): StorySetRow => ({
  set_id: '00000000-0000-4000-8000-000000000001', series: 'free_vs_paid', ny_date: '2026-10-08', status: 'skipped', trigger: 'auto', style: 'homemade',
  payload: { candidates: 0 }, publish_at: null, flagged: false, error: null, spend_usd: '0', approved_at: null, published_at: null,
  built_at: '2026-10-08T08:00:00Z', created_at: '2026-10-08T08:00:00Z', feedback_verdict: null, feedback_tags: null, chosen_origins: null, ...over,
});

const pool = (series: string, titles: string[]): StoryPoolRow[] =>
  titles.map((title, i) => ({ pool_id: `${series}-${i}`, series, key: `${series}-${i}`, origin: 'reels', ref: String(i), title, source: null, score: (titles.length - i) / titles.length, refreshed_at: '2026-10-09T08:00:00Z' }));

function storiesModel(read: StoriesRead) {
  const dataset = buildDataset({ reels: new Error('x'), explainers: new Error('x'), carousels: new Error('x'), stories: read }, null, NOW);
  return typeHubModel(dataset, 'stories', NOW);
}

test('Stories bench: one list, every row tagged with its series, ranked within its series', () => {
  const model = storiesModel({
    sets: [], frames: [], insights: [],
    pool: [...pool('morning_download', ['m1', 'm2', 'm3']), ...pool('guess_the_number', ['g1']), ...pool('free_vs_paid', ['f1', 'f2'])],
  });
  assert.equal(model.bench.length, 6, 'one flat list holds every series');
  for (const row of model.bench) assert.ok(STORY_SERIES.includes(row.idea.group as never), `${row.idea.title} has a series tag`);
  // Series take turns; ranks count within a series, never against another series' scores.
  assert.deepEqual(model.bench.map((b) => `${b.idea.title}#${b.rank}`), ['m1#1', 'g1#1', 'f1#1', 'm2#2', 'f2#2', 'm3#3']);
});

test('a skipped set with no frames is not ready content: no chip, no row, not on the day strip', () => {
  const skipped = set({});
  // More ready sets on one day than it has slots: the extra ones wait on the bench.
  const ready = [1, 2, 3, 4, 5].map((n) => set({ set_id: `00000000-0000-4000-8000-00000000001${n}`, series: 'morning_download', status: 'ready', ny_date: '2026-10-07', payload: { stories: [{ headline: `Made ${n}` }] } }));
  const model = storiesModel({
    sets: [skipped, ...ready],
    frames: ready.map((r, i) => ({ frame_id: `f${i}`, set_id: r.set_id, seq: 1, role: 'opener', template: null, backdrop: 'black', storage_path: `sets/${i}/1.jpg`, flagged: false, ig_media_id: null, published_at: null })),
    insights: [],
    pool: [],
  });
  const onDays = model.days.flatMap((d) => d.cards.map((c) => c.post.refs.setId));
  assert.ok(!onDays.includes(skipped.set_id), 'skipped stays off the day strip');
  assert.ok(!model.bench.some((b) => b.card?.post.refs.setId === skipped.set_id), 'skipped empty set gets no bench row');
  const waiting = model.bench.filter((b) => b.card);
  assert.ok(waiting.length > 0, 'the overflow ready sets wait on the bench');
  for (const b of waiting) {
    assert.equal(b.made, 'frames');
    assert.equal(MADE_LABEL[b.made], 'Stories ready');
    assert.equal(b.idea.group, 'Morning Download');
  }
  assert.equal(onDays.length + waiting.length, ready.length, 'every ready set with frames is on its day or on the bench');
});

test('a ready set whose frames never rendered gets no made chip either', () => {
  const empty = set({ set_id: '00000000-0000-4000-8000-000000000021', series: 'guess_the_number', status: 'ready', ny_date: '2026-10-07' });
  const model = storiesModel({
    sets: [empty],
    frames: [{ frame_id: 'f', set_id: empty.set_id, seq: 1, role: 'intro', template: null, backdrop: 'black', storage_path: null, flagged: false, ig_media_id: null, published_at: null }],
    insights: [],
    pool: [],
  });
  assert.ok(!model.days.some((d) => d.cards.some((c) => c.post.refs.setId === empty.set_id)));
  assert.ok(!model.bench.some((b) => b.card?.post.refs.setId === empty.set_id));
});
