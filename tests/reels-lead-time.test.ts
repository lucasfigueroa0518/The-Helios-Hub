/**
 * Text on Screen made 2 days ahead (Bald-Eagle D4, D8; planning/bald-eagle-2026-11-12/CONTRACT.md §Lead time), offline:
 * PGlite with the real reels and hub schemas, a stubbed Jev transport and a copy client that refuses every call. No live
 * model, search, Meta or HTTP call.
 *
 * Design under test: a slate is keyed by its POSTING date. The scheduled night makes the slate for every date in
 * fillDates(runDay, 2) that still has room (cutover: day+1 then day+2; after: day+2), books each on its own date, and
 * never offers an idea already committed to another day. Run now stays on the day clicked.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { dbQuery } from '@/lib/db';
import { reelActions } from '@/lib/publishing/actions/reels';
import { madeUnbookedOn, reelsFill, reelsLeadFill, reelsPerDay, reelsRunDates, reusableVideos } from '@/lib/reels/pipeline/fill';
import { executeRun, nightTargets } from '@/lib/reels/pipeline/run';
import { scoreRun } from '@/lib/reels/pipeline/scoring';
import { reelTargetDate, schedulePostIdea, scheduleSelectedSlate, scheduleVideo, windowsStillOpen } from '@/lib/reels/publish/schedule';
import { createPostIdea, insertSource, startRun } from '@/lib/reels/repository';
import { nyDateKey } from '@/lib/reels/scoring/decide';
import type { InterpretedScore } from '@/lib/reels/scoring/interpret';
import { slateOnDayFor, todaySlateFor } from '@/lib/reels/visual/finish';
import { reelPosts } from '@/lib/social-hub/adapters/reels';
import type { ReelsRead } from '@/lib/social-hub/queries/reels';
import { fillDates } from '@/lib/social-hub/lead';
import { addDays } from '@/lib/social-hub/time';

import { PAGE, reelsDb, stub } from './fixtures/reels-seed';

delete process.env.ANTHROPIC_API_KEY; // nothing here may reach a live model

const RUN_AT = new Date('2026-11-12T06:00:00Z'); // 1:00 AM New York, Thursday Nov 12 (the night run)
const R = '2026-11-12';
const D1 = '2026-11-13';
const D2 = '2026-11-14';

const refusingCopy = { messages: { create: async () => { throw new Error('stub: copy is not called in this test'); } } } as never;
const uuid = (n: number) => `b4c00000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** The reels db with this track's SQL applied (one slate per run per date: the cutover night makes two). */
async function db(): Promise<PGlite> {
  const pg = await reelsDb({ withSlate: false });
  await pg.exec(readFileSync(path.join(process.cwd(), 'db', 'bald_eagle_2026_11_12_leadtime_reels.sql'), 'utf8'));
  return pg;
}

/** A legacy idea with one source page (scoreable by the stub Jev). Timely unless `timely: false`. */
async function idea(runId: string, n: number, opts: { timely?: boolean } = {}): Promise<string> {
  const sid = await insertSource({
    runId, canonicalUrl: `https://wire.test/lead/${n}`, headline: `Lead time story ${n}`, body: PAGE, author: null, byline: null,
    sourceName: 'Wire', sourceType: 'A1', adapterId: 'rss', bucket: 'A', publishTime: null, language: null, engagement: {},
    mediaUrls: [], citationUrls: [], rawPayload: {}, dropReason: null,
  });
  const id = await createPostIdea(sid!, runId, 'test');
  if (opts.timely === false) await dbQuery(`UPDATE reels.post_ideas SET timely = false WHERE id = $1`, [id]);
  return id;
}

async function slateRows(pg: PGlite, slateId: string) {
  return (await pg.query<{ id: string; selected: boolean; origin: string }>(
    `SELECT post_idea_id::text AS id, selected, origin FROM reels.idea_scores WHERE slate_id = $1 ORDER BY post_idea_id`, [slateId],
  )).rows;
}

async function book(pg: PGlite, ideaId: string | null, nyDate: string, slot: string, source: 'auto' | 'user' = 'auto', status = 'scheduled') {
  await pg.query(
    `INSERT INTO social_hub.schedule (vertical, idea_ref, ny_date, slot, publish_at, status, source)
     VALUES ('reels', $1, $2::date, $3, ($2::date + time '13:00') AT TIME ZONE 'America/New_York', $4, $5)`,
    [ideaId ?? randomUUID(), nyDate, slot, status, source],
  );
}

