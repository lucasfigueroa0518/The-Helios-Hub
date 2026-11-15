/**
 * Bald-Eagle 2026-11-12 (D2, D5, D6, D7): Morning Download remembers what it
 * said; a story we ran comes back only for a new event (spin-offs too); the
 * outlet signal counts direct big-outlet feeds only; the side-by-side final
 * rank orders the cut, and a failed final rank keeps the margin order.
 * Offline: PGlite with the stories and intake schemas, stub Jev and writer.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { bigOutletsOf, outletCount } from '@/lib/intake/outlets';
import { buildMorningDownload, MAX_BUILDERS } from '@/lib/stories/build/morning-download';
import { createStoriesJev } from '@/lib/stories/jev';
import { schemaSql } from '@/lib/stories/local-db';
import { readWhatWeSaid } from '@/lib/stories/md-development';
import { claimNextRequested, recordHistory, requestSet } from '@/lib/stories/repository';
import { DEVELOPMENT_BAR } from '@/lib/stories/scores';
import { DEFAULT_SETTINGS } from '@/lib/stories/settings';
import type { StoryCandidate } from '@/lib/stories/sources/reels';

import { harnessDb, stubJev, stubPhotos, stubWriter } from './stories-harness';

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

const materialOf = (params: Record<string, unknown>) => {
  const m = /<material>\n([\s\S]*)\n<\/material>/.exec(String((params.messages as Array<{ content: string }>)[0]!.content));
  return JSON.parse(m![1]!) as Array<Record<string, unknown>>;
};

async function mdDeps(db: Db, stories: StoryCandidate[], o: { jev?: (k: string, state: unknown) => number; order?: (items: Array<Record<string, unknown>>) => string[] | Error } = {}) {
  const { set } = await requestSet(db, { series: 'morning_download', nyDate: DATE, trigger: 'click', style: DEFAULT_SETTINGS.series.morning_download.style });
  await claimNextRequested(db);
  const jev = stubJev((k, state) => (o.jev?.(k, state) ?? (k === 'supported' ? 0.9 : 0.1)));
  const written: Array<Array<Record<string, unknown>>> = [];
  const write = stubWriter({
    submit_headlines: (params) => {
      const items = materialOf(params);
      written.push(items);
      return {
        stories: items.map((s) => ({ key: s.key, headline: `${String(s.headline)} today. It matters.`, source_verb: 'via', source_name: 'Outlet', subjects: [], visual: { kind: 'thematic', query: 'q' }, alt_visuals: [] })),
        opener_visual: { kind: 'setting', query: 'office' },
      };
    },
    submit_order: (params) => {
      const items = materialOf(params);
      const out = o.order ? o.order(items) : items.map((x) => String(x.id));
      if (out instanceof Error) throw out;
      return { order: out };
    },
  });
  const deps = { db, sourceDb: db, jev: createStoriesJev(jev, db), write, photos: stubPhotos(), settings: DEFAULT_SETTINGS, now: NOW, setId: set.id, nyDate: DATE, pool: { stories, numbers: [], unbriefed: [], leads: [] }, intake: true };
  return { deps, jev, write, written };
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
  assert.ok(r.ok);
  assert.ok(keysOf(r).includes('x.test/0'));
  const call = devCalls(jev)[0]!;
  // No stored headline column (older row): the story frame's headline is what we said.
  assert.equal((call.state as { we_said: string }).we_said, 'Alpha did a thing. It mattered.');
  assert.match(JSON.stringify(call.state), /Alpha update 1/);
  const alpha = written[0]!.find((s) => String(s.headline).startsWith('Alpha'))!;
  assert.deepEqual((alpha.we_already_said as { headline: string }).headline, 'Alpha did a thing. It mattered.');
  assert.match(String(alpha.text), /^New since we ran it:\nSome Outlet: Alpha update 1/);
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

test('development: a spin-off the same-event check ties to a story we ran goes through the same test', async () => {
  for (const newEvent of [0.3, 0.9]) {
    const { db } = await setup();
    await ranStory0(db, 'Alpha did a thing. It mattered.');
    // Story 3 is a separate intake story about the same event (shares the name "Alpha").
    await article(db, 3, 1, new Date(POSTED.getTime() + 86_400_000));
    const spin = cand(3, 0.85, null, { headline: 'Alpha faces a new question', body: 'Alpha follow-up.' });
    const { deps, jev } = await mdDeps(db, [spin, cand(1, 0.8), cand(2, 0.7)], {
      jev: (k, state) => (k === 'same_event' ? (JSON.stringify(state).includes('Alpha did a thing') ? 0.95 : 0.1) : k === 'new_event' ? newEvent : k === 'supported' ? 0.9 : 0.1),
    });
    const r = await buildMorningDownload(deps);
    const calls = devCalls(jev);
    assert.equal(calls.length, 1, 'the spin-off took the development test');
    assert.equal((calls[0]!.state as { we_said: string }).we_said, 'Alpha did a thing. It mattered.');
    if (newEvent < DEVELOPMENT_BAR) assert.ok(!keysOf(r).includes('x.test/3'));
    else {
      assert.ok(keysOf(r).includes('x.test/3'));
      assert.ok((r.ok && (r.payload.stories as Array<{ key: string; we_already_said?: unknown }>).find((s) => s.key === 'x.test/3')!.we_already_said));
    }
  }
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

test('final rank: the cut follows the side-by-side order (builder cap kept), with cached instructions', async () => {
  const { db } = await setup();
  await article(db, 6, 1, new Date(NOW.getTime() - 3_600_000), { sourceId: 'feed:reuters-tech' });
  // Margin order: 0, 4 (builder), 1, 5 (builder), 6 (builder), 2, 3. The model's order puts 3 first and 0 last.
  const stories = [...[0.9, 0.8, 0.7, 0.6].map((m, i) => cand(i, m, 0.1)), ...[0.95, 0.9, 0.85].map((b, i) => cand(4 + i, 0.2, b))];
  const want = [3, 6, 2, 5, 1, 4, 0];
  const at = (x: Record<string, unknown>) => want.indexOf(NAMES.indexOf(String(x.headline).split(' ')[0]!));
  const { deps, write } = await mdDeps(db, stories, { order: (items) => [...items].sort((a, b) => at(a) - at(b)).map((x) => String(x.id)) });
  const r = await buildMorningDownload(deps);
  assert.ok(r.ok);
  // 3, 6 (builder), 2, 5 (builder), 1; 4 is skipped: two builders already.
  assert.deepEqual(keysOf(r), ['x.test/3', 'x.test/6', 'x.test/2', 'x.test/5', 'x.test/1']);
  assert.ok(keysOf(r).filter((k) => ['x.test/4', 'x.test/5', 'x.test/6'].includes(k)).length <= MAX_BUILDERS);
  const req = write.calls.find((c) => (c.tools as Array<{ name: string }>).some((t) => t.name === 'submit_order'))! as { system: Array<{ cache_control?: unknown }>; tools: Array<{ cache_control?: unknown }>; model: string };
  assert.ok(req.system[0]!.cache_control && req.tools.at(-1)!.cache_control);
  assert.equal(req.model, DEFAULT_SETTINGS.models.copy);
  // The outlet signal reached the final rank.
  const golf = materialOf(req as unknown as Record<string, unknown>).find((x) => String(x.headline).startsWith('Golf'))!;
  assert.deepEqual(golf.big_outlets, ['Reuters']);
  assert.equal(r.payload.final_rank, 'ok');
});

test('final rank: a failed call keeps the margin order and logs it', async () => {
  const { db } = await setup();
  const stories = [...[0.9, 0.8, 0.7, 0.6].map((m, i) => cand(i, m, 0.1)), ...[0.95, 0.9, 0.85].map((b, i) => cand(4 + i, 0.2, b))];
  const { deps } = await mdDeps(db, stories, { order: () => new Error('overloaded') });
  const r = await buildMorningDownload(deps);
  assert.ok(r.ok);
  assert.deepEqual(keysOf(r), ['x.test/0', 'x.test/4', 'x.test/1', 'x.test/5', 'x.test/2']);
  assert.ok((r.payload.log as string[]).some((l) => /^final rank failed, margin order kept: .*overloaded/.test(l)));
  assert.equal(r.payload.final_rank, 'margin order');
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
      const alpha = written[0]!.find((x) => String(x.headline).startsWith('Alpha'))!;
      assert.equal((alpha.we_already_said as { headline: string }).headline, 'Alpha did a thing. It mattered.');
    }
  }
});
