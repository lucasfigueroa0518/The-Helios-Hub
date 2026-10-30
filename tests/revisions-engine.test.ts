/** Targeted Revisions task 4: the engine on PGlite with a fake content type (offline, no model calls). */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { Query } from '@/lib/social/store/pg';

import { resetCapsForTest, setCapsForTest } from '@/lib/revisions/caps';
import { continueAfterCeiling, restoreOriginal, runRevision, undoRevision, type EngineDeps } from '@/lib/revisions/engine';
import { clearRegistryForTest, registerDescription, restoreRegistryForTest } from '@/lib/revisions/registry';
import { claimNextRequested, createRequest, listForItem, markRunning } from '@/lib/revisions/store';
import type {
  ContentTypeDescription,
  FixKind,
  Interpretation,
  PartRef,
  PartState,
  PostSnapshot,
  RevisionRow,
} from '@/lib/revisions/types';

import { setupRevisionsDb } from './fixtures/revisions/pglite';

const part: PartRef = { kind: 'slide', key: '3' };
const refs = { postId: 'p1' };

type Post = { status: PostSnapshot['status']; slide3: PartState };

/** In-memory carousel. Rendered files only ever accumulate; the test asserts that. */
type FakeOpts = {
  estimate?: number;
  spends?: number[];
  result?: 'ok' | 'blocked' | 'swallow' | 'throw';
  status?: Post['status'];
  /** Runs inside revise after the new content is written (e.g. flip the post status mid-run). */
  duringRevise?: (post: Post) => void;
  /** Return false (or throw) from unschedule on these 1-based call numbers. */
  unscheduleFailsOn?: number[];
  unscheduleThrows?: boolean;
  restoreThrows?: boolean;
  /** Throw from restore on these 1-based call numbers only. */
  restoreThrowsOn?: number[];
  /** The message restore throws with (default 'disk full', a transient failure). */
  restoreError?: string;
  loadThrows?: boolean;
};

function fakeType(opts: FakeOpts = {}) {
  const post: Post = { status: opts.status ?? 'review', slide3: { copy: 'v0', files: ['slide3-v0.png'] } };
  const files = new Set<string>(post.slide3.files);
  const calls = { revise: 0, restore: 0, unschedule: 0 };
  /** Call order across revise / restore / unschedule. */
  const events: string[] = [];
  /** The `copy` of each state restore put back, in call order. */
  const restored: string[] = [];
  let version = 0;
  const fileCountHistory: number[] = [files.size];
  const track = () => {
    assert.ok(files.size >= fileCountHistory[fileCountHistory.length - 1], 'fake file set must never shrink');
    fileCountHistory.push(files.size);
  };
  const desc: ContentTypeDescription = {
    vertical: 'carousels',
    label: 'carousels',
    stageTags: ['copy_write', 'photo_pick'],
    fixKinds: ['wording', 'photo'],
    load: async () => {
      if (opts.loadThrows) throw new Error('db down');
      return { vertical: 'carousels', refs, status: post.status, parts: [{ ref: part, text: String(post.slide3.copy) }] };
    },
    estimate: () => opts.estimate ?? 0.05,
    async revise({ interpretation, meter }) {
      calls.revise += 1;
      events.push('revise');
      try {
        for (const s of opts.spends ?? [0.05]) meter.spend(s);
      } catch (e) {
        if (opts.result === 'swallow') return { ok: false, reason: 'failed', note: 'stage threw' };
        throw e;
      }
      if (opts.result === 'throw') throw new Error('renderer crashed');
      if (opts.result === 'blocked') return { ok: false, reason: 'blocked', note: 'Fact-check failed: the number is wrong.' };
      version += 1;
      const before = post.slide3;
      const file = `slide3-v${version}.png`;
      files.add(file);
      post.slide3 = { copy: `${interpretation.instruction} #${version}`, files: [file] };
      track();
      opts.duringRevise?.(post);
      return { ok: true, before, after: post.slide3 };
    },
    async restore({ state }) {
      calls.restore += 1;
      events.push('restore');
      if (opts.restoreThrows || opts.restoreThrowsOn?.includes(calls.restore)) throw new Error(opts.restoreError ?? 'disk full');
      restored.push(String(state.copy));
      post.slide3 = state;
      track();
    },
    async unschedule() {
      calls.unschedule += 1;
      events.push('unschedule');
      if (opts.unscheduleThrows) throw new Error('scheduler offline');
      if (opts.unscheduleFailsOn?.includes(calls.unschedule)) return { ok: false, note: 'slot is locked' };
      post.status = 'review';
      return { ok: true, note: 'sent back to review' };
    },
  };
  return { desc, post, files, calls, events, restored };
}

