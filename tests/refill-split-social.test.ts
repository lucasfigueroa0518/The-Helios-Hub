/**
 * The refill split for the helios-social and helios-stories types (settings standard D3, D14, D16; CONTRACT.md §4),
 * offline: PGlite with the real schemas, stub Jev, Claude and render transports. Refill runs in every state and is
 * never stopped by a full quota; each refill is held to its cap and logs `refill_capped`; making follows
 * makesPosts(state); scheduling follows postsToInstagram(state); retired series never refill. No network, no model.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { after, before } from 'node:test';

import { noonQueue as aiEventsNoon } from '@/lib/ai-events/clock';
import { parseAiEventsSettings } from '@/lib/ai-events/settings';
import { claimRun as claimAiEventsRun, requestRun as requestAiEventsRun } from '@/lib/ai-events/store';
import { carryOutAiEventsRun } from '@/lib/ai-events/worker';
import { noonQueue as fieldNotesNoon, refillNight } from '@/lib/field-notes/clock';
import { parseFieldNotesSettings } from '@/lib/field-notes/settings';
import { claimRun as claimFieldNotesRun, requestRun as requestFieldNotesRun } from '@/lib/field-notes/store';
import type { TipCandidate } from '@/lib/field-notes/sources/candidate';
import { carryOutFieldNotesRun } from '@/lib/field-notes/worker';
import { INTAKE_ORDERS, openOrders } from '@/lib/intake/orders';
import type { IntakeQuery } from '@/lib/intake/types';
import { threeAmQueue } from '@/lib/lfd/clock';
import { parseLfdSettings } from '@/lib/lfd/settings';
import { claimRun as claimLfdRun, finishRun as finishLfdRun, requestRun as requestLfdRun } from '@/lib/lfd/store';
import type { LfdRunDeps } from '@/lib/lfd/run';
import { carryOutLfdRun } from '@/lib/lfd/worker';
import { EMPTY_LEDGER } from '@/lib/photos/used';
import type { HubQuery } from '@/lib/social-hub/db';
import { carouselNight, threeAmRequests } from '@/lib/social/overnight/night';
import { readStoriesRefillCap, readTypeGate, resetMismatchLog, typeGate } from '@/lib/social/refill';
import { createStoriesJev } from '@/lib/stories/jev';
import { gatherPool, POOL_SERIES } from '@/lib/stories/pool';
import { requestSet } from '@/lib/stories/repository';
import { runRoaDaily } from '@/lib/stories/roa/daily';
import { requestAutoSets } from '@/lib/stories/schedule';
import { DEFAULT_SETTINGS, loadSettings, saveSeriesSetting, saveTypeSetting } from '@/lib/stories/settings';
import { runTriviaDaily, type RefillBudget } from '@/lib/stories/trivia/daily';
import { tick } from '@/lib/stories/worker';

import { addEvent, openAiEventsDb, stubEngine as aiEventsEngine, stubJev as aiEventsJev, SUN_NOON } from './fixtures/ai-events/seed';
import { addPool, freshDb, NOW as FN_NOW, setSetting, stubEngine as fieldNotesEngine } from './fixtures/field-notes/run/seed';
import { seedLfdPost } from './fixtures/lfd/seed';
import { openHubTestDb } from './fixtures/social-hub/pglite';
import { harnessDb, stubJev as storiesJev, stubWriter } from './stories-harness';

// Rule 1: no network of any kind. The injected clients are the only transports.
const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (async () => {
    throw new Error('network is off in tests');
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
});

type Logged = Array<{ message: string; fields?: Record<string, unknown> }>;
const recorder = () => {
  const logs: Logged = [];
  return { logs, log: (message: string, fields?: Record<string, unknown>) => void logs.push({ message, fields }) };
};
const has = (logs: Logged, message: string) => logs.some((l) => l.message === message);

/* ── The shared gate ─────────────────────────────────────────────────── */

