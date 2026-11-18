/**
 * Real or AI? engine: the pool cap and the builder, offline (CONTRACT.md §5 A).
 * PGlite runs the stories schema plus db/stories_real_or_ai.sql; nothing calls
 * the network (the builder's photo signer is a stub).
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import type { BuildDeps } from '@/lib/stories/build/common';
import { buildRealOrAi, chooseRounds, revealCopy } from '@/lib/stories/build/real-or-ai';
import type { StoriesDb } from '@/lib/stories/db';
import { openLocalStoriesDb } from '@/lib/stories/local-db';
import { capRoaPool, openPool, writePool } from '@/lib/stories/pool';
import type { RoaRevealData, RoaPoolPayload, Subject, Truth } from '@/lib/stories/roa/types';
import { ROA_POOL_CAP, SUBJECTS } from '@/lib/stories/roa/types';
import { DEFAULT_SETTINGS } from '@/lib/stories/settings';

const NOW = new Date('2026-11-17T12:00:00Z');

const hex = (n: number) => n.toString(16).padStart(16, '0');

function payload(n: number, truth: Truth, subject: Subject, difficulty: number, over: Partial<RoaPoolPayload['c']> = {}, tellBox?: RoaPoolPayload['screen']['tellBox']): RoaPoolPayload {
  const imageKey = hex(n);
  return {
    kind: 'roa',
    c: {
      imageKey, truth, subject, trap: truth === 'real' ? 'too_perfect' : 'amateur', storagePath: `roa/candidates/${imageKey}.jpg`,
      provenance: truth === 'real'
        ? { kind: 'commons', url: `https://commons.wikimedia.org/wiki/File:${n}.jpg`, licence: 'CC BY-SA 4.0', credit: 'Jane Doe / Wikimedia Commons', year: '2019' }
        : { kind: 'generated', model: 'gpt-image-2', prompt: 'Phone photo of leftover soup on a counter', createdAt: NOW.toISOString() },
      ...over,
    },
    screen: { pass: true, reasons: [], difficulty, ...(tellBox ? { tellBox } : {}) },
    reveal: truth === 'real' ? 'Salt flats mirror the sky after rain' : 'Steam rises the same way twice',
    writtenOn: '2026-11-16',
  };
}

async function addRow(db: StoriesDb, p: RoaPoolPayload, refreshedAt = NOW): Promise<void> {
  await db.query(
    `INSERT INTO stories.pool (series, key, origin, ref, title, payload, score, refreshed_at) VALUES ('real_or_ai', $1, 'model', $2, $3, $4::jsonb, $5, $6::timestamptz)`,
    [`roa:${p.c.imageKey}`, p.c.imageKey, `${p.c.truth} ${p.c.subject}`, JSON.stringify({ ...p, story_key: null, source: 'test', url: null, breakdown: null }), p.screen.difficulty, refreshedAt.toISOString()],
  );
}

function deps(db: StoriesDb, pool: RoaPoolPayload[] | null = null): BuildDeps {
  return { db, sourceDb: db, settings: DEFAULT_SETTINGS, now: NOW, setId: randomUUID(), nyDate: '2026-11-17', pool: pool ? { stories: [], leads: [], roa: pool } : null } as unknown as BuildDeps;
}

/** mulberry32: a seeded rand. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sign = async (path: string) => `https://storage.test/${path}`;

test('pool: one row over the cap → the hardest ROA_POOL_CAP stay; the dropped one is in roa_archive (cap); roa rows never age out', async () => {
  const { db } = await openLocalStoriesDb();
  for (let i = 0; i <= ROA_POOL_CAP; i++) await addRow(db, payload(i + 1, i % 2 ? 'ai' : 'real', SUBJECTS[i % SUBJECTS.length]!, 0.3 + i * 0.01));
  const dropped = await capRoaPool(db, NOW);
  assert.deepEqual(dropped, [`roa:${hex(1)}`], 'the easiest goes');
  const left = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM stories.pool WHERE series = 'real_or_ai' AND used_at IS NULL`);
  assert.equal(left.rows[0]!.n, ROA_POOL_CAP);
  const arch = await db.query<{ key: string; reason: string }>(`SELECT key, reason FROM stories.roa_archive`);
  assert.deepEqual(arch.rows, [{ key: `roa:${hex(1)}`, reason: 'cap' }]);

  // A refresh a year later neither drops stale roa: rows nor ones it did not return.
  await writePool(db, { items: [], refreshed: ['real_or_ai'] }, new Date('2027-10-01T12:00:00Z'));
  const after = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM stories.pool WHERE series = 'real_or_ai'`);
  assert.equal(after.rows[0]!.n, ROA_POOL_CAP);
  const open = await openPool(db, 'real_or_ai');
  assert.equal(open.roa?.length, ROA_POOL_CAP);
  assert.equal(open.meta?.roa?.[0]?.key, `roa:${hex(ROA_POOL_CAP + 1)}`, 'hardest first');
});

test('builder: 4 frames in order, hardest of each drawn truth, different subjects, payload.roa and history keys', async () => {
  const { db } = await openLocalStoriesDb();
  const pool = [
    payload(1, 'real', 'nature_weather', 0.9),
    payload(2, 'real', 'space', 0.5),
    payload(3, 'ai', 'nature_weather', 0.95, {}, { x: 0.1, y: 0.2, w: 0.2, h: 0.1 }),
    payload(4, 'ai', 'vehicles', 0.6),
  ];
  for (const p of pool) await addRow(db, p);
  // rand: 0.1 → real, 0.9 → ai.
  const draws = [0.1, 0.9];
  const res = await buildRealOrAi(deps(db), { rand: () => draws.shift()!, sign });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.frames.map((f) => [f.seq, f.role]), [[1, 'roa_question'], [2, 'roa_reveal'], [3, 'roa_question'], [4, 'roa_reveal']]);
  // Round 1: the hardest real (nature). Round 2: AI on another subject, so the 0.95 nature AI is passed over for vehicles.
  assert.deepEqual(res.historyKeys, [`roa:${hex(1)}`, `roa:${hex(4)}`]);
  const r1 = res.frames[1]!.copy as RoaRevealData;
  const r2 = res.frames[3]!.copy as RoaRevealData;
  assert.equal(r1.truth, 'real');
  assert.equal(r1.proof, '2019 · Jane Doe / Wikimedia Commons');
  // RA-26: a pool row from before payoffs reads as the camera card for a real photo, the prompt for AI.
  assert.equal(r1.payoff, 'camera');
  assert.deepEqual(r1.receipt, { head: 'Taken', rows: ['2019'] });
  assert.equal(r1.line, undefined);
  assert.equal(r1.prompt, undefined);
  assert.equal(r2.truth, 'ai');
  assert.equal(r2.payoff, 'prompt');
  assert.equal(r2.prompt, 'Phone photo of leftover soup on a counter');
  assert.equal(r2.proof, 'Made with gpt-image-2');
  assert.equal(res.frames[0]!.photo?.src, `https://storage.test/roa/candidates/${hex(1)}.jpg`);
  assert.equal(res.frames[0]!.photo?.credit, '', 'no credit on the question photo');
  const roa = res.payload.roa as { rounds: Array<{ key: string; truth: Truth; difficulty: number }> };
  assert.deepEqual(roa.rounds.map((r) => [r.truth, r.difficulty]), [['real', 0.9], ['ai', 0.6]]);

  // A twin pair may fill both rounds despite sharing a subject; a tell box no longer shows (RA-26): the prompt does.
  const twin = [payload(10, 'real', 'animals', 0.8), payload(11, 'ai', 'animals', 0.7, { twinOf: hex(10), trap: 'twin' }, { x: 0.3, y: 0.3, w: 0.1, h: 0.1 })];
  twin[0]!.c.trap = 'twin';
  const d2 = [0.1, 0.9];
  const t = await buildRealOrAi(deps(db, twin), { rand: () => d2.shift()!, sign });
  assert.equal(t.ok, true);
  if (!t.ok) return;
  const tr = t.frames[3]!.copy as RoaRevealData;
  assert.equal(tr.payoff, 'prompt');
  assert.equal(tr.prompt, 'Phone photo of leftover soup on a counter');
  assert.ok(!('tellBox' in tr));
});

test('RA-26 revealCopy: effort line when the pool row says effort; camera card with EXIF; AI without a usable prompt shows none', () => {
  const photo = { src: 'x', credit: '', kind: 'scene' as const };
  const effort = { ...payload(30, 'real', SUBJECTS[0]!, 0.5), payoff: 'effort' as const, reveal: 'Shot from the ISS, 400 km up' };
  assert.deepEqual(revealCopy(effort, 1, photo), { role: 'roa_reveal', round: 1, photo, truth: 'real', payoff: 'effort', line: 'Shot from the ISS, 400 km up', proof: '2019 · Jane Doe / Wikimedia Commons' });
  const cam = payload(31, 'real', SUBJECTS[0]!, 0.5, {
    provenance: { kind: 'commons', url: 'u', licence: 'CC BY-SA 4.0', credit: 'Jane Doe / Wikimedia Commons', year: '2022', place: 'Lake Nakuru',
      camera: { body: 'Nikon D7200', focalMm: 390, fNumber: 8, exposureS: 1 / 640, iso: 100, taken: '2022-04-11' } },
  });
  assert.deepEqual(revealCopy({ ...cam, payoff: 'camera', reveal: '' }, 1, photo).receipt, {
    head: 'Shot on', rows: ['Nikon D7200', '390 mm · f/8 · 1/640 s · ISO 100', 'April 2022 · Lake Nakuru'],
  });
  // An effort row whose line is empty falls back to the camera card.
  assert.equal(revealCopy({ ...cam, payoff: 'effort', reveal: ' ' }, 1, photo).payoff, 'camera');
  // RA-27: an AI image with no usable prompt shows its effort line, else the origin card; old rows included.
  const bad = payload(32, 'ai', SUBJECTS[0]!, 0.5, { provenance: { kind: 'generated', model: 'gpt-image-2', prompt: '', createdAt: NOW.toISOString() } });
  assert.deepEqual(revealCopy(bad, 2, photo).receipt, { head: 'Made with', rows: ['gpt-image-2'] });
  const ds = payload(33, 'ai', SUBJECTS[0]!, 0.5, { provenance: { kind: 'dataset', dataset: 'Example set', id: '7', model: 'some-model' } });
  const origin = revealCopy({ ...ds, payoff: 'origin', reveal: '' }, 2, photo);
  assert.equal(origin.payoff, 'origin');
  assert.deepEqual(origin.receipt, { head: 'Made with', rows: ['some-model', 'From the Example set dataset'] });
  assert.equal(revealCopy({ ...ds, reveal: 'whatever' }, 2, photo).payoff, 'origin', 'a row from before payoffs');
  const eff = revealCopy({ ...ds, payoff: 'effort', reveal: 'A real shot would need a drone at dawn' }, 2, photo);
  assert.deepEqual([eff.truth, eff.payoff, eff.line], ['ai', 'effort', 'A real shot would need a drone at dawn']);
});

test('builder: over 1,000 seeded draws all four truth patterns appear, near 25% each', () => {
  const pool = SUBJECTS.flatMap((s, i) => [payload(100 + i, 'real', s, 0.5 + i / 100), payload(200 + i, 'ai', s, 0.5 + i / 100)]);
  const counts: Record<string, number> = {};
  const rand = seeded(20261115);
  for (let i = 0; i < 1000; i++) {
    const c = chooseRounds(pool, rand, () => []);
    assert.equal(c.picks.length, 2);
    assert.notEqual(c.picks[0]!.c.subject, c.picks[1]!.c.subject);
    const k = c.truths.map((t) => (t === 'real' ? 'R' : 'A')).join('');
    counts[k] = (counts[k] ?? 0) + 1;
  }
  for (const k of ['RR', 'RA', 'AR', 'AA']) assert.ok((counts[k] ?? 0) > 180, `${k}: ${counts[k]}`);
});

test('builder: provenance failures are archived and skipped; fewer than 2 usable rows skips', async () => {
  const { db } = await openLocalStoriesDb();
  const broken = payload(1, 'real', 'space', 0.99, { provenance: { kind: 'nasa', url: 'https://images.nasa.gov/details/x', licence: 'Public domain (NASA)', credit: '' } });
  const pool = [broken, payload(2, 'real', 'food', 0.5), payload(3, 'ai', 'vehicles', 0.4)];
  for (const p of pool) await addRow(db, p);
  const draws = [0.1, 0.9];
  const res = await buildRealOrAi(deps(db), { rand: () => draws.shift()!, sign });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.historyKeys, [`roa:${hex(2)}`, `roa:${hex(3)}`]);
  const arch = await db.query<{ key: string; reason: string }>(`SELECT key, reason FROM stories.roa_archive`);
  assert.deepEqual(arch.rows, [{ key: `roa:${hex(1)}`, reason: 'provenance' }]);
  const gone = await db.query(`SELECT 1 FROM stories.pool WHERE key = $1`, [`roa:${hex(1)}`]);
  assert.equal(gone.rows.length, 0);

  // One usable row, then none: skip.
  const { db: db2 } = await openLocalStoriesDb();
  const one = await buildRealOrAi(deps(db2, [payload(5, 'ai', 'vehicles', 0.7)]), { rand: () => 0.9, sign });
  assert.equal(one.ok, false);
  if (one.ok) return;
  assert.match(one.skip, /needs 2 usable pool images, has 1/);
  const none = await buildRealOrAi(deps(db2, []), { rand: () => 0.9, sign });
  assert.equal(none.ok, false);
});