const CAP = { capUsd: 0.2, ceilingUsd: 0.5 };

function interp(fixKind: FixKind = 'wording', instruction = 'shorter'): Interpretation {
  return { vertical: 'carousels', part, fixKind, stageTag: 'copy_write', instruction };
}

async function withEngine(
  fake: ReturnType<typeof fakeType>,
  fn: (ctx: { q: Query; itemId: string; deps: EngineDeps; notes: string[] }) => Promise<void>,
  caps: Parameters<typeof setCapsForTest>[0] = { carousels: { wording: CAP, photo: CAP } },
) {
  const { q, itemId } = await setupRevisionsDb();
  const notes: string[] = [];
  const deps: EngineDeps = { q, notify: async (m) => void notes.push(m), now: () => new Date('2026-10-28T12:00:00Z') };
  clearRegistryForTest();
  setCapsForTest(caps);
  try {
    registerDescription(fake.desc);
    await fn({ q, itemId, deps, notes });
  } finally {
    restoreRegistryForTest();
    resetCapsForTest();
  }
}

/** Queue, claim, store the interpretation (the worker's job), then hand the claimed row to the engine. */
async function submit(q: Query, itemId: string, i: Interpretation = interp()): Promise<RevisionRow> {
  const r = await createRequest(q, { vertical: 'carousels', refs, itemId, by: 'tommy', instruction: i.instruction });
  return claimAndInterpret(q, r.id, i);
}

async function claimAndInterpret(q: Query, id: string, i: Interpretation): Promise<RevisionRow> {
  const claimed = await claimNextRequested(q);
  assert.equal(claimed?.id, id);
  await markRunning(q, id, i, 0, 0);
  return (await rowOf(q, claimed!.itemId, id))!;
}

async function rowOf(q: Query, itemId: string, id: string) {
  return (await listForItem(q, itemId)).find((r) => r.id === id);
}

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('refuses a post that became published after queueing and leaves it untouched', async () => {
  const fake = fakeType({ status: 'published' });
  await withEngine(fake, async ({ q, itemId, deps }) => {
    const row = await submit(q, itemId);
    await runRevision(deps, row);
    const after = await rowOf(q, itemId, row.id);
    assert.equal(after?.status, 'failed');
    assert.match(after!.note!, /published/);
    assert.equal(after?.after, null);
    assert.equal(after?.spendUsd, 0);
    assert.deepEqual(fake.calls, { revise: 0, restore: 0, unschedule: 0 });
    assert.deepEqual(fake.post.slide3, { copy: 'v0', files: ['slide3-v0.png'] });
  });
});

test('a rejected post is refused too', async () => {
  const fake = fakeType({ status: 'rejected' });
  await withEngine(fake, async ({ q, itemId, deps }) => {
    const row = await submit(q, itemId);
    await runRevision(deps, row);
    assert.equal((await rowOf(q, itemId, row.id))?.status, 'failed');
    assert.equal(fake.calls.revise, 0);
  });
});

test('no approved cap refuses with a plain note', async () => {
  const fake = fakeType();
  await withEngine(
    fake,
    async ({ q, itemId, deps }) => {
      const row = await submit(q, itemId);
      await runRevision(deps, row);
      const after = await rowOf(q, itemId, row.id);
      assert.equal(after?.status, 'failed');
      assert.match(after!.note!, /no approved cap for carousels/);
      assert.equal(fake.calls.revise, 0);
    },
    {},
  );
});

test('a fix kind the type does not offer ends failed with no spend', async () => {
  const fake = fakeType();
  await withEngine(fake, async ({ q, itemId, deps }) => {
    const row = await submit(q, itemId, interp('motion'));
    await runRevision(deps, row);
    const after = await rowOf(q, itemId, row.id);
    assert.equal(after?.status, 'failed');
    assert.match(after!.note!, /motion/);
    assert.equal(after?.spendUsd, 0);
    assert.equal(fake.calls.revise, 0);
  }, { carousels: { motion: CAP } });
});