// ── which dates a run fills ─────────────────────────────────────────────────

/** The dates lead.ts lists for a night (day+1 and day+2, and the run day itself once T4a adds it). */
const WINDOW = fillDates(R, 2);
const fillAll = async (pg: PGlite, dates: readonly string[], base: number) => {
  for (const d of dates) {
    const quota = await reelsPerDay(RUN_AT, d);
    for (let i = 0; i < quota; i += 1) await book(pg, null, d, `t${String(base + i).padStart(4, '0')}`);
  }
};

test('run dates: the scheduled night fills the lead window (counting every booking); Run now fills the day clicked', () => {
  assert.deepEqual(reelsRunDates(R, 'scheduled'), { dates: WINDOW, lead: 2 });
  assert.ok(WINDOW.includes(D1) && WINDOW.includes(D2) && WINDOW.at(-1) === D2);
  assert.deepEqual(reelsRunDates(R, 'manual'), { dates: [R], lead: 0 });
});

test('night targets: cutover makes every empty date; once the earlier ones are booked only day+2; day+2 is always scored; Run now: today', async () => {
  const pg = await db();
  assert.deepEqual((await nightTargets('scheduled', R, RUN_AT)).map((t) => t.nyDate), WINDOW, 'the cutover night (D8): every date is empty');
  // Earlier nights filled the earlier dates: their quota is booked (the night's own auto bookings count when made ahead).
  const quota = await reelsPerDay(RUN_AT, D1);
  await fillAll(pg, WINDOW.slice(0, -1), 500);
  const fill = await reelsFill(RUN_AT, { nyDate: D1, lead: 2 });
  assert.equal(fill.making, 0);
  assert.equal(fill.counted, 'every');
  assert.equal((await reelsFill(RUN_AT, { nyDate: D1 })).making, quota, 'same-day counting sees only people (D54, unchanged)');
  assert.deepEqual((await nightTargets('scheduled', R, RUN_AT)).map((t) => t.nyDate), [D2], 'steady state: day+2 only');
  await fillAll(pg, [D2], 500);
  const full = await nightTargets('scheduled', R, RUN_AT);
  assert.deepEqual(full.map((t) => t.nyDate), [D2], 'every date full: the last is still scored, so tonight’s ideas carry');
  assert.equal(full[0]!.fill!.making, 0);
  assert.deepEqual((await nightTargets('manual', R, RUN_AT)).map((t) => [t.nyDate, t.lead]), [[R, 0]]);
  assert.ok((await windowsStillOpen(RUN_AT, D2)) >= 0);
});

