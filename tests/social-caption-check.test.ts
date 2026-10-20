/**
 * Social captions final fixes (2026-10-19), item 6: the dev scripts run the
 * same captioner → Fact-checker → mechanical join as a live run. Offline:
 * stub stages only, no model, no network.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { briefSuperIntelligenceForce } from '@/fixtures/social/briefs';
import { sifDraftHandoff } from '@/fixtures/social/drafts';
import { memoryClosings } from '@/lib/social/captions/closings-store';
import { captionAndCheck, type CaptionCheckStages } from '@/lib/social/pipeline/caption-check';
import { createMechanicalStage, joinAndFix } from '@/lib/social/pipeline/mechanical-stage';
import { MAX_FRESH_CAPTIONS } from '@/lib/social/pipeline/orchestrator';
import type { Brief, Draft, StageResult } from '@/lib/social/pipeline/types';
import { checkDraft, fillDraft } from '@/lib/social/writer/draft';

const parsed = briefSuperIntelligenceForce();
const brief: Brief = { storyId: 'sif', parsed, raw: '', pages: [] };
const NEWS = { text: 'Trump announced a Super Intelligence Force on Sunday.\n\nWhat would you want its report to settle first?', facts: ['F1'] };
const READ = { text: 'For a law firm, the rules may loosen first. Helios builds systems you own.', facts: [] as string[] };

function edited(): Draft {
  const submission = checkDraft(sifDraftHandoff(), parsed);
  return { storyId: 'sif', submission, filled: fillDraft(submission, parsed) };
}

function captioned(d: Draft): Draft {
  const submission = { ...d.submission, caption: NEWS, caption_read: READ };
  return { ...d, submission, filled: fillDraft(submission, parsed) };
}

function stubStages(factChecks: Array<StageResult<Draft> | 'pass'>): { stages: CaptionCheckStages; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    stages: {
      caption: async (d) => (calls.push('captioner'), { ok: true, value: captioned(d), costUsd: 0.01 }),
      factCheck: async (d) => {
        calls.push('fact-checker');
        const next = factChecks.shift() ?? 'pass';
        return next === 'pass' ? { ok: true, value: d, costUsd: 0.02 } : next;
      },
      mechanical: createMechanicalStage(),
    },
  };
}

test('joinAndFix is the mechanical stage\'s join: news, read, then the code-built Source line', async () => {
  const d = captioned(edited());
  const { draft } = joinAndFix(d.filled, parsed);
  assert.equal(draft.caption_read, undefined, 'the read is folded in');
  assert.ok(draft.caption.text.startsWith(`${NEWS.text}\n\n${READ.text}\n\nSource: `), draft.caption.text);
  const stage = await createMechanicalStage()(d, brief);
  assert.ok(stage.ok);
  assert.deepEqual(stage.value.filled, draft);
  // Idempotent on a caption that already went through it (a script re-rendering a stored final).
  assert.equal(joinAndFix(draft, parsed).draft.caption.text, draft.caption.text);
});

test('captionAndCheck: captioner → Fact-checker → mechanical, and the final caption is joined', async () => {
  const { stages, calls } = stubStages(['pass']);
  const r = await captionAndCheck(stages, edited(), brief);
  assert.equal(r.kind, 'ok');
  assert.deepEqual(calls, ['captioner', 'fact-checker']);
  if (r.kind !== 'ok') return;
  assert.ok(r.final.filled.caption.text.includes(`${NEWS.text}\n\n${READ.text}\n\nSource: `));
  assert.ok(Math.abs(r.costUsd - 0.03) < 1e-9);
});

test('captionAndCheck: a fresh caption reruns only captioner → Fact-checker, MAX_FRESH_CAPTIONS times, then asks for a fresh draft', async () => {
  const fresh: StageResult<Draft> = { ok: false, reasonCode: 'needs-fresh-caption', detail: 'read cut', costUsd: 0.02 };
  const once = stubStages([fresh, 'pass']);
  const ok = await captionAndCheck(once.stages, edited(), brief);
  assert.equal(ok.kind, 'ok');
  assert.deepEqual(once.calls, ['captioner', 'fact-checker', 'captioner', 'fact-checker']);
  if (ok.kind === 'ok') assert.equal(ok.freshCaptions, 1);

  const always = stubStages(Array.from({ length: MAX_FRESH_CAPTIONS + 1 }, () => fresh));
  const out = await captionAndCheck(always.stages, edited(), brief);
  assert.equal(out.kind, 'fresh-draft');
  assert.equal(always.calls.filter((c) => c === 'captioner').length, MAX_FRESH_CAPTIONS + 1);
});

test('captionAndCheck: a fresh draft or a failure stops with the stage and reason', async () => {
  const draftNeeded = await captionAndCheck(stubStages([{ ok: false, reasonCode: 'needs-fresh-draft', detail: 'key slide cut', costUsd: 0 }]).stages, edited(), brief);
  assert.deepEqual(draftNeeded.kind === 'fresh-draft' && draftNeeded.why, 'key slide cut');
  const aside = await captionAndCheck(stubStages([{ ok: false, reasonCode: 'main-claim-false', detail: 'false', costUsd: 0 }]).stages, edited(), brief);
  assert.equal(aside.kind, 'stopped');
  if (aside.kind === 'stopped') assert.deepEqual([aside.stage, aside.reasonCode], ['fact-checker', 'main-claim-false']);
});

test('memoryClosings: newest first, capped to the window, never touches the shared log', async () => {
  const log = memoryClosings(2);
  assert.deepEqual(await log.recent(), []);
  await log.record('a', 'one', false);
  await log.record('b', 'two', true);
  await log.record('c', 'three', false);
  assert.deepEqual((await log.recent()).map((r) => [r.closing, r.buildLine]), [['three', false], ['two', true]]);
});
