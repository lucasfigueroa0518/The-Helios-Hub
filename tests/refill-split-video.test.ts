/**
 * Refill split for the three video types (settings standard D16, D3, D14, D17, D18; planning/settings-standard/
 * CONTRACT.md §4), offline: the real schemas on PGlite, stubbed Jev transports, a stubbed idea model and a copy client
 * that counts and refuses. No live Claude, web_search, Jev, Meta or HTTP call.
 *
 * Per type: the refill runs when paused and on a quota-full day; the make step is skipped when paused; slots are booked
 * in Approval and Live (holdsSlots, contract §4.3) and posted only when Live; the refill cap stops the refill, and so
 * does a nightly total with no room left (D19). Also: posts that went back to Made are never re-slotted (D18).
 * The nightly total's ledger is an in-memory fake (tests/helpers/refill-total-fake.ts), never a database.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

import { REFILL_CAP_DEFAULT_USD } from '@/lib/content-type/state';
import { dbQuery } from '@/lib/db';
import type { ExplainersDb } from '@/lib/explainers/db';
import { runIdeaCycle } from '@/lib/explainers/ideas/cycle';
import { explainersGate } from '@/lib/explainers/ideas/gate';
import type { IdeaModel } from '@/lib/explainers/ideas/generator';
import { explainerItemId, spineOf } from '@/lib/explainers/publish/items';
import { explainersHoldsSlots, publishingLive as explainersLive, scheduleApproved } from '@/lib/explainers/publish/schedule';
import { saveFeedback } from '@/lib/explainers/repository';
import { saveSetting } from '@/lib/explainers/settings';
import { runDevelopmentSession } from '@/lib/reel-ai-drama/development/session';
import { dramaGate } from '@/lib/reel-ai-drama/gate';
import { runDramaNight } from '@/lib/reel-ai-drama/night';
import { nightlyTick } from '@/lib/reel-ai-drama/production/schedule';
import { dramaItemId } from '@/lib/reel-ai-drama/publish/items';
import { dramaHoldsSlots, dramaPublishingLive, scheduleApprovedDrama, scheduleDramaJob, setDramaVerdict } from '@/lib/reel-ai-drama/hub';
import type { JevRequest, JevRunner, JevTransport } from '@/lib/reels/jev/runner';
import { reelsNightGate, type ReelsNightGate } from '@/lib/reels/pipeline/night-gate';
import { executeRun } from '@/lib/reels/pipeline/run';
import { publishingLive as reelsLive, reelIdeaUnslottedSql, reelsHoldsSlots, scheduleSelectedSlate } from '@/lib/reels/publish/schedule';
import { reelActions } from '@/lib/publishing/actions/reels';
import { CappedJevRunner, RefillBudget, RefillCappedError, isRefillCapped, withoutCapped } from '@/lib/reels/refill-budget';
import { createPostIdea, insertSource, startRun } from '@/lib/reels/repository';
import { bookSlot, ensureContentItem } from '@/lib/social-hub/spine';

import { scratchExplainersDb } from './explainers-pglite';
import { fakeTotalLedger } from './helpers/refill-total-fake';
import { NEW_SLATE, NORMAL, PAGE, reelsDb, stub } from './fixtures/reels-seed';
import { dramaHubDb, finishedJob, pitch, setDrama } from './reel-ai-drama-hub-fixture';

delete process.env.ANTHROPIC_API_KEY; // nothing here may reach a live model

/** Capture event lines instead of printing them. */
function events() {
  const lines: Array<{ event: string; fields: Record<string, unknown> }> = [];
  return { lines, log: (event: string, fields: Record<string, unknown> = {}) => lines.push({ event, fields }), names: () => lines.map((l) => l.event) };
}

/** Capture console.log JSON lines (the reels run logs straight to stdout). */
async function captureConsole<T>(work: () => Promise<T>): Promise<{ out: T; messages: string[] }> {
  const messages: string[] = [];
  const original = console.log;
  console.log = (line: unknown) => {
    try {
      const parsed = JSON.parse(String(line)) as { message?: string };
      if (parsed.message) messages.push(parsed.message);
    } catch {
      /* not a JSON line */
    }
  };
  try {
    return { out: await work(), messages };
  } finally {
    console.log = original;
  }
}

// ── Pure gates ──────────────────────────────────────────────────────────────