test('S1: a date whose reels are made or being made but not booked (publishing off) is full; a rejected one leaves a hole', async () => {
  const pg = await db();
  const run = (await startRun('scheduled'))!;
  const quota = await reelsPerDay(RUN_AT, D1);
  // Every earlier date but D1 is booked full, so only D1's state decides.
  await fillAll(pg, WINDOW.slice(0, -1).filter((d) => d !== D1), 500);
  await pg.exec(`INSERT INTO reels.score_slates (id, run_id, ny_date, pass1_version, pass2_version) VALUES ('${uuid(50)}', '${run.id}', '${D1}', 'p1', 'p2')`);
  const ideas: string[] = [];
  for (let n = 0; n < quota; n += 1) {
    const id = await idea(run.id, 50 + n, { timely: false });
    ideas.push(id);
    await pg.exec(`INSERT INTO reels.idea_scores (slate_id, post_idea_id, origin, net, rank, selected, components) VALUES ('${uuid(50)}', '${id}', 'timely', 2, ${n + 1}, true, '{}'::jsonb)`);
    // One finished video; the rest still being made (the night's Generate walk).
    if (n === 0) await pg.exec(`INSERT INTO reels.video_jobs (id, post_idea_id, slate_id, status, finished_at, video_storage_path) VALUES ('${uuid(60)}', '${id}', '${uuid(50)}', 'ok', now(), 'videos/s1.mp4')`);
    else await pg.exec(`INSERT INTO reels.finish_requests (post_idea_id, slate_id, status, start_stage) VALUES ('${id}', '${uuid(50)}', 'active', 'frame')`);
  }
  assert.equal(await madeUnbookedOn(D1), quota);
  assert.deepEqual((await nightTargets('scheduled', R, RUN_AT)).map((t) => t.nyDate), [D2], 'nothing booked, but D1 is made: not written or rendered again');
  // A booked one is counted once (by its booking), not twice.
  await book(pg, ideas[0]!, D1, 'morning');
  assert.equal(await madeUnbookedOn(D1), quota - 1);
  assert.equal((await reelsLeadFill(RUN_AT, D1, 2)).making, 0);
  // A person rejected the finished one: D1 has a hole again.
  await pg.exec(`UPDATE social_hub.schedule SET status = 'cancelled' WHERE idea_ref = '${ideas[0]}';
    INSERT INTO social_hub.content_items (vertical, format, native_ref, idea_ref) VALUES ('reels', 'reel', '${uuid(60)}', '${ideas[0]}');
    INSERT INTO social_hub.approvals (content_item_id, decision, via) SELECT id, 'rejected', 'user' FROM social_hub.content_items WHERE native_ref = '${uuid(60)}';`);
  assert.equal(await madeUnbookedOn(D1), quota - 1);
  assert.deepEqual((await nightTargets('scheduled', R, RUN_AT)).map((t) => t.nyDate), [D1, D2]);
  // Run now is unchanged: its own day, plain same-day counting.
  assert.deepEqual((await nightTargets('manual', R, RUN_AT)).map((t) => t.nyDate), [R]);
});

// ── the slates: target-keyed, never the same idea twice ─────────────────────

test('cutover: two slates keyed by posting date share no picked idea; the second reuses tonight’s scores (no second Jev call)', async () => {
  const pg = await db();
  const run = (await startRun('scheduled'))!;
  const ideas: string[] = [];
  for (let n = 1; n <= 6; n += 1) ideas.push(await idea(run.id, n));
  const { calls, jev } = stub();
  const scored = new Map<string, InterpretedScore>();
  const first = await scoreRun(run.id, RUN_AT, jev, undefined, undefined, D1, scored);
  const callsAfterFirst = calls.n;
  assert.ok(callsAfterFirst > 0);
  const second = await scoreRun(run.id, RUN_AT, jev, undefined, undefined, D2, scored);
  assert.equal(calls.n, callsAfterFirst, 'the cutover night pays for each idea’s score once');

  const dates = (await pg.query<{ id: string; d: string }>(`SELECT id::text AS id, ny_date::text AS d FROM reels.score_slates`)).rows;
  assert.deepEqual(new Map(dates.map((r) => [r.id, r.d])), new Map([[first.slateId!, D1], [second.slateId!, D2]]), 'slate.ny_date = posting date');
  const picked1 = (await slateRows(pg, first.slateId!)).filter((r) => r.selected).map((r) => r.id);
  const rows2 = await slateRows(pg, second.slateId!);
  assert.equal(picked1.length, 3);
  for (const id of picked1) assert.ok(!rows2.some((r) => r.id === id), 'an idea picked for day+1 is not offered for day+2');
  assert.equal(rows2.filter((r) => r.selected).length, 3, 'day+2 picks from the rest');
});

test('steady state: an idea on the clock (any day) or picked on a not-yet-passed slate is never offered again, even when it re-joins', async () => {
  const pg = await db();
  const run = (await startRun('scheduled'))!;
  const booked = await idea(run.id, 1);
  const pickedToday = await idea(run.id, 2);
  const fresh = await idea(run.id, 3);
  // Last night's slate for D1 picked `booked` (and booked it); two nights ago, today's slate picked `pickedToday` (publishing off: no booking).
  await pg.exec(`
    INSERT INTO reels.score_slates (id, run_id, ny_date, pass1_version, pass2_version) VALUES
      ('${uuid(1)}', '${run.id}', '${D1}', 'p1', 'p2'), ('${uuid(2)}', '${run.id}', '${R}', 'p1', 'p2');
    INSERT INTO reels.idea_scores (slate_id, post_idea_id, origin, net, rank, selected, components) VALUES
      ('${uuid(1)}', '${booked}', 'timely', 2, 1, true, '{}'::jsonb), ('${uuid(2)}', '${pickedToday}', 'timely', 2, 1, true, '{}'::jsonb);`);
  await book(pg, booked, D1, 'morning');
  const { jev } = stub();
  const out = await scoreRun(run.id, RUN_AT, jev, undefined, undefined, D2);
  const ids = (await slateRows(pg, out.slateId!)).map((r) => r.id);
  assert.deepEqual(ids, [fresh], 'only the uncommitted idea is on day+2’s slate');
});

