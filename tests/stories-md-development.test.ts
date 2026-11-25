/**
 * Bald-Eagle 2026-11-12 (D2, D5, D6, D7): Morning Download remembers what it
 * said; a story we ran comes back only for a new event (WC6); the outlet
 * signal counts direct big-outlet feeds only and reaches the news chain's
 * shortlist. Offline: PGlite with the stories and intake schemas, stub Jev and
 * the news chain stubs (tests/stories-md-news-stubs.ts).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { bigOutletsOf, outletCount } from '@/lib/intake/outlets';
import type { BuildDeps } from '@/lib/stories/build/common';
import { buildMorningDownload } from '@/lib/stories/build/morning-download';
import { createStoriesJev } from '@/lib/stories/jev';
import { schemaSql } from '@/lib/stories/local-db';
import { readWhatWeSaid } from '@/lib/stories/md-development';
import { claimNextRequested, recordHistory, requestSet } from '@/lib/stories/repository';
import { DEVELOPMENT_BAR } from '@/lib/stories/scores';
import { DEFAULT_SETTINGS } from '@/lib/stories/settings';
import type { StoryCandidate } from '@/lib/stories/sources/reels';

import { harnessDb, stubJev, stubPhotos, stubWriter } from './stories-harness';
import { newsStubs, writerMaterial } from './stories-md-news-stubs';

const NOW = new Date('2026-11-12T08:00:00Z');
const DATE = '2026-11-12';
const POSTED = new Date('2026-11-09T13:30:00Z');
const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf'];
const sid = (i: number) => `00000000-0000-4000-8000-00000000000${i}`;
type Db = Awaited<ReturnType<typeof harnessDb>>['db'];

function cand(i: number, major: number, builder: number | null = null, o: Partial<StoryCandidate> = {}): StoryCandidate {
  return {
    key: `x.test/${i}`, origin: 'carousel', ref: `https://x.test/${i}`, headline: `${NAMES[i]} story number ${i}`, sourceName: 'Outlet', url: `https://x.test/${i}`,
    body: `${NAMES[i]} body.`, publishedAt: NOW.toISOString(), nativeScore: 1, photo: null,
    intake: { storyId: sid(i), major, builder, eventDate: NOW.toISOString(), memberKeys: [`x.test/${i}`] },
    ...o,
  };
}

async function setup(opts: { md?: boolean } = {}) {
  const { db, pg } = await harnessDb();
  await pg.exec(schemaSql('db/intake_schema.sql'));
  if (opts.md) await pg.exec(schemaSql('db/bald_eagle_2026_11_12_md.sql'));
  for (let i = 0; i < NAMES.length; i++) await db.query(`INSERT INTO intake.stories (id, representative_key, headline) VALUES ($1, $2, $3)`, [sid(i), `x.test/${i}`, `${NAMES[i]} story`]);
  return { db };
}

/** An earlier Morning Download set that ran story 0 (published, with its history row and story frame). */
async function ranStory0(db: Db, headline = 'Alpha did a thing. It mattered.') {
  const set = (await db.query<{ id: string }>(
    `INSERT INTO stories.sets (series, ny_date, status, trigger, style, payload, published_at) VALUES ('morning_download', '2026-11-09', 'published', 'auto', 'polished', $1, $2) RETURNING id`,
    [JSON.stringify({ stories: [{ key: 'x.test/0', headline, storyId: sid(0) }], historyKeys: ['x.test/0'] }), POSTED],
  )).rows[0]!.id;
  await db.query(`INSERT INTO stories.frames (set_id, seq, role, backdrop, copy) VALUES ($1, 2, 'story', 'black', $2)`, [set, JSON.stringify({ role: 'story', headline })]);
  await db.query(`INSERT INTO stories.history (series, key, set_id, shown_at) VALUES ('morning_download', 'x.test/0', $1, $2)`, [set, POSTED]);
  return set;
}

