/**
 * Stories Split (planning/Stories Split/CONTRACT.md §3 B): each Stories-format type (Morning Download, AI Trivia,
 * Real or AI?) has its own spend cap, publishing switch, spine vertical and posting settings. Offline: PGlite and
 * stubs only; nothing calls a model, the web or Supabase.
 */
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { readPosting, writePosting } from '@/lib/content-type/posting';
import { capSpendUsd } from '@/lib/stories/build/common';
import { approveSet, listSets, recordCost, scheduleSet, typeDaySpendUsd } from '@/lib/stories/repository';
import { loadSettings, saveSeriesSetting, saveTypeSetting, typeSettings } from '@/lib/stories/settings';
import { tick } from '@/lib/stories/worker';

import { openHubTestDb } from './fixtures/social-hub/pglite';
import { harnessDb } from './stories-harness';

type Db = Awaited<ReturnType<typeof harnessDb>>['db'];

const THU = '2026-10-08';
const SAT = '2026-10-10';
const THU_1AM = new Date('2026-10-08T05:00:00Z'); // 1:00 AM New York
const THU_3AM = new Date('2026-10-08T07:00:00Z');

let n = 0;
async function addSet(db: Db, series: string, nyDate: string, status = 'ready'): Promise<string> {
  const id = `70000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  await db.query(`INSERT INTO stories.sets (id, series, ny_date, status, trigger, style) VALUES ($1, $2, $3, $4, 'click', 'polished')`, [id, series, nyDate, status]);
  return id;
}

async function cost(db: Db, usd: number, component: string, setId?: string) {
  await recordCost(db, { vendor: 'anthropic', component, usd, ...(setId ? { setId } : {}) });
  // created_at defaults to the real now(): put every event on the test's clock.
  await db.query(`UPDATE stories.cost_events SET created_at = $1`, [THU_1AM]);
}

const deps = (db: Db, now: Date, calls: string[] = []) => ({
  db, sourceDb: db, now: () => now, sleep: async () => {},
  triviaDaily: async () => (calls.push('trivia'), null),
  roaDaily: async () => (calls.push('roa'), null),
  builder: async () => { throw new Error('nothing to build'); },
  meta: () => { throw new Error('nothing may publish'); },
  storage: () => { throw new Error('not used'); },
  insights: () => { throw new Error('not used'); },
  poolReads: () => { throw new Error('no pool in this test'); },
}) as never;

test('spend is attributed per type: a set by its series, a set-less event by its component prefix (SS-22)', async () => {
  const { db } = await harnessDb();
  const md = await addSet(db, 'morning_download', THU);
  const trivia = await addSet(db, 'ai_trivia', SAT);
  const roa = await addSet(db, 'real_or_ai', SAT);
  const retired = await addSet(db, 'guess_the_number', THU);
  await cost(db, 0.5, 'md-copy@1', md);
  await cost(db, 0.25, 'gtn@1', retired);
  await cost(db, 1, 'trivia-writer@1', trivia);
  await cost(db, 0.75, 'trivia-daily@1');
  await cost(db, 2, 'roa-image@1', roa);
  await cost(db, 0.5, 'roa-daily@1');
  await cost(db, 0.1, 'pool-intake@1');
  assert.equal(await typeDaySpendUsd(db, 'stories', THU_1AM), 0.85, 'Morning Download, the retired series and set-less intake');
  assert.equal(await typeDaySpendUsd(db, 'ai_trivia', THU_1AM), 1.75);
  assert.equal(await typeDaySpendUsd(db, 'real_or_ai', THU_1AM), 2.5);
  // A type made ahead counts its sets for the target date; Trivia and Real or AI? no longer share one cap.
  assert.equal(await capSpendUsd(db, 'ai_trivia', SAT, THU_1AM), 1);
  assert.equal(await capSpendUsd(db, 'real_or_ai', SAT, THU_1AM), 2);
  assert.equal(await capSpendUsd(db, 'morning_download', THU, THU_1AM), 0.85);
});

test('a type over its daily cap holds its own daily run, not another type’s (SS-22)', async () => {
  const { db } = await harnessDb();
  await saveTypeSetting(db, 'ai_trivia', { dailyCapUsd: 1 });
  await cost(db, 1.5, 'trivia-daily@1');
  await cost(db, 5, 'md-copy@1'); // over Morning Download's $2, which is not Real or AI?'s business
  const calls: string[] = [];
  await tick(deps(db, THU_3AM, calls));
  assert.deepEqual(calls, ['roa']);
  const s = await loadSettings(db);
  assert.deepEqual([typeSettings(s, 'ai_trivia').dailyCapUsd, typeSettings(s, 'real_or_ai').dailyCapUsd], [1, 2]);
});

test('publishing live is per type: only the live type’s approved set is scheduled (SS-22)', async () => {
  const { db } = await harnessDb();
  const md = await addSet(db, 'morning_download', THU);
  const trivia = await addSet(db, 'ai_trivia', THU);
  await approveSet(db, md);
  await approveSet(db, trivia);
  assert.equal((await tick(deps(db, THU_1AM))).scheduled, 0, 'every type off');
  await saveTypeSetting(db, 'ai_trivia', { publishingLive: true });
  // Live is Generate on with publishing_live on (D16); publishing_live alone reads as paused.
  assert.equal((await tick(deps(db, THU_1AM))).scheduled, 0, 'Generate off: paused');
  await saveSeriesSetting(db, 'ai_trivia', { auto: true });
  assert.equal((await tick(deps(db, THU_1AM))).scheduled, 1);
  const status = Object.fromEntries((await listSets(db, {})).map((s) => [s.series, s.status]));
  assert.deepEqual(status, { ai_trivia: 'scheduled', morning_download: 'approved' });
});

test('the spine books each set under its own type; Morning Download and retired series stay Stories (SS-21)', async () => {
  const { db } = await harnessDb();
  const at = new Date('2026-10-10T13:00:00Z');
  for (const series of ['morning_download', 'ai_trivia', 'real_or_ai', 'guess_the_number']) {
    const id = await addSet(db, series, SAT);
    await approveSet(db, id);
    await scheduleSet(db, id, at);
  }
  const items = (await db.query<{ ref: string; vertical: string }>(`SELECT split_part(idea_ref, ':', 1) AS ref, vertical FROM social_hub.content_items ORDER BY 1`)).rows;
  assert.deepEqual(items.map((r) => `${r.ref}=${r.vertical}`), ['ai_trivia=ai_trivia', 'guess_the_number=stories', 'morning_download=stories', 'real_or_ai=real_or_ai']);
  const slots = (await db.query<{ slot: string; vertical: string }>(`SELECT slot, vertical FROM social_hub.schedule ORDER BY slot`)).rows;
  assert.deepEqual(slots.map((r) => `${r.slot}=${r.vertical}`), ['ai_trivia=ai_trivia', 'guess_the_number=stories', 'morning_download=stories', 'real_or_ai=real_or_ai']);
});

/* ── Posting (lib/content-type/posting.ts) ─────────────────────────── */

const holder = globalThis as { __outreachHubPool?: unknown; __explainersDb?: unknown };
const before = { pool: holder.__outreachHubPool, ex: holder.__explainersDb };
afterEach(() => {
  if (before.pool === undefined) delete holder.__outreachHubPool;
  else holder.__outreachHubPool = before.pool;
  if (before.ex === undefined) delete holder.__explainersDb;
  else holder.__explainersDb = before.ex;
});

async function appDb() {
  const { pg } = await openHubTestDb();
  const run = (text: string, params?: unknown[]) => pg.query(text, params as unknown[]);
  holder.__outreachHubPool = { query: run };
  holder.__explainersDb = Promise.resolve({ query: run, transaction: (fn: (tx: unknown) => Promise<unknown>) => pg.transaction((tx) => fn({ query: (t: string, p?: unknown[]) => tx.query(t, p as unknown[]) })) });
  return pg;
}

test('AI Trivia posting: the standard days-based switches, saved for its own type only (SS-24)', async () => {
  await appDb();
  const first = await readPosting('ai_trivia');
  assert.deepEqual([first.live, first.generate, first.autoPublish, first.perDay, first.series], [false, false, false, null, null]);
  assert.deepEqual(first.days, [0, 1, 4], 'Sun, Mon, Thu');
  assert.deepEqual((await readPosting('real_or_ai')).days, [2, 6], 'Tue, Sat');

  assert.equal((await writePosting('ai_trivia', { generate: true }, 't')).generate, true);
  assert.equal((await writePosting('ai_trivia', { autoPublish: true }, 't')).autoPublish, true);
  assert.equal((await writePosting('ai_trivia', { live: true }, 't')).live, true);
  const md = await readPosting('stories');
  assert.deepEqual([md.live, md.generate, md.autoPublish], [false, false, false], 'Morning Download keeps its own');
  assert.equal((await readPosting('real_or_ai')).live, false);

  await assert.rejects(() => writePosting('ai_trivia', { series: { ai_trivia: { auto: true } } } as never, 't'), /Series settings moved/);
  await assert.rejects(() => writePosting('ai_trivia', { perDay: 1 }, 't'), /no daily quota/);
});
