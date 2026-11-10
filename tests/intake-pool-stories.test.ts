/**
 * The IG Stories pool on the central intake (lib/intake/pool-stories.ts) and
 * the per-series consumer switch (lib/stories/pool-intake.ts). Offline: the
 * intake reads, the posted check and the legacy reads are stubs; no Jev, no
 * Claude, no web.
 *
 * Each read is checked against the legacy rule it mirrors: Warning / Callout
 * out, a blockbuster below the top 10 in, a posted story out, The Number and
 * Ball Knowledge buckets, a GitHub Trending lead, no brief numbers.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { intakePoolReads, type IntakePoolDeps } from '@/lib/intake/pool-stories';
import type { IntakeItem, IntakeJev, ListStoriesInput, ScoredStory } from '@/lib/intake/types';
import type { InterpretedScore } from '@/lib/reels/scoring/interpret';
import { SHORTLIST_MAX } from '@/lib/social/ingest/select/rank';
import { openLocalStoriesDb } from '@/lib/stories/local-db';
import { refreshStoryPool, type PoolReads } from '@/lib/stories/pool';
import { readPoolModes, storiesPoolReads } from '@/lib/stories/pool-intake';
import type { StoryCandidate } from '@/lib/stories/sources/reels';

const NOW = new Date('2026-11-09T08:00:00Z'); // 3:00 AM New York
const MAIN = new Date('2026-11-09T05:00:00Z'); // tonight's main run (12:00 AM)
const TOPUP = new Date('2026-11-09T07:40:00Z'); // 2:40 AM
const H = 3_600_000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * H);

let n = 0;
function item(o: Partial<IntakeItem> & { url: string; family: IntakeItem['family'] }): IntakeItem {
  return {
    key: o.url, sourceId: o.family === 'feeds' ? 'feed:test' : 'hacker-news', sourceName: o.family === 'feeds' ? 'Feed Outlet' : 'Reels Outlet', sourceType: 'feed' as IntakeItem['sourceType'],
    headline: `Headline ${o.url}`, body: `Body of ${o.url}`, publishTime: ago(5), firstSeenAt: ago(5), lastSeenAt: ago(5), engagement: null, dropReason: null, storyId: null, role: 'primary',
    ...o,
  };
}

const reelsScore = (net: number, o: { blockbuster?: number; bucket?: string | null } = {}) => ({ net, blockbuster: o.blockbuster ?? 0, chosenBucket: o.bucket ?? 'the_shift' }) as unknown as InterpretedScore;
const qualified = (probSum: number, o: { status?: 'qualified' | 'not-qualified'; field?: number } = {}) => ({ kind: 'story-scoring' as const, status: o.status ?? 'qualified', probSum, outletCount: 1, answers: { field_shift: o.field ?? 0.9, industry_power: 0.6, must_know: 0.1 } });

function story(o: { id?: string; members: IntakeItem[]; lastJoinedAt?: Date; firstSeenAt?: Date; reels?: InterpretedScore; ss?: ReturnType<typeof qualified>; major?: number; builder?: number }): ScoredStory {
  const id = o.id ?? `s${++n}`;
  const members = o.members.map((m) => ({ ...m, storyId: id }));
  return {
    id, representativeKey: members[0]!.key, headline: members[0]!.headline, firstSeenAt: o.firstSeenAt ?? o.lastJoinedAt ?? ago(5), lastJoinedAt: o.lastJoinedAt ?? ago(5), mergedInto: null, members,
    scores: { ...(o.reels ? { 'reels-score': o.reels } : {}), ...(o.ss ? { 'story-scoring': o.ss } : {}), ...(o.major !== undefined ? { 'major-news': o.major } : {}), ...(o.builder !== undefined ? { 'story-builder': o.builder } : {}) },
    eventDate: members[0]!.publishTime, yours: false,
  };
}
const reelsStory = (slug: string, net: number, o: { blockbuster?: number; bucket?: string | null; joined?: Date; seen?: Date; first?: Date } = {}) =>
  story({ id: slug, members: [item({ url: `https://r.test/${slug}`, family: 'reels', firstSeenAt: o.first ?? o.seen ?? o.joined ?? ago(2), lastSeenAt: o.seen ?? o.joined ?? ago(2) })], lastJoinedAt: o.joined ?? ago(2), reels: reelsScore(net, o) });
const feedStory = (slug: string, probSum: number, o: { joined?: Date; status?: 'qualified' | 'not-qualified'; headline?: string } = {}) =>
  story({ id: slug, members: [item({ url: `https://f.test/${slug}`, family: 'feeds', headline: o.headline ?? `Headline ${slug}` })], lastJoinedAt: o.joined ?? ago(2), ss: qualified(probSum, o) });

/** listStories by the contract: window on lastJoinedAt / firstSeenAt, families, needed scores. */
function fakeList(all: ScoredStory[], seen: ListStoriesInput[] = []) {
  return async (_q: unknown, input: ListStoriesInput) => {
    seen.push(input);
    return all.filter(
      (s) =>
        (s.lastJoinedAt >= input.since || s.firstSeenAt >= input.since) &&
        (!input.families || s.members.some((m) => input.families!.includes(m.family))) &&
        (!input.needScores || input.needScores.every((k) => k in s.scores)),
    );
  };
}