async function article(db: Db, i: number, n: number, at: Date, o: { sourceId?: string; sourceName?: string; feedSlug?: string } = {}) {
  await db.query(
    `INSERT INTO intake.items (key, family, source_id, source_name, source_type, headline, body, url, first_seen_at, story_id, feed_slug) VALUES ($1, 'feeds', $2, $3, 'rss', $4, $5, $1, $6, $7, $8)`,
    [`https://a.test/${i}/${n}`, o.sourceId ?? 'feed:other', o.sourceName ?? 'Some Outlet', `${NAMES[i]} update ${n}`, `${NAMES[i]} new detail ${n}.`, at, sid(i), o.feedSlug ?? null],
  );
}

async function mdDeps(db: Db, stories: StoryCandidate[], o: { jev?: (k: string, state: unknown) => number } = {}) {
  const { set } = await requestSet(db, { series: 'morning_download', nyDate: DATE, trigger: 'click', style: DEFAULT_SETTINGS.series.morning_download.style });
  await claimNextRequested(db);
  const jev = stubJev((k, state) => (o.jev?.(k, state) ?? (k === 'supported' ? 0.9 : 0.1)));
  // Every pool story is top tier with a good photo, ranked in pool order.
  const stubs = await newsStubs(stories.map((c) => ({ headline: c.headline, top: true, photo: 'good' as const })));
  const deps: BuildDeps = {
    db, sourceDb: db, jev: createStoriesJev(jev, db), write: stubWriter({}), photos: stubPhotos(), settings: DEFAULT_SETTINGS, now: NOW, setId: set.id, nyDate: DATE,
    pool: { stories, leads: [] }, intake: true, news: stubs.news,
  };
  /** What the writer was given (its first call's material). */
  const written = () => stubs.calls.writer.filter((p) => (p.tools as Array<{ name: string }>)[0]!.name === 'propose_angles').slice(0, 1).map(writerMaterial);
  return { deps, jev, written };
}

const keysOf = (r: Awaited<ReturnType<typeof buildMorningDownload>>) => (r.ok ? (r.payload.stories as Array<{ key: string }>).map((s) => s.key) : []);
const devCalls = (jev: ReturnType<typeof stubJev>) => jev.calls.filter((c) => c.keys.includes('new_event'));

test('development: a story we ran with no articles since it posted stays out, with no Jev call', async () => {
  const { db } = await setup();
  await ranStory0(db);
  await article(db, 0, 1, new Date(POSTED.getTime() - 3_600_000));
  const { deps, jev } = await mdDeps(db, [cand(0, 0.9), cand(1, 0.8), cand(2, 0.7)]);
  const r = await buildMorningDownload(deps);
  assert.equal(r.ok, true);
  assert.deepEqual(keysOf(r), ['x.test/1', 'x.test/2']);
  assert.equal(devCalls(jev).length, 0);
  assert.ok(r.candidates.some((c) => c.reason === 'ran before; no new articles since'));
});

test('development: new articles and new_event ≥ bar let it back in; the writer gets what we already said and the new text first', async () => {
  const { db } = await setup();
  await ranStory0(db, 'Alpha did a thing. It mattered.');
  await article(db, 0, 1, new Date(POSTED.getTime() + 86_400_000));
  const { deps, jev, written } = await mdDeps(db, [cand(0, 0.9), cand(1, 0.8), cand(2, 0.7)], { jev: (k) => (k === 'new_event' ? DEVELOPMENT_BAR + 0.2 : k === 'supported' ? 0.9 : 0.1) });
  const r = await buildMorningDownload(deps);
  assert.ok(r.ok, r.ok ? '' : r.skip);
  assert.ok(keysOf(r).includes('x.test/0'));
  const call = devCalls(jev)[0]!;
  // No stored headline column (older row): the story frame's headline is what we said.
  assert.equal((call.state as { we_said: string }).we_said, 'Alpha did a thing. It mattered.');
  assert.match(JSON.stringify(call.state), /Alpha update 1/);
  // WC6: the writer (lib/news-writer) gets what we already said, and the new articles before the earlier coverage.
  const alpha = written()[0]!.find((s) => s.source_headline.startsWith('Alpha'))!;
  assert.equal(alpha.we_already_said, 'Alpha did a thing. It mattered.');
  assert.match(alpha.text, /^New since we ran it:\nSome Outlet: Alpha update 1/);
  const story = (r.payload.stories as Array<{ key: string; storyId?: string; we_already_said?: unknown }>).find((s) => s.key === 'x.test/0')!;
  assert.equal(story.storyId, sid(0));
  assert.ok(story.we_already_said);
});

