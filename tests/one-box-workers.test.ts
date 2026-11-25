/**
 * One-box seeding v2, Task 8: the Stories worker claims at most one queued Trivia or Real or AI? seed per poll and runs it.
 * Offline: PGlite with the hub schema; the runners and the deps builders are stubs. No live call of any kind.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { createRequest } from '@/lib/seed/one-box/requests';
import { runClaimedSeed } from '@/lib/seed/one-box/workers';
import type { OneBoxInput } from '@/lib/seed/one-box/types';
import type { Query } from '@/lib/social/store/pg';

const schemaSql = (file: string) => fs.readFileSync(path.join(process.cwd(), 'db', file), 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');

async function db(): Promise<Query> {
  const pg = new PGlite();
  await pg.exec(schemaSql('social_hub_schema.sql'));
  return async (text, params) => ({ rows: (await pg.query(text, params)).rows as any[] });
}
const input = (vertical: OneBoxInput['vertical'], blurb: string): OneBoxInput => ({ vertical, blurb });
const row = async (q: Query, id: string) => (await q(`SELECT status, stage, message, cost_usd::float AS cost FROM social_hub.seed_requests WHERE id = $1::uuid`, [id])).rows[0];

function stubs() {
  const calls: { runner: string; id: string; blurb: string; limit: number }[] = [];
  const mk = (runner: string) => async (i: { id: string; input: OneBoxInput; ledger: { usable: number } }) => {
    calls.push({ runner, id: i.id, blurb: i.input.blurb, limit: i.ledger.usable });
  };
  const factories = { trivia: async () => ({ tag: 'trivia' }) as never, roa: async () => ({ tag: 'roa' }) as never };
  return { calls, run: { trivia: mk('trivia') as never, roa: mk('roa') as never }, deps: factories };
}

test('routes ai_trivia and real_or_ai to their runners', async () => {
  const q = await db();
  const a = await createRequest(q, input('ai_trivia', 'moon facts'));
  const s = stubs();
  assert.deepEqual(await runClaimedSeed({ q, runner: 'stories', deps: s.deps, run: s.run }), { id: a.id });
  const b = await createRequest(q, input('real_or_ai', 'a goat on a path'));
  assert.deepEqual(await runClaimedSeed({ q, runner: 'stories', deps: s.deps, run: s.run }), { id: b.id });
  assert.deepEqual(s.calls.map((c) => [c.runner, c.id, c.blurb]), [['trivia', a.id, 'moon facts'], ['roa', b.id, 'a goat on a path']]);
  assert.equal(s.calls[0]!.limit, 0.29); // 0.35 limit less the 0.06 reserve: the vertical's own ledger
  assert.equal(s.calls[1]!.limit, 0.52);
});

test('nothing queued: returns null and calls no runner', async () => {
  const q = await db();
  const s = stubs();
  let built = 0;
  const deps = { trivia: async () => (built++, {}) as never, roa: async () => (built++, {}) as never };
  assert.equal(await runClaimedSeed({ q, runner: 'stories', deps, run: s.run }), null);
  assert.equal(s.calls.length, 0);
  assert.equal(built, 0); // the deps are only built for a claimed request
});

test('a request for another runner is left queued', async () => {
  const q = await db();
  const a = await createRequest(q, input('reel_ai_drama', 'a drama'));
  const s = stubs();
  assert.equal(await runClaimedSeed({ q, runner: 'stories', deps: s.deps, run: s.run }), null);
  assert.equal((await row(q, a.id)).stage, 'queued');
});

test('a runner that throws leaves the request failed and returns', async () => {
  const q = await db();
  const a = await createRequest(q, input('ai_trivia', 'moon facts'));
  const s = stubs();
  const run = { ...s.run, trivia: (async () => { throw new Error('boom'); }) as never };
  assert.deepEqual(await runClaimedSeed({ q, runner: 'stories', deps: s.deps, run }), { id: a.id });
  const r = await row(q, a.id);
  assert.equal(r.status, 'failed');
  assert.match(r.message, /nothing was added/);
});

// Final fixes 6: the cause is logged, and so is a failure of failRequest itself; the stored message stays the same.
test('a runner that throws: log receives the error; a failRequest that fails is logged too', async () => {
  const q = await db();
  const a = await createRequest(q, input('ai_trivia', 'moon facts'));
  const s = stubs();
  const boom = new Error('boom');
  const run = { ...s.run, trivia: (async () => { throw boom; }) as never };
  const logged: Array<{ msg: string; err: unknown }> = [];
  const log = (msg: string, err: unknown) => void logged.push({ msg, err });
  await runClaimedSeed({ q, runner: 'stories', deps: s.deps, run, log });
  assert.equal(logged.length, 1);
  assert.equal(logged[0]!.err, boom);
  assert.match(logged[0]!.msg, new RegExp(a.id));
  assert.equal((await row(q, a.id)).message, "The worker hit an error; nothing was added.");

  const b = await createRequest(q, input('ai_trivia', 'sun facts'));
  const down = new Error('db down');
  const failing: Query = async (text, params) => { if (/SET status = 'failed'/.test(text)) throw down; return q(text, params); };
  logged.length = 0;
  assert.deepEqual(await runClaimedSeed({ q: failing, runner: 'stories', deps: s.deps, run, log }), { id: b.id });
  assert.deepEqual(logged.map((l) => l.err), [boom, down]);
});

test('deps that cannot be built fail the request too', async () => {
  const q = await db();
  const a = await createRequest(q, input('real_or_ai', 'a goat'));
  const s = stubs();
  const deps = { ...s.deps, roa: async () => { throw new Error('no renderer'); } };
  assert.deepEqual(await runClaimedSeed({ q, runner: 'stories', deps, run: s.run }), { id: a.id });
  assert.equal((await row(q, a.id)).status, 'failed');
  assert.equal(s.calls.length, 0);
});

test('seedDepsFactories builds each deps object the daily way, only when asked', async () => {
  const { seedDepsFactories } = await import('@/lib/stories/worker');
  const calls: string[] = [];
  const write = (async () => ({})) as never;
  const storage = { upload: async () => 'x' } as never;
  const sourceDb = { query: async () => ({ rows: [] }) };
  const sdb = { query: async (text: string) => (calls.push(text), { rows: [] }) , transaction: async () => undefined as never };
  let built = 0;
  const now = new Date('2026-11-24T15:00:00Z');
  const f = seedDepsFactories({
    db: sdb as never, sourceDb: sourceDb as never, now: () => now,
    builder: async () => (built++, { db: sdb, sourceDb, write, storage, jevTransport: {} }) as never,
  } as never);
  assert.equal(built, 0);
  const t = await f.trivia();
  assert.equal(t.db, sdb as never);
  assert.equal(t.write, write);
  assert.equal(t.now, now);
  assert.equal(t.refill, undefined);
  assert.ok(t.jev);
  assert.ok(t.settings);
  const r = await f.roa();
  assert.equal(r.sourceDb, sourceDb as never);
  assert.equal(r.storage, storage);
  assert.equal(r.now, now);
  assert.equal(r.refill, undefined);
  assert.ok(r.bank);
  assert.equal(built, 2);
});