const JEV = { usd: 0, calls: 0 } as unknown as IntakeJev;
const q = { query: async () => ({ rows: [] }) };

function deps(all: ScoredStory[], o: Partial<IntakePoolDeps> & { posted?: string[]; flagged?: string[] } = {}) {
  const checked: string[][] = [];
  const d: IntakePoolDeps = {
    jev: JEV,
    listStories: fakeList(all),
    lastRuns: async () => ({ main: { id: 'm', startedAt: MAIN }, topup: { id: 't', startedAt: TOPUP } }),
    readCarouselPosted: async () => o.posted ?? ['A story we posted'],
    postedCheck: async (stories, headlines, jev) => {
      assert.equal(jev, JEV);
      assert.ok(headlines.length);
      checked.push(stories.map((s) => s.id));
      return new Set(o.flagged ?? []);
    },
    ...o,
  };
  return { d, checked };
}

const keys = (list: Array<{ key: string }>) => list.map((c) => c.key);

/* ── Morning Download ─────────────────────────────────────────────── */

test('morning().reels ↔ morningDownloadReels: timely only, no Warning or Callout, top 10 by net plus every blockbuster', async () => {
  const top = Array.from({ length: 12 }, (_, i) => reelsStory(`n${i}`, 20 - i)); // nets 20..9
  const all = [
    ...top,
    reelsStory('warning', 99, { bucket: 'the_warning' }),
    reelsStory('callout', 98, { bucket: 'the_callout' }),
    reelsStory('yesterday', 97, { joined: ago(10) }), // last joined before tonight's main run: not timely
    reelsStory('blockbuster', 1, { blockbuster: 2 }), // 15th by net, but a blockbuster
    // Legacy parity: first seen days ago and joined long ago, but its link was seen again tonight: timely.
    reelsStory('reseen', 0, { blockbuster: 1, joined: ago(30), first: ago(30), seen: ago(1) }),
  ];
  const { morning } = intakePoolReads(q, NOW, deps(all).d);
  const { reels } = await morning();
  assert.deepEqual(keys(reels), [...top.slice(0, 10).map((s) => `r.test/${s.id}`), 'r.test/blockbuster', 'r.test/reseen']);
  const first = reels[0]!;
  assert.equal(first.origin, 'reels');
  assert.equal(first.nativeScore, 20);
  assert.equal(first.url, 'https://r.test/n0');
  assert.equal(first.sourceName, 'Reels Outlet');
  assert.equal(reels.at(-2)!.blockbuster, 2);
  assert.equal(first.intake?.storyId, 'n0');
});

test('morning().carousel ↔ morningDownloadCarousel: qualified in the last 30 h, posted story removed, passes as native score', async () => {
  const all = [
    feedStory('low', 1),
    feedStory('high', 4),
    feedStory('posted', 5),
    feedStory('notq', 9, { status: 'not-qualified' }),
    feedStory('old', 9, { joined: ago(31) }),
  ];
  const { d, checked } = deps(all, { flagged: ['posted'] });
  const { carousel } = await intakePoolReads(q, NOW, d).morning();
  assert.deepEqual(keys(carousel), ['f.test/high', 'f.test/low'], 'rank order (probSum), posted and not-qualified and old gone');
  assert.deepEqual(checked, [['low', 'high', 'posted']], 'the posted check sees the qualified stories only');
  assert.equal(carousel[0]!.origin, 'carousel');
  assert.equal(carousel[0]!.nativeScore, 2, 'passes: field_shift and industry_power reach BONUS_MIN');
  assert.equal(carousel[0]!.sourceName, 'Feed Outlet');
});