test('the gate: stateOf over the stored pair; Live is the only state that posts; Generate off + Live on reads as paused and logs state_mismatch', () => {
  resetMismatchLog();
  const { logs, log } = recorder();
  const paused = typeGate('carousels', { generate: false, live: false }, log);
  assert.deepEqual([paused.state, paused.makes, paused.posts, paused.mismatch], ['paused', false, false, false]);
  const approval = typeGate('carousels', { generate: 'true', live: null }, log);
  assert.deepEqual([approval.state, approval.makes, approval.posts], ['approval', true, false]);
  const live = typeGate('carousels', { generate: true, live: true }, log);
  assert.deepEqual([live.state, live.makes, live.posts], ['live', true, true]);
  const mismatch = typeGate('carousels', { generate: false, live: true }, log, 1_000);
  assert.deepEqual([mismatch.state, mismatch.mismatch, mismatch.makes, mismatch.posts], ['paused', true, false, false]);
  assert.deepEqual(logs.map((l) => l.message), ['state_mismatch']);
  typeGate('carousels', { generate: false, live: true }, log, 2_000);
  assert.equal(logs.length, 1, 'repeated mismatches stay quiet for an hour (the loop reads every 15 seconds)');
  // Refill caps (D14): stored when positive, else the type's default.
  assert.equal(typeGate('carousels', { generate: false, live: false, refillCap: 0.1 }).refillCapUsd, 0.1);
  assert.equal(typeGate('carousels', { generate: false, live: false, refillCap: 0 }).refillCapUsd, 0.25);
  assert.equal(typeGate('field_notes', { generate: false, live: false }).refillCapUsd, 0.5);
});

test('readTypeGate reads the stored keys; an unreadable table reads as paused (refill still runs, nothing is made or posted)', async () => {
  const q = async (text: string) => {
    if (text.includes('social.settings')) return { rows: [{ key: 'auto_run', value: true }, { key: 'publishing_live', value: false }, { key: 'pool_refill_cap_usd', value: 0.2 }] };
    throw new Error('relation does not exist');
  };
  const carousels = await readTypeGate(q, 'carousels');
  assert.deepEqual([carousels.state, carousels.refillCapUsd], ['approval', 0.2]);
  const { logs, log } = recorder();
  const lfd = await readTypeGate(q, 'last_few_days', log);
  assert.deepEqual([lfd.state, lfd.makes, lfd.posts, lfd.refillCapUsd], ['paused', false, false, 0.25]);
  assert.ok(has(logs, 'state_read_failed'));
});

/* ── 1. Intake: every order open in every state ──────────────────────── */

test('intake: every order is open whatever each type’s state, and none reads a settings table (D16)', async () => {
  const reads: string[] = [];
  const q: IntakeQuery = {
    async query() {
      reads.push('read');
      throw new Error('no read expected');
    },
  };
  assert.deepEqual((await openOrders(q, new Date())).map((o) => o.id), ['lfd', 'md', 'reels', 'carousel', 'field-notes', 'trivia']);
  assert.deepEqual(reads, []);
  // Retired series have no order at all (Free vs. Paid 'fvp', Guess the Number): they never refill.
  assert.ok(!INTAKE_ORDERS.some((o) => ['fvp', 'gtn'].includes(o.id as string)));
});

test('intake: the run caps stay as they were (main $0.50, top-up $0.15); a per-type cap is not applied there', async () => {
  const types = await import('@/lib/intake/types');
  assert.deepEqual([types.INTAKE_MAIN_CAP_USD, types.INTAKE_TOPUP_CAP_USD], [0.5, 0.15]);
  assert.match(readFileSync(path.join(process.cwd(), 'lib/intake/orders.ts'), 'utf8'), /does not attribute cost to one type/);
});

/* ── 2. Carousels: refill is the run's selection, every night ────────── */

const lfdOn = parseLfdSettings([{ key: 'auto_run', value: true }]);
const lfdOff = parseLfdSettings([]);

test('carousels: the 3:00 clock queues the carousel run every night: make on its nights, refill otherwise (paused, LFD day)', () => {
  const caps = { lfdRunCapUsd: 1, carouselRunCapUsd: 2, refillCapUsd: 0.25 };
  const make = threeAmRequests(threeAmQueue('2026-10-14', lfdOn, true), caps);
  assert.deepEqual(make, { lfd: false, carousel: { mode: 'make', capUsd: 2, reason: 'auto_run is on' } });
  const paused = threeAmRequests(threeAmQueue('2026-10-14', lfdOff, false), caps);
  assert.deepEqual([paused.lfd, paused.carousel.mode, paused.carousel.capUsd], [false, 'refill', 0.25]);
  const lfdDay = threeAmRequests(threeAmQueue('2026-10-13', lfdOn, true), caps);
  assert.deepEqual([lfdDay.lfd, lfdDay.carousel.mode, lfdDay.carousel.capUsd], [true, 'refill', 0.25], 'Last Few Days makes; the carousel pool still refills');
  // Template mode, an LFD day with LFD paused: neither makes, the carousel pool still refills.
  const literal = threeAmRequests(threeAmQueue('2026-10-13', lfdOff, true, true), caps);
  assert.deepEqual([literal.lfd, literal.carousel.mode], [false, 'refill']);
});