test('reels notes say "text on screen"', async () => {
  const fake = fakeType();
  const reelsDesc = { ...fake.desc, vertical: 'reels' as const };
  await withEngine({ ...fake, desc: reelsDesc }, async ({ q, itemId, deps }) => {
    const r = await createRequest(q, { vertical: 'reels', refs, itemId, by: 'tommy', instruction: 'x' });
    const row = await claimAndInterpret(q, r.id, { ...interp(), vertical: 'reels' });
    await runRevision(deps, row);
    const after = await rowOf(q, itemId, row.id);
    assert.match(after!.note!, /no approved cap for text on screen/);
    assert.doesNotMatch(after!.note!, /reels/);
  }, {});
});

test('estimate above cap pauses; setOverride then run proceeds', async () => {
  const fake = fakeType({ estimate: 0.3, spends: [0.25] });
  await withEngine(fake, async ({ q, itemId, deps }) => {
    const row = await submit(q, itemId);
    await runRevision(deps, row);
    const paused = await rowOf(q, itemId, row.id);
    assert.equal(paused?.status, 'paused_at_cap');
    assert.match(paused!.note!, /0\.30/);
    assert.equal(paused?.spendUsd, 0);
    assert.equal(fake.calls.revise, 0);

    const go = await continueAfterCeiling(deps, row.id, 'tommy', 0.4);
    assert.equal(go.ok, true);
    assert.equal((await rowOf(q, itemId, row.id))?.status, 'requested');
    const again = await claimNextRequested(q);
    assert.equal(again?.id, row.id);
    assert.ok(again?.interpretation, 'interpretation survives the requeue');
    await runRevision(deps, again!);
    const done = await rowOf(q, itemId, row.id);
    assert.equal(done?.status, 'applied');
    assert.equal(done?.overrideUsd, 0.4);
    near(done!.spendUsd, 0.25);
  });
});

test('continueAfterCeiling refuses a row that is not paused', async () => {
  const fake = fakeType();
  await withEngine(fake, async ({ q, itemId, deps }) => {
    const row = await submit(q, itemId);
    await runRevision(deps, row);
    const res = await continueAfterCeiling(deps, row.id, 'tommy', 5);
    assert.equal(res.ok, false);
    const after = await rowOf(q, itemId, row.id);
    assert.equal(after?.status, 'applied');
    assert.equal(after?.overrideUsd, null);
  });
});

test('ceiling hit mid-run records partial spend, status paused_at_ceiling, calls notify, after state not written', async () => {
  const fake = fakeType({ spends: [0.3, 0.3] });
  await withEngine(fake, async ({ q, itemId, deps, notes }) => {
    const row = await submit(q, itemId);
    await runRevision(deps, row);
    const after = await rowOf(q, itemId, row.id);
    assert.equal(after?.status, 'paused_at_ceiling');
    near(after!.spendUsd, 0.6);
    assert.equal(after?.after, null);
    assert.equal(after?.before, null);
    assert.deepEqual(fake.post.slide3, { copy: 'v0', files: ['slide3-v0.png'] });
    assert.equal(notes.length, 1);
    assert.match(notes[0], /ceiling/);
    assert.equal(fake.calls.unschedule, 0);

    // Keep going: spend accumulates across attempts.
    assert.equal((await continueAfterCeiling(deps, row.id, 'tommy', 1)).ok, true);
    const again = await claimNextRequested(q);
    await runRevision(deps, again!);
    const done = await rowOf(q, itemId, row.id);
    assert.equal(done?.status, 'applied');
    near(done!.spendUsd, 1.2);
  });
});

test('spend exactly at the ceiling does not pause', async () => {
  const fake = fakeType({ spends: [0.25, 0.25] });
  await withEngine(fake, async ({ q, itemId, deps, notes }) => {
    const row = await submit(q, itemId);
    await runRevision(deps, row);
    const after = await rowOf(q, itemId, row.id);
    assert.equal(after?.status, 'applied');
    near(after!.spendUsd, 0.5);
    assert.equal(notes.length, 0);
  });
});