test('morning(): no posted headlines → no Jev needed; a carousel post photo comes along (S-29)', async () => {
  const all = [feedStory('pic', 3)];
  const { d, checked } = deps(all, { posted: [], jev: undefined, carouselPhotos: async () => new Map([['f.test/pic', { url: 'https://img.test/p.jpg', credit: 'Photo: X', storyId: 'https://f.test/pic' }]]) });
  const { carousel } = await intakePoolReads(q, NOW, d).morning();
  assert.deepEqual(checked, []);
  assert.deepEqual(carousel[0]!.photo, { url: 'https://img.test/p.jpg', credit: 'Photo: X' });
  assert.equal(carousel[0]!.ref, 'https://f.test/pic');
});

/* ── Guess the Number ─────────────────────────────────────────────── */

test('numbers(): no brief numbers; the day\'s shortlist (rank, company spread, top 25) then The Number ideas, 7 days', async () => {
  const day = ago(2);
  const shortlist = Array.from({ length: SHORTLIST_MAX + 2 }, (_, i) => feedStory(`c${i}`, 100 - i, { joined: day, headline: i < 3 ? `OpenAI news ${i}` : `Story ${i}` }));
  const all = [
    ...shortlist,
    feedStory('older', 1, { joined: ago(8 * 24) }), // outside 7 days
    feedStory('notq', 200, { status: 'not-qualified', joined: day }),
    reelsStory('num1', 5, { bucket: 'the_number' }),
    reelsStory('num-old', 9, { bucket: 'the_number', joined: ago(8 * 24) }),
    reelsStory('shift', 9),
  ];
  const { numbers, unbriefed } = await intakePoolReads(q, NOW, deps(all).d).numbers();
  assert.deepEqual(numbers, []);
  const got = keys(unbriefed);
  assert.equal(got.length, SHORTLIST_MAX + 1);
  // SPREAD_PER_COMPANY: the third OpenAI story waits just below the first 10 places.
  assert.deepEqual(got.slice(0, 3), ['f.test/c0', 'f.test/c1', 'f.test/c3']);
  assert.equal(got[10], 'f.test/c2');
  assert.ok(!got.includes('f.test/c25') && !got.includes('f.test/c26'), 'the shortlist stops at 25');
  assert.equal(got.at(-1), 'r.test/num1');
  assert.ok(!got.includes('f.test/older') && !got.includes('r.test/num-old') && !got.includes('r.test/shift'));
});

/* ── Free vs. Paid ────────────────────────────────────────────────── */

test('leads() ↔ freeToolLeads: Ball Knowledge (14 days) and GitHub Trending items', async () => {
  const all = [
    reelsStory('bk', 3, { bucket: 'ball_knowledge' }),
    reelsStory('bk-old', 3, { bucket: 'ball_knowledge', joined: ago(15 * 24) }),
    reelsStory('num', 3, { bucket: 'the_number' }),
  ];
  // Fix 6: GitHub Trending is read from that source's items (no story needed, any drop reason), 14 days, newest first.
  const repo = item({ url: 'https://github.com/a/tool', family: 'reels', sourceId: 'github-trending', headline: 'a/tool', firstSeenAt: ago(30) });
  const dropped = item({ url: 'https://github.com/b/lib', family: 'reels', sourceId: 'github-trending', headline: 'b/lib', firstSeenAt: ago(40), dropReason: 'off_topic', storyId: null, role: null });
  const old = item({ url: 'https://github.com/c/old', family: 'reels', sourceId: 'github-trending', headline: 'c/old', firstSeenAt: ago(15 * 24) });
  const asked: Array<[string, Date, number]> = [];
  const listSourceItems = async (_q: unknown, sourceId: string, since: Date, limit: number) => {
    asked.push([sourceId, since, limit]);
    return [repo, dropped, old];
  };
  const leads = await intakePoolReads(q, NOW, { ...deps(all).d, listSourceItems }).leads();
  assert.deepEqual(leads.map((l) => [l.origin, l.url]), [['reels', 'https://r.test/bk'], ['github', 'https://github.com/a/tool'], ['github', 'https://github.com/b/lib']]);
  assert.equal(leads[1]!.name, 'a/tool');
  assert.equal(asked[0]![0], 'github-trending');
  assert.equal(asked[0]![1].toISOString(), ago(14 * 24).toISOString());
});

