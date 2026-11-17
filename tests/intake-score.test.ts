/** Intake score cache and seeds (Owner B), on PGlite. Offline: stub scorecards and a stub Jev, no live calls. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { FVP_ORDER, GTN_ORDER, LFD_ORDER, MD_ORDER } from '@/lib/intake/orders';
import { listStories } from '@/lib/intake/read';
import { memberHash, orderCovers, scoreForStories } from '@/lib/intake/score';
import { INTAKE_SCORECARDS } from '@/lib/intake/scorecards';
import { makeAddIntakeSeed } from '@/lib/intake/seed';
import type { Family, IntakeJev, Scorecard, ScorecardId } from '@/lib/intake/types';

import { intakeDb, item, story, stubJev, uid } from './fixtures/intake/stubs';

/** A counting scorecard: no Jev, a fixed result. */
function card(id: ScorecardId, families: readonly Family[], version = `${id}@1`, opts: { capAfter?: number } = {}) {
  const seen: string[] = [];
  const c: Scorecard = {
    id,
    version,
    families,
    async score(s) {
      if (opts.capAfter !== undefined && seen.length >= opts.capAfter) {
        const e = new Error('cap');
        e.name = 'IntakeCapReached';
        throw e;
      }
      seen.push(s.id);
      await new Promise((r) => setTimeout(r, 1));
      return { answers: { x: 1 }, result: { kind: 'major-news', score: 0.5 }, usd: 0.001 };
    },
  };
  return { c, seen };
}

const noJev = {} as IntakeJev;

async function insertStory(q: Awaited<ReturnType<typeof intakeDb>>['q'], id: string) {
  await q.query(`INSERT INTO intake.stories (id, representative_key, headline, first_seen_at, last_joined_at) VALUES ($1::uuid, $1::text, $1::text, now(), now())`, [id]);
}

test('cache hit on an unchanged member set; re-score when a member joins; version bump re-scores', async () => {
  const { q } = await intakeDb();
  const S1 = uid(1);
  await insertStory(q, S1);
  const major = card('major-news', ['reels', 'feeds', 'search', 'seed']);
  const feedsOnly = card('story-scoring', ['feeds']);
  const s1 = story(S1, [item({ key: 'r1', family: 'reels', role: 'primary' }), item({ key: 'f1', family: 'feeds' })]);

  const first = await scoreForStories(q, noJev, [s1], [LFD_ORDER], [major.c, feedsOnly.c]);
  assert.equal(first['major-news'].scored, 1);
  assert.equal(first['story-scoring'].scored, 1);
  const row = (await q.query<{ member_hash: string; version: string }>(`SELECT member_hash, version FROM intake.scores WHERE story_id = $1 AND scorecard = 'major-news'`, [S1])).rows[0]!;
  assert.equal(row.member_hash, memberHash([{ key: 'f1' }, { key: 'r1' }]));

  const again = await scoreForStories(q, noJev, [s1], [LFD_ORDER], [major.c, feedsOnly.c]);
  assert.equal(again['major-news'].cached, 1);
  assert.equal(again['story-scoring'].cached, 1);
  assert.equal(major.seen.length, 1);

  // A reels member joins: major-news (all families) re-scores; story-scoring (feeds only) stays cached.
  const grown = story(S1, [...s1.members, item({ key: 'r2', family: 'reels' })]);
  const third = await scoreForStories(q, noJev, [grown], [LFD_ORDER], [major.c, feedsOnly.c]);
  assert.equal(third['major-news'].scored, 1);
  assert.equal(third['story-scoring'].cached, 1);

  const bumped = card('major-news', ['reels', 'feeds', 'search', 'seed'], 'major-news@99');
  const fourth = await scoreForStories(q, noJev, [grown], [LFD_ORDER], [bumped.c, feedsOnly.c]);
  assert.equal(fourth['major-news'].scored, 1);
  const rows = (await q.query(`SELECT 1 FROM intake.scores WHERE story_id = $1 AND scorecard = 'major-news'`, [S1])).rows;
  assert.equal(rows.length, 1);
});