test('carousels: a full quota never skips the run; it refills (no story) under min(run cap, refill cap)', () => {
  const makeSlot = { queue: 'carousels' as const, reason: 'auto_run is on' };
  const full = carouselNight({ slot: makeSlot, fill: { stories: 0, note: 'Daily fill: people placed 2 carousels.' }, runStories: 2, runCapUsd: 2, refillCapUsd: 0.25 });
  assert.deepEqual(full, { stories: 0, capUsd: 0.25, refillOnly: 'Daily fill: people placed 2 carousels.' });
  assert.deepEqual(carouselNight({ slot: makeSlot, fill: { stories: 1, note: '' }, runStories: 2, runCapUsd: 2, refillCapUsd: 0.25 }), { stories: 1, capUsd: 2, refillOnly: null });
  assert.deepEqual(carouselNight({ slot: makeSlot, fill: null, runStories: 2, runCapUsd: 2, refillCapUsd: 0.25 }), { stories: 2, capUsd: 2, refillOnly: null }, 'an unreadable fill makes run_stories, as before');
  const paused = carouselNight({ slot: { queue: 'none', reason: 'auto_run is off' }, fill: { stories: 2, note: '' }, runStories: 2, runCapUsd: 0.25, refillCapUsd: 0.25 });
  assert.deepEqual([paused.stories, paused.refillOnly], [0, 'auto_run is off']);
  // A person's manual run (no slot) makes posts in every state; a full day still refills rather than skipping.
  assert.equal(carouselNight({ slot: null, fill: { stories: 2, note: '' }, runStories: 2, runCapUsd: 2, refillCapUsd: 0.25 }).stories, 2);
  assert.equal(carouselNight({ slot: null, fill: { stories: 0, note: 'full' }, runStories: 2, runCapUsd: 2, refillCapUsd: 0.1 }).capUsd, 0.1);
});

