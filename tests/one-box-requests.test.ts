/** One-box seeding: the seed_requests store (offline, PGlite with the real hub schema). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { createRequest, dismissRequest, doneRequest, failRequest, listCards, setStage } from '@/lib/seed/one-box/requests';
import type { OneBoxInput } from '@/lib/seed/one-box/types';
import type { Query } from '@/lib/social/store/pg';

const NOW = new Date('2026-11-04T14:00:00Z');
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);
const schemaSql = (file: string) => fs.readFileSync(path.join(process.cwd(), 'db', file), 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');

async function db(): Promise<Query> {
  const pg = new PGlite();
  await pg.exec(schemaSql('social_hub_schema.sql'));
  return async (text, params) => ({ rows: (await pg.query(text, params)).rows as any[] });
}
const input = (blurb: string, vertical: OneBoxInput['vertical'] = 'reels'): OneBoxInput => ({ vertical, blurb });

test('createRequest twice with the same blurb and vertical inside 60s returns the first request', async () => {
  const q = await db();
  const a = await createRequest(q, input('OpenAI shipped a thing'), NOW);
  const b = await createRequest(q, input('OpenAI shipped a thing'), minutes(0.5));
  assert.equal(a.reused, false);
  assert.equal(b.reused, true);
  assert.equal(b.id, a.id);
});

test('a fourth concurrent working request is refused', async () => {
  const q = await db();
  for (const n of [1, 2, 3]) await createRequest(q, input(`idea ${n}`), NOW);
  await assert.rejects(createRequest(q, input('idea 4'), NOW), /Three seeds are already being worked on; wait for one to finish\./);
});

test('a working row 7 minutes old lists as failed: timed out', async () => {
  const q = await db();
  await createRequest(q, input('old one'), NOW);
  const cards = await listCards(q, 'reels', minutes(7));
  assert.equal(cards.length, 1);
  assert.deepEqual([cards[0]!.status, cards[0]!.message], ['failed', 'Timed out; nothing was added.']);
});

test('the same stale row at stage filing says it may have been added', async () => {
  const q = await db();
  const { id } = await createRequest(q, input('filing one'), NOW);
  await setStage(q, id, 'filing', 0.1, NOW);
  const cards = await listCards(q, 'reels', minutes(7));
  assert.equal(cards[0]!.message, 'This may have been added; check the queue.');
});

test('a fresh working row lists as working with its stage', async () => {
  const q = await db();
  const { id } = await createRequest(q, input('fresh'), NOW);
  await setStage(q, id, 'searching', 0, NOW);
  const cards = await listCards(q, 'reels', minutes(1));
  assert.deepEqual([cards[0]!.status, cards[0]!.stage], ['working', 'searching']);
});

test('dismissed failed rows and done rows are not listed; other verticals are not mixed in', async () => {
  const q = await db();
  const a = await createRequest(q, input('fails'), NOW);
  const b = await createRequest(q, input('succeeds'), NOW);
  await createRequest(q, input('elsewhere', 'carousels'), NOW);
  await failRequest(q, a.id, 'No source found.', 0.12);
  assert.equal((await listCards(q, 'reels', minutes(1))).length, 2, 'the failed card and the working one');
  await dismissRequest(q, a.id);
  await doneRequest(q, b.id, 'reels:idea:1', 0.1);
  assert.equal((await listCards(q, 'reels', minutes(1))).length, 0);
  assert.equal((await listCards(q, 'carousels', minutes(1))).length, 1);
});

test('a quick retry after a failure is a new request, and another Stories series is not the same request', async () => {
  const q = await db();
  const a = await createRequest(q, input('same words'), NOW);
  await failRequest(q, a.id, 'No source found.', 0);
  const b = await createRequest(q, input('same words'), minutes(0.2));
  assert.equal(b.reused, false);
  const s1 = await createRequest(q, { vertical: 'stories', series: 'morning_download', blurb: 'story words' }, NOW);
  const s2 = await createRequest(q, { vertical: 'stories', series: 'free_vs_paid', blurb: 'story words' }, NOW);
  assert.notEqual(s1.id, s2.id);
});