test('carryover (D55) still works: a passed day’s picked reel that never posted carries to day+2 and reuses its video; last night’s bench carries too', async () => {
  const pg = await db();
  const run = (await startRun('scheduled'))!;
  const missed = await idea(run.id, 1, { timely: false });
  const bench = await idea(run.id, 2, { timely: false });
  const video = uuid(9);
  const yesterday = addDays(R, -1);
  await pg.exec(`
    INSERT INTO reels.score_slates (id, run_id, ny_date, pass1_version, pass2_version) VALUES
      ('${uuid(1)}', '${run.id}', '${yesterday}', 'p1', 'p2'), ('${uuid(2)}', '${run.id}', '${D1}', 'p1', 'p2');
    INSERT INTO reels.idea_scores (slate_id, post_idea_id, origin, net, rank, selected, components) VALUES
      ('${uuid(1)}', '${missed}', 'timely', 2, 1, true, '{}'::jsonb), ('${uuid(2)}', '${bench}', 'timely', 1.5, 4, false, '{}'::jsonb);
    INSERT INTO reels.idea_copy (slate_id, post_idea_id, prompt_version, model, bucket, framework, status, caption, call_to_action, hashtags)
    VALUES ('${uuid(1)}', '${missed}', 'v1', 'm', 'b', 'f', 'ok', 'A new model shipped.', 'Follow for more.', ARRAY['#ai']);
    INSERT INTO reels.video_jobs (id, post_idea_id, slate_id, status, finished_at, video_storage_path)
    VALUES ('${video}', '${missed}', '${uuid(1)}', 'ok', now(), 'videos/x.mp4');
    INSERT INTO reels.song_picks (video_job_id, post_idea_id, status, finished_at, picked_audio_id, picked_title, picked_artist)
    VALUES ('${video}', '${missed}', 'ok', now(), 'aud-1', 'Song', 'Artist');`);
  // Nobody approved it before its slot yesterday: the slot was cancelled, nothing posted.
  await book(pg, missed, yesterday, 'morning', 'auto', 'cancelled');
  const { jev } = stub();
  const out = await scoreRun(run.id, RUN_AT, jev, undefined, undefined, D2);
  const rows = await slateRows(pg, out.slateId!);
  assert.deepEqual(rows.map((r) => [r.id, r.origin]).sort(), [[bench, 'carryover'], [missed, 'carryover']].sort());
  assert.deepEqual([...(await reusableVideos(out.slateId!, [missed, bench]))], [[missed, video]], 'the finished video takes its slot again');
});

test('without the SQL, a second slate for the same run says what to apply', async () => {
  await reelsDb({ withSlate: false });
  const run = (await startRun('scheduled'))!;
  await idea(run.id, 1);
  const { jev } = stub();
  await scoreRun(run.id, RUN_AT, jev, undefined, undefined, D1);
  await assert.rejects(scoreRun(run.id, RUN_AT, jev, undefined, undefined, D2), /apply db\/bald_eagle_2026_11_12_leadtime_reels\.sql/);
});

// ── booking on the target date ─────────────────────────────────────────────