test('carousels: the worker never skips for the quota, schedules only while Live, and never reads approval as off', () => {
  const text = readFileSync(path.join(process.cwd(), 'scripts/social_worker.ts'), 'utf8');
  assert.doesNotMatch(text, /skipRun\(/, 'no quota-filled skip');
  assert.doesNotMatch(text, /requireApproval\(\)|\.requireApproval\b/, 'require_approval is never read');
  assert.doesNotMatch(text, /publishingLive\(\)|\?\.publishingLive/, 'publishing follows the state, not publishing_live alone');
  assert.match(text, /if \(!rerun && \(await readTypeGate\(lfdQuery, 'carousels', log\)\)\.posts\)/);
  assert.match(text, /\(await standDown\(\)\) && \(await readTypeGate\(lfdQuery, 'carousels', log\)\)\.posts/);
  assert.match(text, /logRefillCapped\(log, 'carousels'/);
  // A refill-only run uses no hand placements: they stay for the next night that makes stories.
  assert.ok(text.indexOf("log('run_refill_complete'") < text.indexOf('await finishNightPlacements(query'));
});

/* ── 3. Last Few Days: the intake is its refill; the run is the make step ── */

const TUE_3 = new Date('2026-10-13T07:00:00Z');

function lfdWorker(query: HubQuery) {
  const { logs, log } = recorder();
  const calls = { engine: 0 };
  return {
    logs,
    calls,
    w: {
      query,
      now: () => TUE_3,
      log,
      engine: async () => {
        calls.engine += 1;
        return { query } as unknown as LfdRunDeps;
      },
      run: async (d: LfdRunDeps) => {
        const postId = await seedLfdPost(query, { nyDate: '2026-10-13' });
        await finishLfdRun(query, d.runId!, { status: 'ok', claudeUsd: 0, jevUsd: 0, record: {} });
        return { ok: true as const, runId: d.runId!, postId, stories: 6, short: false };
      },
    },
  };
}

test('last few days: paused, the scheduled run makes nothing; a person’s Make now still works; Live with Generate off books nothing', async () => {
  resetMismatchLog();
  const { query } = await openHubTestDb();
  await requestLfdRun(query, 'scheduled', 1);
  const a = lfdWorker(query);
  const skipped = await carryOutLfdRun(a.w, (await claimLfdRun(query, TUE_3))!);
  assert.equal(skipped.status, 'skipped');
  assert.equal(a.calls.engine, 0, 'no make step while paused');
  assert.match((await query<{ stop_reason: string }>(`SELECT stop_reason FROM lfd.runs WHERE id = $1`, [skipped.runId])).rows[0]!.stop_reason, /^paused: /);

  await query(`UPDATE lfd.settings SET value = 'true'::jsonb WHERE key = 'publishing_live'`);
  await requestLfdRun(query, 'manual', 1);
  const b = lfdWorker(query);
  const made = await carryOutLfdRun(b.w, (await claimLfdRun(query, TUE_3))!);
  assert.equal(made.status, 'ok', 'Make now runs in every state');
  assert.equal(made.scheduled, null, 'Generate off + Live on reads as paused: nothing is booked');
  assert.equal((await query<{ n: number }>(`SELECT count(*)::int AS n FROM social_hub.schedule`)).rows[0]!.n, 0);
  assert.ok(has(b.logs, 'state_mismatch'));
});

/* ── 4. AI Events: the weekly ranking is the refill ──────────────────── */

async function aiEventsWeek(query: HubQuery, n: number) {
  for (let i = 0; i < n; i++) {
    await addEvent(query, { title: `Boston AI Night ${i}`, startAt: `2026-10-${27 + (i % 3)}T22:00:00Z`, guests: 50 + i });
    await addEvent(query, { title: `Miami AI Night ${i}`, metro: 'miami', startAt: `2026-10-${27 + (i % 3)}T23:00:00Z`, guests: 40 + i });
  }
}

async function aiEventsScheduled(query: HubQuery) {
  await requestAiEventsRun(query, 'scheduled', 0.25);
  return (await claimAiEventsRun(query, SUN_NOON))!;
}

test('ai events: the noon clock queues in every state; paused, the run only ranks the week', () => {
  const sunday = new Date('2026-10-25T16:00:00Z');
  assert.deepEqual(aiEventsNoon(sunday, parseAiEventsSettings([])), { queue: true, make: false, reason: 'an AI Events day; AI Events is paused, so the run only ranks the week (refill)' });
  assert.equal(aiEventsNoon(sunday, parseAiEventsSettings([{ key: 'auto_run', value: true }])).make, true);
  assert.equal(aiEventsNoon(new Date('2026-10-26T16:00:00Z'), parseAiEventsSettings([])).queue, false, 'the Sunday cadence holds');
});

test('ai events: paused, the scheduled run ranks the pool (refill) and renders, books and publishes nothing; Generate still makes posts', async () => {
  const { query } = await openAiEventsDb({ publishingLive: true });
  await aiEventsWeek(query, 2);
  const jev = aiEventsJev();
  const engine = aiEventsEngine(query, jev);
  const { logs, log } = recorder();
  const snapshots: string[] = [];
  const w = { query, now: () => SUN_NOON, log, engine: async () => engine, snapshot: async (r: string) => (snapshots.push(r), {}) };
  const out = await carryOutAiEventsRun(w, await aiEventsScheduled(query));
  assert.equal(out.status, 'skipped');
  assert.ok(jev.calls.length > 0, 'the week was ranked');
  assert.ok((await query<{ n: number }>(`SELECT count(*)::int AS n FROM ai_events.pool`)).rows[0]!.n > 0, 'ai_events.pool refilled');
  assert.deepEqual([engine.uploads.length, snapshots.length], [0, 0], 'nothing rendered, nothing published');
  assert.equal((await query<{ n: number }>(`SELECT count(*)::int AS n FROM ai_events.posts`)).rows[0]!.n, 0);
  const row = (await query<{ stop_reason: string; jev_usd: number; record: { refillOnly: boolean } }>(`SELECT stop_reason, jev_usd, record FROM ai_events.runs`)).rows[0]!;
  assert.match(row.stop_reason, /^paused: /);
  assert.ok(row.jev_usd > 0 && row.record.refillOnly);
  assert.ok(has(logs, 'state_mismatch'), 'Live with Generate off reads as paused');

  // A person's Generate makes posts in every state; while not Live it books nothing.
  await requestAiEventsRun(query, 'manual', 0.5);
  const made = await carryOutAiEventsRun(w, (await claimAiEventsRun(query, SUN_NOON))!);
  assert.equal(made.status, 'ok', made.note);
  assert.deepEqual(made.scheduled, [null, null]);
});

test('ai events: the refill cap stops the ranking and logs refill_capped', async () => {
  const { query } = await openAiEventsDb();
  await query(`INSERT INTO ai_events.settings (key, value) VALUES ('pool_refill_cap_usd', '0.000001'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  await aiEventsWeek(query, 6);
  const jev = aiEventsJev();
  const { logs, log } = recorder();
  const w = { query, now: () => SUN_NOON, log, engine: async () => aiEventsEngine(query, jev), snapshot: async () => ({}) };
  const out = await carryOutAiEventsRun(w, await aiEventsScheduled(query));
  assert.equal(out.status, 'skipped');
  assert.ok(jev.calls.length < 12, `the cap refused some calls (${jev.calls.length} of 12 asked)`);
  const capped = logs.find((l) => l.message === 'refill_capped');
  assert.ok(capped, logs.map((l) => l.message).join(','));
  assert.deepEqual([capped!.fields!.type, capped!.fields!.capUsd], ['ai_events', 0.000001]);
});

/* ── 5. Field Notes: tip sourcing is the refill ──────────────────────── */

const fnCandidates = (n: number): TipCandidate[] =>
  Array.from({ length: n }, (_, i) => ({
    sourceUrl: `https://docs.example.com/refill-${i}`,
    sourceKind: 'docs' as const,
    sourceLabel: `Refill docs ${i}`,
    publishedAt: '2026-11-01T00:00:00Z',
    item: {} as TipCandidate['item'],
    untrustedContent: `Refill docs ${i}\n\nOpen the settings and switch it on. Type /review after a run.`,
  }));

test('field notes: paused queues no post run, but a Field Notes day still queues the refill (Tue/Fri cadence)', () => {
  const paused = parseFieldNotesSettings([]);
  const tue = new Date('2026-11-03T07:00:00Z'); // 2:00 AM New York, Tuesday
  assert.equal(fieldNotesNoon(tue, paused).queue, false);
  assert.deepEqual(refillNight(tue, paused), { queue: true, reason: '2026-11-03 is a Field Notes day: the tip pool refills' });
  assert.equal(refillNight(new Date('2026-11-04T07:00:00Z'), paused).queue, false, 'Wednesday is not a Field Notes day');
  assert.equal(refillNight(tue, paused, true).queue, false, 'never twice a night');
  assert.equal(refillNight(tue, null).queue, false);
  assert.equal(refillNight(new Date('2026-11-04T07:00:00Z'), paused, null, () => true).queue, true, 'template mode: a calendar slot makes the day');
});

test('field notes: a refill-only run finds and scores new tips, makes no post and spends no Claude', async () => {
  const { query } = await freshDb();
  await addPool(query, 6);
  const engine = fieldNotesEngine(query, { config: { questionsApproved: true }, collect: async () => fnCandidates(3) });
  const { logs, log } = recorder();
  await requestFieldNotesRun(query, 'scheduled', 0.25, { refillOnly: true });
  const claimed = (await claimFieldNotesRun(query, FN_NOW))!;
  assert.equal(claimed.refillOnly, true);
  const out = await carryOutFieldNotesRun({ query, now: () => FN_NOW, log, engine: async () => engine }, claimed);
  assert.equal(out.status, 'skipped', out.note);
  const row = (await query<{ stop_reason: string; claude_usd: number; jev_usd: number; record: { refill: { capped: boolean } } }>(`SELECT stop_reason, claude_usd, jev_usd, record FROM field_notes.runs WHERE id = $1`, [claimed.id])).rows[0]!;
  assert.match(row.stop_reason, /^refill-only: /);
  assert.equal(Number(row.claude_usd), 0);
  assert.ok(Number(row.jev_usd) > 0, 'the scoring was paid and recorded');
  assert.equal((await query<{ n: number }>(`SELECT count(*)::int AS n FROM field_notes.tips WHERE source_kind = 'docs'`)).rows[0]!.n, 3);
  assert.equal((await query<{ n: number }>(`SELECT count(*)::int AS n FROM field_notes.posts`)).rows[0]!.n, 0);
  assert.equal(engine.claudeStub.calls.length, 0);
  assert.equal(row.record.refill.capped, false);
  assert.ok(!has(logs, 'refill_capped'));
});

test('field notes: a post run refills before anything can end it (photos short still refills)', async () => {
  const { query } = await freshDb();
  const engine = fieldNotesEngine(query, { config: { questionsApproved: true }, collect: async () => fnCandidates(2) });
  await requestFieldNotesRun(query, 'manual', 0.5);
  const out = await carryOutFieldNotesRun({ query, now: () => FN_NOW, log: () => {}, engine: async () => engine }, (await claimFieldNotesRun(query, FN_NOW))!);
  assert.equal(out.status, 'skipped');
  assert.match(out.note ?? '', /photo/i);
  assert.equal((await query<{ n: number }>(`SELECT count(*)::int AS n FROM field_notes.tips WHERE source_kind = 'docs'`)).rows[0]!.n, 2, 'the tips were found and stored');
});

test('field notes: the refill cap stops the scoring and logs refill_capped', async () => {
  const { query } = await freshDb();
  // Below one call's reserve: no scoring call may start.
  await setSetting(query, 'pool_refill_cap_usd', 0.05);
  const engine = fieldNotesEngine(query, { config: { questionsApproved: true }, collect: async () => fnCandidates(3) });
  const { logs, log } = recorder();
  await requestFieldNotesRun(query, 'scheduled', 0.05, { refillOnly: true });
  const out = await carryOutFieldNotesRun({ query, now: () => FN_NOW, log, engine: async () => engine }, (await claimFieldNotesRun(query, FN_NOW))!);
  assert.equal(out.status, 'skipped');
  assert.equal(engine.jevStub.calls, 0);
  assert.equal((await query<{ n: number }>(`SELECT count(*)::int AS n FROM field_notes.tips`)).rows[0]!.n, 0, 'nothing unscored is saved');
  const capped = logs.find((l) => l.message === 'refill_capped');
  assert.deepEqual([capped?.fields?.type, capped?.fields?.capUsd], ['field_notes', 0.05]);
});

/* ── 6. Stories types ────────────────────────────────────────────────── */

const STORIES_3AM = new Date('2026-10-08T07:00:00Z'); // 3:00 AM New York, Thursday

function storiesDeps(db: Awaited<ReturnType<typeof harnessDb>>['db'], now: Date, o: { capped?: boolean } = {}) {
  const lines: string[] = [];
  const refills: Array<{ type: string; budget?: RefillBudget }> = [];
  return {
    lines,
    refills,
    deps: {
      db,
      sourceDb: db,
      now: () => now,
      log: (line: string) => void lines.push(line),
      poolReads: () => ({ morning: async () => ({ reels: [], carousel: [] }), leads: async () => [] }),
      triviaDaily: async (_at: Date, _s: unknown, budget?: RefillBudget) => (refills.push({ type: 'ai_trivia', budget }), { ran: true, capped: o.capped ?? false }),
      roaDaily: async (_at: Date, _s: unknown, budget?: RefillBudget) => (refills.push({ type: 'real_or_ai', budget }), { ran: true, capped: o.capped ?? false }),
      builder: async () => {
        throw new Error('nothing is built while every type is paused');
      },
      meta: () => {
        throw new Error('nothing posts');
      },
      storage: () => {
        throw new Error('not used');
      },
      insights: () => {
        throw new Error('not used');
      },
    },
  };
}

test('stories: every type paused, the 3:00 pass still refreshes the pool and runs both daily refills, each with its refill cap; nothing is made', async () => {
  const { db } = await harnessDb();
  const settings = await loadSettings(db);
  assert.ok(Object.values(settings.series).every((s) => !s.auto), 'every series paused');
  const { deps, refills, lines } = storiesDeps(db, STORIES_3AM);
  const out = await tick(deps as never);
  assert.deepEqual(out, { built: 0, scheduled: 0, published: 0, insights: 0 });
  assert.deepEqual(refills.map((r) => [r.type, r.budget?.capUsd]), [['ai_trivia', 0.25], ['real_or_ai', 0.25]]);
  assert.ok(lines.some((l) => l.startsWith('pool: refreshed')), lines.join('\n'));
  assert.equal((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM stories.sets`)).rows[0]!.n, 0, 'no auto set while paused');
});

test('stories: a refill that stops for its cap logs refill_capped; the stored cap is read per type', async () => {
  const { db } = await harnessDb();
  await db.query(
    `INSERT INTO stories.settings (key, value) VALUES ('types', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify({ ai_trivia: { refill_cap_usd: 0.1 } })],
  );
  assert.equal(await readStoriesRefillCap((t, p) => db.query(t, p), 'ai_trivia'), 0.1);
  assert.equal(await readStoriesRefillCap((t, p) => db.query(t, p), 'real_or_ai'), 0.25);
  const { deps, refills, lines } = storiesDeps(db, STORIES_3AM, { capped: true });
  await tick(deps as never);
  assert.equal(refills[0]!.budget!.capUsd, 0.1);
  const capped = lines.filter((l) => l.startsWith('refill_capped '));
  assert.deepEqual(capped.map((l) => JSON.parse(l.slice('refill_capped '.length)).type), ['ai_trivia', 'real_or_ai']);
});

test('stories: the daily writers start no paid call once the refill cap is spent', async () => {
  const { db } = await harnessDb();
  const spent: RefillBudget = { capUsd: 0.25, canSpend: async () => false };
  const writer = stubWriter({});
  const trivia = await runTriviaDaily({ db, jev: createStoriesJev(storiesJev(), db), write: writer, settings: DEFAULT_SETTINGS, now: STORIES_3AM, intake: { readMode: async () => 'legacy' }, refill: spent });
  assert.ok(trivia.ran && trivia.capped);
  assert.equal(writer.calls.length, 0);
  const roa = await runRoaDaily({ db, sourceDb: db, write: writer, settings: DEFAULT_SETTINGS, now: STORIES_3AM, finder: 'legacy', used: async () => EMPTY_LEDGER, photoBank: null, storage: { upload: async () => undefined } as never, refill: spent });
  assert.ok(roa.ran && roa.capped);
  assert.equal(writer.calls.length, 0);
});

test('stories: retired series never refill or make, even with their stored switches on', async () => {
  const { db } = await harnessDb();
  await db.query(
    `INSERT INTO stories.settings (key, value) VALUES ('series', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify({ free_vs_paid: { enabled: true, auto: true }, guess_the_number: { enabled: true, auto: true } })],
  );
  assert.deepEqual(POOL_SERIES, ['morning_download', 'ai_trivia', 'real_or_ai']);
  const gathered = await gatherPool({ morning: async () => ({ reels: [], carousel: [] }), leads: async () => [{ name: 'x' } as never] }, STORIES_3AM);
  assert.deepEqual(gathered.refreshed, ['morning_download'], 'only Morning Download is read; Free vs. Paid’s leads are not');
  assert.deepEqual(await requestAutoSets(db, await loadSettings(db), STORIES_3AM), []);
  const { deps, refills } = storiesDeps(db, STORIES_3AM);
  await tick(deps as never);
  assert.deepEqual(refills.map((r) => r.type), ['ai_trivia', 'real_or_ai']);
  const { rows } = await db.query<{ series: string }>(`SELECT DISTINCT series FROM stories.pool`);
  assert.ok(rows.every((r) => !['free_vs_paid', 'guess_the_number'].includes(r.series)));
  assert.equal((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM stories.sets WHERE series IN ('free_vs_paid', 'guess_the_number')`)).rows[0]!.n, 0);
});

test('stories: an approved set is scheduled only while its type is Live; Live with Generate off reads as paused (state_mismatch)', async () => {
  const { db } = await harnessDb();
  const before3 = new Date('2026-10-08T06:00:00Z'); // 2:00 AM New York: no refill or auto pass, only steps 3–5
  const { set } = await requestSet(db, { series: 'ai_trivia', nyDate: '2026-10-08', trigger: 'click', style: DEFAULT_SETTINGS.series.ai_trivia.style });
  await db.query(`UPDATE stories.sets SET status = 'approved' WHERE id = $1`, [set.id]);
  await saveTypeSetting(db, 'ai_trivia', { publishingLive: true });
  resetMismatchLog();
  const a = storiesDeps(db, before3);
  assert.equal((await tick(a.deps as never)).scheduled, 0, 'Generate off + Live on: paused, nothing scheduled');
  assert.ok(a.lines.some((l) => l.startsWith('state_mismatch ')), a.lines.join('\n'));
  await saveSeriesSetting(db, 'ai_trivia', { auto: true });
  const b = storiesDeps(db, before3);
  assert.equal((await tick(b.deps as never)).scheduled, 1, 'Live: the approved set takes its window');
});

test('stories: approval is never turned off through the settings API', async () => {
  const { db } = await harnessDb();
  const api = await import('@/lib/stories/api');
  await assert.rejects(api.updateSeries(db, { vertical: 'ai_trivia', requireApproval: false }, 'test'), /cannot be turned off/);
});

/* ── 7. Stories: back to Made (D17, D18) ─────────────────────────────── */

async function scheduledTriviaSet(db: Awaited<ReturnType<typeof harnessDb>>['db'], at: Date) {
  const repo = await import('@/lib/stories/repository');
  const { set } = await requestSet(db, { series: 'ai_trivia', nyDate: '2026-10-08', trigger: 'click', style: DEFAULT_SETTINGS.series.ai_trivia.style });
  await db.query(`UPDATE stories.sets SET status = 'approved' WHERE id = $1`, [set.id]);
  await repo.scheduleSet(db, set.id, at);
  return set.id;
}

const spineSlot = async (db: Awaited<ReturnType<typeof harnessDb>>['db'], setId: string) =>
  (await db.query<{ status: string; error: string | null }>(
    `SELECT s.status, s.error FROM social_hub.schedule s JOIN social_hub.content_items ci ON ci.id = s.content_item_id WHERE ci.native_ref = $1 ORDER BY s.created_at DESC`,
    [setId],
  )).rows;

test('stories: a set paused back to Made is never re-slotted by step 3 when the type is Live again (D18)', async () => {
  const { db } = await harnessDb();
  const before3 = new Date('2026-10-08T06:00:00Z');
  // unslotType takes only slots still ahead of the real clock.
  const id = await scheduledTriviaSet(db, new Date(Date.now() + 86_400_000));
  const { unslotType } = await import('@/lib/content-type/unslot');
  const out = await unslotType((t, p) => db.query(t, p) as never, 'ai_trivia', 'paused');
  assert.equal(out.sets, 1);
  assert.deepEqual((await spineSlot(db, id)).map((r) => [r.status, r.error]), [['cancelled', 'paused']]);
  // Live again: Generate on, publishing_live on.
  await saveSeriesSetting(db, 'ai_trivia', { auto: true });
  await saveTypeSetting(db, 'ai_trivia', { publishingLive: true });
  const { deps } = storiesDeps(db, before3);
  assert.equal((await tick(deps as never)).scheduled, 0, 'it stays in the Made tab, approved');
  const row = (await db.query<{ status: string; publish_at: string | null }>(`SELECT status, publish_at FROM stories.sets WHERE id = $1`, [id])).rows[0]!;
  assert.deepEqual([row.status, row.publish_at], ['approved', null]);
});

test('stories: a set whose slot passes while its type is not Live goes back to approved, its slot cancelled slot-passed, and is not re-slotted', async () => {
  const { db } = await harnessDb();
  const id = await scheduledTriviaSet(db, new Date('2026-10-08T05:30:00Z'));
  // Paused (the default): its minute passes.
  const { deps, lines } = storiesDeps(db, new Date('2026-10-08T06:00:00Z'));
  assert.deepEqual(await tick(deps as never), { built: 0, scheduled: 0, published: 0, insights: 0 });
  const row = (await db.query<{ status: string; publish_at: string | null }>(`SELECT status, publish_at FROM stories.sets WHERE id = $1`, [id])).rows[0]!;
  assert.deepEqual([row.status, row.publish_at], ['approved', null]);
  assert.deepEqual((await spineSlot(db, id)).map((r) => [r.status, r.error]), [['cancelled', 'slot-passed']]);
  assert.ok(lines.some((l) => l.startsWith('slot-passed: 1 set(s) back to Made')));
  // Live later the same morning: still not re-slotted (D18).
  await saveSeriesSetting(db, 'ai_trivia', { auto: true });
  await saveTypeSetting(db, 'ai_trivia', { publishingLive: true });
  const later = storiesDeps(db, new Date('2026-10-08T06:30:00Z'));
  assert.equal((await tick(later.deps as never)).scheduled, 0);
});

test('stories: a Live type’s passed slot is left to the publish step, not sent back to Made', async () => {
  const { db } = await harnessDb();
  const id = await scheduledTriviaSet(db, new Date('2026-10-08T05:30:00Z'));
  await saveSeriesSetting(db, 'ai_trivia', { auto: true });
  await saveTypeSetting(db, 'ai_trivia', { publishingLive: true });
  const { returnPassedSets } = await import('@/lib/stories/unslot');
  assert.deepEqual(await returnPassedSets(db, ['morning_download', 'real_or_ai'], new Date('2026-10-08T06:00:00Z')), []);
  assert.equal((await db.query<{ status: string }>(`SELECT status FROM stories.sets WHERE id = $1`, [id])).rows[0]!.status, 'scheduled');
});