test('a description that swallows CeilingReached still ends paused_at_ceiling', async () => {
  const fake = fakeType({ spends: [0.6], result: 'swallow' });
  await withEngine(fake, async ({ q, itemId, deps, notes }) => {
    const row = await submit(q, itemId);
    await runRevision(deps, row);
    assert.equal((await rowOf(q, itemId, row.id))?.status, 'paused_at_ceiling');
    assert.equal(notes.length, 1);
  });
});

test('success on an approved post calls unschedule once and logs applied with before and after', async () => {
  const fake = fakeType({ status: 'approved' });
  await withEngine(fake, async ({ q, itemId, deps }) => {
    const row = await submit(q, itemId);
    await runRevision(deps, row);
    assert.equal(fake.calls.unschedule, 1);
    assert.deepEqual(fake.events, ['unschedule', 'revise'], 'back to review before any content changes');
    assert.equal(fake.post.status, 'review');
    const after = await rowOf(q, itemId, row.id);
    assert.equal(after?.status, 'applied');
    assert.deepEqual(after?.before, { copy: 'v0', files: ['slide3-v0.png'] });
    assert.deepEqual(after?.after, { copy: 'shorter #1', files: ['slide3-v1.png'] });
    near(after!.spendUsd, 0.05);
    assert.equal(after?.capUsd, 0.2);
    assert.equal(after?.ceilingUsd, 0.5);
  });
});

test('success on a post in review does not unschedule', async () => {
  const fake = fakeType();
  await withEngine(fake, async ({ q, itemId, deps }) => {
    await runRevision(deps, await submit(q, itemId));
    assert.equal(fake.calls.unschedule, 0);
  });
});

test('blocked result writes status blocked and the note, original unchanged', async () => {
  const fake = fakeType({ result: 'blocked' });
  await withEngine(fake, async ({ q, itemId, deps }) => {
    const row = await submit(q, itemId);
    await runRevision(deps, row);
    const after = await rowOf(q, itemId, row.id);
    assert.equal(after?.status, 'blocked');
    assert.equal(after?.note, 'Fact-check failed: the number is wrong.');
    near(after!.spendUsd, 0.05);
    assert.deepEqual(fake.post.slide3, { copy: 'v0', files: ['slide3-v0.png'] });
    assert.equal(fake.calls.unschedule, 0);
  });
});

test('undo restores the previous state, marks the row undone, and does not re-approve', async () => {
  const fake = fakeType({ status: 'scheduled' });
  await withEngine(fake, async ({ q, itemId, deps }) => {
    const row = await submit(q, itemId);
    await runRevision(deps, row);
    assert.equal(fake.post.status, 'review');
    const res = await undoRevision(deps, itemId, part, 'ana');
    assert.equal(res.ok, true);
    assert.deepEqual(fake.post.slide3, { copy: 'v0', files: ['slide3-v0.png'] });
    assert.equal(fake.post.status, 'review');
    assert.equal(fake.calls.unschedule, 1, 'a post already in review is not unscheduled again by undo');
    const after = await rowOf(q, itemId, row.id);
    assert.equal(after?.status, 'undone');
    assert.equal(after?.undoneBy, 'ana');
  });
});

test('undo with nothing applied reports ok false and touches nothing', async () => {
  const fake = fakeType();
  await withEngine(fake, async ({ deps, itemId }) => {
    const res = await undoRevision(deps, itemId, part, 'ana');
    assert.equal(res.ok, false);
    assert.equal(fake.calls.restore, 0);
  });
});

test('undo reports ok false and does not restore when the row was undone underneath it', async () => {
  const fake = fakeType();
  await withEngine(fake, async ({ q, itemId, deps }) => {
    const row = await submit(q, itemId);
    await runRevision(deps, row);
    // Another undo lands between the engine's lookup and its own mark.
    const racing: Query = async (text, params) => {
      if (/SET status = 'undone'/.test(text)) {
        await q(`UPDATE revisions.requests SET status = 'undone', undone_by = 'other' WHERE id = $1`, [row.id]);
      }
      return q(text, params);
    };
    const res = await undoRevision({ ...deps, q: racing }, itemId, part, 'ana');
    assert.equal(res.ok, false);
    assert.equal(fake.calls.restore, 0);
    assert.equal((await rowOf(q, itemId, row.id))?.undoneBy, 'other');
  });
});