/** A finished, postable reel for `idea`, picked on a slate for `slateDay`. */
async function madeReel(pg: PGlite, n: number, slateDay: string, opts: { live?: boolean } = {}): Promise<{ idea: string; slate: string; video: string }> {
  const ids = { idea: uuid(100 + n), slate: uuid(200 + n), video: uuid(300 + n) };
  const runId = uuid(400 + n);
  await pg.exec(`
    INSERT INTO reels.runs (id, trigger, status) VALUES ('${runId}', 'scheduled', 'ok');
    INSERT INTO reels.post_ideas (id) VALUES ('${ids.idea}');
    INSERT INTO reels.score_slates (id, run_id, ny_date, pass1_version, pass2_version) VALUES ('${ids.slate}', '${runId}', '${slateDay}', 'p1', 'p2');
    INSERT INTO reels.idea_scores (slate_id, post_idea_id, origin, net, rank, selected, components) VALUES ('${ids.slate}', '${ids.idea}', 'timely', 1, 1, true, '{}'::jsonb);
    INSERT INTO reels.idea_copy (slate_id, post_idea_id, prompt_version, model, bucket, framework, status, caption, call_to_action, hashtags)
    VALUES ('${ids.slate}', '${ids.idea}', 'v1', 'm', 'b', 'f', 'ok', 'A new model shipped today.', 'Follow for more.', ARRAY['#ai']);
    INSERT INTO reels.video_jobs (id, post_idea_id, slate_id, status, finished_at, video_storage_path)
    VALUES ('${ids.video}', '${ids.idea}', '${ids.slate}', 'ok', now(), 'videos/${n}.mp4');
    INSERT INTO reels.song_picks (video_job_id, post_idea_id, status, finished_at, picked_audio_id, picked_title, picked_artist)
    VALUES ('${ids.video}', '${ids.idea}', 'ok', now(), 'aud-${n}', 'Song', 'Artist');
    INSERT INTO reels.settings (key, value) VALUES ('auto_run', 'true'::jsonb), ('publishing_live', '${opts.live === false ? 'false' : 'true'}'::jsonb), ('require_approval', 'true'::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`);
  return ids;
}

const bookedDates = async (pg: PGlite, ideaId: string) =>
  (await pg.query<{ d: string; source: string; approved: boolean }>(
    `SELECT ny_date::text AS d, source, approved_at IS NOT NULL AS approved FROM social_hub.schedule WHERE idea_ref = $1 AND status = 'scheduled'`, [ideaId],
  )).rows;

test('booking: the night books a day+2 slate on day+2, never today; approving keeps that slot', async () => {
  const pg = await db();
  const reel = await madeReel(pg, 1, D2);
  assert.deepEqual(await scheduleSelectedSlate(reel.slate, RUN_AT), { scheduled: 1 });
  assert.deepEqual(await bookedDates(pg, reel.idea), [{ d: D2, source: 'auto', approved: false }]);
  // A person approves it on the morning of Nov 12: the day+2 slot is kept and approved, not moved to today.
  const out = await schedulePostIdea(reel.idea, 'user', reel.video, new Date('2026-11-12T14:00:00Z'));
  assert.ok(out.scheduled);
  assert.deepEqual(await bookedDates(pg, reel.idea), [{ d: D2, source: 'auto', approved: true }]);
});

test('approve / scheduleVideo with no slot yet book the reel’s own day+2, not today; the bench and passed days are refused', async () => {
  const pg = await db();
  const morning = new Date('2026-11-12T14:00:00Z'); // 9 AM New York: today's windows are still open
  const viaApprove = await madeReel(pg, 1, D2, { live: false });
  assert.equal(await reelTargetDate(viaApprove.idea, morning), D2);
  const a = await schedulePostIdea(viaApprove.idea, 'user', viaApprove.video, morning);
  assert.ok(a.scheduled, a.note);
  assert.deepEqual(await bookedDates(pg, viaApprove.idea), [{ d: D2, source: 'user', approved: true }]);

  const viaPublish = await madeReel(pg, 2, D1, { live: false });
  const v = await scheduleVideo(viaPublish.video, morning);
  assert.ok(v.scheduled, v.note);
  assert.deepEqual((await bookedDates(pg, viaPublish.idea)).map((r) => r.d), [D1]);

  const passed = await madeReel(pg, 3, addDays(R, -1), { live: false });
  assert.equal(await reelTargetDate(passed.idea, morning), null);
  const p = await scheduleVideo(passed.video, morning);
  assert.equal(p.scheduled, false);
  assert.match(p.note, /stay on the bench/);
});

// ── Regenerate ──────────────────────────────────────────────────────────────