test('gates: refill on its cap in every state; make by makesPosts; book in Approval and Live; post only Live; mismatch reads as paused', () => {
  const paused = reelsNightGate('scheduled', { autoRun: false, publishingLive: false, refillCap: null });
  assert.deepEqual(paused, { state: 'paused', mismatch: false, makes: false, books: false, posts: false, refillCapUsd: REFILL_CAP_DEFAULT_USD.reels });
  assert.equal(reelsNightGate('scheduled', { autoRun: null, publishingLive: null, refillCap: null }).state, 'paused', 'a missing auto_run is off (D6)');
  assert.deepEqual(
    reelsNightGate('scheduled', { autoRun: true, publishingLive: false, refillCap: '0.4' }),
    { state: 'approval', mismatch: false, makes: true, books: true, posts: false, refillCapUsd: 0.4 },
    'Approval books its slots (contract §4.3) but posts nothing',
  );
  const live = reelsNightGate('scheduled', { autoRun: true, publishingLive: true, refillCap: 1 });
  assert.deepEqual([live.books, live.posts], [true, true]);
  const mismatch = reelsNightGate('scheduled', { autoRun: false, publishingLive: true, refillCap: null });
  assert.deepEqual([mismatch.state, mismatch.mismatch, mismatch.makes, mismatch.books, mismatch.posts], ['paused', true, false, false, false], 'a mismatch never books or posts');
  const runNow = reelsNightGate('manual', { autoRun: false, publishingLive: true, refillCap: null });
  assert.deepEqual([runNow.makes, runNow.books, runNow.posts, runNow.refillCapUsd], [true, false, false, null], 'Run now makes in every state, books only outside Paused');

  assert.deepEqual(explainersGate({ autoRender: false, publishingLive: false, refillCap: null }), { state: 'paused', mismatch: false, makes: false, books: false, posts: false, refillCapUsd: REFILL_CAP_DEFAULT_USD.explainers });
  assert.deepEqual(
    [explainersGate({ autoRender: true, publishingLive: false, refillCap: null }).books, explainersGate({ autoRender: true, publishingLive: false, refillCap: null }).posts],
    [true, false],
    'Approval places renders but posts nothing',
  );
  assert.deepEqual(explainersGate({ autoRender: false, publishingLive: false, refillCap: null }, true).makes, true, 'Run the idea cycle now makes while paused');
  assert.equal(explainersGate({ autoRender: true, publishingLive: true, refillCap: 0 }).refillCapUsd, REFILL_CAP_DEFAULT_USD.explainers, 'a non-positive cap reads as the default');
  const exMismatch = explainersGate({ autoRender: false, publishingLive: true, refillCap: null });
  assert.deepEqual([exMismatch.mismatch, exMismatch.books, exMismatch.posts], [true, false, false]);

  assert.deepEqual(dramaGate({ auto: false, publishingLive: false, refillCap: null }), { state: 'paused', mismatch: false, makes: false, books: false, posts: false, refillCapUsd: REFILL_CAP_DEFAULT_USD.reel_ai_drama });
  assert.deepEqual(dramaGate({ auto: true, publishingLive: false, refillCap: 0.75 }), { state: 'approval', mismatch: false, makes: true, books: true, posts: false, refillCapUsd: 0.75 });
  assert.deepEqual(dramaGate({ auto: true, publishingLive: true, refillCap: 0.75 }), { state: 'live', mismatch: false, makes: true, books: true, posts: true, refillCapUsd: 0.75 });
  const drMismatch = dramaGate({ auto: false, publishingLive: true, refillCap: null });
  assert.deepEqual([drMismatch.state, drMismatch.books, drMismatch.posts], ['paused', false, false]);
});

// ── The shared refill budget ────────────────────────────────────────────────

test('refill budget: stops at the cap, logs refill_capped once, never counts the make step, and a capped Jev runner refuses', async () => {
  let spent = 0;
  const capped: number[] = [];
  const budget = new RefillBudget(0.25, async () => spent, ({ spentUsd }) => capped.push(spentUsd));
  assert.equal(await budget.reached(), false);
  await budget.outside(async () => {
    spent += 5; // copy and renders share the ledger: not the refill's
  });
  assert.equal(await budget.reached(), false, 'make-step spend is not counted against the refill');
  spent += 0.3;
  assert.equal(await budget.reached(), true);
  assert.equal(await budget.reached(), true);
  assert.equal(capped.length, 1, 'refill_capped is logged once');
  assert.ok(Math.abs(capped[0]! - 0.3) < 1e-9);

  let calls = 0;
  const inner: JevRunner = { callCount: 0, ask: async () => { calls += 1; return {} as never; } };
  const runner = new CappedJevRunner(inner, budget);
  await assert.rejects(runner.ask({} as JevRequest<Questions>), (e) => e instanceof RefillCappedError && isRefillCapped(e));
  assert.equal(calls, 0, 'no paid call once the cap is reached');
  assert.deepEqual(withoutCapped(['a: Refill cap reached ($0.25)', 'b: boom']), ['b: boom']);
  assert.equal(await new RefillBudget(null, async () => 1e9).reached(), false, 'no cap: a person’s own run');
});

// ── Text on Screen ──────────────────────────────────────────────────────────

const refusingCopy = (calls: { n: number }) =>
  ({ messages: { create: async () => { calls.n += 1; throw new Error('stub: copy refused'); } } }) as never;
const legacy = { readMode: async () => 'legacy' as const };