test('undo is refused on a published post', async () => {
  const fake = fakeType();
  await withEngine(fake, async ({ q, itemId, deps }) => {
    await runRevision(deps, await submit(q, itemId));
    fake.post.status = 'published';
    const res = await undoRevision(deps, itemId, part, 'ana');
    assert.equal(res.ok, false);
    assert.equal(fake.calls.restore, 0);
  });
});

test('undo twice walks back one revision each', async () => {
  const fake = fakeType();
  await withEngine(fake, async ({ q, itemId, deps }) => {
    await runRevision(deps, await submit(q, itemId, interp('wording', 'a')));
    await runRevision(deps, await submit(q, itemId, interp('wording', 'b')));
    assert.equal(fake.post.slide3.copy, 'b #2');
    assert.equal((await undoRevision(deps, itemId, part, 'ana')).ok, true);
    assert.equal(fake.post.slide3.copy, 'a #1');
    assert.equal((await undoRevision(deps, itemId, part, 'ana')).ok, true);
    assert.equal(fake.post.slide3.copy, 'v0');
    assert.equal((await undoRevision(deps, itemId, part, 'ana')).ok, false);
    const rows = await listForItem(q, itemId);
    assert.deepEqual(rows.map((r) => r.status), ['undone', 'undone']);
  });
});

test('restoreOriginal restores originalOf even after three revisions', async () => {
  const fake = fakeType({ status: 'approved' });
  await withEngine(fake, async ({ q, itemId, deps }) => {
    for (const s of ['a', 'b', 'c']) await runRevision(deps, await submit(q, itemId, interp('wording', s)));
    assert.equal(fake.post.slide3.copy, 'c #3');
    const unschedulesBefore = fake.calls.unschedule;
    const res = await restoreOriginal(deps, itemId, part, 'ana');
    assert.equal(res.ok, true);
    assert.deepEqual(fake.post.slide3, { copy: 'v0', files: ['slide3-v0.png'] });
    assert.equal(fake.calls.unschedule, unschedulesBefore);
    assert.equal(fake.post.status, 'review');
    const rows = await listForItem(q, itemId);
    assert.deepEqual(rows.map((r) => r.status), ['undone', 'undone', 'undone']);
    assert.ok(rows.every((r) => r.undoneBy === 'ana'));
    assert.equal((await restoreOriginal(deps, itemId, part, 'ana')).ok, false);
  });
});

test('rendered file paths referenced by a log row are never deleted by a later revise', async () => {
  const fake = fakeType();
  await withEngine(fake, async ({ q, itemId, deps }) => {
    for (const s of ['a', 'b']) await runRevision(deps, await submit(q, itemId, interp('wording', s)));
    await undoRevision(deps, itemId, part, 'ana');
    await runRevision(deps, await submit(q, itemId, interp('wording', 'c')));
    await restoreOriginal(deps, itemId, part, 'ana');
    const referenced = (await listForItem(q, itemId)).flatMap((r) => [...(r.before?.files ?? []), ...(r.after?.files ?? [])]);
    assert.ok(referenced.length >= 6);
    for (const f of referenced) assert.ok(fake.files.has(f), `${f} was deleted`);
  });
});

// ---- Fix round 1: failure paths, unschedule-before-revise, review on undo/restore ----

test('refusals and cap pauses on an approved post never unschedule', async () => {
  for (const [name, fake, i] of [
    ['cap pause', fakeType({ status: 'approved', estimate: 0.3 }), interp()],
    ['fixKind refusal', fakeType({ status: 'approved' }), interp('motion')],
  ] as const) {
    await withEngine(fake, async ({ q, itemId, deps }) => {
      const row = await submit(q, itemId, i);
      await runRevision(deps, row);
      assert.equal(fake.calls.unschedule, 0, name);
      assert.equal(fake.calls.revise, 0, name);
      assert.equal(fake.post.status, 'approved', name);
    }, { carousels: { wording: CAP, motion: CAP } });
  }
});

test('a pre-revise unschedule that fails ends failed without revising', async () => {
  const fake = fakeType({ status: 'scheduled', unscheduleFailsOn: [1] });
  await withEngine(fake, async ({ q, itemId, deps }) => {
    const row = await submit(q, itemId);
    await runRevision(deps, row);
    const after = await rowOf(q, itemId, row.id);
    assert.equal(after?.status, 'failed');
    assert.match(after!.note!, /could not be sent back to review/);
    assert.equal(fake.calls.revise, 0);
    assert.equal(fake.post.status, 'scheduled');
  });
});

