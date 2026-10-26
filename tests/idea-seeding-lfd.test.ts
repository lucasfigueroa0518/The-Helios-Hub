/**
 * Idea seeding and Archive, Last Few Days (design 2026-10-26-last-few-days-queue-and-seeding), offline on PGlite with the real
 * schemas, a stubbed page fetch, a stubbed Jev and a stubbed writer (no live calls): a pasted link becomes a story of the
 * person's own that the next run takes before the lanes (up to 3), an archived story stays out of every run, and with no seeds
 * and no archives a run picks exactly what it always did.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { runLastFewDays, type LfdRunDeps } from '@/lib/lfd/run';
import { Selector } from '@/lib/lfd/pick';
import { MAX_OPEN_SEEDS, SeedError, addLfdSeed, readOpenSeeds } from '@/lib/lfd/seeds';
import type { LfdCandidate } from '@/lib/lfd/types';
import { buildDataset } from '@/lib/social-hub/dataset';
import type { HubQuery } from '@/lib/social-hub/db';
import { readAll } from '@/lib/social-hub/load';
import type { JevAsk, JevResult } from '@/lib/social/jev/client';
import type { PhotoFinder } from '@/lib/stories/photos';

import { resetSeed, seedCarouselRun, seedReelsIdea, seedScore } from './fixtures/lfd/seed';
import { openHubTestDb } from './fixtures/social-hub/pglite';

const NOW = new Date('2026-10-13T07:00:00Z'); // Tuesday 3:00 AM NY
const LONG = 'The company said it would ship the product this week and gave details on pricing and availability. '.repeat(20);
const MEDIUM = 'The company said it would ship the product this week and gave details on pricing. '.repeat(8); // between 500 and 1500
const THIN = 'The company said it would ship. '.repeat(8); // over the 200 to add, under the 500 a run needs
const link = (n: string) => `https://seed.test/${n}`;
const keyOf = (n: string) => `seed.test/${n}`;
const refused = (p: Promise<unknown>, status: number, match: RegExp) => assert.rejects(p, (e: unknown) => e instanceof SeedError && e.status === status && match.test(e.message));

/** Single-word names per seed so no two seeds (or a seed and a machine story) look like one event. */
const HEADLINES: Record<string, string> = {
  a: 'Zorblax Wins Prize',
  b: 'Quillon Ships Chip',
  c: 'Mavrick Buys Startup',
  d: 'Dunmore Cuts Staff',
  e: 'Ephraim Sues Rival',
};
/** Major-news score by headline: Dunmore is below the 0.55 bar. */
const majorOf = (h: string) => (h.includes('Haiku') || /Zorblax|Quillon|Mavrick|Ephraim/.test(h) ? 1 : 0);

const jev = (): JevAsk => async (req, meta): Promise<JevResult> => {
  const usage = { input_tokens: 10, output_tokens: 0 };
  if (meta.version.startsWith('major-news')) {
    const s = majorOf((req.state as { headline: string }).headline) || (/Dunmore/.test((req.state as { headline: string }).headline) ? 0.2 : 0);
    return { answers: { happened: { noul: s }, news_kind: { noul: s }, blockbuster_entity: { noul: s }, global_relevance: { noul: s }, political_relevance: { noul: s }, speculative: { noul: 0 } }, usage, model: 's' };
  }
  if (meta.version.startsWith('md-grounding')) {
    return { answers: { supported: { noul: (req.state as { headline: string }).headline.includes('UNSUPPORTED') ? 0.1 : 0.9 } }, usage, model: 's' };
  }
  return { answers: { same_event: { noul: 0.1 } }, usage, model: 's' };
};

