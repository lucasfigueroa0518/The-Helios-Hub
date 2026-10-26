/**
 * The AI Events engine and the worker's carry-out (plan M4), offline: PGlite with the real
 * networking, ai_events and spine schemas, the real ranking (lib/networking/pick) over a stub Jev
 * transport, and a stub render. Draws are stored and kept on a rebuild; a rebuild asks Jev
 * nothing; the pool's pins and excludes decide; a fit problem uploads nothing.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { HOOK_KEYS } from '@/lib/ai-events/hooks';
import { excludePoolEvent, clearPoolEvent, pinPoolEvent, poolWeekKey, queueRebuild, shownPoolWeekKey } from '@/lib/ai-events/pool';
import { postDateFor } from '@/lib/ai-events/run';
import { claimRun, requestRun, type ClaimedRun } from '@/lib/ai-events/store';
import { carryOutAiEventsRun, withAiEventsTimeout, type CarryOutDeps } from '@/lib/ai-events/worker';
import type { HubQuery } from '@/lib/social-hub/db';

import { addEvent, openAiEventsDb, seedAiEventsPost, stubEngine, stubJev, SUN_NOON, WEEK, type StubEngine } from './fixtures/ai-events/seed';

async function claimed(query: HubQuery, trigger: 'scheduled' | 'manual' = 'manual'): Promise<ClaimedRun> {
  await requestRun(query, trigger, 0.5);
  return (await claimRun(query, SUN_NOON))!;
}

function worker(query: HubQuery, engine: StubEngine, over: Partial<CarryOutDeps> = {}) {
  const logs: string[] = [];
  const snapshots: string[] = [];
  const w: CarryOutDeps = {
    query,
    now: () => SUN_NOON,
    log: (message) => {
      logs.push(message);
    },
    engine: async () => engine,
    snapshot: async (reason) => {
      snapshots.push(reason);
      return { url: 'https://x/events.v1.json', events: 5, picks: 4, weekKey: WEEK, changed: true, hook: { fired: false, reason: 'no_hook_url' } };
    },
    ...over,
  };
  return { w, logs, snapshots };
}

/** Two Miami events (one a partner's), three Boston events on three days and one in NYC, in the coming week (2026-W44). */
async function seedWeek(query: HubQuery) {
  return {
    miamiHub: await addEvent(query, { title: 'Miami AI Hub Demo Night', metro: 'miami', startAt: '2026-10-28T23:00:00Z', organizer: 'Miami AI Hub', guests: 20 }),
    miamiWed: await addEvent(query, { title: 'Miami Founders Breakfast', metro: 'miami', startAt: '2026-10-29T13:00:00Z', guests: 90 }),
    bostonTue: await addEvent(query, { title: 'Boston AI Builders Night', startAt: '2026-10-27T22:00:00Z', guests: 120 }),
    bostonWed: await addEvent(query, { title: 'Boston Founders Dinner', startAt: '2026-10-28T22:00:00Z', guests: 60 }),
    bostonThu: await addEvent(query, { title: 'Boston LLM Paper Club', startAt: '2026-10-29T22:00:00Z', guests: 30 }),
    nycTue: await addEvent(query, { title: 'NYC AI Demo Night', metro: 'nyc', startAt: '2026-10-27T23:00:00Z', guests: 200 }),
  };
}

type PostRow = { id: string; week_key: string; ny_date: string; status: string; hook: string; look: string; metro: string | null; bar_tier: string | null; render_version: number; event_ids: string[]; slide_objects: string[]; caption: string; render: { slides: Array<{ layoutVariant: string }> } };
const posts = async (q: HubQuery) =>
  (await q<PostRow>(`SELECT id::text AS id, week_key, ny_date::text AS ny_date, status, hook, look, metro, bar_tier, render_version, event_ids, slide_objects, caption, render FROM ai_events.posts ORDER BY created_at`)).rows;
const postFor = async (q: HubQuery, metro: string) => (await posts(q)).find((p) => p.metro === metro);

