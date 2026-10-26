/**
 * Idea seeding, Stories (spec 2026-10-21-idea-seeding-design), offline on PGlite with the real stories schema: a typed story,
 * number or tool becomes a pool row with no model or web call; the nightly refresh and the 30 cap never drop it; the build
 * reads it like any idea; a used tool seed is marked used; and a series holds only so many.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from '@/lib/stories/api';
import { leadKeysForPair, markPoolUsed, openPool, refreshStoryPool, type PoolReads } from '@/lib/stories/pool';
import { MAX_OPEN_SEEDS, isSeedKey, seedIdea, seedItem } from '@/lib/stories/seed';

import { harnessDb } from './stories-harness';

const NOW = new Date('2026-10-09T14:00:00Z');
const empty: PoolReads = { morning: async () => ({ reels: [], carousel: [] }), numbers: async () => ({ numbers: [], unbriefed: [] }), leads: async () => [] };
const refused = (fn: () => unknown, status: number, match: RegExp) => assert.throws(fn, (e: unknown) => e instanceof ApiError && e.status === status && match.test(e.message));

test('each series validates what it needs and says what is missing', () => {
  refused(() => seedItem({ series: 'nope' }, NOW), 400, /series/);
  refused(() => seedItem({ series: 'morning_download', headline: '  ' }, NOW), 400, /headline/);
  refused(() => seedItem({ series: 'morning_download', headline: 'A story', url: 'ftp://x' }, NOW), 400, /http/);
  refused(() => seedItem({ series: 'guess_the_number', value: '$3.9B' }, NOW), 400, /number and what it counts/);
  refused(() => seedItem({ series: 'free_vs_paid', toolName: 'GIMP' }, NOW), 400, /link/);
});

test('a story seed is scored on the news scale, a number or tool ranks mid-pool; all are keyed as seeds', () => {
  const story = seedItem({ series: 'morning_download', headline: 'OpenAI launches a new model', notes: 'It is faster.' }, NOW, 'a');
  assert.equal(story.key, 'seed:a');
  assert.ok(isSeedKey(story.key));
  assert.ok((story.score ?? 0) > 0, 'a news-kind headline scores like any story');
  assert.equal(story.payload.kind === 'story' && story.payload.story.body, 'It is faster.');
  assert.equal(seedItem({ series: 'guess_the_number', value: '$3.9B', fact: 'raised for AI data centers' }, NOW, 'b').score, 0.5);
  const tool = seedItem({ series: 'free_vs_paid', toolName: 'GIMP', url: 'https://gimp.org', description: 'Free image editor' }, NOW, 'c');
  assert.equal(tool.score, 0.5);
  assert.equal(tool.payload.kind === 'lead' && tool.payload.lead.name, 'GIMP');
});

test('a seed enters its series’ open pool and the build’s lists, with no model call', async () => {
  const { db } = await harnessDb();
  await seedIdea(db, { series: 'morning_download', headline: 'Anthropic ships a model', url: 'https://x.test/a' }, NOW);
  await seedIdea(db, { series: 'guess_the_number', value: '42%', fact: 'of teams use agents' }, NOW);
  await seedIdea(db, { series: 'free_vs_paid', toolName: 'GIMP', url: 'https://gimp.org' }, NOW);
  assert.deepEqual((await openPool(db, 'morning_download')).stories.map((s) => s.headline), ['Anthropic ships a model']);
  assert.deepEqual((await openPool(db, 'guess_the_number')).numbers.map((n) => n.value), ['42%']);
  assert.deepEqual((await openPool(db, 'free_vs_paid')).leads.map((l) => l.name), ['GIMP']);
});

test('the nightly refresh, the freshness window and the 30 cap never drop a seed', async () => {
  const { db } = await harnessDb();
  const { key } = await seedIdea(db, { series: 'morning_download', headline: 'A seeded story' }, NOW);
  const later = new Date(NOW.getTime() + 30 * 86_400_000);
  const story = (n: number) => ({ key: `news.test/${n}`, origin: 'reels' as const, ref: `${n}`, headline: `Headline ${n}`, sourceName: 'T', url: `https://news.test/${n}`, body: 'b', publishedAt: null, nativeScore: 1 });
  await refreshStoryPool(db, { ...empty, morning: async () => ({ reels: Array.from({ length: 40 }, (_, i) => story(i)), carousel: [] }) }, later);
  const left = (await db.query<{ key: string }>(`SELECT key FROM stories.pool WHERE series = 'morning_download' AND used_at IS NULL`)).rows.map((r) => r.key);
  assert.ok(left.includes(key), 'still there after a refresh a month later that did not return it, and a cap of 30');
});

test('a used tool seed is marked used (its pool key is the seed key, not its link)', async () => {
  const { db } = await harnessDb();
  const { key } = await seedIdea(db, { series: 'free_vs_paid', toolName: 'GIMP', url: 'https://gimp.org' }, NOW);
  const pool = await openPool(db, 'free_vs_paid');
  const used = leadKeysForPair(pool.leads, { free_tool: 'GIMP', free_url: 'https://gimp.org' });
  assert.deepEqual(used, [key]);
  assert.equal(await markPoolUsed(db, 'free_vs_paid', used, NOW), 1);
  assert.equal((await openPool(db, 'free_vs_paid')).leads.length, 0);
});

test('a series holds only so many seeds; the next is refused plainly, another series is unaffected', async () => {
  const { db } = await harnessDb();
  for (let i = 0; i < MAX_OPEN_SEEDS; i++) await seedIdea(db, { series: 'morning_download', headline: `Story ${i}` }, NOW);
  await assert.rejects(() => seedIdea(db, { series: 'morning_download', headline: 'One too many' }, NOW), (e: unknown) => e instanceof ApiError && e.status === 409 && /make or archive one/.test(e.message));
  await seedIdea(db, { series: 'guess_the_number', value: '1', fact: 'a thing' }, NOW);
});

test('archiving a seed frees its place, so the cap never locks a series for good', async () => {
  const { db } = await harnessDb();
  const keys: string[] = [];
  for (let i = 0; i < MAX_OPEN_SEEDS; i++) keys.push((await seedIdea(db, { series: 'morning_download', headline: `Story ${i}` }, NOW)).key);
  await assert.rejects(() => seedIdea(db, { series: 'morning_download', headline: 'One too many' }, NOW), (e: unknown) => e instanceof ApiError && e.status === 409);
  await db.query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind) VALUES ('stories', $1, '2026-10-09', 'archive')`, [`stories:pool:morning_download:${keys[0]}`]);
  await seedIdea(db, { series: 'morning_download', headline: 'Now there is room' }, NOW);
});