test('regenerate: a reel made for day+2 is rebuilt on its own slate; a passed day is not; Run now stays on today', async () => {
  const pg = await db();
  const ahead = await madeReel(pg, 1, D2, { live: false });
  const old = await madeReel(pg, 2, addDays(R, -1), { live: false });
  const morning = new Date('2026-11-12T14:00:00Z');
  assert.equal(await todaySlateFor(ahead.idea, morning), ahead.slate);
  assert.equal(await todaySlateFor(old.idea, morning), null, 'a day that has passed is not rebuilt (SH-59)');
  assert.equal(await slateOnDayFor(ahead.idea, R), null, 'Run now builds today’s slate only');

  const requested: Array<[string, string]> = [];
  const actions = reelActions({
    todaySlate: (id: string) => todaySlateFor(id, morning),
    findReelLock: async () => null,
    requestFinish: async (id: string, slate: string) => (requested.push([id, slate]), { status: 'active', note: 'Generating.' }),
    unscheduleIdea: async () => ({ ok: false, note: '' }),
  } as never);
  const ok = await actions.regenerate!({ postIdeaId: ahead.idea } as never, 'tommy');
  assert.equal(ok.ok, true, ok.note);
  assert.deepEqual(requested, [[ahead.idea, ahead.slate]]);
  const refused = await actions.regenerate!({ postIdeaId: old.idea } as never, 'tommy');
  assert.equal(refused.ok, false);
});

// ── the board ───────────────────────────────────────────────────────────────

test('board: an unbooked Text on Screen reel shows on its posting date, not the day it was made', () => {
  const made = {
    video_job_id: uuid(1), post_idea_id: uuid(2), ny_date: D2, video_storage_path: 'videos/x.mp4', video_finished_at: '2026-11-12T07:00:00Z',
    video_slate_id: uuid(3), chosen_framework: null, chosen_bucket: null, net: null, on_screen_copy: 'Copy', headline: 'Headline',
  };
  const read = { attempts: [], schedules: [], made: [made], insights: [], sources: [], requireApproval: true } as unknown as ReelsRead;
  const [post] = reelPosts(read);
  assert.equal(post!.status, 'ready');
  assert.equal(post!.nyDate, D2);
  assert.match(post!.statusNote ?? '', /slot on its day/);
});

// ── the whole night ─────────────────────────────────────────────────────────

test('the night: cutover scores day+1 and day+2 slates; the next night only day+2; Run now makes today', async () => {
  const pg = await db();
  const intake = { readMode: async () => 'legacy' as const };
  let made = 1000;
  const night = async (trigger: 'scheduled' | 'manual') => {
    const run = (await startRun(trigger))!;
    for (let n = 1; n <= 4; n += 1) await idea(run.id, (made += 1));
    const { jev } = stub();
    const outcome = await executeRun(run, { jev, copyClient: refusingCopy, adapters: { primary: [], derived: [] }, intake });
    assert.notEqual(outcome.status, 'failed', outcome.note);
    const day = nyDateKey(new Date(run.started_at ?? run.requested_at));
    const dates = (await pg.query<{ d: string }>(`SELECT ny_date::text AS d FROM reels.score_slates WHERE run_id = $1 ORDER BY ny_date`, [run.id])).rows.map((r) => r.d);
    return { day, dates };
  };
  const first = await night('scheduled');
  // The run is real-time: a date in the window with no window left today (the run day, late) is skipped unless it is the last.
  const window = fillDates(first.day, 2);
  const expected: string[] = [];
  for (const [i, d] of window.entries()) if (i === window.length - 1 || (await windowsStillOpen(new Date(), d)) > 0) expected.push(d);
  assert.deepEqual(first.dates, expected, 'cutover (D8): every empty date, earliest first');
  assert.ok(first.dates.includes(addDays(first.day, 1)) && first.dates.includes(addDays(first.day, 2)));
  // The copy stub refuses, so nothing was made: no idea stays picked on a slate it was not made for.
  assert.equal(Number((await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM reels.idea_scores WHERE selected`)).rows[0]!.n), 0);

  // The earlier dates are now filled (what earlier nights booked): the next night makes only day+2.
  for (const d of window.slice(0, -1)) {
    const quota = await reelsPerDay(new Date(), d);
    for (let i = 0; i < quota; i += 1) await book(pg, null, d, `t${String(600 + i).padStart(4, '0')}`);
  }
  const second = await night('scheduled');
  assert.deepEqual(second.dates, [addDays(second.day, 2)]);

  const manual = await night('manual');
  assert.deepEqual(manual.dates, [manual.day], 'Run now stays on the day it was clicked');
});
