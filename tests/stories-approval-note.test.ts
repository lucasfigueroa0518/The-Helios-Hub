/**
 * Approving a Stories set says whether the worker can still schedule it. A
 * set approved after its 8:30-10:00 window never posts (worker: a passed
 * window is skipped), so the note must say so instead of "It posts in its
 * window." Offline.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { storyActions } from '@/lib/publishing/actions/stories';
import { approve, generate } from '@/lib/stories/api';
import { approvalNote, windowLabel } from '@/lib/stories/schedule';
import { claimNextRequested, markReady, saveBuild } from '@/lib/stories/repository';

import { harnessDb } from './stories-harness';

const W = { start: '08:30', end: '10:00', days: [0, 1, 2, 3, 4, 5, 6] };
const at = (iso: string) => new Date(iso); // October is EDT: 08:30 NY = 12:30Z

test('windowLabel reads as a person would say it', () => {
  assert.equal(windowLabel(W), '8:30-10:00 AM');
  assert.equal(windowLabel({ ...W, start: '11:00', end: '13:15' }), '11:00 AM-1:15 PM');
});

test('approvalNote: before and inside the window it posts; after, it will not', () => {
  assert.match(approvalNote(W, '2026-10-13', at('2026-10-13T08:10:00Z')), /posts at a random minute in its 8:30-10:00 AM window/);
  assert.match(approvalNote(W, '2026-10-13', at('2026-10-13T13:30:00Z')), /posts at a random minute/); // 9:30 AM NY
  const late = approvalNote(W, '2026-10-13', at('2026-10-13T14:01:00Z')); // 10:01 AM NY
  assert.match(late, /window has passed/);
  assert.match(late, /will not post unless you press Publish now/);
  assert.match(approvalNote(W, '2026-10-11', at('2026-10-13T08:10:00Z')), /will not post unless you press Publish now/, 'a stale day');
  assert.match(approvalNote(W, '2026-10-14', at('2026-10-13T08:10:00Z')), /posts at a random minute/, 'a future day');
  assert.match(approvalNote(W, '2026-10-13', at('2026-10-13T08:10:00Z'), false), /Publishing is switched off/);
});

async function ready(nyNow: Date) {
  const { db } = await harnessDb();
  const { set } = await generate(db, 'free_vs_paid', 'lucas@x', nyNow);
  await claimNextRequested(db);
  await saveBuild(db, set.id, { payload: {}, frames: [{ seq: 1, role: 'intro', backdrop: 'black', copy: { role: 'intro' } }], candidates: [] });
  await markReady(db, set.id, true);
  return { db, id: set.id };
}

test('api.approve returns the note; a late approval of a flagged set says it will not post', async () => {
  const early = await ready(at('2026-10-10T08:00:00Z'));
  const first = (await approve(early.db, early.id, at('2026-10-10T09:00:00Z'))).approvalNote; // the harness has publishing off
  assert.match(first, /^Approved\./);
  assert.doesNotMatch(first, /Publish now|has passed/);
  const late = await ready(at('2026-10-10T08:00:00Z'));
  const done = await approve(late.db, late.id, at('2026-10-10T15:00:00Z'));
  assert.equal(done.status, 'approved');
  assert.match(done.approvalNote, /Publish now/);
});

test('storyActions.approve passes the note through, and keeps the old line when none comes back', async () => {
  const base = { reject: async () => 0, publishNow: async () => 0, regenerate: async () => 0, unscheduleSet: async () => ({ ok: true, note: '' }), query: (async () => ({ rows: [] })) as never, getSet: async () => null, slotOf: async () => null, plan: (async () => ({})) as never, rescheduleSet: async () => 0 };
  const withNote = storyActions({ ...base, approve: async () => ({ approvalNote: 'Approved, but the window has passed.' }) });
  assert.deepEqual(await withNote.approve!({ setId: 's' }, 'tommy', {}), { ok: true, note: 'Approved, but the window has passed.' });
  const plain = storyActions({ ...base, approve: async () => undefined });
  assert.deepEqual(await plain.approve!({ setId: 's' }, 'tommy', {}), { ok: true, note: 'Approved. It posts in its window.' });
});