/** Echoes every story in the material with valid copy. The caption call throws, so the template caption ships. */
const create = async (p: Anthropic.MessageCreateParamsNonStreaming) => {
  if ((p.tools?.[0] as { name?: string } | undefined)?.name === 'submit_verdict') {
    return { id: 'v', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 4, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, content: [{ type: 'tool_use', id: 'v', name: 'submit_verdict', input: { shows_story_subject: true, generic_stock: false, reason: 'ok' } }] } as unknown as Anthropic.Message;
  }
  if ((p as { output_config?: { format?: unknown } }).output_config?.format) throw new Error('stub: no caption model');
  const user = String((p.messages.at(-1) as { content: unknown }).content);
  const material = JSON.parse(user.slice(user.indexOf('<material>') + 10, user.indexOf('</material>'))) as { stories: Array<{ key: string; headline: string }> };
  const stories = material.stories.map((s) => ({
    key: s.key, setup: '', headline: `Story ${s.headline.slice(0, 40)}`, highlight: '', names: [],
    body: 'It happened this week. The company says more is coming', photo: { kind: 'company', query: s.headline, subjects: [], alts: [] },
  }));
  return { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 100, cache_creation_input_tokens: 5, cache_read_input_tokens: 50 }, content: [{ type: 'tool_use', id: 't', name: 'submit_rundown', input: { stories } }] } as unknown as Anthropic.Message;
};

const photos = (): PhotoFinder => ({
  usd: 0,
  find: async () => null,
  findSet: async (reqs) => reqs.map((r, i) => (/NoPhoto/.test(r.query) ? null : { src: `https://p/${encodeURIComponent(r.query)}-${i}.jpg`, credit: 'C', kind: 'scene' })),
});

async function freshDb() {
  resetSeed();
  const { query, pg } = await openHubTestDb();
  for (let i = 0; i < 8; i++) {
    const idea = await seedReelsIdea(query, { headline: `Niche Thing ${i} Happens`, url: `https://n.com/${i}` });
    await seedScore(query, idea, { nyDate: '2026-10-11', origin: 'timely', net: 0.9 - i / 20 });
  }
  await seedCarouselRun(query, '2026-10-12T07:00:00Z', [{ id: 'https://big.com/haiku', headline: 'Anthropic Releases Claude Haiku 5.5', source: 'The Verge' }]);
  return { query, pg };
}

function runDeps(query: HubQuery, over: Partial<LfdRunDeps> = {}): LfdRunDeps & { jevCount: () => number } {
  let jevCalls = 0;
  const j = jev();
  return {
    query,
    jev: (req, meta) => (jevCalls += 1, j(req, meta)),
    jevCount: () => jevCalls,
    create,
    photos: photos(),
    fetchFeeds: async () => [],
    fetchBody: async () => null,
    readPage: async (url) => ({ ok: false, url, error: 'stub: no page' }),
    fitCheck: async (post, opts) => {
      if (opts?.screenshotDir) {
        const fs = await import('node:fs/promises');
        const sharp = (await import('sharp')).default;
        for (let i = 1; i <= post.slides.length; i++) {
          const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: i * 20, g: 0, b: 0 } } }).png().toBuffer();
          await fs.writeFile(`${opts.screenshotDir}/slide-slide-${String(i).padStart(2, '0')}.png`, png);
        }
      }
      return { ok: true, violations: [], problems: [], slideText: [] };
    },
    upload: async () => {},
    now: NOW,
    trigger: 'manual',
    capUsd: 1,
    spend: () => ({ claudeUsd: 0.1, jevUsd: 0.01 }),
    ...over,
  };
}