test('development: new articles but new_event < bar keeps it out', async () => {
  const { db } = await setup();
  await ranStory0(db);
  await article(db, 0, 1, new Date(POSTED.getTime() + 86_400_000));
  const { deps, jev } = await mdDeps(db, [cand(0, 0.9), cand(1, 0.8), cand(2, 0.7)], { jev: (k) => (k === 'new_event' ? DEVELOPMENT_BAR - 0.2 : k === 'supported' ? 0.9 : 0.1) });
  const r = await buildMorningDownload(deps);
  assert.deepEqual(keysOf(r), ['x.test/1', 'x.test/2']);
  assert.equal(devCalls(jev).length, 1);
});

test('development: an older row with no headline anywhere stays blocked (as before)', async () => {
  const { db } = await setup();
  await db.query(`INSERT INTO stories.history (series, key, shown_at) VALUES ('morning_download', 'x.test/0', $1)`, [POSTED]);
  await article(db, 0, 1, new Date(POSTED.getTime() + 86_400_000));
  const { deps, jev } = await mdDeps(db, [cand(0, 0.9), cand(1, 0.8), cand(2, 0.7)], { jev: () => 0.9 });
  const r = await buildMorningDownload(deps);
  assert.deepEqual(keysOf(r), ['x.test/1', 'x.test/2']);
  assert.equal(devCalls(jev).length, 0);
});

test('recordHistory stores what we said once the SQL file is applied; the reader prefers it', async () => {
  const { db } = await setup({ md: true });
  const set = await ranStory0(db, 'Alpha did a thing. It mattered.');
  await db.query(`DELETE FROM stories.history`);
  await recordHistory(db, 'morning_download', ['x.test/0'], set);
  const { rows } = await db.query<{ headline: string; intake_story_id: string }>(`SELECT headline, intake_story_id FROM stories.history`);
  assert.deepEqual(rows, [{ headline: 'Alpha did a thing. It mattered.', intake_story_id: sid(0) }]);
  await db.query(`UPDATE stories.frames SET copy = '{"headline": "edited later"}'`);
  const said = await readWhatWeSaid(db, NOW, DATE);
  assert.equal(said[0]!.headline, 'Alpha did a thing. It mattered.');
  assert.equal(said[0]!.storyId, sid(0));
});

test('outlets: only direct big-outlet feeds count; one Google News search hit relaying many publishers counts none', async () => {
  // The "18 outlets" case: one search feed relaying 18 publishers.
  const relayed = Array.from({ length: 18 }, (_, i) => ({ sourceId: 'feed:gnews-ai-products', sourceName: `Publisher ${i}` }));
  assert.deepEqual(bigOutletsOf(relayed), []);
  // One outlet under two names (its own feed, and Google News's "Bloomberg.com"): counted once, by its feed.
  assert.deepEqual(bigOutletsOf([{ sourceId: 'feed:bloomberg-tech' }, { sourceId: 'feed:gnews-frontier-labs' }, { sourceId: 'feed:bloomberg-tech' }]), ['Bloomberg']);
  // Only the storing source counts: a Hacker News item that the NYT feed also listed is not an NYT item.
  assert.deepEqual(bigOutletsOf([{ sourceId: 'hacker-news' }, { sourceId: 'guardian-ai' }]), ['The Guardian']);

  const { db } = await setup();
  const recent = new Date(NOW.getTime() - 3_600_000);
  await article(db, 0, 1, recent, { sourceId: 'feed:reuters-tech' });
  await article(db, 0, 2, recent, { sourceId: 'feed:gnews-frontier-labs', sourceName: 'Reuters' });
  await article(db, 0, 4, recent, { sourceId: 'hacker-news', sourceName: 'Hacker News', feedSlug: 'nyt-tech' });
  await article(db, 0, 3, new Date(NOW.getTime() - 30 * 3_600_000), { sourceId: 'nbc-tech' }); // outside 24 h
  await article(db, 1, 1, recent, { sourceId: 'bbc-tech' }); // a spin-off story
  await db.query(`UPDATE intake.stories SET merged_into = $1 WHERE id = $2`, [sid(0), sid(2)]);
  await article(db, 2, 1, recent, { sourceId: 'cbs-tech' }); // merged into story 0
  const since = new Date(NOW.getTime() - 24 * 3_600_000);
  assert.deepEqual(await outletCount(db, [sid(0)], since), { count: 2, outlets: ['CBS News', 'Reuters'] });
  assert.deepEqual(await outletCount(db, [sid(0), sid(1)], since), { count: 3, outlets: ['BBC News', 'CBS News', 'Reuters'] });
});