test('listSourceItems: one source, a window, no drop filter, newest first (PGlite)', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const { listSourceItems } = await import('@/lib/intake/read');
  const pg = new PGlite();
  const sql = readFileSync(path.join(process.cwd(), 'db', 'intake_schema.sql'), 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');
  await pg.exec(sql);
  const db = { query: async (text: string, params?: unknown[]) => ({ rows: (await pg.query(text, params as unknown[])).rows as never[] }) };
  const put = (key: string, source: string, seen: Date, drop: string | null) =>
    pg.query(`INSERT INTO intake.items (key, family, source_id, source_name, source_type, headline, url, first_seen_at, drop_reason) VALUES ($1, 'reels', $2, 'GH', 'A2', $1, $1, $3, $4)`, [key, source, seen, drop]);
  await put('https://github.com/a/new', 'github-trending', ago(2), null);
  await put('https://github.com/a/dropped', 'github-trending', ago(5), 'off_topic');
  await put('https://github.com/a/old', 'github-trending', ago(20 * 24), null);
  await put('https://example.com/other', 'hacker-news', ago(1), null);
  const got = await listSourceItems(db, 'github-trending', ago(14 * 24), 15);
  assert.deepEqual(got.map((m) => m.key), ['https://github.com/a/new', 'https://github.com/a/dropped']);
  await pg.close();
});

test('carouselRunAt(): the last successful intake run start', async () => {
  assert.equal(await intakePoolReads(q, NOW, deps([]).d).carouselRunAt!(), TOPUP.toISOString());
  const none = intakePoolReads(q, NOW, { ...deps([]).d, lastRuns: async () => ({ main: null, topup: null }) });
  assert.equal(await none.carouselRunAt!(), null);
  assert.deepEqual((await none.morning()).reels, [], 'no main run: nothing is timely');
});

/* ── the consumer switch ──────────────────────────────────────────── */

const cand = (key: string): StoryCandidate => ({ key, origin: 'reels', ref: key, headline: key, sourceName: 'Test', url: `https://${key}`, body: '', publishedAt: null, nativeScore: 1 });
const marked = (tag: string): PoolReads => ({
  morning: async () => ({ reels: [cand(`${tag}/md`)], carousel: [] }),
  numbers: async () => ({ numbers: [], unbriefed: [cand(`${tag}/gtn`)] }),
  leads: async () => [{ origin: 'catalog', ref: tag, name: tag, url: `https://${tag}.test/fvp`, description: '' }],
  carouselRunAt: async () => (tag === 'legacy' ? '2026-11-09T07:10:00.000Z' : TOPUP.toISOString()),
});

test('switch: legacy and stale-fallback read today\'s sources; intake reads the intake; an unreadable mode is legacy', async () => {
  const modes = { md: 'intake', gtn: 'stale-fallback', fvp: 'legacy' } as const;
  const reads = storiesPoolReads(q as never, NOW, { readMode: async (_q, order) => modes[order as keyof typeof modes], legacyReads: () => marked('legacy'), intakeReads: () => marked('intake') });
  assert.equal((await reads.morning()).reels[0]!.key, 'intake/md');
  assert.equal((await reads.numbers()).unbriefed[0]!.key, 'legacy/gtn', 'stale fallback reads today\'s sources');
  assert.equal((await reads.leads())[0]!.ref, 'legacy');
  assert.equal(await reads.carouselRunAt!(), TOPUP.toISOString(), 'the newer of the carousel and intake runs');
  assert.deepEqual(await readPoolModes(q, NOW, async () => { throw new Error('intake.settings missing'); }), { md: 'legacy', gtn: 'legacy', fvp: 'legacy' });

  const all = storiesPoolReads(q as never, NOW, { readMode: async () => 'legacy', legacyReads: () => marked('legacy'), intakeReads: () => marked('intake') });
  assert.equal((await all.morning()).reels[0]!.key, 'legacy/md');
  assert.equal(await all.carouselRunAt!(), '2026-11-09T07:10:00.000Z', 'all legacy: the carousel run only');
});