async function reelsNight(n: number) {
  const pg = await reelsDb({ withSlate: false });
  await pg.exec(readFileSync(path.join(process.cwd(), 'db', 'bald_eagle_2026_11_12_leadtime_reels.sql'), 'utf8'));
  const run = (await startRun('manual'))!;
  for (let i = 1; i <= n; i += 1) {
    const sid = await insertSource({
      runId: run.id, canonicalUrl: `https://wire.test/refill/${i}`, headline: `Refill story ${i}`, body: PAGE, author: null, byline: null,
      sourceName: 'Wire', sourceType: 'A1', adapterId: 'rss', bucket: 'A', publishTime: null, language: null, engagement: {},
      mediaUrls: [], citationUrls: [], rawPayload: {}, dropReason: null,
    });
    await createPostIdea(sid!, run.id, 'test');
  }
  return { pg, run };
}

const reelsGate = (over: Partial<ReelsNightGate>): ReelsNightGate => ({ state: 'approval', mismatch: false, makes: true, books: true, posts: false, refillCapUsd: 0.25, ...over });
const scoredOn = async (runId: string) =>
  Number((await dbQuery<{ n: number }>(`SELECT count(*)::int AS n FROM reels.idea_scores s JOIN reels.score_slates sl ON sl.id = s.slate_id WHERE sl.run_id = $1`, [runId])).rows[0]!.n);
const reelSlots = async () => Number((await dbQuery<{ n: number }>(`SELECT count(*)::int AS n FROM social_hub.schedule WHERE vertical = 'reels' AND status = 'scheduled'`)).rows[0]!.n);

test('Text on Screen paused: the refill scores the ideas; no copy is written, nothing is selected or booked', async () => {
  const { run } = await reelsNight(3);
  const { jev, calls } = stub();
  const copy = { n: 0 };
  const outcome = await executeRun(run, { jev, copyClient: refusingCopy(copy), adapters: { primary: [], derived: [] }, intake: legacy, gate: reelsGate({ state: 'paused', makes: false, books: false }), totalQuery: fakeTotalLedger().q });
  assert.notEqual(outcome.status, 'failed', outcome.note);
  assert.ok(calls.n > 0, 'Jev scored tonight’s ideas');
  assert.ok((await scoredOn(run.id)) >= 1, 'the slate holds tonight’s scored ideas (grouping may merge look-alikes)');
  assert.equal(copy.n, 0, 'no copy call while paused');
  assert.equal(Number((await dbQuery<{ n: number }>(`SELECT count(*)::int AS n FROM reels.idea_scores WHERE selected`)).rows[0]!.n), 0);
  assert.equal(await reelSlots(), 0);
  assert.match(outcome.note ?? '', /paused/);
});

test('Text on Screen quota-full day: the refill still scores; nothing new is made', async () => {
  const { run } = await reelsNight(2);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(run.started_at ?? run.requested_at));
  for (let i = 0; i < 6; i += 1) {
    await bookSlot(dbQuery as never, { vertical: 'reels', itemId: null, ideaRef: `placed-${i}`, nyDate: today, slot: `t${String(500 + i).padStart(4, '0')}`, publishAt: new Date(Date.now() + (i + 1) * 3600_000), source: 'user' });
  }
  const { jev, calls } = stub();
  const copy = { n: 0 };
  const outcome = await executeRun(run, { jev, copyClient: refusingCopy(copy), adapters: { primary: [], derived: [] }, intake: legacy, gate: reelsGate({}), totalQuery: fakeTotalLedger().q });
  assert.notEqual(outcome.status, 'failed', outcome.note);
  assert.ok(calls.n > 0);
  assert.ok((await scoredOn(run.id)) >= 1, 'scored even with the quota filled (D3)');
  assert.equal(copy.n, 0);
});

test('Text on Screen refill cap: once reached, no Jev call starts, refill_capped is logged and the run does not fail', async () => {
  const { run } = await reelsNight(3);
  const { jev, calls } = stub();
  const { out, messages } = await captureConsole(() =>
    executeRun(run, { jev, copyClient: refusingCopy({ n: 0 }), adapters: { primary: [], derived: [] }, intake: legacy, gate: reelsGate({ refillCapUsd: 0.25 }), runSpend: async () => 0.25, totalQuery: fakeTotalLedger().q }),
  );
  assert.notEqual(out.status, 'failed', out.note);
  assert.equal(calls.n, 0, 'no paid call past the cap');
  assert.ok(messages.includes('refill_capped'));
  assert.match(out.note ?? '', /refill reached its \$0\.25 cap/);
  assert.doesNotMatch(out.note ?? '', /Scoring failed/, 'the cap is not a scoring failure');
});

