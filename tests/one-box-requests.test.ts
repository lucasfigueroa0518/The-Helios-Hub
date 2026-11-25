/** One-box seeding: the seed_requests store (offline, PGlite with the real hub schema). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { cancelOrDismiss, cancelRequest, claimRequest, createRequest, dismissRequest, doneRequest, failRequest, listCards, setStage, workingCount } from '@/lib/seed/one-box/requests';
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

test('a quick retry after a failure is a new request, and the same words in another pool are not the same request', async () => {
  const q = await db();
  const a = await createRequest(q, input('same words'), NOW);
  await failRequest(q, a.id, 'No source found.', 0);
  const b = await createRequest(q, input('same words'), minutes(0.2));
  assert.equal(b.reused, false);
  const s1 = await createRequest(q, { vertical: 'stories', blurb: 'story words' }, NOW);
  const s2 = await createRequest(q, { vertical: 'explainers', blurb: 'story words' }, NOW);
  assert.notEqual(s1.id, s2.id);
});

test('claimRequest returns the oldest queued request for its runner and nothing for the other runner', async () => {
  const q = await db();
  const a = await createRequest(q, { vertical: 'ai_trivia', blurb: 'first' }, NOW);
  await createRequest(q, { vertical: 'real_or_ai', blurb: 'second', link: 'https://example.com/x' }, minutes(1));
  await createRequest(q, { vertical: 'reel_ai_drama', blurb: 'drama one' }, minutes(1));
  assert.equal(await claimRequest(q, 'drama', minutes(2)).then((c) => c?.input.vertical), 'reel_ai_drama');
  const c = await claimRequest(q, 'stories', minutes(2));
  assert.deepEqual(c, { id: a.id, input: { vertical: 'ai_trivia', blurb: 'first' } });
  const d = await claimRequest(q, 'stories', minutes(2));
  assert.deepEqual(d?.input, { vertical: 'real_or_ai', blurb: 'second', link: 'https://example.com/x' });
  assert.equal(await claimRequest(q, 'stories', minutes(2)), null);
  assert.equal(await claimRequest(q, 'drama', minutes(2)), null);
  const { rows } = await q(`SELECT stage, status, claimed_at IS NOT NULL AS c FROM social_hub.seed_requests WHERE id = $1::uuid`, [a.id]);
  assert.deepEqual(rows[0], { stage: 'claimed', status: 'working', c: true });
});

test('claimRequest skips a request queued 121 minutes ago', async () => {
  const q = await db();
  await createRequest(q, { vertical: 'ai_trivia', blurb: 'too old' }, NOW);
  assert.equal(await claimRequest(q, 'stories', minutes(121)), null);
  assert.ok(await claimRequest(q, 'stories', minutes(119)));
});

test('same text twice in 60 s on ai_trivia makes one request', async () => {
  const q = await db();
  const a = await createRequest(q, { vertical: 'ai_trivia', blurb: 'same' }, NOW);
  const b = await createRequest(q, { vertical: 'ai_trivia', blurb: 'same' }, minutes(0.5));
  assert.deepEqual([b.reused, b.id], [true, a.id]);
});

test('queued worker requests do not count toward the three-at-once limit; claimed ones do', async () => {
  const q = await db();
  for (const n of [1, 2, 3, 4]) await createRequest(q, { vertical: 'ai_trivia', blurb: `t${n}` }, NOW);
  await createRequest(q, input('reel one'), NOW);
  for (let i = 0; i < 3; i++) await claimRequest(q, 'stories', minutes(1));
  await assert.rejects(createRequest(q, input('reel two'), minutes(1)), /Three seeds are already/);
});

test('a claimed request untouched for 7 minutes reads may-have-been-added when its stage is filing, timed out otherwise; real_or_ai waits 10', async () => {
  const q = await db();
  const a = await createRequest(q, { vertical: 'ai_trivia', blurb: 'trivia' }, NOW);
  const r = await createRequest(q, { vertical: 'real_or_ai', blurb: 'roa' }, NOW);
  await claimRequest(q, 'stories', NOW);
  await claimRequest(q, 'stories', NOW);
  let t = await listCards(q, 'ai_trivia', minutes(7));
  assert.deepEqual([t[0]!.status, t[0]!.message], ['failed', 'Timed out; nothing was added.']);
  await setStage(q, a.id, 'filing', 0.1, NOW);
  t = await listCards(q, 'ai_trivia', minutes(7));
  assert.equal(t[0]!.message, 'This may have been added; check the queue.');
  assert.equal((await listCards(q, 'real_or_ai', minutes(7)))[0]!.status, 'working');
  assert.equal((await listCards(q, 'real_or_ai', minutes(11)))[0]!.status, 'failed');
  await setStage(q, r.id, 'filing', 0.1, minutes(8));
  assert.equal((await listCards(q, 'real_or_ai', minutes(17)))[0]!.status, 'working', 'a touch at minute 8 restarts the 10-minute clock');
});

test('cancelRequest works only while queued', async () => {
  const q = await db();
  const a = await createRequest(q, { vertical: 'ai_trivia', blurb: 'cancel me' }, NOW);
  const b = await createRequest(q, { vertical: 'ai_trivia', blurb: 'claimed' }, NOW);
  assert.equal(await cancelRequest(q, a.id), true);
  assert.equal(await cancelRequest(q, a.id), false);
  assert.equal(await claimRequest(q, 'stories', minutes(1)).then((c) => c?.id), b.id);
  assert.equal(await cancelRequest(q, b.id), false);
  const { rows } = await q(`SELECT status, message, dismissed_at IS NOT NULL AS d FROM social_hub.seed_requests WHERE id = $1::uuid`, [a.id]);
  assert.deepEqual(rows[0], { status: 'failed', message: 'Cancelled; nothing was spent.', d: true });
  assert.equal(await claimRequest(q, 'stories', minutes(1)), null);
});

test('listCards shows the 1-minute and 120-minute queued wording', async () => {
  const q = await db();
  await createRequest(q, { vertical: 'ai_trivia', blurb: 'waits' }, NOW);
  const msg = async (m: number) => (await listCards(q, 'ai_trivia', minutes(m)))[0]!;
  assert.deepEqual([(await msg(0.5)).status, (await msg(0.5)).message], ['working', 'Waiting for the worker']);
  assert.equal((await msg(2)).message, "Waiting: the worker is busy with tonight's run");
  assert.equal((await msg(119)).status, 'working');
  assert.deepEqual([(await msg(121)).status, (await msg(121)).message], ['failed', "The worker didn't pick this up; nothing was spent."]);
});

test('cancelOrDismiss (the DELETE route): stale row dismissed, fresh running row refused, queued row cancelled', async () => {
  const q = await db();
  const stale = await createRequest(q, input('stale'), NOW);
  assert.equal(await cancelOrDismiss(q, stale.id, minutes(7)), 'dismissed');
  assert.equal((await listCards(q, 'reels', minutes(7))).length, 0);
  const fresh = await createRequest(q, input('fresh'), minutes(8));
  await setStage(q, fresh.id, 'searching', 0, minutes(8));
  assert.equal(await cancelOrDismiss(q, fresh.id, minutes(9)), 'running');
  const roa = await createRequest(q, { vertical: 'real_or_ai', blurb: 'roa' }, NOW);
  await claimRequest(q, 'stories', NOW);
  assert.equal(await cancelOrDismiss(q, roa.id, minutes(8)), 'running', 'real_or_ai is still fresh at 8 minutes');
  assert.equal(await cancelOrDismiss(q, roa.id, minutes(11)), 'dismissed');
  const q2 = await db();
  const queued = await createRequest(q2, { vertical: 'ai_trivia', blurb: 'q' }, NOW);
  assert.equal(await cancelOrDismiss(q2, queued.id, minutes(60)), 'cancelled');
  const old = await createRequest(q2, { vertical: 'ai_trivia', blurb: 'old' }, NOW);
  assert.equal(await cancelOrDismiss(q2, old.id, minutes(130)), 'dismissed');
  const failed = await createRequest(q2, input('failed'), NOW);
  await failRequest(q2, failed.id, 'x', 0);
  assert.equal(await cancelOrDismiss(q2, failed.id, minutes(1)), 'dismissed');
  assert.equal(await cancelOrDismiss(q, '00000000-0000-4000-8000-000000000000'), 'missing');
});

test('a done row with a message stays as a done card until dismissed; one without stays hidden', async () => {
  const q = await db();
  const a = await createRequest(q, input('real photo', 'real_or_ai'), NOW);
  const b = await createRequest(q, input('plain'), NOW);
  await doneRequest(q, a.id, 'roa:1', 0.3, "The real photo was added; the AI twin didn't pass.");
  await doneRequest(q, b.id, 'reels:idea:1', 0.1);
  const cards = await listCards(q, 'real_or_ai', minutes(1));
  assert.equal(cards.length, 1);
  assert.deepEqual([cards[0]!.status, cards[0]!.message], ['done', "The real photo was added; the AI twin didn't pass."]);
  assert.equal((await listCards(q, 'reels', minutes(1))).length, 0);
  assert.equal(await cancelOrDismiss(q, a.id, minutes(2)), 'dismissed');
  assert.equal((await listCards(q, 'real_or_ai', minutes(2))).length, 0);
});

test('only a queued worker card can be cancelled from the card', async () => {
  const q = await db();
  const t = await createRequest(q, input('trivia', 'ai_trivia'), NOW);
  const r = await createRequest(q, input('reel'), NOW);
  assert.equal((await listCards(q, 'ai_trivia', minutes(1)))[0]!.cancellable, true);
  assert.equal((await listCards(q, 'reels', minutes(1)))[0]!.cancellable, false);
  await claimRequest(q, 'stories', minutes(1));
  assert.equal((await listCards(q, 'ai_trivia', minutes(1)))[0]!.cancellable, false);
  void t; void r;
});

// Final fixes 2: AI Drama's producer turn can outlast 6 minutes, so a claimed drama request waits 10, like Real or AI?; and the
// three-at-once count uses each row's own cutoff.
test('a claimed reel_ai_drama request stays working at 8 minutes; workingCount uses each row\'s own cutoff', async () => {
  const q = await db();
  const d = await createRequest(q, { vertical: 'reel_ai_drama', blurb: 'drama' }, NOW);
  await createRequest(q, input('a reel'), NOW);
  assert.ok(await claimRequest(q, 'drama', NOW));
  assert.equal((await listCards(q, 'reel_ai_drama', minutes(8)))[0]!.status, 'working');
  assert.equal((await listCards(q, 'reels', minutes(8)))[0]!.status, 'failed', 'a reel still times out at 6');
  assert.equal(await workingCount(q, minutes(8)), 1, 'the drama row counts at 8 minutes; the stale reel does not');
  assert.equal(await workingCount(q, minutes(11)), 0);
  assert.equal((await listCards(q, 'reel_ai_drama', minutes(11)))[0]!.status, 'failed');
  await setStage(q, d.id, 'checking', 0.1, minutes(9));
  assert.equal(await workingCount(q, minutes(18)), 1, 'a stage refresh restarts its clock');
});
