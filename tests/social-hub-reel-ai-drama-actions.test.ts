/**
 * AI Drama Reels hub verbs (lib/publishing/actions/reel-ai-drama.ts) with stub deps: every verb answers
 * with a note, refusals keep their words, an unreachable drama database is a 503 note (never a raw
 * throw), and revisions are refused while drama is not on the revisions worker's database. Offline.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { DRAMA_REFUSAL_TEXT } from '@/lib/reel-ai-drama/hub';
import { DRAMA_REVISIONS_NOT_SHARED, reelAiDramaActions } from '@/lib/publishing/actions/reel-ai-drama';

const JOB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PITCH = '11111111-1111-4111-8111-111111111111';
const NEW_JOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const T = { jobId: JOB, pitchId: PITCH };

type Calls = Array<[string, ...unknown[]]>;

function actions(over: Record<string, unknown> = {}) {
  const calls: Calls = [];
  const db = { query: async () => ({ rows: [] }) };
  const deps = {
    db: async () => db,
    setVerdict: async (...a: unknown[]) => { calls.push(['setVerdict', ...a.slice(1)]); },
    hardPublishJob: async () => ({ queued: true }),
    requestJob: async () => ({ ok: true, jobId: NEW_JOB }),
    itemId: async () => 'item-1',
    unscheduleJob: async (_db: unknown, id: string) => { calls.push(['unschedule', id]); return { ok: true, note: 'Unscheduled.' }; },
    latestJobId: async () => JOB,
    verdictOf: async () => null,
    scheduleJob: async () => ({ scheduled: true, publishAt: '2026-11-09T01:10:00Z' }),
    publishingLive: async () => true,
    placeItem: async (_q: unknown, input: unknown) => { calls.push(['place', input]); return { ok: true, note: 'Placed.' }; },
    rescheduleItem: async () => ({ ok: true, note: 'Moved.' }),
    revisionsQuery: async () => null,
    now: () => new Date('2026-11-08T15:00:00Z'),
    ...over,
  };
  return { a: reelAiDramaActions(deps as never), calls };
}

test('approve books a slot while publishing is live, and holds off while it is off', async () => {
  const { a, calls } = actions();
  const out = await a.approve!(T, 'lucas');
  assert.equal(out.ok, true);
  assert.match(out.note, /^Approved\. It posts /);
  assert.deepEqual(calls[0], ['setVerdict', JOB, 'approved', 'lucas']);
  const off = await actions({ publishingLive: async () => false }).a.approve!(T, 'lucas');
  assert.match(off.note, /Publishing is switched off/);
  const full = await actions({ scheduleJob: async () => ({ scheduled: false }) }).a.approve!(T, 'lucas');
  assert.match(full.note, /No window is left today/);
});

test('reject passes the review tags and note', async () => {
  const { a, calls } = actions();
  const out = await a.reject!(T, 'lucas', { tags: ['hook'], note: 'slow open' });
  assert.deepEqual(out, { ok: true, note: 'Rejected. It will not post.' });
  assert.deepEqual(calls[0], ['setVerdict', JOB, 'rejected', 'lucas', { tags: ['hook'], note: 'slow open' }]);
});

test('publishNow queues, and a refusal keeps its note and status', async () => {
  assert.deepEqual(await actions().a.publishNow!(T, 'lucas'), { ok: true, note: 'Queued to publish now.' });
  const refused = await actions({ hardPublishJob: async () => ({ queued: false, note: 'Not finished yet.', status: 409 }) }).a.publishNow!(T, 'lucas');
  assert.deepEqual(refused, { ok: false, note: 'Not finished yet.', status: 409 });
});

test('regenerate queues a new job for the pitch and unschedules the version it replaces; a refusal is a 409 note', async () => {
  const { a, calls } = actions();
  const out = await a.regenerate!(T, 'lucas');
  assert.equal(out.ok, true);
  assert.match(out.note, /unscheduled and no longer approved/);
  assert.deepEqual(calls, [['unschedule', JOB]]);
  const capped = await actions({ requestJob: async () => ({ ok: false, reason: 'daily_spend_cap' }) }).a.regenerate!(T, 'lucas');
  assert.deepEqual(capped, { ok: false, note: DRAMA_REFUSAL_TEXT.daily_spend_cap, status: 409 });
});

test('place refuses a rejected reel and a missing one, else places it on the spine', async () => {
  const at = { nyDate: '2026-11-09', slot: 'evening' };
  assert.match((await actions({ verdictOf: async () => 'rejected' }).a.place!(T, 'lucas', at)).note, /rejected/);
  assert.deepEqual(await actions({ itemId: async () => null }).a.place!(T, 'lucas', at), { ok: false, note: 'The reel is gone.' });
  const { a, calls } = actions();
  assert.equal((await a.place!(T, 'lucas', at)).ok, true);
  assert.deepEqual(calls[0], ['place', { vertical: 'reel_ai_drama', itemId: 'item-1', nyDate: '2026-11-09', slot: 'evening', by: 'lucas' }]);
});

test('a missing ref is a 400 note; an unreachable drama database is a 503 note on every verb', async () => {
  assert.deepEqual(await actions().a.approve!({}, 'lucas'), { ok: false, note: 'Missing jobId.', status: 400 });
  assert.deepEqual(await actions().a.place!(T, 'lucas'), { ok: false, note: 'Missing nyDate or slot.', status: 400 });
  const { a } = actions({ db: async () => { throw new Error('connection refused'); } });
  for (const verb of ['approve', 'reject', 'publishNow', 'regenerate', 'unschedule', 'delete', 'place', 'reschedule'] as const) {
    const out = await a[verb]!(T, 'lucas', { nyDate: '2026-11-09', slot: 'evening' });
    assert.equal(out.ok, false, verb);
    assert.equal(out.status, 503, verb);
    assert.match(out.note, /^AI Drama Reels couldn’t .+: connection refused$/, verb);
  }
});

test('revisions are refused with a note while drama is not on the shared database, and read as none', async () => {
  const { a } = actions();
  for (const verb of ['revise', 'undoRevision', 'continueRevision'] as const) {
    assert.deepEqual(await a[verb]!(T, 'lucas', { instruction: 'x' } as never), { ok: false, note: DRAMA_REVISIONS_NOT_SHARED, status: 409 }, verb);
  }
  assert.deepEqual(await a.revisions!(T), []);
  assert.equal(a.vertical, 'reel_ai_drama');
});