test('Text on Screen books in Approval and Live, posts only when Live: both read Generate and Live together', async () => {
  await reelsDb({ withSlate: false });
  const set = (key: string, value: unknown) => dbQuery(`INSERT INTO reels.settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, JSON.stringify(value)]);
  const both = async () => [await reelsHoldsSlots(), await reelsLive()];
  await set('publishing_live', true);
  assert.deepEqual(await both(), [false, false], 'Live with no auto_run (missing is off, D6): paused, nothing books or posts');
  await set('auto_run', false);
  assert.deepEqual(await both(), [false, false], 'Generate off + Live on is a mismatch: paused');
  await set('auto_run', true);
  assert.deepEqual(await both(), [true, true], 'Live books and posts');
  await set('publishing_live', false);
  assert.deepEqual(await both(), [true, false], 'Approval books its slots but posts nothing');
});

test('Text on Screen (D18): an idea that went back to Made is never re-slotted by scheduleSelectedSlate / scheduleLatestToday', async () => {
  await reelsDb(); // NEW_SLATE with NORMAL selected
  for (const [key, value] of [['auto_run', true], ['publishing_live', true]] as const) {
    await dbQuery(`INSERT INTO reels.settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, JSON.stringify(value)]);
  }
  const unslotted = async () => (await dbQuery<{ u: boolean }>(`SELECT ${reelIdeaUnslottedSql('$1::uuid')} AS u`, [NORMAL])).rows[0]!.u;
  assert.equal(await unslotted(), false, 'never slotted');
  await dbQuery(
    `INSERT INTO social_hub.schedule (vertical, idea_ref, ny_date, slot, publish_at, status, source, error)
     VALUES ('reels', $1, '2026-10-08', 't0600', '2026-10-08T14:00:00Z', 'cancelled', 'auto', 'not approved')`,
    [NORMAL],
  );
  assert.equal(await unslotted(), false, 'another cancel reason is not Back to Made');
  await dbQuery(
    `INSERT INTO social_hub.schedule (vertical, idea_ref, ny_date, slot, publish_at, status, source, error)
     VALUES ('reels', $1, '2026-10-08', 't0601', '2026-10-08T15:00:00Z', 'cancelled', 'auto', 'paused')`,
    [NORMAL],
  );
  assert.equal(await unslotted(), true, 'paused by Pause: back in Made');
  const before = await reelSlots();
  assert.deepEqual(await scheduleSelectedSlate(NEW_SLATE), { scheduled: 0 }, 'the selected idea is passed over while Live');
  assert.equal(await reelSlots(), before);
  // A person places it again: it is no longer "back in Made".
  await bookSlot(dbQuery as never, { vertical: 'reels', itemId: null, ideaRef: NORMAL, nyDate: '2026-12-01', slot: 't0602', publishAt: new Date('2026-12-01T15:00:00Z'), source: 'user' });
  assert.equal(await unslotted(), false);
});

test('Text on Screen Approve (hub verb): Paused approves the reel without a slot (D17); Approval and Live book it; Publish now only when Live', async () => {
  const calls: string[] = [];
  const verbs = (state: 'paused' | 'approval' | 'live') =>
    reelActions({
      schedulePostIdea: async (idea) => (calls.push(`book ${idea}`), { scheduled: true, note: 'Booked.' }),
      rejectReel: async () => ({ rejected: true, note: '' }),
      forcePost: async (video) => (calls.push(`force ${video}`), { queued: true }),
      unscheduleIdea: async () => ({ ok: true, note: '' }),
      query: (async () => ({ rows: [] })) as never,
      itemId: async () => null,
      placeItem: async () => ({ ok: true, note: '' }) as never,
      rescheduleItem: async () => ({ ok: true, note: '' }) as never,
      todaySlate: async () => null,
      findReelLock: async () => null,
      requestFinish: async () => ({ status: 'done', note: '' }),
      publishingLive: async () => state === 'live',
      holdsSlots: async () => state !== 'paused',
      approveVideo: async (video) => void calls.push(`approve ${video}`),
    });
  const paused = await verbs('paused').approve!({ postIdeaId: 'idea-1', videoJobId: 'video-1' }, 'tommy', {});
  assert.equal(paused.ok, true);
  assert.match(paused.note, /Text on Screen is Paused, so it stays in the Made tab/);
  assert.deepEqual(calls.splice(0), ['approve video-1'], 'approved, nothing booked');
  const noVideo = await verbs('paused').approve!({ postIdeaId: 'idea-1' }, 'tommy', {});
  assert.deepEqual([noVideo.ok, noVideo.status], [false, 409]);
  assert.deepEqual(calls.splice(0), []);
  for (const state of ['approval', 'live'] as const) {
    assert.equal((await verbs(state).approve!({ postIdeaId: 'idea-1', videoJobId: 'video-1' }, 'tommy', {})).ok, true, state);
    assert.deepEqual(calls.splice(0), ['book idea-1'], state);
  }
  const refused = await verbs('approval').publishNow!({ postIdeaId: 'idea-1', videoJobId: 'video-1' }, 'tommy', {});
  assert.deepEqual([refused.ok, refused.status], [false, 409]);
  assert.match(refused.note, /isn’t Live.*Settings tab/);
  assert.equal((await verbs('live').publishNow!({ postIdeaId: 'idea-1', videoJobId: 'video-1' }, 'tommy', {})).ok, true);
  assert.deepEqual(calls.splice(0), ['force video-1']);
});

// ── Explainers ──────────────────────────────────────────────────────────────