test('switch: the pool refresh records which source each series read', async () => {
  const { db } = await openLocalStoriesDb();
  const modes = { md: 'intake', gtn: 'legacy', fvp: 'stale-fallback' } as const;
  const reads = storiesPoolReads(db, NOW, { readMode: async (_q, order) => modes[order as keyof typeof modes], legacyReads: () => marked('legacy'), intakeReads: () => marked('intake') });
  const r = await refreshStoryPool(db, reads, NOW);
  assert.deepEqual(r.intake, modes);
  const { rows } = await db.query<{ value: { intake?: unknown } }>(`SELECT value FROM stories.settings WHERE key = 'pool_refreshed'`);
  assert.deepEqual(rows[0]!.value.intake, modes);
});

test('switch: a series whose intake read throws reads today\'s sources, recorded error-fallback; the others are untouched (fix 7)', async () => {
  const { db } = await openLocalStoriesDb();
  const broken = (): PoolReads => ({ ...marked('intake'), morning: async () => { throw new Error('intake.scores is missing'); } });
  const reads = storiesPoolReads(db, NOW, { readMode: async () => 'intake', legacyReads: () => marked('legacy'), intakeReads: broken });
  assert.equal((await reads.morning()).reels[0]!.key, 'legacy/md', 'Morning Download falls back');
  assert.equal((await reads.numbers()).unbriefed[0]!.key, 'intake/gtn', 'Guess the Number stays on the intake');
  const r = await refreshStoryPool(db, storiesPoolReads(db, NOW, { readMode: async () => 'intake', legacyReads: () => marked('legacy'), intakeReads: broken }), NOW);
  assert.deepEqual(r.intake, { md: 'error-fallback', gtn: 'intake', fvp: 'intake' });
});

/* ── seeds ────────────────────────────────────────────────────────── */

test('seed: a Morning Download story seed with a link goes to the intake only in intake mode, and never fails the seed', async () => {
  const { seedIdea } = await import('@/lib/stories/seed');
  const { openPool } = await import('@/lib/stories/pool');
  const { db } = await openLocalStoriesDb();
  const seeded = story({ id: 'seed-story', members: [item({ url: 'https://x.test/seed', family: 'seed' })], major: 0.7, builder: 0.65 });
  const calls: string[] = [];
  const intake = (mode: 'intake' | 'legacy', fail = false) => ({
    q, seededBy: 'lucas@test', readMode: async () => mode, jev: () => JEV, listStories: fakeList([seeded]),
    addSeed: async (_q: unknown, _j: unknown, input: { order: string; url: string }) => {
      calls.push(`${input.order} ${input.url}`);
      if (fail) throw new Error('page unreadable');
      return { storyId: 'seed-story', created: true };
    },
  });
  await seedIdea(db, { series: 'morning_download', headline: 'A seeded story', url: 'https://x.test/seed' }, NOW, intake('intake'));
  await seedIdea(db, { series: 'morning_download', headline: 'Legacy seed', url: 'https://x.test/legacy' }, NOW, intake('legacy'));
  await seedIdea(db, { series: 'morning_download', headline: 'Broken seed', url: 'https://x.test/broken' }, NOW, intake('intake', true));
  await seedIdea(db, { series: 'free_vs_paid', toolName: 'GIMP', url: 'https://gimp.org' }, NOW, intake('intake'));
  assert.deepEqual(calls, ['md https://x.test/seed', 'md https://x.test/broken'], 'legacy mode and tool seeds stay Stories-only');
  const stories = (await openPool(db, 'morning_download')).stories;
  assert.equal(stories.length, 3, 'every seed landed, the failed hand-off too');
  assert.deepEqual(stories.find((s) => s.headline === 'A seeded story')!.intake, { storyId: 'seed-story', major: 0.7, builder: 0.65, eventDate: seeded.eventDate!.toISOString(), memberKeys: ['x.test/seed'] });
  assert.equal(stories.find((s) => s.headline === 'Broken seed')!.intake, undefined);
});