test('a pre-revise unschedule that throws ends failed without revising', async () => {
  const fake = fakeType({ status: 'approved', unscheduleThrows: true });
  await withEngine(fake, async ({ q, itemId, deps }) => {
    const row = await submit(q, itemId);
    await runRevision(deps, row);
    assert.equal((await rowOf(q, itemId, row.id))?.status, 'failed');
    assert.equal(fake.calls.revise, 0);
  });
});

test('blocked on an approved post leaves it in review and the note says so', async () => {
  const fake = fakeType({ status: 'approved', result: 'blocked' });
  await withEngine(fake, async ({ q, itemId, deps }) => {
    const row = await submit(q, itemId);
    await runRevision(deps, row);
    const after = await rowOf(q, itemId, row.id);
    assert.equal(after?.status, 'blocked');
    assert.match(after!.note!, /Fact-check failed/);
    assert.match(after!.note!, /review/);
    assert.equal(fake.post.status, 'review');
    assert.deepEqual(fake.post.slide3, { copy: 'v0', files: ['slide3-v0.png'] });
  });
});

test('a generic throw from revise ends failed with the spend recorded, never running', async () => {
  const fake = fakeType({ result: 'throw', spends: [0.07] });
  await withEngine(fake, async ({ q, itemId, deps }) => {
    const row = await submit(q, itemId);
    await runRevision(deps, row);
    const after = await rowOf(q, itemId, row.id);
    assert.equal(after?.status, 'failed');
    assert.match(after!.note!, /renderer crashed/);
    near(after!.spendUsd, 0.07);
  });
});

test('a throw from load ends the row failed instead of leaving it running', async () => {
  const fake = fakeType({ loadThrows: true });
  await withEngine(fake, async ({ q, itemId, deps }) => {
    const row = await submit(q, itemId);
    await runRevision(deps, row);
    const after = await rowOf(q, itemId, row.id);
    assert.equal(after?.status, 'failed');
    assert.match(after!.note!, /db down/);
  });
});

test('post approved mid-run is sent back to review before the revision is logged', async () => {
  const fake = fakeType({ duringRevise: (p) => void (p.status = 'approved') });
  await withEngine(fake, async ({ q, itemId, deps }) => {
    const row = await submit(q, itemId);
    await runRevision(deps, row);
    assert.deepEqual(fake.events, ['revise', 'unschedule']);
    assert.equal(fake.post.status, 'review');
    assert.equal((await rowOf(q, itemId, row.id))?.status, 'applied');
  });
});

test('post published mid-run restores before and ends failed, never applied', async () => {
  const fake = fakeType({ duringRevise: (p) => void (p.status = 'published') });
  await withEngine(fake, async ({ q, itemId, deps }) => {
    const row = await submit(q, itemId);
    await runRevision(deps, row);
    const after = await rowOf(q, itemId, row.id);
    assert.equal(after?.status, 'failed');
    assert.match(after!.note!, /published/);
    assert.equal(after?.after, null);
    assert.deepEqual(fake.post.slide3, { copy: 'v0', files: ['slide3-v0.png'] });
    assert.equal(fake.calls.unschedule, 0);
  });
});

test('approved mid-run and unschedule failing: content restored, row failed', async () => {
  const fake = fakeType({ duringRevise: (p) => void (p.status = 'approved'), unscheduleFailsOn: [1] });
  await withEngine(fake, async ({ q, itemId, deps, notes }) => {
    const row = await submit(q, itemId);
    await runRevision(deps, row);
    const after = await rowOf(q, itemId, row.id);
    assert.equal(after?.status, 'failed');
    assert.match(after!.note!, /original was restored/);
    assert.deepEqual(fake.post.slide3, { copy: 'v0', files: ['slide3-v0.png'] });
    assert.equal(notes.length, 0);
  });
});