function stubJev(opts: { tokens?: number } = {}): JevTransport & { calls: number } {
  const t = {
    calls: 0,
    async systemOne<const Q extends Questions>(state: EntryType, questions: Q) {
      t.calls += 1;
      void state;
      const keys = Object.keys(questions);
      const answers: Record<string, unknown> = {};
      for (const key of keys) answers[key] = keys[0] === 'duplicate_of_existing_topic' || key.startsWith('pair_') ? { type: 'noul', noul: 0.1 } : { type: 'score', score: 3, confidence: 1 };
      return { model: 'jev-stub', answers, usage: { input_tokens: opts.tokens ?? 10, output_tokens: 0 } } as unknown as SystemOneResult<Q>;
    },
  };
  return t;
}

function stubIdeas(usdTokens = 1): IdeaModel & { calls: number } {
  const model = {
    calls: 0,
    async writeScopes(request: { titles: string[] }) {
      return { scopes: request.titles.map((t) => `Explain ${t}.`), usage: { input_tokens: 1, output_tokens: 1 }, model: 'stub' };
    },
    async propose(request: { topics: { term: string }[] }) {
      model.calls += 1;
      // Each idea takes its assigned syllabus term, as the generator is told to (curriculum): one per topic.
      return { ideas: request.topics.map((t, n) => ({ topic_title: `Generated ${n} ${Math.random()}`, topic_scope: 'Scope.', term: t.term })), usage: { input_tokens: usdTokens, output_tokens: usdTokens }, model: 'stub' };
    },
  };
  return model as unknown as IdeaModel & { calls: number };
}

const CYCLE_AT = new Date('2026-10-08T06:00:00Z'); // 2:00 AM New York
const TODAY = '2026-10-08';