type Post = { stories: Array<{ key: string; lane: string; origin: string; url: string }>; idea_ids: string[] };
async function run(query: HubQuery, over: Partial<LfdRunDeps> = {}) {
  const d = runDeps(query, over);
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  const post = (await query<Post>(`SELECT stories, idea_ids FROM lfd.posts ORDER BY created_at DESC LIMIT 1`)).rows[0]!;
  const record = (await query<{ record: Record<string, any> }>(`SELECT record FROM lfd.runs WHERE id = $1`, [res.runId])).rows[0]!.record;
  return { post, record, jevCalls: d.jevCount() };
}
const seed = (query: HubQuery, n: string, body = LONG, now = NOW) => addLfdSeed(query, { url: link(n), headline: HEADLINES[n] }, { fetchBody: async () => body, now });
const seedRow = async (query: HubQuery, n: string) => (await query<{ value: Record<string, any> }>(`SELECT value FROM lfd.settings WHERE key = $1`, [`seed:${keyOf(n)}`])).rows[0]?.value;
const archive = (query: HubQuery, key: string) =>
  query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind) VALUES ('last_few_days', $1, '2026-10-13', 'archive')`, [`last_few_days:story:${key}`]);

const GOLDEN = ['big.com/haiku', 'n.com/0', 'n.com/1', 'n.com/2', 'n.com/3', 'n.com/4'];

test('golden: with no seeds and no archives a run picks exactly what it always did, and an expired or unrelated row changes nothing', async () => {
  const { query } = await freshDb();
  const plain = await run(query);
  assert.deepEqual(plain.post.stories.map((s) => s.key), GOLDEN);
  assert.equal(plain.record.seeds, undefined);
  assert.equal(plain.record.seedError, undefined);
  // The same candidates through a Selector with no forced list.
  const cand = (key: string, over: Partial<LfdCandidate> = {}): LfdCandidate => ({ key, refs: [key], origin: 'reels', headline: `Thing ${key}`, sourceName: 'x', url: `https://${key}`, body: 'b', publishedAt: null, net: 0.5, blockbuster: 0, firstSeen: null, alsoFrom: [], major: null, ...over });
  const majors = [cand('m1', { major: 0.9 }), cand('m2', { major: 0.7 })];
  const rundown = ['r1', 'r2', 'r3', 'r4', 'r5'].map((k, i) => cand(k, { net: 0.9 - i / 10 }));
  const noForced = await new Selector(majors, rundown, [], jev()).fill();
  const emptyForced = await new Selector(majors, rundown, [], jev(), []).fill();
  assert.deepEqual(noForced.map((p) => [p.key, p.lane]), [['m1', 'major'], ['m2', 'major'], ['r1', 'rundown'], ['r2', 'rundown'], ['r3', 'rundown'], ['r4', 'rundown']]);
  assert.deepEqual(emptyForced, noForced);

  // An archive of a story nobody picked and a seed that expired a week ago leave the same picks and the same Jev calls.
  const other = await freshDb();
  await archive(other.query, 'nowhere.com/never-seen');
  await seed(other.query, 'a', LONG, new Date(NOW.getTime() - 9 * 86_400_000));
  const same = await run(other.query);
  assert.deepEqual(same.post.stories.map((s) => s.key), GOLDEN);
  assert.equal(same.jevCalls, plain.jevCalls, 'no extra model calls');
  assert.equal(same.record.seeds, undefined, 'an expired seed is not even listed');
});

test('a seeded story is taken first, lands in the right lane, is marked made, and costs one Jev call', async () => {
  const { query } = await freshDb();
  const base = await run((await freshDb()).query);
  await seed(query, 'a'); // Zorblax: above the bar
  await seed(query, 'd'); // Dunmore: below it
  assert.equal((await query(`SELECT 1 FROM lfd.posts`)).rows.length, 0, 'adding makes nothing');
  const { post, record, jevCalls } = await run(query);
  const byKey = new Map(post.stories.map((s) => [s.key, s]));
  assert.equal(byKey.get(keyOf('a'))?.lane, 'major');
  assert.equal(byKey.get(keyOf('a'))?.origin, 'seed');
  assert.equal(byKey.get(keyOf('d'))?.lane, 'rundown');
  assert.equal(post.stories.length, 6);
  assert.ok(post.idea_ids.includes(keyOf('a')));
  assert.equal(jevCalls, base.jevCalls + 2, 'one major-news call per taken seed');
  assert.deepEqual(record.seeds.map((s: any) => [s.key, s.outcome]), [[keyOf('a'), 'in the post'], [keyOf('d'), 'in the post']]);
  assert.equal((await seedRow(query, 'a'))?.status, 'made');
  assert.equal((await readOpenSeeds(query, NOW)).length, 0);
  // Made seeds do not come back in the next run.
  const again = await run(query, { now: new Date('2026-10-16T07:00:00Z') });
  assert.ok(!again.post.stories.some((s) => s.key === keyOf('a')));
});