test('unschedule failing AND the rollback restore throwing: failed, loud note, notify', async () => {
  const fake = fakeType({ duringRevise: (p) => void (p.status = 'approved'), unscheduleFailsOn: [1], restoreThrows: true });
  await withEngine(fake, async ({ q, itemId, deps, notes }) => {
    const row = await submit(q, itemId);
    await runRevision(deps, row);
    const after = await rowOf(q, itemId, row.id);
    assert.equal(after?.status, 'failed');
    assert.match(after!.note!, /could not roll back/);
    assert.match(after!.note!, /may still carry the revised content/);
    assert.equal(notes.length, 1);
    assert.match(notes[0], /could not roll back/);
  });
});

test('markApplied returning false rolls the content back and leaves the row status alone', async () => {
  const fake = fakeType();
  await withEngine(fake, async ({ q, itemId, deps }) => {
    const row = await submit(q, itemId);
    const racing: Query = async (text, params) => {
      if (/SET status = 'applied'/.test(text)) {
        await q(`UPDATE revisions.requests SET status = 'failed', note = 'cancelled elsewhere' WHERE id = $1`, [row.id]);
      }
      return q(text, params);
    };
    await runRevision({ ...deps, q: racing }, row);
    const after = await rowOf(q, itemId, row.id);
    assert.equal(after?.status, 'failed');
    assert.equal(after?.note, 'cancelled elsewhere');
    assert.deepEqual(fake.post.slide3, { copy: 'v0', files: ['slide3-v0.png'] });
  });
});

test('undo on an approved post unschedules once then restores, and the post ends in review', async () => {
  const fake = fakeType();
  await withEngine(fake, async ({ q, itemId, deps }) => {
    await runRevision(deps, await submit(q, itemId));
    fake.post.status = 'approved';
    fake.events.length = 0;
    const res = await undoRevision(deps, itemId, part, 'ana');
    assert.equal(res.ok, true);
    assert.deepEqual(fake.events, ['unschedule', 'restore']);
    assert.equal(fake.post.status, 'review');
    assert.deepEqual(fake.post.slide3, { copy: 'v0', files: ['slide3-v0.png'] });
  });
});

test('undo where unschedule fails changes nothing and releases the claim', async () => {
  const fake = fakeType({ unscheduleFailsOn: [1] });
  await withEngine(fake, async ({ q, itemId, deps }) => {
    const row = await submit(q, itemId);
    await runRevision(deps, row);
    fake.post.status = 'scheduled';
    const res = await undoRevision(deps, itemId, part, 'ana');
    assert.equal(res.ok, false);
    assert.equal(fake.calls.restore, 0);
    assert.equal((await rowOf(q, itemId, row.id))?.status, 'applied');
  });
});

test('restore throwing during undo rolls the claim back', async () => {
  const fake = fakeType({ restoreThrows: true });
  await withEngine(fake, async ({ q, itemId, deps }) => {
    const row = await submit(q, itemId);
    await runRevision(deps, row);
    const res = await undoRevision(deps, itemId, part, 'ana');
    assert.equal(res.ok, false);
    assert.match(res.note, /disk full/);
    const after = await rowOf(q, itemId, row.id);
    assert.equal(after?.status, 'applied');
    assert.equal(after?.undoneBy, null);
  });
});

test('restoreOriginal on a scheduled post unschedules then restores; refused when published', async () => {
  const fake = fakeType();
  await withEngine(fake, async ({ q, itemId, deps }) => {
    for (const s of ['a', 'b']) await runRevision(deps, await submit(q, itemId, interp('wording', s)));
    fake.post.status = 'published';
    assert.equal((await restoreOriginal(deps, itemId, part, 'ana')).ok, false);
    assert.equal(fake.calls.restore, 0);
    fake.post.status = 'scheduled';
    fake.events.length = 0;
    assert.equal((await restoreOriginal(deps, itemId, part, 'ana')).ok, true);
    // Final wave: restore walks the chain newest first (one restore per revision), unscheduling once.
    assert.deepEqual(fake.events, ['unschedule', 'restore', 'restore']);
    assert.equal(fake.post.status, 'review');
    assert.equal(fake.post.slide3.copy, 'v0');
  });
});

test('restore throwing during restoreOriginal releases every claim', async () => {
  const fake = fakeType({ restoreThrows: true });
  await withEngine(fake, async ({ q, itemId, deps }) => {
    for (const s of ['a', 'b']) await runRevision(deps, await submit(q, itemId, interp('wording', s)));
    assert.equal((await restoreOriginal(deps, itemId, part, 'ana')).ok, false);
    assert.deepEqual((await listForItem(q, itemId)).map((r) => r.status), ['applied', 'applied']);
  });
});