/** Earlier nights filled tomorrow and day+2, so tonight's only date is today. */
async function explainersDb(state: { autoRender: boolean; live?: boolean }): Promise<ExplainersDb> {
  const { db } = await scratchExplainersDb();
  await saveSetting(db, 'auto_render', state.autoRender);
  if (state.live) await db.query(`INSERT INTO explainers.settings (key, value) VALUES ('publishing_live', 'true'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  await db.query(`INSERT INTO explainers.idea_cycles (status, mode, ny_date, started_at, finished_at) VALUES ('ok', 'development', '2026-10-09', '2026-10-06T06:00:00Z', now()), ('ok', 'development', '2026-10-10', '2026-10-07T06:00:00Z', now())`);
  return db;
}
const count = async (db: ExplainersDb, sql: string) => Number((await db.query<{ n: number }>(sql)).rows[0]!.n);
async function poolTopic(db: ExplainersDb, title: string, score: number): Promise<string> {
  const { rows } = await db.query<{ id: string }>(`INSERT INTO explainers.topics (title, origin, status, weighted_score) VALUES ($1, 'manual', 'pool', $2) RETURNING id`, [title, score]);
  return rows[0]!.id;
}

test('Explainers paused: the 2 AM refill generates and scores into the pool; no render is requested', async () => {
  const db = await explainersDb({ autoRender: false });
  await poolTopic(db, 'Waiting', 90);
  const ideas = stubIdeas();
  const jev = stubJev();
  const ev = events();
  const result = await runIdeaCycle({ db, ideaModel: ideas, jevTransport: jev, now: CYCLE_AT, event: ev.log, totalQuery: fakeTotalLedger().q });
  assert.equal(result.status, 'refilled', JSON.stringify(result));
  assert.equal(result.status === 'refilled' && result.reason, 'paused');
  assert.ok(ideas.calls >= 1, 'the refill wrote ideas (as many calls as the pool is short of 10)');
  const first = ideas.calls;
  assert.ok(jev.calls > 0, 'scored and deduped');
  assert.equal(await count(db, `SELECT count(*)::int AS n FROM explainers.jobs`), 0, 'no render while paused');
  assert.equal(await count(db, `SELECT count(*)::int AS n FROM explainers.idea_cycles WHERE status = 'skipped' AND ideas_generated > 0`), 1, 'the refill is recorded');
  assert.ok(ev.names().includes('make_skipped'));
  // Once a night: a worker restart the same night does not refill again.
  const again = await runIdeaCycle({ db, ideaModel: ideas, jevTransport: jev, now: CYCLE_AT, event: ev.log, totalQuery: fakeTotalLedger().q });
  assert.notEqual(again.status, 'refilled');
  assert.equal(ideas.calls, first, 'no second refill the same night');
});

test('Explainers quota-full day: the refill still runs; nothing is rendered', async () => {
  const db = await explainersDb({ autoRender: true });
  const spine = spineOf(db);
  for (const [i, slot] of ['afternoon', 'late'].entries()) {
    const itemId = await ensureContentItem(spine, { vertical: 'explainers', format: 'reel', nativeRef: `hand-${i}`, ideaRef: null });
    await bookSlot(spine, { vertical: 'explainers', itemId, ideaRef: null, nyDate: TODAY, slot, publishAt: new Date(`${TODAY}T18:0${i}:00Z`), source: 'user' });
  }
  const a = await poolTopic(db, 'A', 90);
  const ideas = stubIdeas();
  const result = await runIdeaCycle({ db, ideaModel: ideas, jevTransport: stubJev(), now: CYCLE_AT, event: events().log, totalQuery: fakeTotalLedger().q });
  assert.equal(result.status, 'refilled', JSON.stringify(result));
  assert.equal(result.status === 'refilled' && result.reason, 'nothing_to_make');
  assert.ok(ideas.calls >= 1, 'the idea calls ran on a quota-full day (D3)');
  assert.equal(await count(db, `SELECT count(*)::int AS n FROM explainers.jobs WHERE topic_id = '${a}'`), 0);
});

test('Explainers refill cap: no topic is scored past it, refill_capped is logged, the cycle does not fail', async () => {
  const db = await explainersDb({ autoRender: false });
  await db.query(`INSERT INTO explainers.settings (key, value) VALUES ('pool_refill_cap_usd', '0.1'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  // The idea call alone costs over the cap (stub usage priced by ideaUsd), so no topic evaluation starts.
  const ideas = stubIdeas(2_000_000);
  const jev = stubJev();
  const ev = events();
  const result = await runIdeaCycle({ db, ideaModel: ideas, jevTransport: jev, now: CYCLE_AT, event: ev.log, totalQuery: fakeTotalLedger().q });
  assert.equal(result.status, 'refilled', JSON.stringify(result));
  assert.equal(result.status === 'refilled' && result.refillCapped, true);
  assert.equal(jev.calls, 0, 'no Jev scoring past the cap');
  assert.ok(ev.names().includes('refill_capped'));
});

test('Explainers book in Approval and Live, post only when Live; Run the idea cycle now still makes while paused', async () => {
  const db = await explainersDb({ autoRender: false, live: true });
  const both = async () => [await explainersHoldsSlots(db), await explainersLive(db)];
  assert.deepEqual(await both(), [false, false], 'Generate off + Live on: paused, nothing placed or posted');
  await saveSetting(db, 'auto_render', true);
  assert.deepEqual(await both(), [true, true]);
  await db.query(`UPDATE explainers.settings SET value = 'false'::jsonb WHERE key = 'publishing_live'`);
  assert.deepEqual(await both(), [true, false], 'Approval places renders but posts nothing');

  const paused = await explainersDb({ autoRender: false });
  await poolTopic(paused, 'A', 90);
  const forced = await runIdeaCycle({ db: paused, ideaModel: stubIdeas(), jevTransport: stubJev(), now: CYCLE_AT, force: true, event: events().log, totalQuery: fakeTotalLedger().q });
  assert.equal(forced.status, 'ok', JSON.stringify(forced));
  // The refill tops the pool up first, so the day's quota is made from the best of a full pool, not only A.
  assert.ok((await count(paused, `SELECT count(*)::int AS n FROM explainers.jobs`)) >= 1, 'the person’s click renders');
  assert.equal(forced.status === 'ok' && forced.allocated.every((x) => x.scheduled === null), true);
});

test('Explainers (D18): an approved render that went back to Made is not re-slotted by scheduleApproved', async () => {
  const db = await explainersDb({ autoRender: true, live: true });
  const render = async (title: string) => {
    const { rows: t } = await db.query<{ id: string }>(`INSERT INTO explainers.topics (title, origin, status, weighted_score, rendered_at) VALUES ($1, 'manual', 'rendered', 50, now()) RETURNING id`, [title]);
    const { rows: j } = await db.query<{ id: string }>(
      `INSERT INTO explainers.jobs (topic_id, status, trigger, mode, spend_cap_usd, orchestrator_model, frame_worker_model, finished_at, spend_usd)
       VALUES ($1, 'ok', 'click', 'development', 5, 'm', 'm', now() - interval '1 day', 1) RETURNING id`,
      [t[0]!.id],
    );
    await db.query(`INSERT INTO explainers.artifacts (job_id, kind, storage_path, bytes, storage_location) VALUES ($1, 'video', 'v.mp4', 1, 'bucket')`, [j[0]!.id]);
    await saveFeedback(db, { jobId: j[0]!.id, verdict: 'approved', tags: [] });
    return j[0]!.id;
  };
  const back = await render('Back in Made');
  const itemId = await explainerItemId(db, back);
  await db.query(
    `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source, error)
     VALUES ($1, 'explainers', '2026-10-07', 'afternoon', '2026-10-07T18:00:00Z', 'cancelled', 'auto', 'slot-passed')`,
    [itemId],
  );
  const fresh = await render('Fresh');
  const booked = await scheduleApproved(db, CYCLE_AT);
  const slotsOf = async (jobId: string) =>
    count(db, `SELECT count(*)::int AS n FROM social_hub.schedule s JOIN social_hub.content_items ci ON ci.id = s.content_item_id WHERE ci.native_ref = '${jobId}' AND s.status = 'scheduled'`);
  assert.equal(await slotsOf(back), 0, 'stays approved in Made, never re-slotted');
  assert.equal(await slotsOf(fresh), booked > 0 ? 1 : 0);
});

// ── AI Drama ────────────────────────────────────────────────────────────────

const MONDAY = new Date('2026-11-09T15:00:00Z'); // Monday 10:00 New York
const MONDAY_REFILL = new Date('2026-11-10T03:30:00Z'); // Monday 22:30 New York, inside the nightly refill window (MD-156)
const dramaJobs = async (db: ExplainersDb, trigger = 'auto') => Number((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM reel_ai_drama.jobs WHERE trigger = $1`, [trigger])).rows[0]!.n);

test('AI Drama paused: the nightly development (refill) runs on its cap; the night fill makes nothing', async () => {
  const db = await dramaHubDb();
  await setDrama(db, 'auto', false);
  await pitch(db, { title: 'Pooled one', status: 'pooled', rank: 0.9 });
  const asked: Array<{ trigger: string; refillCapUsd?: number }> = [];
  const tick = await nightlyTick(
    { db, runDevelopmentSession: async (opts) => { asked.push(opts); }, nextForProduction: async () => null, tendPool: async () => ({ faded: 0, rechecked: 0 }) },
    MONDAY_REFILL,
  );
  assert.equal(tick.development, 'ran', 'the refill runs while paused');
  assert.deepEqual(asked, [{ trigger: 'auto', refillCapUsd: REFILL_CAP_DEFAULT_USD.reel_ai_drama }], 'held to the default refill cap (D14/D19)');
  const night = await runDramaNight({ db, now: MONDAY });
  assert.deepEqual(night, { status: 'skipped', reason: 'paused' });
  assert.equal(await dramaJobs(db), 0, 'no reel requested while paused');
});

test('AI Drama quota-full day: the night makes nothing; the nightly refill still runs', async () => {
  const db = await dramaHubDb();
  await setDrama(db, 'auto', true);
  await setDrama(db, 'pool_refill_cap_usd', 0.3);
  // Every date the night fills already holds its one reel.
  for (const day of ['2026-11-09', '2026-11-10', '2026-11-11']) {
    const { jobId } = await finishedJob(db);
    const booked = await scheduleDramaJob(db, jobId, 'user', MONDAY, day, undefined, day);
    assert.equal(booked.scheduled, true, day);
  }
  await pitch(db, { title: 'Pooled one', status: 'pooled', rank: 0.9 });
  const night = await runDramaNight({ db, now: MONDAY });
  assert.notEqual(night.status, 'ok');
  assert.equal(await dramaJobs(db), 0);
  const asked: Array<{ refillCapUsd?: number }> = [];
  const tick = await nightlyTick({ db, runDevelopmentSession: async (opts) => { asked.push(opts); }, nextForProduction: async () => null, tendPool: async () => ({ faded: 0, rechecked: 0 }) }, MONDAY_REFILL);
  assert.equal(tick.development, 'ran');
  assert.equal(asked[0]?.refillCapUsd, 0.3, 'the stored cap is read');
});

test('AI Drama refill cap: the development session stops starting paid work once its own spend reaches the cap', async () => {
  const db = await dramaHubDb();
  for (let i = 0; i < 3; i += 1) {
    await db.query(
      `INSERT INTO reel_ai_drama.pitches (title, pitch, event_key, status) VALUES ($1, $2::jsonb, $3, 'new')`,
      [`Pending ${i}`, JSON.stringify({ title: `Pending ${i}`, brief: 'b', story_type: 'deal', era: 'race', cast: [], sources: [] }), `pending:${i}`],
    );
  }
  let calls = 0;
  // Each Jev call is priced over the cap (jevUsd: input tokens × the Jev rate).
  const jev: JevTransport = {
    async systemOne<const Q extends Questions>(_state: EntryType, questions: Q) {
      calls += 1;
      const answers = Object.fromEntries(Object.keys(questions).map((k) => [k, { type: 'score', score: 0.1, confidence: 1 }]));
      return { model: 'stub', answers, usage: { input_tokens: 50_000_000, output_tokens: 0 } } as never;
    },
  };
  const ev = events();
  const summary = await runDevelopmentSession(
    {
      db,
      producer: { create: async () => { throw new Error('stub: producer not called'); }, loadPrompt: () => '' } as never,
      jevTransport: jev,
      visuals: {} as never,
      now: () => MONDAY,
      log: ev.log,
      totalQuery: fakeTotalLedger().q,
    },
    { trigger: 'calibration', refillCapUsd: 0.25 },
  );
  assert.equal(summary.status, 'capped', JSON.stringify(summary));
  assert.equal(calls, 1, 'one paid call, then the cap stops the rest');
  assert.ok(ev.names().includes('refill_capped'));
  assert.ok(summary.errors.every((e) => !isRefillCapped(e)), 'hitting the cap is not an error');
  const left = Number((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM reel_ai_drama.pitches WHERE status = 'new'`)).rows[0]!.n);
  assert.ok(left >= 2, 'the pitches the cap stopped stay new for the next session');
});