test('a seed that fails stays open with its reason, and the post still fills', async () => {
  const { query } = await freshDb();
  await seed(query, 'a', THIN); // thin text: dropped at the full-text step
  await addLfdSeed(query, { url: link('c'), headline: `${HEADLINES.c} NoPhoto` }, { fetchBody: async () => LONG, now: NOW }); // no photo
  const { post, record } = await run(query);
  assert.equal(post.stories.length, 6, 'replaced from its own lane, then the rundown');
  assert.ok(!post.stories.some((s) => s.key === keyOf('a') || s.key === keyOf('c')));
  const out = new Map(record.seeds.map((s: any) => [s.key, s.outcome]));
  assert.equal(out.get(keyOf('a')), 'thin-text');
  assert.equal(out.get(keyOf('c')), 'no-photo');
  assert.deepEqual([(await seedRow(query, 'a'))?.status, (await seedRow(query, 'a'))?.outcome], ['open', 'thin-text']);
  assert.equal((await readOpenSeeds(query, NOW)).length, 2, 'both wait for the next run');
});

test('4 open seeds: 3 are taken, the 4th shows waiting and is not scored; the lane is the seed’s own score', async () => {
  const { query } = await freshDb();
  const base = await run((await freshDb()).query);
  for (const n of ['a', 'b', 'c', 'd']) await seed(query, n, LONG, new Date(NOW.getTime() - 60_000 * (10 - 'abcd'.indexOf(n)))); // oldest first: a, b, c, d
  const { post, record, jevCalls } = await run(query);
  assert.deepEqual(post.stories.filter((s) => s.origin === 'seed').map((s) => s.key).sort(), [keyOf('a'), keyOf('b'), keyOf('c')]);
  assert.equal(jevCalls, base.jevCalls + 3, 'the waiting seed costs nothing');
  assert.deepEqual(record.seeds.map((s: any) => s.outcome), ['in the post', 'in the post', 'in the post', 'waiting: this run already had 3']);
  assert.equal((await seedRow(query, 'd'))?.status, 'open');
  assert.match((await seedRow(query, 'd'))?.outcome, /waiting/);
});

test('a seed skips the “already covered last time” check, and the run says so', async () => {
  const { query } = await freshDb();
  const first = await run(query);
  // The same event as the last post's lead, under a different link, seeded.
  const lead = first.post.stories[0]!;
  const covered = jev();
  const sameEventJev: JevAsk = (req, meta) => (meta.version.startsWith('stories-same-event') ? Promise.resolve({ answers: { same_event: { noul: (req.state as any).story_a?.headline?.includes('Haiku') ? 0.95 : 0.1 } }, usage: { input_tokens: 1, output_tokens: 0 }, model: 's' }) : covered(req, meta));
  await addLfdSeed(query, { url: link('b'), headline: 'Anthropic Quillon Haiku Shipped' }, { fetchBody: async () => LONG, now: new Date('2026-10-14T00:00:00Z') });
  const res = await run(query, { now: new Date('2026-10-16T07:00:00Z'), jev: sameEventJev });
  assert.ok(lead);
  assert.ok(res.post.stories.some((s) => s.key === keyOf('b')), 'taken although the last post covered the event');
  assert.equal(res.record.seeds[0].repeat, true);
  assert.match(res.record.seeds[0].outcome, /in the post.*already covered/);
});

test('refusals: the 11th seed, an unreadable page, a bad or private link, a duplicate, an archived story, a story in the latest post', async () => {
  const { query } = await freshDb();
  const ok = { fetchBody: async () => LONG, now: NOW };
  await refused(addLfdSeed(query, { url: 'not a link' }, ok), 400, /http/);
  await refused(addLfdSeed(query, { url: 'ftp://seed.test/x' }, ok), 400, /http/);
  let fetched = 0;
  for (const bad of ['http://localhost:3000/x', 'http://127.0.0.1/x', 'http://10.0.0.5/x', 'http://192.168.1.2/x', 'http://169.254.169.254/latest', 'http://[::1]/x', 'http://printer.local/x']) {
    await refused(addLfdSeed(query, { url: bad }, { fetchBody: async () => (fetched += 1, LONG), now: NOW }), 400, /private|look right/);
  }
  assert.equal(fetched, 0, 'nothing private is fetched');
  await refused(addLfdSeed(query, { url: link('x') }, { fetchBody: async () => null, now: NOW }), 422, /couldn’t read/);
  await refused(addLfdSeed(query, { url: link('x') }, { fetchBody: async () => 'too short', now: NOW }), 422, /couldn’t read/);
  assert.deepEqual(await readOpenSeeds(query, NOW), [], 'a refusal writes nothing');

  await addLfdSeed(query, { url: link('dup'), headline: 'Dupe Story' }, ok);
  await refused(addLfdSeed(query, { url: `${link('dup')}?utm_source=x` }, ok), 409, /already waiting/);

  await archive(query, keyOf('gone'));
  await refused(addLfdSeed(query, { url: link('gone') }, ok), 409, /archived/);

  // Fill to the cap, then the 11th is refused until one is archived.
  for (let i = 1; i < MAX_OPEN_SEEDS; i++) await addLfdSeed(query, { url: link(`n${i}`), headline: `Number ${i}` }, ok);
  await refused(addLfdSeed(query, { url: link('over') }, ok), 409, /archive one first/);
  await archive(query, keyOf('n1'));
  await addLfdSeed(query, { url: link('over') }, ok);

  // A story already in the latest post.
  const made = await freshDb();
  const { post } = await run(made.query);
  await refused(addLfdSeed(made.query, { url: `https://${post.stories[1]!.key.replace(/^/, '')}` }, ok), 409, /latest Last Few Days post/);
});