/* ── Final wave: Restore original walks the chain newest -> oldest ── */

test('restoreOriginal restores each applied revision\'s before, newest first, and ends at the first row\'s before', async () => {
  const fake = fakeType();
  await withEngine(fake, async ({ q, itemId, deps }) => {
    for (const s of ['a', 'b', 'c']) await runRevision(deps, await submit(q, itemId, interp('wording', s)));
    const res = await restoreOriginal(deps, itemId, part, 'ana');
    assert.equal(res.ok, true, res.note);
    assert.equal(res.note, 'Restored the original slide 3.');
    assert.deepEqual(fake.restored, ['b #2', 'a #1', 'v0']);
    assert.deepEqual(fake.post.slide3, { copy: 'v0', files: ['slide3-v0.png'] }, 'same end state as before: the first row\'s before');
    assert.equal(fake.calls.unschedule, 0, 'a post in review is never unscheduled');
  });
});

test('restoreOriginal on an approved post unschedules once, ends in review, and never re-approves', async () => {
  const fake = fakeType({ status: 'approved' });
  await withEngine(fake, async ({ q, itemId, deps }) => {
    for (const s of ['a', 'b']) await runRevision(deps, await submit(q, itemId, interp('wording', s)));
    fake.post.status = 'approved';
    fake.events.length = 0;
    const res = await restoreOriginal(deps, itemId, part, 'ana');
    assert.equal(res.ok, true, res.note);
    assert.deepEqual(fake.events, ['unschedule', 'restore', 'restore']);
    assert.equal(fake.post.status, 'review');
    assert.equal(fake.post.slide3.copy, 'v0');
  });
});

test('a failure on step 2 undoes only the newest row, keeps the older one, says where it stopped, and a re-run continues', async () => {
  const fake = fakeType({ status: 'approved', restoreThrowsOn: [2] });
  await withEngine(fake, async ({ q, itemId, deps }) => {
    for (const s of ['a', 'b']) await runRevision(deps, await submit(q, itemId, interp('wording', s)));
    fake.post.status = 'approved';
    const [older, newer] = await listForItem(q, itemId);
    const res = await restoreOriginal(deps, itemId, part, 'ana');
    assert.equal(res.ok, false);
    assert.equal(
      res.note,
      'Undid 1 of 2 revisions of slide 3, then stopped: disk full. The older ones are still in place; Restore original again picks up from there. The post was sent back to review and stays there.',
    );
    assert.equal(fake.post.slide3.copy, 'a #1', 'the newest revision is undone');
    assert.equal(fake.post.status, 'review', 'not re-approved');
    assert.equal((await rowOf(q, itemId, newer!.id))?.status, 'undone');
    assert.equal((await rowOf(q, itemId, older!.id))?.status, 'applied', 'the claim on the row not undone is released');
    assert.equal((await rowOf(q, itemId, older!.id))?.undoneBy, null);

    const again = await restoreOriginal(deps, itemId, part, 'ana');
    assert.equal(again.ok, true, again.note);
    assert.equal(fake.post.slide3.copy, 'v0');
    assert.deepEqual((await listForItem(q, itemId)).map((r) => r.status), ['undone', 'undone']);
    assert.equal(fake.calls.unschedule, 2, 'one for the first revise, one for the restore; the re-run finds the post in review');
  });
});

test('a partial restore stopped by another part\'s later fix says to undo that fix first, not to just try again', async () => {
  const fake = fakeType({ restoreThrowsOn: [2], restoreError: 'A later fix to this carousels post changed it after this one; undo that fix first.' });
  await withEngine(fake, async ({ q, itemId, deps }) => {
    for (const s of ['a', 'b']) await runRevision(deps, await submit(q, itemId, interp('wording', s)));
    const res = await restoreOriginal(deps, itemId, part, 'ana');
    assert.equal(res.ok, false);
    assert.equal(
      res.note,
      'Undid 1 of 2 revisions of slide 3, then stopped: A later fix to this carousels post changed it after this one; undo that fix first. The older ones are still in place. Undo the fix it names first, then use Restore original again.',
    );
    assert.doesNotMatch(res.note, /picks up from there/);
  });
});