test('AI Drama books in Approval (posts only when Live); a mismatch books nothing; a reel that went back to Made is not re-slotted (D18)', async () => {
  const db = await dramaHubDb();
  const back = await finishedJob(db);
  const fresh = await finishedJob(db);
  await setDramaVerdict(db, back.jobId, 'approved', 'lucas');
  await setDramaVerdict(db, fresh.jobId, 'approved', 'lucas');
  await setDrama(db, 'publishing_live', true);
  assert.deepEqual([await dramaHoldsSlots(db), await dramaPublishingLive(db)], [false, false], 'Live with Generate off: paused');
  assert.equal(await scheduleApprovedDrama(db, MONDAY), 0, 'a mismatch books nothing');

  const itemId = await dramaItemId(db, back.jobId);
  await db.query(
    `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source, error)
     VALUES ($1, 'reel_ai_drama', '2026-11-08', 'evening', '2026-11-09T01:00:00Z', 'cancelled', 'auto', 'paused')`,
    [itemId],
  );
  // Approval: Generate on, Live off. The approved reel books its slot (contract §4.3); nothing posts.
  await setDrama(db, 'auto', true);
  await setDrama(db, 'publishing_live', false);
  assert.deepEqual([await dramaHoldsSlots(db), await dramaPublishingLive(db)], [true, false]);
  assert.equal(await scheduleApprovedDrama(db, MONDAY), 1, 'only the fresh reel books, in Approval');
  const scheduledFor = async (jobId: string) =>
    Number((await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM social_hub.schedule s JOIN social_hub.content_items ci ON ci.id = s.content_item_id WHERE ci.native_ref = $1 AND s.status = 'scheduled'`,
      [jobId],
    )).rows[0]!.n);
  assert.equal(await scheduledFor(back.jobId), 0, 'stays approved in Made');
  assert.equal(await scheduledFor(fresh.jobId), 1);
});

// ── The nightly refill total (D19): no room left caps each refill ─────────────

test('Text on Screen refill with no room left in the nightly total: no Jev call, refill_total_capped, the run does not fail', async () => {
  const { run } = await reelsNight(3);
  const { jev, calls } = stub();
  const ledger = fakeTotalLedger({ total: 1, spentUsd: 1 });
  const { out, messages } = await captureConsole(() =>
    executeRun(run, { jev, copyClient: refusingCopy({ n: 0 }), adapters: { primary: [], derived: [] }, intake: legacy, gate: reelsGate({ state: 'paused', makes: false, books: false, refillCapUsd: 1.5 }), runSpend: async () => 0, totalQuery: ledger.q }),
  );
  assert.notEqual(out.status, 'failed', out.note);
  assert.equal(calls.n, 0, 'no Jev call: the refill is capped at $0');
  assert.ok(messages.includes('refill_total_capped'));
  assert.equal(ledger.written().length, 0, 'nothing reserved when the total has no room');
});

test('Explainers refill with no room left in the nightly total: no idea call, refill_total_capped', async () => {
  const db = await explainersDb({ autoRender: false });
  const ideas = stubIdeas();
  const jev = stubJev();
  const ev = events();
  const ledger = fakeTotalLedger({ total: 1, spentUsd: 1 });
  const result = await runIdeaCycle({ db, ideaModel: ideas, jevTransport: jev, now: CYCLE_AT, event: ev.log, totalQuery: ledger.q });
  assert.notEqual(result.status, 'failed', JSON.stringify(result));
  assert.equal(ideas.calls, 0, 'no idea call');
  assert.equal(jev.calls, 0, 'no Jev scoring');
  assert.ok(ev.names().includes('refill_total_capped'));
  assert.equal(ledger.written().length, 0);
});

test('AI Drama weekly session with no room left in the nightly total: status capped, no paid call', async () => {
  const db = await dramaHubDb();
  await db.query(
    `INSERT INTO reel_ai_drama.pitches (title, pitch, event_key, status) VALUES ('Pending', $1::jsonb, 'pending:total', 'new')`,
    [JSON.stringify({ title: 'Pending', brief: 'b', story_type: 'deal', era: 'race', cast: [], sources: [] })],
  );
  let calls = 0;
  const jev: JevTransport = {
    async systemOne() {
      calls += 1;
      throw new Error('stub: no Jev call expected');
    },
  };
  const ev = events();
  const ledger = fakeTotalLedger({ total: 2, spentUsd: 2 });
  const summary = await runDevelopmentSession(
    {
      db,
      producer: { create: async () => { throw new Error('stub: producer not called'); }, loadPrompt: () => '' } as never,
      jevTransport: jev,
      visuals: {} as never,
      now: () => MONDAY,
      log: ev.log,
      totalQuery: ledger.q,
    },
    { trigger: 'auto', refillCapUsd: 3 },
  );
  assert.equal(summary.status, 'capped', JSON.stringify(summary));
  assert.equal(calls, 0);
  assert.ok(ev.names().includes('refill_total_capped'));
  assert.equal(ledger.written().length, 0);
});
