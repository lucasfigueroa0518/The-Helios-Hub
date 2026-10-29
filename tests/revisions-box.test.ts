/**
 * Targeted Revisions task 12: the revision box's view-model (revisionBoxState), pure and offline.
 * Every state the post view shows comes from the item's revision rows (newest first).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { lockReason, partLabel, plainNote, revisionBoxState, suggestOverrideUsd, toBoxRow, type BoxRow } from '@/lib/revisions/box-state';
import type { RevisionRow } from '@/lib/revisions/types';

const NOW = new Date('2026-10-29T15:00:00Z');
let seq = 0;

function row(over: Partial<BoxRow> = {}): BoxRow {
  seq += 1;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  return {
    id,
    status: 'requested',
    instruction: 'Make the headline shorter',
    question: null,
    note: null,
    part: null,
    fixKind: null,
    stageTag: null,
    spendUsd: 0,
    capUsd: null,
    ceilingUsd: null,
    overrideUsd: null,
    createdAt: new Date(NOW.getTime() - (100 - seq) * 1000).toISOString(),
    startedAt: null,
    finishedAt: null,
    parentId: null,
    undoneAt: null,
    ...over,
  };
}

const slide3 = { kind: 'slide', key: '3' };
const slide5 = { kind: 'slide', key: '5' };
const box = (rows: BoxRow[], lock: string | null = null) => revisionBoxState(rows, { vertical: 'carousels', lock, now: NOW });

test('no rows: an empty box ready for a first request', () => {
  const s = box([]);
  assert.equal(s.current, null);
  assert.equal(s.canSubmit, true);
  assert.equal(s.polling, false);
  assert.deepEqual(s.parts, []);
});

test('requested shows revising, with an elapsed hint, and polls', () => {
  const r = row({ status: 'requested', createdAt: new Date(NOW.getTime() - 3 * 60_000).toISOString() });
  const s = box([r]);
  assert.equal(s.current?.kind, 'revising');
  assert.equal(s.polling, true);
  assert.equal(s.canSubmit, false, 'one request at a time');
  assert.match(s.current!.kind === 'revising' ? s.current.hint : '', /3 minutes/);
  assert.match(s.announce, /Revising/);
});

test('running shows revising too', () => {
  const s = box([row({ status: 'running', startedAt: new Date(NOW.getTime() - 20_000).toISOString() })]);
  assert.equal(s.current?.kind, 'revising');
  assert.equal(s.polling, true);
  assert.match(s.current!.kind === 'revising' ? s.current.hint : '', /less than a minute/);
});

test('asking shows the question and a reply input, and stops polling', () => {
  const r = row({ status: 'asking', question: 'Which slide do you mean, 3 or 5?' });
  const s = box([r]);
  assert.equal(s.current?.kind, 'asking');
  assert.equal(s.current!.kind === 'asking' && s.current.question, 'Which slide do you mean, 3 or 5?');
  assert.equal(s.current!.kind === 'asking' && s.current.replyTo, r.id);
  assert.equal(s.polling, false);
});

test('an answered question is not asked again: the reply row is current', () => {
  const ask = row({ status: 'asking', question: 'Which slide?' });
  const reply = row({ status: 'running', parentId: ask.id, instruction: 'Slide 3' });
  const s = box([reply, ask]);
  assert.equal(s.current?.kind, 'revising');
  assert.equal(s.current!.id, reply.id);
});

test('blocked and failed show the plain note and the box is ready for another try', () => {
  for (const status of ['blocked', 'failed'] as const) {
    const s = box([row({ status, part: slide3, note: 'The new headline did not match the article, so it was not changed. Try saying it another way.' })]);
    assert.equal(s.current?.kind, status);
    assert.match(s.current!.kind === status ? s.current.note : '', /did not match the article/);
    assert.equal(s.canSubmit, true);
    assert.equal(s.polling, false);
  }
});

test('a raw error in a failed note is never shown', () => {
  const s = box([row({ status: 'failed', note: 'The revision stopped on an unexpected error: TypeError: Cannot read properties of undefined (reading \'x\'). The original was kept.' })]);
  const note = s.current?.kind === 'failed' ? s.current.note : '';
  assert.doesNotMatch(note, /TypeError|undefined|reading/);
  assert.match(note, /original was kept/i);
  assert.equal(plainNote('failed', null).length > 0, true);
  // A loud could-not-roll-back note keeps its warning, in plain words.
  const loud = plainNote('failed', 'The fix failed. The engine could not roll back (ECONNRESET); the post may still carry the revised content.');
  assert.doesNotMatch(loud, /ECONNRESET|engine/);
  assert.match(loud, /may still show the revised version/);
});

test('paused_at_cap shows the note, the override control and suggests the estimate', () => {
  const note = 'This photo fix is estimated at $0.80, above the $0.50 cap for carousels. Allow a higher amount to run it.';
  const s = box([row({ status: 'paused_at_cap', part: slide3, note, capUsd: 0.5, ceilingUsd: 1.5 })]);
  assert.equal(s.current?.kind, 'paused');
  assert.ok(s.current!.kind === 'paused');
  if (s.current!.kind !== 'paused') return;
  assert.equal(s.current.at, 'cap');
  assert.equal(s.current.note, note);
  assert.equal(s.current.suggestUsd, 0.8);
  assert.equal(s.current.needsAmount, false);
  assert.equal(s.current.notified, false);
  assert.equal(s.polling, false);
});

test('paused_at_cap without a readable estimate suggests the cap', () => {
  assert.equal(suggestOverrideUsd(row({ status: 'paused_at_cap', note: 'Over the cap.', capUsd: 0.5 })), 0.5);
  assert.equal(suggestOverrideUsd(row({ status: 'paused_at_cap', note: null, capUsd: null })), null);
});

test('paused_at_ceiling shows the override button, the amount to enter and the notification line', () => {
  const note = 'Paused at the $1.50 ceiling for carousels after spending $1.52. Nothing was changed; you can keep going.';
  const s = box([row({ status: 'paused_at_ceiling', part: slide3, note, capUsd: 0.5, ceilingUsd: 1.5, spendUsd: 1.52 })]);
  assert.ok(s.current?.kind === 'paused');
  if (s.current?.kind !== 'paused') return;
  assert.equal(s.current.at, 'ceiling');
  assert.equal(s.current.needsAmount, true, 'keep going needs the person to enter an amount');
  assert.equal(s.current.notified, true);
  assert.equal(s.current.note, note);
  assert.equal(s.current.revisionId, s.current.id);
});

test('published disables the box with a one-line reason', () => {
  const lock = lockReason({ status: 'published' });
  assert.equal(lock, 'Published posts can’t be revised.');
  const s = box([row({ status: 'requested' })], lock);
  assert.equal(s.lock, lock);
  assert.equal(s.canSubmit, false);
  assert.equal(s.polling, false);
  assert.deepEqual(s.parts, [], 'no undo on a published post');
  assert.equal(lockReason({ status: 'publishing' }), 'Published posts can’t be revised.');
  assert.equal(lockReason({ status: 'ready', stateId: 'rejected' }), 'Rejected posts can’t be revised.');
  assert.equal(lockReason({ status: 'ready', stateId: 'review' }), null);
});

test('applied shows Done with the fix summary and Undo', () => {
  const r = row({ status: 'applied', part: slide3, fixKind: 'wording', instruction: 'Shorter headline', finishedAt: NOW.toISOString() });
  const s = box([r]);
  assert.ok(s.current?.kind === 'applied');
  if (s.current?.kind !== 'applied') return;
  assert.match(s.current.summary, /Shorter headline/);
  assert.match(s.current.summary, /slide 3/i);
  assert.equal(s.parts.length, 1);
  assert.deepEqual(s.parts[0]!.part, slide3);
  assert.equal(s.parts[0]!.canUndo, true);
  assert.equal(s.parts[0]!.canRestore, false, 'one revision: Undo already goes back to the original');
  assert.equal(s.canSubmit, true);
});

test('two applied revisions on one part show both Undo and Restore original', () => {
  const a = row({ status: 'applied', part: slide3, instruction: 'Shorter' });
  const b = row({ status: 'applied', part: slide3, instruction: 'Even shorter' });
  const s = box([b, a]);
  assert.equal(s.parts.length, 1);
  assert.equal(s.parts[0]!.canUndo, true);
  assert.equal(s.parts[0]!.canRestore, true);
  assert.equal(s.parts[0]!.latest.instruction, 'Even shorter');
  assert.equal(s.parts[0]!.applied, 2);
});

test('after an undo the part still offers Undo while a revision remains, and nothing once none does', () => {
  const a = row({ status: 'applied', part: slide3, instruction: 'Shorter' });
  const b = row({ status: 'undone', part: slide3, instruction: 'Even shorter', undoneAt: NOW.toISOString() });
  const one = box([b, a]);
  assert.equal(one.parts.length, 1);
  assert.equal(one.parts[0]!.canUndo, true);
  assert.equal(one.parts[0]!.latest.instruction, 'Shorter');
  assert.equal(one.current, null, 'an undone row is not a result to show');
  const none = box([row({ status: 'undone', part: slide3, undoneAt: NOW.toISOString() })]);
  assert.deepEqual(none.parts, []);
});

test('rows from a different part do not mix', () => {
  const a = row({ status: 'applied', part: slide3, instruction: 'Shorter' });
  const b = row({ status: 'applied', part: slide5, instruction: 'Brighter photo' });
  const c = row({ status: 'applied', part: slide5, instruction: 'Different photo' });
  const s = box([c, b, a]);
  assert.equal(s.parts.length, 2);
  const p3 = s.parts.find((p) => p.part.key === '3')!;
  const p5 = s.parts.find((p) => p.part.key === '5')!;
  assert.equal(p3.applied, 1);
  assert.equal(p3.canRestore, false);
  assert.equal(p3.latest.instruction, 'Shorter');
  assert.equal(p5.applied, 2);
  assert.equal(p5.canRestore, true);
  assert.equal(p5.latest.instruction, 'Different photo');
  assert.ok(s.current?.kind === 'applied' && /slide 5/i.test(s.current.summary));
});

test('reels parts and labels say "text on screen", never "reels"', () => {
  const s = revisionBoxState([], { vertical: 'reels', lock: null, now: NOW });
  assert.match(s.prompt, /text on screen/);
  assert.doesNotMatch(s.prompt, /reel/i);
  assert.equal(partLabel({ kind: 'stage', key: 'copy' }), 'the words');
  assert.equal(partLabel({ kind: 'stage', key: 'video' }), 'the video');
  assert.equal(partLabel({ kind: 'frame', key: '2' }), 'frame 2');
});

test('toBoxRow keeps only the fields the box needs', () => {
  const full: RevisionRow = {
    id: 'r1', vertical: 'carousels', itemId: 'item-secret', refs: { postId: 'p' }, requestedBy: 'tommy@helios.test',
    instruction: 'Shorter', parentId: null, status: 'applied', question: null,
    interpretation: { vertical: 'carousels', part: slide3, fixKind: 'wording', stageTag: 'copy_write', instruction: 'Shorter' },
    stageTag: 'copy_write', fixKind: 'wording', part: slide3, capUsd: 0.5, ceilingUsd: 1.5, overrideUsd: null, spendUsd: 0.01,
    before: { copy: 'old', files: ['a.png'] }, after: { copy: 'new', files: ['b.png'] }, note: null,
    createdAt: NOW.toISOString(), startedAt: NOW.toISOString(), finishedAt: NOW.toISOString(), undoneAt: null, undoneBy: null,
  };
  const out = toBoxRow(full);
  assert.deepEqual(Object.keys(out).sort(), [
    'capUsd', 'ceilingUsd', 'createdAt', 'finishedAt', 'fixKind', 'id', 'instruction', 'note', 'overrideUsd', 'parentId', 'part',
    'question', 'spendUsd', 'stageTag', 'startedAt', 'status', 'undoneAt',
  ]);
  assert.equal(JSON.stringify(out).includes('item-secret'), false);
  assert.equal(JSON.stringify(out).includes('tommy@'), false);
});

test('the box sends the one ref each type\'s revise verb reads', async () => {
  const { readFileSync } = await import('node:fs');
  const { REVISION_REF_KEY, revisionRefs } = await import('@/lib/revisions/box-state');
  const FILES: Record<string, string> = { carousels: 'carousels', reels: 'reels', explainers: 'explainers', stories: 'stories', last_few_days: 'last-few-days', ai_events: 'ai-events' };
  for (const [vertical, key] of Object.entries(REVISION_REF_KEY)) {
    const src = readFileSync(`lib/publishing/actions/${FILES[vertical]}.ts`, 'utf8');
    const verbs = src.slice(src.indexOf('reviseVerbs('));
    assert.match(verbs, new RegExp(`need\\(t, '${key}'\\)`), `${vertical} revise verbs read ${key}`);
  }
  assert.deepEqual(revisionRefs('reels', { postIdeaId: 'a', videoJobId: 'b' }), { videoJobId: 'b' });
  assert.equal(revisionRefs('stories', {}), null);
});