test('outlets: the big-outlet signal reaches the news chain\'s shortlist with the story\'s own outlet', async () => {
  const { db } = await setup();
  await article(db, 1, 1, new Date(NOW.getTime() - 3_600_000), { sourceId: 'feed:reuters-tech' });
  const { deps } = await mdDeps(db, [cand(0, 0.9), cand(1, 0.8), cand(2, 0.7)]);
  const seen = new Map<string, string[]>();
  const ask = deps.news!.jevAsk;
  deps.news = { ...deps.news!, jevAsk: async (req, o) => { const st = req.state as { headline: string; outlets: string[] }; seen.set(st.headline, st.outlets); return ask(req, o); } };
  const r = await buildMorningDownload(deps);
  assert.ok(r.ok, r.ok ? '' : r.skip);
  assert.deepEqual(seen.get('Bravo story number 1'), ['Outlet', 'Reuters']);
  assert.deepEqual(seen.get('Alpha story number 0'), ['Outlet']);
  assert.deepEqual((r.payload.stories as Array<{ key: string; big_outlets?: string[] }>).find((s) => s.key === 'x.test/1')!.big_outlets, ['Reuters']);
});

test('development (S5): a story we ran 10 days ago is found by its intake story; commentary stays out, a new event comes back', async () => {
  const LONG_AGO = new Date(NOW.getTime() - 10 * 86_400_000);
  for (const newEvent of [DEVELOPMENT_BAR - 0.3, DEVELOPMENT_BAR + 0.3]) {
    const { db } = await setup();
    // The set ran story 0 under an older representative link, so only the intake story id ties it to today's candidate.
    const set = (await db.query<{ id: string }>(
      `INSERT INTO stories.sets (series, ny_date, status, trigger, style, payload, published_at) VALUES ('morning_download', '2026-11-02', 'published', 'auto', 'polished', $1, $2) RETURNING id`,
      [JSON.stringify({ stories: [{ key: 'old.test/alpha', headline: 'Alpha did a thing. It mattered.', storyId: sid(0) }], historyKeys: ['old.test/alpha'] }), LONG_AGO],
    )).rows[0]!.id;
    await db.query(`INSERT INTO stories.frames (set_id, seq, role, backdrop, copy) VALUES ($1, 2, 'story', 'black', $2)`, [set, JSON.stringify({ role: 'story', headline: 'Alpha did a thing. It mattered.' })]);
    await db.query(`INSERT INTO stories.history (series, key, set_id, shown_at) VALUES ('morning_download', 'old.test/alpha', $1, $2)`, [set, LONG_AGO]);
    await article(db, 0, 1, new Date(NOW.getTime() - 86_400_000));
    const { deps, jev, written } = await mdDeps(db, [cand(0, 0.9), cand(1, 0.8), cand(2, 0.7)], { jev: (k) => (k === 'new_event' ? newEvent : k === 'supported' ? 0.9 : 0.1) });
    const r = await buildMorningDownload(deps);
    assert.equal(devCalls(jev).length, 1, 'the 10-day-old run still triggers the development test');
    if (newEvent < DEVELOPMENT_BAR) {
      assert.deepEqual(keysOf(r), ['x.test/1', 'x.test/2']);
      assert.ok(r.candidates.some((c) => /no new event/.test(String(c.reason))));
    } else {
      assert.ok(keysOf(r).includes('x.test/0'));
      const alpha = written()[0]!.find((x) => x.source_headline.startsWith('Alpha'))!;
      assert.equal(alpha.we_already_said, 'Alpha did a thing. It mattered.');
    }
  }
});