test('only open orders that cover a member choose scorecards; an empty family subset gets no row', async () => {
  const { q } = await intakeDb();
  const F = uid(2);
  await insertStory(q, F);
  const reelsScore = card('reels-score', ['reels', 'search']);
  const storyScoring = card('story-scoring', ['feeds']);
  const s = story(F, [item({ key: 'f1', family: 'feeds', role: 'primary' })]);

  // FvP covers only reels adapters: a feeds-only story is not scored at all.
  const none = await scoreForStories(q, noJev, [s], [FVP_ORDER], [reelsScore.c, storyScoring.c]);
  assert.equal(none['reels-score'].scored + none['story-scoring'].scored, 0);
  // GTN covers feeds: story-scoring runs; reels-score has no reels/search members → no row.
  const gtn = await scoreForStories(q, noJev, [s], [GTN_ORDER], [reelsScore.c, storyScoring.c]);
  assert.equal(gtn['story-scoring'].scored, 1);
  assert.equal(gtn['reels-score'].scored, 0);
  assert.equal(reelsScore.seen.length, 0);
  // No open order: nothing.
  const closed = await scoreForStories(q, noJev, [s], [], [reelsScore.c, storyScoring.c]);
  assert.equal(closed['story-scoring'].scored + closed['story-scoring'].cached, 0);
  // A seed is covered by its own order only.
  const seeded = story(uid(3), [item({ key: 'x1', family: 'seed', sourceId: 'seed:lfd' })]);
  const major = card('major-news', ['reels', 'feeds', 'search', 'seed']);
  await insertStory(q, uid(3));
  assert.equal((await scoreForStories(q, noJev, [seeded], [MD_ORDER], [major.c]))['major-news'].scored, 0);
  assert.equal((await scoreForStories(q, noJev, [seeded], [LFD_ORDER], [major.c]))['major-news'].scored, 1);
});

test('the cap stops scoring cleanly: tally so far returned, onCapReached once, nothing new starts', async () => {
  const { q } = await intakeDb();
  const stories = [];
  for (let i = 0; i < 30; i++) {
    await insertStory(q, uid(100 + i));
    stories.push(story(uid(100 + i), [item({ key: `k${i}`, family: 'reels', role: 'primary' })]));
  }
  const major = card('major-news', ['reels'], 'major-news@1', { capAfter: 3 });
  let caps = 0;
  const tally = await scoreForStories(q, noJev, stories, [LFD_ORDER], [major.c], { onCapReached: () => caps++ });
  assert.equal(caps, 1);
  assert.equal(tally['major-news'].scored, 3);
  assert.equal((await q.query(`SELECT 1 FROM intake.scores`)).rows.length, 3);
});

