/** Targeted Revisions task 5: the worker's claim loop on PGlite (offline; `complete` is stubbed, never live). */
import assert from 'node:assert/strict';
import test from 'node:test';

import { resetCapsForTest, setCapsForTest } from '@/lib/revisions/caps';
import type { Complete } from '@/lib/revisions/interpret';
import { clearRegistryForTest, registerDescription, restoreRegistryForTest } from '@/lib/revisions/registry';
import { createRequest, listForItem } from '@/lib/revisions/store';
import type { ContentTypeDescription, PartState, PostSnapshot } from '@/lib/revisions/types';
import { continueAfterCeiling } from '@/lib/revisions/engine';
import { claimAndRunRevisions, type RevisionWorkerDeps } from '@/lib/revisions/worker';
import type { Query } from '@/lib/social/store/pg';

import { setupRevisionsDb } from './fixtures/revisions/pglite';

const part = { kind: 'slide', key: '3' };
const refs = { postId: 'p1' };
const usage = { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const OK_JSON = JSON.stringify({ status: 'ok', part, fixKind: 'wording', stageTag: 'copy_write', instruction: 'Shorten the slide 3 headline.' });
const ASK_JSON = JSON.stringify({ status: 'ask', question: 'Which slide do you mean?' });

function fakeType(o: { status?: PostSnapshot['status']; missing?: boolean } = {}) {
  const post = { slide3: { copy: 'v0', files: ['slide3-v0.png'] } as PartState };
  const calls = { revise: 0 };
  const desc: ContentTypeDescription = {
    vertical: 'carousels',
    label: 'carousels',
    stageTags: ['copy_write'],
    fixKinds: ['wording'],
    load: async () => (o.missing ? null : { vertical: 'carousels', refs, status: o.status ?? 'review', parts: [{ ref: part, text: String(post.slide3.copy) }] }),
    estimate: () => 0.01,
    async revise({ meter, interpretation }) {
      calls.revise += 1;
      meter.spend(0.02);
      const before = post.slide3;
      post.slide3 = { copy: interpretation.instruction, files: ['slide3-v1.png'] };
      return { ok: true, before, after: post.slide3 };
    },
    restore: async ({ state }) => {
      post.slide3 = state;
    },
    unschedule: async () => ({ ok: true, note: '' }),
  };
  return { desc, post, calls };
}

function stub(...texts: Array<string | Error>) {
  const calls: Parameters<Complete>[0][] = [];
  const complete: Complete = async (r) => {
    calls.push(r);
    const t = texts[Math.min(calls.length - 1, texts.length - 1)];
    if (t instanceof Error) throw t;
    return { text: t, usage };
  };
  return { complete, calls };
}

async function withWorker(
  fake: ReturnType<typeof fakeType> | null,
  complete: Complete,
  fn: (ctx: { q: Query; itemId: string; deps: RevisionWorkerDeps; notes: string[] }) => Promise<void>,
  cap = { capUsd: 0.2, ceilingUsd: 0.5 },
) {
  const { q, itemId } = await setupRevisionsDb();
  const notes: string[] = [];
  clearRegistryForTest();
  setCapsForTest({ carousels: { wording: cap } });
  try {
    if (fake) registerDescription(fake.desc);
    const deps: RevisionWorkerDeps = { q, complete, notify: async (m) => void notes.push(m), now: () => new Date('2026-10-28T12:00:00Z') };
    await fn({ q, itemId, deps, notes });
  } finally {
    restoreRegistryForTest();
    resetCapsForTest();
  }
}

const submit = (q: Query, itemId: string, instruction = 'fix the headline', parentId?: string) =>
  createRequest(q, { vertical: 'carousels', refs, itemId, by: 'lucas', instruction, parentId });

test('claimAndRunRevisions asks back on an ambiguous sentence without calling revise', async () => {
  const fake = fakeType();
  const s = stub(ASK_JSON);
  await withWorker(fake, s.complete, async ({ q, itemId, deps }) => {
    const r = await submit(q, itemId, 'make it better');
    assert.equal(await claimAndRunRevisions(deps), 1);
    const row = (await listForItem(q, itemId))[0];
    assert.equal(row.id, r.id);
    assert.equal(row.status, 'asking');
    assert.equal(row.question, 'Which slide do you mean?');
    assert.ok(row.spendUsd > 0, 'the Haiku call is logged on the row');
    assert.equal(fake.calls.revise, 0);
    assert.equal(s.calls.length, 1);
    assert.equal(await claimAndRunRevisions(deps), 0, 'nothing left to claim');
  });
});

test('an ok interpretation is stored and the engine applies it', async () => {
  const fake = fakeType();
  const s = stub(OK_JSON);
  await withWorker(fake, s.complete, async ({ q, itemId, deps }) => {
    await submit(q, itemId);
    assert.equal(await claimAndRunRevisions(deps), 1);
    const row = (await listForItem(q, itemId))[0];
    assert.equal(row.status, 'applied', row.note ?? '');
    assert.deepEqual(row.part, part);
    assert.equal(row.fixKind, 'wording');
    assert.equal(row.stageTag, 'copy_write');
    assert.equal(row.capUsd, 0.2);
    assert.equal(row.ceilingUsd, 0.5);
    assert.equal(row.interpretation?.instruction, 'Shorten the slide 3 headline.');
    assert.ok(row.spendUsd > 0.02, 'interpreter cost plus the revision spend');
    assert.equal(fake.calls.revise, 1);
    assert.equal(fake.post.slide3.copy, 'Shorten the slide 3 headline.');
  });
});

test('a reply with parentId sends the earlier sentence and question as prior', async () => {
  const fake = fakeType();
  const s = stub(ASK_JSON, OK_JSON);
  await withWorker(fake, s.complete, async ({ q, itemId, deps }) => {
    const first = await submit(q, itemId, 'make it better');
    await claimAndRunRevisions(deps);
    const reply = await submit(q, itemId, 'the slide 3 headline, shorter', first.id);
    assert.equal(await claimAndRunRevisions(deps), 1);
    const user = String(s.calls[1].messages[0].content);
    assert.match(user, /Earlier the person said: "make it better"/);
    assert.match(user, /You asked: "Which slide do you mean\?"/);
    assert.match(user, /"the slide 3 headline, shorter"/);
    const row = (await listForItem(q, itemId)).find((r) => r.id === reply.id)!;
    assert.equal(row.parentId, first.id);
    assert.equal(row.status, 'applied');
  });
});

test('a thrown model call ends the row failed, never running', async () => {
  const fake = fakeType();
  const s = stub(new Error('overloaded'));
  await withWorker(fake, s.complete, async ({ q, itemId, deps }) => {
    await submit(q, itemId);
    assert.equal(await claimAndRunRevisions(deps), 1);
    const row = (await listForItem(q, itemId))[0];
    assert.equal(row.status, 'failed');
    assert.match(row.note!, /overloaded/);
    assert.equal(fake.calls.revise, 0);
  });
});

test('a missing description or post ends the row failed with a plain note and no model call', async () => {
  const s = stub(OK_JSON);
  await withWorker(null, s.complete, async ({ q, itemId, deps }) => {
    await submit(q, itemId);
    await claimAndRunRevisions(deps);
    const row = (await listForItem(q, itemId))[0];
    assert.equal(row.status, 'failed');
    assert.equal(row.note, 'Revisions are not available for carousels yet.');
  });
  const gone = fakeType({ missing: true });
  await withWorker(gone, s.complete, async ({ q, itemId, deps }) => {
    await submit(q, itemId);
    await claimAndRunRevisions(deps);
    const row = (await listForItem(q, itemId))[0];
    assert.equal(row.status, 'failed');
    assert.match(row.note!, /could not be found/);
  });
  const published = fakeType({ status: 'published' });
  await withWorker(published, s.complete, async ({ q, itemId, deps }) => {
    await submit(q, itemId);
    await claimAndRunRevisions(deps);
    const row = (await listForItem(q, itemId))[0];
    assert.equal(row.status, 'failed');
    assert.match(row.note!, /published/);
  });
  assert.equal(s.calls.length, 0);
});

test('claims at most `max` rows per tick', async () => {
  const fake = fakeType();
  const s = stub(ASK_JSON);
  await withWorker(fake, s.complete, async ({ q, itemId, deps }) => {
    for (let i = 0; i < 3; i++) await submit(q, itemId, `vague ${i}`);
    assert.equal(await claimAndRunRevisions({ ...deps, max: 2 }), 2);
    assert.equal(await claimAndRunRevisions({ ...deps, max: 2 }), 1);
    assert.equal((await listForItem(q, itemId)).every((r) => r.status === 'asking'), true);
  });
});

for (const c of [
  { name: 'its cap', paused: 'paused_at_cap', cap: { capUsd: 0.005, ceilingUsd: 0.5 }, revisesBefore: 0 },
  { name: 'its ceiling', paused: 'paused_at_ceiling', cap: { capUsd: 0.2, ceilingUsd: 0.01 }, revisesBefore: 1 },
] as const) {
  test(`a row continued past ${c.name} runs again without a second interpreter call`, async () => {
    const fake = fakeType();
    // A second call would ask back; it must never happen.
    const s = stub(OK_JSON, ASK_JSON);
    await withWorker(
      fake,
      s.complete,
      async ({ q, itemId, deps }) => {
        const r = await submit(q, itemId);
        assert.equal(await claimAndRunRevisions(deps), 1);
        let row = (await listForItem(q, itemId))[0];
        assert.equal(row.status, c.paused, row.note ?? '');
        assert.equal(fake.calls.revise, c.revisesBefore);
        const spentBefore = row.spendUsd;

        const cont = await continueAfterCeiling(deps, r.id, 'lucas', 0.05);
        assert.equal(cont.ok, true, cont.note);
        assert.equal(await claimAndRunRevisions(deps), 1);

        assert.equal(s.calls.length, 1, 'complete is not called for a continued row');
        row = (await listForItem(q, itemId))[0];
        assert.equal(row.status, 'applied', row.note ?? '');
        assert.deepEqual(row.part, part);
        assert.equal(row.fixKind, 'wording');
        assert.equal(row.interpretation?.instruction, 'Shorten the slide 3 headline.');
        assert.equal(row.overrideUsd, 0.05);
        assert.equal(fake.calls.revise, c.revisesBefore + 1);
        assert.ok(row.spendUsd > spentBefore, 'the continued run adds its spend');
      },
      c.cap,
    );
  });
}

/* ── Final wave: no paid interpretation without a cap ── */

test('no approved cap for the type: the row fails with the plain note before any interpreter call, $0', async () => {
  const fake = fakeType();
  const s = stub(OK_JSON);
  for (const caps of [{}, { carousels: null }, { carousels: {} }, { reels: { wording: { capUsd: 1, ceilingUsd: 2 } } }]) {
    await withWorker(fake, s.complete, async ({ q, itemId, deps }) => {
      setCapsForTest(caps);
      await submit(q, itemId);
      assert.equal(await claimAndRunRevisions(deps), 1);
      const row = (await listForItem(q, itemId))[0];
      assert.equal(row.status, 'failed');
      assert.equal(row.note, 'There is no approved cap for carousels yet, so nothing was run.');
      assert.equal(row.spendUsd, 0);
    });
  }
  assert.equal(s.calls.length, 0, 'Haiku is never called');
  assert.equal(fake.calls.revise, 0);
});

test('no cap: reels say "text on screen" in the note', async () => {
  const fake = fakeType();
  const reels = { ...fake, desc: { ...fake.desc, vertical: 'reels' as const } };
  const s = stub(OK_JSON);
  await withWorker(reels, s.complete, async ({ q, itemId, deps }) => {
    setCapsForTest({});
    await createRequest(q, { vertical: 'reels', refs, itemId, by: 'lucas', instruction: 'x' });
    await claimAndRunRevisions(deps);
    const row = (await listForItem(q, itemId))[0];
    assert.equal(row.note, 'There is no approved cap for text on screen yet, so nothing was run.');
  });
  assert.equal(s.calls.length, 0);
});

/* ── Final wave: rows a dead worker left `running` ── */

test('startUpRevisions repairs first, then fails only this worker\'s `running` rows, and logs the ids', async () => {
  const { startUpRevisions } = await import('@/lib/revisions/worker');
  const { RESTARTED_NOTE, getRequest } = await import('@/lib/revisions/store');
  await withWorker(fakeType(), stub(OK_JSON).complete, async ({ q, itemId }) => {
    const mine = await submit(q, itemId);
    const theirs = await createRequest(q, { vertical: 'explainers', refs: { jobId: 'j1' }, itemId, by: 'lucas', instruction: 'x' });
    const waiting = await submit(q, itemId, 'still queued');
    await q(`UPDATE revisions.requests SET status = 'running', started_at = now() WHERE id = ANY($1::uuid[])`, [[mine.id, theirs.id]]);

    const order: string[] = [];
    const logs: Array<[string, Record<string, unknown> | undefined]> = [];
    const swept = await startUpRevisions({
      recover: async () => void order.push('recover'),
      query: async () => {
        order.push('sweep');
        return q;
      },
      filter: { exclude: 'explainers' },
      log: (m, f) => void logs.push([m, f]),
    });
    assert.deepEqual(order, ['recover', 'sweep'], 'the workspace is repaired before the rows are ended');
    assert.deepEqual(swept, [mine.id]);
    assert.equal((await getRequest(q, mine.id))!.note, RESTARTED_NOTE);
    assert.equal((await getRequest(q, theirs.id))!.status, 'running');
    assert.equal((await getRequest(q, waiting.id))!.status, 'requested', 'not requeued, not touched');
    assert.deepEqual(logs, [['revisions_restart_swept', { ids: [mine.id] }]]);
    // A requested row is claimed normally afterwards; the swept one is never run again.
  });
});

test('startUpRevisions never throws: a failing sweep is logged and start-up goes on; no query means no sweep', async () => {
  const { startUpRevisions } = await import('@/lib/revisions/worker');
  const logs: string[] = [];
  const failing: Query = async () => {
    throw new Error('relation "revisions.requests" does not exist');
  };
  assert.deepEqual(await startUpRevisions({ query: async () => failing, filter: { only: 'explainers' }, log: (m) => void logs.push(m) }), []);
  assert.deepEqual(logs, ['revisions_restart_sweep_failed']);
  let asked = false;
  assert.deepEqual(await startUpRevisions({ query: null, recover: async () => void (asked = true), filter: { only: 'explainers' }, log: (m) => void logs.push(m) }), []);
  assert.equal(asked, true, 'recovery still runs');
  assert.equal(logs.length, 1);
});

test('each tick also fails this worker\'s rows running longer than 2 hours, before claiming', async () => {
  const { STALE_RUNNING_NOTE, getRequest } = await import('@/lib/revisions/store');
  const fake = fakeType();
  const s = stub(ASK_JSON);
  await withWorker(fake, s.complete, async ({ q, itemId, deps }) => {
    const old = await submit(q, itemId, 'old');
    const recent = await submit(q, itemId, 'recent');
    const otherOld = await createRequest(q, { vertical: 'explainers', refs: { jobId: 'j1' }, itemId, by: 'lucas', instruction: 'x' });
    await q(`UPDATE revisions.requests SET status = 'running', started_at = now() - interval '3 hours' WHERE id = ANY($1::uuid[])`, [[old.id, otherOld.id]]);
    await q(`UPDATE revisions.requests SET status = 'running', started_at = now() - interval '90 minutes' WHERE id = $1`, [recent.id]);
    const logs: string[] = [];
    assert.equal(await claimAndRunRevisions({ ...deps, filter: { exclude: 'explainers' }, log: (m) => void logs.push(m) }), 0);
    assert.equal((await getRequest(q, old.id))!.status, 'failed');
    assert.equal((await getRequest(q, old.id))!.note, STALE_RUNNING_NOTE);
    assert.equal((await getRequest(q, recent.id))!.status, 'running');
    assert.equal((await getRequest(q, otherOld.id))!.status, 'running', 'another worker\'s row');
    assert.ok(logs.includes('revisions_stale_swept'));
  });
});