test('expired and archived seeds are skipped; an archived machine story is not a candidate', async () => {
  const { query } = await freshDb();
  await seed(query, 'a', LONG, new Date(NOW.getTime() - 8 * 86_400_000)); // expired
  await seed(query, 'b'); // archived
  await seed(query, 'c'); // live
  await archive(query, keyOf('b'));
  await archive(query, 'n.com/0'); // a machine story
  await archive(query, 'big.com/haiku'); // and the major headline
  const { post, record } = await run(query);
  const keys = post.stories.map((s) => s.key);
  assert.ok(keys.includes(keyOf('c')));
  assert.ok(!keys.includes(keyOf('a')) && !keys.includes(keyOf('b')), 'expired and archived seeds are skipped');
  assert.ok(!keys.includes('n.com/0') && !keys.includes('big.com/haiku'), 'archived stories stay out');
  assert.ok(!post.idea_ids.includes('n.com/0'));
  assert.deepEqual(record.seeds.map((s: any) => s.key), [keyOf('c')]);
});

test('a seed or archive read that throws leaves the run unchanged and is noted', async () => {
  const { query } = await freshDb();
  const plain = await run((await freshDb()).query);
  await seed(query, 'a');
  for (const hit of ["LIKE 'seed:%'", 'idea_adjustments']) {
    const broken: HubQuery = (text, params) => (text.includes(hit) ? Promise.reject(new Error('seed table gone')) : query(text, params));
    const res = await run(broken);
    assert.deepEqual(res.post.stories.map((s) => s.key), GOLDEN, `unchanged when the read of ${hit} throws`);
    assert.equal(res.record.seedError, 'seed table gone');
    assert.equal(res.jevCalls, plain.jevCalls);
    await query(`DELETE FROM lfd.posts`);
    await query(`DELETE FROM lfd.runs`);
  }
});

test('the hub lists seeds as the person’s own with the last outcome, and an archived seed is hidden', async () => {
  const { query } = await freshDb();
  const today = new Date(); // the hub's reads judge expiry by the database clock
  await seed(query, 'a', LONG, today);
  await seed(query, 'b', LONG, today);
  const ideas = async () => buildDataset(await readAll(query), null, NOW).ideas.filter((i) => i.vertical === 'last_few_days');
  let list = await ideas();
  const mine = list.filter((i) => i.yours);
  assert.deepEqual(mine.map((i) => [i.id, i.state, i.title]), [[`last_few_days:story:${keyOf('a')}`, 'idea_only', HEADLINES.a], [`last_few_days:story:${keyOf('b')}`, 'idea_only', HEADLINES.b]]);
  assert.match(mine[0]!.detail ?? '', /waits for the next run/);
  await archive(query, keyOf('b'));
  list = await ideas();
  assert.deepEqual(list.filter((i) => i.yours).map((i) => i.id), [`last_few_days:story:${keyOf('a')}`]);
  // After a run that could not use it, the reason shows.
  await query(`UPDATE lfd.settings SET value = value || '{"outcome":"thin-text"}'::jsonb WHERE key = $1`, [`seed:${keyOf('a')}`]);
  assert.match((await ideas()).find((i) => i.yours)!.detail ?? '', /last run: thin-text/);
});