test('addIntakeSeed: creates a story, scores it with the order’s cards (≤ 2 Jev calls), marks it yours (seeded_by/seed_order); a same-headline seed joins', async () => {
  const { q } = await intakeDb();
  const { jev, social, reels } = stubJev();
  const page = 'A team built something new with AI.\n' + 'Long page text. '.repeat(40);
  let n = 0;
  const addSeed = makeAddIntakeSeed({ fetchBody: async () => page, newId: () => uid(500 + ++n) });
  const now = new Date('2026-11-09T10:00:00Z');

  const a = await addSeed(q, jev, { order: 'lfd', url: 'https://example.com/a?utm_source=x', seededBy: 'lucas', headline: 'Lab X ships Y' }, now);
  assert.deepEqual(a, { storyId: uid(501), created: true });
  const it = (await q.query<{ family: string; source_id: string; role: string }>(`SELECT family, source_id, role FROM intake.items WHERE story_id = $1`, [a.storyId])).rows;
  assert.deepEqual(it, [{ family: 'seed', source_id: 'seed:lfd', role: 'primary' }]);
  assert.equal(reels.length, 0); // reels-score reads reels+search members only
  assert.deepEqual(social.map((c) => c.meta.version).sort(), ['major-news@3', 'story-builder@2']);
  const mark = (await q.query<{ seeded_by: string; seed_order: string }>(`SELECT seeded_by, seed_order FROM intake.items WHERE story_id = $1`, [a.storyId])).rows;
  assert.deepEqual(mark, [{ seeded_by: 'lucas', seed_order: 'lfd' }]);

  const b = await addSeed(q, jev, { order: 'lfd', url: 'https://other.example.org/b', seededBy: 'tommy', headline: 'lab x ships y' }, now);
  assert.deepEqual(b, { storyId: uid(501), created: false });
  assert.equal(social.length, 4); // the member set changed → re-scored

  await assert.rejects(addSeed(q, jev, { order: 'md', url: 'ftp://nope', seededBy: 'x' }, now), /must start with http/);
  const thin = makeAddIntakeSeed({ fetchBody: async () => 'short' });
  await assert.rejects(thin(q, jev, { order: 'md', url: 'https://example.com/thin', seededBy: 'x' }, now), /couldn’t read/);
  assert.equal(INTAKE_SCORECARDS.length, 5); // Phase 2 adds field-notes-score
});

test('reels-score keeps the best net / blockbuster across re-scores; the latest score stays the score (nit a)', async () => {
  const { q } = await intakeDb();
  const S = uid(7);
  await insertStory(q, S);
  await q.query(`INSERT INTO intake.items (key, family, source_id, source_name, source_type, headline, url, story_id, role) VALUES ('r1', 'reels', 'hacker-news', 'HN', 'rss', 'h', 'https://e.com/r1', $1, 'primary')`, [S]);
  let net = 0.8;
  let blockbuster = 2;
  const reelsCard: Scorecard = {
    id: 'reels-score',
    version: 'reels-score@1',
    families: ['reels', 'search'],
    score: async () => ({ answers: {}, result: { kind: 'reels-score', score: { net, blockbuster } as never }, usd: 0 }),
  };
  await scoreForStories(q, noJev, [story(S, [item({ key: 'r1', family: 'reels' })])], [LFD_ORDER], [reelsCard]);
  net = 0.3;
  blockbuster = 0;
  await scoreForStories(q, noJev, [story(S, [item({ key: 'r1', family: 'reels' }), item({ key: 'r2', family: 'reels' })])], [LFD_ORDER], [reelsCard]);
  const row = (await q.query<{ result: { score: { net: number }; best_net: number; best_blockbuster: number } }>(`SELECT result FROM intake.scores WHERE story_id = $1`, [S])).rows[0]!;
  assert.equal(row.result.score.net, 0.3, 'the latest');
  assert.equal(row.result.best_net, 0.8);
  assert.equal(row.result.best_blockbuster, 2);
  const [read] = await listStories(q, { since: new Date(0) });
  assert.deepEqual(read!.reelsBest, { net: 0.8, blockbuster: 2 });
  assert.equal(read!.scores['reels-score']?.net, 0.3);
});

test('orderCovers: through any list that keeps the item (fix 1)', () => {
  const feedsOnly = { id: 'md' as const, sources: ['feeds:*'] };
  const reelsOnly = { id: 'lfd' as const, sources: ['reels:*'] };
  const both = item({ key: 'k', family: 'reels', feedSlug: 'techcrunch-ai', reelsSourceId: 'hacker-news', reelsDropReason: 'off_topic', dropReason: null });
  assert.equal(orderCovers(feedsOnly, both), true, 'kept by its feed');
  assert.equal(orderCovers(reelsOnly, both), false, 'dropped by the reels screen');
  assert.equal(orderCovers({ id: 'md', sources: ['feed:techcrunch-ai'] }, both), true, 'an explicit feed slug');
});