test('ai_events schema: applies twice, ships safe, one post per city per week that is not rejected', async () => {
  const { pg, query } = await openAiEventsDb();
  const sql = readFileSync(path.join(process.cwd(), 'db/ai_events_schema.sql'), 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');
  await pg.exec(sql);
  const settings = (await query<{ key: string; value: unknown }>(`SELECT key, value FROM ai_events.settings ORDER BY key`)).rows;
  assert.deepEqual(Object.fromEntries(settings.map((r) => [r.key, r.value])), { auto_run: false, days: [0], publishing_live: false, require_approval: true, run_cap_usd: 0.5 });
  await seedAiEventsPost(query);
  await assert.rejects(() => seedAiEventsPost(query, { slug: 'second' }), /idx_ai_events_posts_one_per_week_city|duplicate key/);
  await seedAiEventsPost(query, { metro: 'miami' });
  await seedAiEventsPost(query, { metro: 'boston' });
  await assert.rejects(() => seedAiEventsPost(query, { metro: 'boston', slug: 'boston-again' }), /idx_ai_events_posts_one_per_week_city|duplicate key/);
  await assert.rejects(() => query(`UPDATE ai_events.posts SET bar_tier = 'top10'`), /check constraint/);
  await query(`UPDATE ai_events.posts SET status = 'rejected'`);
  await seedAiEventsPost(query, { slug: 'second' });
  await seedAiEventsPost(query, { metro: 'boston', slug: 'boston-again' });
  await assert.rejects(() => seedAiEventsPost(query, { weekKey: '2026-W45', slug: 'w45', look: 'neon' }), /look_check|check constraint/);
  await requestRun(query, 'manual', 0.5);
  assert.equal(await requestRun(query, 'scheduled', 0.5), null, 'the single-requested index');
});

test('a manual build ranks, draws, renders, saves a ranked post per city and records the run; publishing off books nothing', async () => {
  const { query } = await openAiEventsDb();
  const ids = await seedWeek(query);
  const jev = stubJev();
  const engine = stubEngine(query, jev);
  const { w, snapshots } = worker(query, engine);
  const run = await claimed(query);
  const out = await carryOutAiEventsRun(w, run);
  assert.equal(out.status, 'ok', out.note);
  assert.deepEqual(out.scheduled, [null, null]);
  assert.equal(jev.calls.length, 6, 'every candidate asked once, NYC too (it is ranked for the site)');

  const all = await posts(query);
  assert.deepEqual(all.map((p) => p.metro), ['miami', 'boston'], 'Miami first, then Boston; no NYC or SF post');
  assert.deepEqual(out.postIds, all.map((p) => p.id));
  const miami = all[0]!;
  const boston = all[1]!;
  for (const post of all) {
    assert.deepEqual([post.week_key, post.ny_date, post.status, post.hook, post.render_version], [WEEK, '2026-10-25', 'review', 'ranked', 1]);
  }
  assert.equal(postDateFor(WEEK), '2026-10-25', 'the Sunday before the week');
  assert.notEqual(miami.look, boston.look, 'the second post draws a look the first did not use');
  assert.deepEqual([...miami.event_ids].sort(), [ids.miamiHub, ids.miamiWed].sort());
  assert.equal(miami.event_ids[0], ids.miamiHub, 'the partner is #1');
  assert.deepEqual([...boston.event_ids].sort(), [ids.bostonTue, ids.bostonWed, ids.bostonThu].sort());
  assert.equal(boston.bar_tier, 'gates', 'no history yet: anything past the gates');
  assert.deepEqual(boston.render.slides.map((s) => s.layoutVariant.replace(`ae_${boston.look}_`, '')), ['cover', 'rank', 'rank', 'tease', 'cta'], 'three ranked: #2 and #3 span the gated list');
  assert.deepEqual(miami.render.slides.map((s) => s.layoutVariant.replace(`ae_${miami.look}_`, '')), ['cover', 'rank', 'tease', 'cta']);
  assert.deepEqual(boston.slide_objects, [1, 2, 3, 4, 5].map((n) => `ai-events/ai-events-2026-w44-boston/v1/slide-0${n}.jpg`));
  assert.deepEqual(engine.uploads, [...miami.slide_objects, ...boston.slide_objects]);
  assert.match(boston.caption, /^We ranked the 3 AI networking events happening in Boston this week\./);
  assert.match(miami.caption, /^We ranked the 2 AI networking events happening in Miami this week\./);

  const items = (await query<{ native_ref: string }>(`SELECT native_ref FROM social_hub.content_items WHERE vertical = 'ai_events' ORDER BY native_ref`)).rows;
  assert.deepEqual(items.map((i) => i.native_ref), all.map((p) => p.id).sort());
  assert.equal((await query<{ n: number }>(`SELECT count(*)::int AS n FROM social_hub.schedule`)).rows[0]!.n, 0);
  assert.deepEqual(snapshots, ['ai_events run'], 'the calendar is republished once with the picks');

  const row = (await query<{ status: string; kind: string; week_key: string; ny_date: string; jev_usd: number; total_usd: number; claude_usd: number; record: Record<string, any> }>(
    `SELECT status, kind, week_key, ny_date::text AS ny_date, jev_usd, total_usd, claude_usd, record FROM ai_events.runs`,
  )).rows[0]!;
  assert.deepEqual([row.status, row.kind, row.week_key, row.ny_date, row.claude_usd], ['ok', 'build', WEEK, '2026-10-25', 0]);
  assert.ok(row.jev_usd > 0 && row.total_usd === row.jev_usd, 'Jev spend recorded; no Claude');
  assert.deepEqual(row.record.posts.map((p: { metro: string; postId: string }) => [p.metro, p.postId]), all.map((p) => [p.metro, p.id]));
  assert.deepEqual(row.record.skippedCities, []);
  assert.equal(row.record.snapshot.ok, true);
  assert.deepEqual(row.record.cities.map((c: { metro: string; picks: unknown[] }) => [c.metro, c.picks.length]), [['miami', 2], ['boston', 3], ['nyc', 1], ['sf', 0]]);
  assert.equal(row.record.cities[0].picks[0].partner, 'Miami AI Hub');
  const pool = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM ai_events.pool WHERE week_key = $1 AND picked`, [WEEK])).rows[0]!.n;
  assert.equal(pool, 6);
});

test('a city with fewer than 2 ranked events gets no post; the other city still does', async () => {
  const { query } = await openAiEventsDb();
  await addEvent(query, { title: 'Boston AI Builders Night', startAt: '2026-10-27T22:00:00Z', guests: 120 });
  await addEvent(query, { title: 'Boston Founders Dinner', startAt: '2026-10-28T22:00:00Z', guests: 60 });
  await addEvent(query, { title: 'Miami Lone Mixer', metro: 'miami', startAt: '2026-10-28T23:00:00Z', guests: 40 });
  const { w } = worker(query, stubEngine(query, stubJev()));
  const out = await carryOutAiEventsRun(w, await claimed(query));
  assert.equal(out.status, 'ok', out.note);
  assert.deepEqual((await posts(query)).map((p) => p.metro), ['boston']);
  const record = (await query<{ record: { skippedCities: Array<{ metro: string; note: string }> } }>(`SELECT record FROM ai_events.runs`)).rows[0]!.record;
  assert.deepEqual(record.skippedCities, [{ metro: 'miami', note: 'Miami has fewer than 2 ranked events this week, so there is no post.' }]);
});

test('publishing live: Miami books Sunday 6:00–7:00 PM and Boston 7:00–8:00 PM', async () => {
  const { query } = await openAiEventsDb({ publishingLive: true });
  await seedWeek(query);
  const { w } = worker(query, stubEngine(query, stubJev()));
  const out = await carryOutAiEventsRun(w, await claimed(query));
  assert.equal(out.status, 'ok', out.note);
  const [miami, boston] = out.scheduled ?? [];
  assert.ok(miami && miami >= '2026-10-25T22:00:00.000Z' && miami < '2026-10-25T23:00:00.000Z', String(miami));
  assert.ok(boston && boston >= '2026-10-25T23:00:00.000Z' && boston < '2026-10-26T00:00:00.000Z', String(boston));
  const slots = (await query<{ vertical: string; slot: string; d: string; source: string }>(`SELECT vertical, slot, ny_date::text AS d, source FROM social_hub.schedule ORDER BY publish_at`)).rows;
  assert.deepEqual(slots.map((x) => [x.vertical, x.slot, x.d, x.source]), [['ai_events', 'evening', '2026-10-25', 'auto'], ['ai_events', 'night', '2026-10-25', 'auto']]);
});

test('look draws avoid the last 2 looks and rejected posts don’t count; ranked posts draw no hook', async () => {
  const { query } = await openAiEventsDb();
  // Newest first: the Sundays before W43, W42, W41 and W40.
  const history: Array<[string, string, string, string]> = [
    ['2026-W43', '2026-10-18', 'one_event', 'spotlight'],
    ['2026-W42', '2026-10-11', 'everyones_story', 'glass'],
    ['2026-W41', '2026-10-04', 'rsvps_close', 'daylight'],
    ['2026-W40', '2026-09-27', 'dragging_friend', 'orb'],
  ];
  for (const [weekKey, nyDate, hook, look] of history) {
    await seedAiEventsPost(query, { weekKey, slug: weekKey.toLowerCase(), nyDate, hook, look });
  }
  // A rejected post never reaches the audience: its look doesn't block it.
  await seedAiEventsPost(query, { weekKey: '2026-W39', slug: 'w39', nyDate: '2026-09-20', hook: 'group_chat', look: 'daylight', status: 'rejected' });
  await seedWeek(query);
  const { w } = worker(query, stubEngine(query, stubJev()));
  assert.equal((await carryOutAiEventsRun(w, await claimed(query))).status, 'ok');
  const miami = (await postFor(query, 'miami'))!;
  const boston = (await postFor(query, 'boston'))!;
  assert.equal(miami.look, 'daylight', 'the first look neither of the last 2 used');
  assert.equal(boston.look, 'glass', 'then neither of the last 2 (Miami’s daylight and W43’s spotlight)');
  assert.deepEqual([miami.hook, boston.hook], ['ranked', 'ranked']);
});

test('pool actions and Rebuild post: pins and excludes decide, Jev is not asked again, the draws stay', async () => {
  const { query } = await openAiEventsDb();
  const ids = await seedWeek(query);
  const extra = await addEvent(query, { title: 'Boston Quiet Coffee', startAt: '2026-10-30T14:00:00Z', guests: 5 });
  const gated = await addEvent(query, { title: 'Boston Vendor Webinar', startAt: '2026-10-30T16:00:00Z', guests: 300 });
  const jev = stubJev({ 'Boston Quiet Coffee': { value: 0.1 }, 'Boston Vendor Webinar': { value: 0.9, vendor_pitch: 0.9 } });
  const engine = stubEngine(query, jev);
  const { w, snapshots } = worker(query, engine);
  assert.equal((await carryOutAiEventsRun(w, await claimed(query))).status, 'ok');
  const first = (await postFor(query, 'boston'))!;
  assert.ok(first.event_ids.includes(extra), 'no history: the bar steps down to the gates, so the weak one fills #4');
  assert.ok(!first.event_ids.includes(gated), 'gated out: never picked on its own');
  assert.equal(jev.calls.length, 8);

  // Ingested after the build and not scored yet: a rebuild leaves it for the next build.
  const late = await addEvent(query, { title: 'Boston Late Listing', startAt: '2026-10-31T16:00:00Z', guests: 250 });

  assert.equal(poolWeekKey(SUN_NOON), WEEK);
  assert.equal((await pinPoolEvent(query, gated, 'editor@example.com', SUN_NOON)).ok, true);
  assert.equal((await excludePoolEvent(query, ids.bostonWed, 'editor@example.com', SUN_NOON)).ok, true);
  assert.equal((await pinPoolEvent(query, '00000000-0000-0000-0000-000000000000', 'editor@example.com', SUN_NOON)).ok, false);
  assert.equal((await pinPoolEvent(query, 'not-a-uuid', 'editor@example.com', SUN_NOON)).ok, false);
  // Exclude then pin the same event: the newer click wins, never both.
  await excludePoolEvent(query, ids.bostonThu, 'editor@example.com', SUN_NOON);
  await clearPoolEvent(query, ids.bostonThu, SUN_NOON);
  const marks = (await query<{ event_id: string; pinned_by: string | null; excluded_by: string | null }>(
    `SELECT event_id::text AS event_id, pinned_by, excluded_by FROM ai_events.pool WHERE pinned_by IS NOT NULL OR excluded_by IS NOT NULL ORDER BY event_id`,
  )).rows;
  assert.deepEqual(new Map(marks.map((m) => [m.event_id, [m.pinned_by, m.excluded_by]])), new Map([[gated, ['editor@example.com', null]], [ids.bostonWed, [null, 'editor@example.com']]]));

  const queued = await queueRebuild(query, 'editor@example.com', SUN_NOON);
  assert.equal(queued.ok, true, queued.note);
  const run = (await claimRun(query, SUN_NOON))!;
  assert.deepEqual([run.kind, run.weekKey, run.requestedBy, run.trigger], ['rebuild', WEEK, 'editor@example.com', 'manual']);
  // A different random draw: a rebuild must keep the stored hook and look anyway.
  engine.rand = () => 0.99;
  const out = await carryOutAiEventsRun(w, run);
  assert.equal(out.status, 'ok', out.note);
  assert.equal(jev.calls.length, 8, 'a rebuild asks Jev nothing');
  assert.ok(!jev.calls.includes('Boston Late Listing'));

  const post = (await postFor(query, 'boston'))!;
  assert.equal(post.id, first.id, 'the same post row: its spine item, approval and slot stay');
  assert.deepEqual([post.hook, post.look, post.render_version], [first.hook, first.look, 2]);
  assert.equal(post.event_ids[0], gated, 'the pin is #1, gate or not');
  assert.ok(!post.event_ids.includes(ids.bostonWed), 'the exclude is out');
  assert.ok(!post.event_ids.includes(late), 'an event not scored yet is not picked by a rebuild');
  assert.ok(post.slide_objects.every((o) => o.startsWith('ai-events/ai-events-2026-w44-boston/v2/')), 'a new folder per render');
  assert.equal((await postFor(query, 'miami'))!.render_version, 2, 'Rebuild post redoes both city posts');
  assert.equal((await query<{ n: number }>(`SELECT count(*)::int AS n FROM social_hub.content_items WHERE vertical = 'ai_events'`)).rows[0]!.n, 2);
  assert.deepEqual(snapshots, ['ai_events run', 'ai_events rebuild']);
  const runRow = (await query<{ jev_usd: number }>(`SELECT jev_usd FROM ai_events.runs WHERE id = $1`, [run.id])).rows[0]!;
  assert.equal(runRow.jev_usd, 0);
});

test('the Sunday clock never redoes a city that already has a post; a published week is never rebuilt', async () => {
  const { query } = await openAiEventsDb();
  await seedWeek(query);
  await seedAiEventsPost(query, { metro: 'miami' });
  await seedAiEventsPost(query, { metro: 'boston' });
  const jev = stubJev();
  const { w } = worker(query, stubEngine(query, jev));
  const out = await carryOutAiEventsRun(w, await claimed(query, 'scheduled'));
  assert.equal(out.status, 'skipped');
  assert.match((await query<{ stop_reason: string }>(`SELECT stop_reason FROM ai_events.runs`)).rows[0]!.stop_reason, /^post-exists:/);
  assert.equal(jev.calls.length, 0);

  await query(`UPDATE ai_events.posts SET status = 'published'`);
  await queueRebuild(query, 'editor@example.com', SUN_NOON);
  const rebuilt = await carryOutAiEventsRun(w, (await claimRun(query, SUN_NOON))!);
  assert.equal(rebuilt.status, 'skipped');
  assert.match(rebuilt.note ?? '', /already past review/);
});

test('the Sunday clock makes only the city still missing its post', async () => {
  const { query } = await openAiEventsDb();
  await seedWeek(query);
  const miami = await seedAiEventsPost(query, { metro: 'miami' });
  const { w } = worker(query, stubEngine(query, stubJev()));
  const out = await carryOutAiEventsRun(w, await claimed(query, 'scheduled'));
  assert.equal(out.status, 'ok', out.note);
  const all = await posts(query);
  assert.deepEqual(all.map((p) => [p.metro, p.render_version]), [['miami', 1], ['boston', 1]]);
  assert.equal(all[0]!.id, miami);
  assert.equal(all[0]!.caption, 'Caption', 'the Miami post a person made is untouched');
});

test('a fit problem fails the run before any upload, and its Jev spend is still recorded', async () => {
  const { query } = await openAiEventsDb();
  await seedWeek(query);
  const engine = stubEngine(query, stubJev(), { problems: ['slide 2 text fit: h3 "Boston …" (overflow, min 30px)'] });
  const { w, snapshots } = worker(query, engine);
  const out = await carryOutAiEventsRun(w, await claimed(query));
  assert.equal(out.status, 'failed');
  assert.match(out.note ?? '', /render has 1 problem\(s\): slide 2 text fit/);
  assert.deepEqual(engine.uploads, []);
  assert.deepEqual(await posts(query), []);
  assert.deepEqual(snapshots, []);
  const row = (await query<{ status: string; jev_usd: number; error: string }>(`SELECT status, jev_usd, error FROM ai_events.runs`)).rows[0]!;
  assert.equal(row.status, 'failed');
  assert.ok(row.jev_usd > 0);
});

test('a week with no city post (fewer than 2 ranked events in each) is skipped; a bad cap refuses to run', async () => {
  const { query } = await openAiEventsDb();
  await addEvent(query, { title: 'Vertical only', startAt: '2026-10-27T22:00:00Z', bucket: 'vertical' });
  await addEvent(query, { title: 'Weak', startAt: '2026-10-28T22:00:00Z' });
  await addEvent(query, { title: 'Pitch', startAt: '2026-10-29T22:00:00Z' });
  const { w, snapshots } = worker(query, stubEngine(query, stubJev({ Weak: { value: 0.05 }, Pitch: { vendor_pitch: 0.9 } })));
  const out = await carryOutAiEventsRun(w, await claimed(query));
  assert.equal(out.status, 'skipped');
  assert.equal(out.note, 'Miami has fewer than 2 ranked events this week, so there is no post. Boston has fewer than 2 ranked events this week, so there is no post.');
  assert.deepEqual(await posts(query), []);
  assert.deepEqual(snapshots, []);

  await query(`UPDATE ai_events.settings SET value = '-1'::jsonb WHERE key = 'run_cap_usd'`);
  const refused = await carryOutAiEventsRun(w, await claimed(query));
  assert.equal(refused.status, 'failed');
  assert.match(refused.note ?? '', /run_cap_usd/);
});

test('a snapshot failure never fails the run; it is recorded', async () => {
  const { query } = await openAiEventsDb();
  await seedWeek(query);
  const { w, logs } = worker(query, stubEngine(query, stubJev()), {
    snapshot: async () => {
      throw new Error('bucket not found');
    },
  });
  const out = await carryOutAiEventsRun(w, await claimed(query));
  assert.equal(out.status, 'ok');
  assert.ok(logs.includes('ai_events_snapshot_failed'));
  const record = (await query<{ record: { snapshot: { ok: boolean; error: string } } }>(`SELECT record FROM ai_events.runs`)).rows[0]!.record;
  assert.deepEqual(record.snapshot, { ok: false, error: 'bucket not found' });
});

test('withAiEventsTimeout answers with onTimeout when the work hangs', async () => {
  const hung = new Promise<string>(() => undefined);
  assert.equal(await withAiEventsTimeout(hung, 5, () => 'timed out'), 'timed out');
  assert.equal(await withAiEventsTimeout(Promise.resolve('done'), 1000, () => 'timed out'), 'done');
});

test('mid-week pool actions act on the week the hub shows, never a week the event is not in', async () => {
  const { query } = await openAiEventsDb();
  const ids = await seedWeek(query);
  const { w } = worker(query, stubEngine(query, stubJev()));
  assert.equal((await carryOutAiEventsRun(w, await claimed(query))).status, 'ok');
  // Wednesday of the week in progress: the coming week is W45, but the hub still shows W44's pool.
  const WED = new Date('2026-10-28T15:00:00Z');
  assert.equal(poolWeekKey(WED), '2026-W45');
  assert.equal(await shownPoolWeekKey(query, WED), WEEK);
  assert.equal((await excludePoolEvent(query, ids.bostonThu, 'editor@example.com', WED)).ok, true);
  const weeks = (await query<{ week_key: string; excluded_by: string | null }>(`SELECT DISTINCT week_key, excluded_by FROM ai_events.pool WHERE event_id = $1`, [ids.bostonThu])).rows;
  assert.deepEqual(weeks, [{ week_key: WEEK, excluded_by: 'editor@example.com' }], 'no orphan row in W45');
  assert.equal((await query<{ n: number }>(`SELECT count(*)::int AS n FROM ai_events.pool WHERE week_key <> $1`, [WEEK])).rows[0]!.n, 0);
  assert.equal((await clearPoolEvent(query, ids.bostonThu, WED)).ok, true);
  // An event outside the shown week is refused and nothing is written.
  const next = await addEvent(query, { title: 'Boston Next Week Night', startAt: '2026-11-03T22:00:00Z' });
  const out = await pinPoolEvent(query, next, 'editor@example.com', WED);
  assert.equal(out.ok, false);
  assert.match(out.note, /not in the pool's week \(2026-10-26 to 2026-11-01\)/);
  assert.equal((await query(`SELECT 1 FROM ai_events.pool WHERE event_id = $1`, [next])).rows.length, 0);
  assert.equal((await queueRebuild(query, 'editor@example.com', WED)).ok, true);
  assert.deepEqual((await query<{ week_key: string }>(`SELECT week_key FROM ai_events.runs WHERE kind = 'rebuild'`)).rows, [{ week_key: WEEK }]);
});

test('a pinned event that was never scored still goes in on a rebuild (a pin is a person’s call)', async () => {
  const { query } = await openAiEventsDb();
  await seedWeek(query);
  const jev = stubJev();
  const { w } = worker(query, stubEngine(query, jev));
  assert.equal((await carryOutAiEventsRun(w, await claimed(query))).status, 'ok');
  const late = await addEvent(query, { title: 'Boston Late Listing', startAt: '2026-10-30T23:00:00Z', guests: 40 });
  assert.equal((await pinPoolEvent(query, late, 'editor@example.com', SUN_NOON)).ok, true);
  assert.equal((await queueRebuild(query, 'editor@example.com', SUN_NOON)).ok, true);
  const calls = jev.calls.length;
  const out = await carryOutAiEventsRun(w, (await claimRun(query, SUN_NOON))!);
  assert.equal(out.status, 'ok', out.note);
  assert.equal(jev.calls.length, calls, 'still no Jev call');
  const post = (await postFor(query, 'boston'))!;
  assert.equal(post.event_ids[0], late, 'the unscored pin is in, as #1');
  const row = (await query<{ picked: boolean; pick_rank: number; score: string | null; gate: string | null }>(`SELECT picked, pick_rank, score, gate FROM ai_events.pool WHERE event_id = $1`, [late])).rows[0]!;
  assert.deepEqual([row.picked, row.pick_rank, row.score, row.gate], [true, 1, null, null]);
});
