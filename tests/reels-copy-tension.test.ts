/**
 * Offline tests for copy-caption-v18 (D-250 to D-252): every on-screen copy is
 * a complete thought with tension, The Number and Ball Knowledge run to 22
 * words, and close nearest misses are picked on loop, care, and reward.
 * No model calls.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCopyTaskBlock, copyStrategySystem } from '@/lib/reels/copy/assemble';
import { bestLineScores, isWideMiss } from '@/lib/reels/copy/held-out';
import { NEAREST_MISS_PLAIN_TIE, polishLines, rankCopyLines, type CopyLineJudgment } from '@/lib/reels/copy/pick';
import { ON_SCREEN_WORD_RANGE, REPORT_COPY_TOOL, parseCopyReport } from '@/lib/reels/copy/report';
import { COPY_PROMPT_VERSION, COPY_SKILL, FRAMEWORK_WRITING_LOGIC } from '@/lib/reels/copy/skill';
import { BUCKET_SPEC_TEXT } from '@/lib/reels/copy/source-text.generated';

test('the copy is defined as a complete thought with tension, as a hard constraint', () => {
  assert.equal(COPY_PROMPT_VERSION, 'copy-caption-v27');
  assert.match(COPY_SKILL, /HARD CONSTRAINT\. The whole on-screen copy is the hook, and it is a complete thought with tension, never a fact that stops\./);
  assert.match(COPY_SKILL, /a reversal, a contradiction, an escalation, an absurd detail, or a stake out of proportion to its cause/);
  assert.match(COPY_SKILL, /These are kinds to choose from, never a template/);
  assert.match(COPY_SKILL, /is a failed report, the same as a word count outside the range/);
  // D-268 replaces "never trade either way" with an order: the first beat holds, the tension rides the second.
  assert.match(COPY_SKILL, /A stake only lands on a viewer who already understands what happened\./);
  assert.doesNotMatch(COPY_SKILL, /it has two jobs, in this order/);
  assert.doesNotMatch(COPY_SKILL, /with a turn|the turn:|a turn\b/i, 'the rule is named tension, not turn');
});

test('the writer names the tension before drafting and checks every copy against it', () => {
  assert.match(COPY_SKILL, /3\. Where is the tension\? Point to the words that carry it\./);
  assert.match(COPY_SKILL, /Then name the tension the sources hold and report it in the tension field\. If the sources hold none, say so there\. Never invent one\./);
  assert.match(COPY_SKILL, /carries the stake and the tension\. Keep four that all pass every hook question/);
  assert.match(COPY_SKILL, /in The Saga, hook question 5/);
});

test('the framework logic agrees: no bare fact, the tension stays on screen', () => {
  assert.doesNotMatch(FRAMEWORK_WRITING_LOGIC.arousal.onScreen, /Lead with the fact/);
  assert.match(FRAMEWORK_WRITING_LOGIC.arousal.onScreen, /give it its tension/);
  assert.match(FRAMEWORK_WRITING_LOGIC.curiosity.onScreen, /The tension is on screen\. The gap opens after it and never takes its place\./);
  assert.match(FRAMEWORK_WRITING_LOGIC.identity.onScreen, /what changes for that group\. Announcing that something exists is not a stance\./);
});

test('the bucket rules agree, and The Number, Ball Knowledge, and The Callout run to 26 words (D-267)', () => {
  assert.doesNotMatch(BUCKET_SPEC_TEXT.the_number.body, /The stat is the payload/);
  assert.match(BUCKET_SPEC_TEXT.the_number.body, /the whole thought, with its tension, lands on screen/);
  assert.match(BUCKET_SPEC_TEXT.the_number.body, /Up to 26 words/);
  assert.match(BUCKET_SPEC_TEXT.ball_knowledge.body, /why the get is worth stopping for/);
  assert.match(BUCKET_SPEC_TEXT.ball_knowledge.body, /8–26 words/);
  assert.match(BUCKET_SPEC_TEXT.the_saga.body, /with the tension carried to the last word/);
  assert.deepEqual(ON_SCREEN_WORD_RANGE.the_number, { min: 1, max: 26 });
  assert.deepEqual(ON_SCREEN_WORD_RANGE.ball_knowledge, { min: 8, max: 26 });
  assert.deepEqual(ON_SCREEN_WORD_RANGE.the_callout, { min: 12, max: 26 });
  assert.match(BUCKET_SPEC_TEXT.the_callout.body, /12–26 words/);
  // D-269: The Saga is two beats from 14 words, and its chronology is the caption's.
  assert.deepEqual(ON_SCREEN_WORD_RANGE.the_saga, { min: 14, max: 32 });
  assert.match(BUCKET_SPEC_TEXT.the_saga.body, /Two beats on one screen\./);
  assert.match(BUCKET_SPEC_TEXT.the_saga.body, /The chronology belongs to the caption\./);
  assert.match(FRAMEWORK_WRITING_LOGIC.arousal.onScreen, /except in The Saga and Personal Profile: there the people in the story stay the subject/);
  assert.match(copyStrategySystem('the_number', 'curiosity'), /1 to 26 words/);
  assert.match(copyStrategySystem('ball_knowledge', 'identity'), /8 to 26 words/);
});

test('the tension field is required, written before the copies, and stored', () => {
  const properties = Object.keys(REPORT_COPY_TOOL.input_schema.properties);
  assert.ok(REPORT_COPY_TOOL.input_schema.required.includes('tension'));
  assert.ok(properties.indexOf('viewer_stake') < properties.indexOf('tension'));
  assert.ok(properties.indexOf('tension') < properties.indexOf('on_screen_copies'));
  const input = {
    hook_drafts: ['a', 'b', 'c'],
    copy_draft: 'draft',
    caption_draft: 'draft',
    remaining_patterns: [],
    viewer_stake: 'Your AI-written emails may be giving you away.',
    tension: 'People think their AI drafts read as their own, and a list of 13,000 phrases says they do not.',
    on_screen_copies: ['Line one here now', 'Line two here now'],
    caption: 'Story.\n\nMore.',
    call_to_action: 'Save this post.',
    outcome_note: '',
    hashtags: ['#AI'],
    sources: [],
  };
  assert.equal(parseCopyReport(input).working.tension, input.tension);
  const { tension: _tension, ...missing } = input;
  assert.throws(() => parseCopyReport(missing), /missing tension/);
});

test('the rewrite keeps the tension', () => {
  const task = buildCopyTaskBlock({
    bucket: 'the_number',
    framework: 'arousal',
    members: [],
    rewriteOf: [
      {
        onScreenCopy: 'A line',
        words: 2,
        inRange: true,
        scores: { plain: 0.5, stake: 0.5, loop: 0.5, care: 0.5, reward: 0.5 },
        sameStory: true,
      },
    ],
  });
  assert.match(task, /Keep the tension and the plain read/);
});

/** Raw Jev levels, 0 to 4. A level of 2.8 is 0.70 once normalized. */
function line(plain: number, stake: number, perf: number, inRange = true): CopyLineJudgment & { inRange: boolean } {
  return { plain, stake, loop: perf, care: perf, reward: perf, sameStory: 0.9, payoff: null, inRange };
}

test('close nearest misses on plain read are picked by loop, care, and reward (D-252)', () => {
  assert.equal(NEAREST_MISS_PLAIN_TIE, 0.05);
  // 0.70 plain, flat; 0.68 plain, compelling: a close tie, so the compelling line ships.
  assert.equal(rankCopyLines([line(2.8, 2.8, 1), line(2.72, 2.72, 3.6)]).winner, 1);
  // 0.70 against 0.60 is not a tie: the plainer line still ships.
  assert.equal(rankCopyLines([line(2.8, 2.8, 1), line(2.4, 2.4, 4)]).winner, 0);
  // An out-of-range line never joins the tie for an in-range reference.
  assert.equal(rankCopyLines([line(2.8, 2.8, 1), line(2.8, 2.8, 4, false)]).winner, 0);
  // A line that clears the gate still wins on its own terms.
  const passing = rankCopyLines([line(3.2, 3.2, 1), line(2.8, 2.8, 4)]);
  assert.equal(passing.eligible, true);
  assert.equal(passing.winner, 0);
});

test('round 1 (v19): concrete stakes, four copies per call, and the kind of thing for Ball Knowledge', () => {
  assert.match(COPY_SKILL, /The stake lives in concrete words: who is affected and what happens to them\./);
  assert.match(COPY_SKILL, /Report four on-screen copies and one caption\./);
  assert.match(COPY_SKILL, /The four copies must be four different hooks/);
  assert.match(BUCKET_SPEC_TEXT.ball_knowledge.body, /Say what kind of thing the get is in everyday words/);
  const base = {
    hook_drafts: ['a'], copy_draft: 'd', caption_draft: 'd', remaining_patterns: [], viewer_stake: 'Stake here.',
    tension: 'Tension here.', caption: 'Story.\n\nMore.', call_to_action: 'Save this post.', outcome_note: '', hashtags: ['#AI'], sources: [],
  };
  assert.equal(parseCopyReport({ ...base, on_screen_copies: ['One a', 'Two b', 'Three c', 'Four d'] }).onScreenCopies.length, 4);
  assert.equal(parseCopyReport({ ...base, on_screen_copies: ['One a', 'Two b', 'Three c'] }).onScreenCopies.length, 3);
  assert.throws(() => parseCopyReport({ ...base, on_screen_copies: ['Only one'] }), /needs 4 on-screen copies, got 1/);
});

test('round 2 (v20): every copy says what it means for the viewer, and most buckets open on their thing', () => {
  // D-268: two beats, and the first one never gives way.
  assert.match(COPY_SKILL, /never a fact that stops\. It is built in two beats\./);
  assert.match(COPY_SKILL, /The first beat is the foundation: what happened and to whom/);
  assert.match(COPY_SKILL, /The tension lives inside the second beat\./);
  assert.match(COPY_SKILL, /When the words run short, the first beat is never the one that gives\./);
  assert.match(COPY_SKILL, /The second beat is why it matters: what it means for the viewer, said outright/);
  assert.match(COPY_SKILL, /at least two of the four copies open that way/);
  assert.match(COPY_SKILL, /In The Saga and Personal Profile, the copy opens on the story as the bucket says/);
  assert.doesNotMatch(FRAMEWORK_WRITING_LOGIC.arousal.onScreen, /Address the viewer only when/);
  assert.match(BUCKET_SPEC_TEXT.the_number.body, /what the figure does to the viewer's own things/);
});

test('round 3 (v21): reported facts can be applied to the viewer, and the rewrite has one blind job', () => {
  assert.match(COPY_SKILL, /Saying what a reported fact means for the viewer is not a new fact\./);
  assert.match(COPY_SKILL, /does not claim that something already happened to them/);
  const line = { onScreenCopy: 'A line', words: 2, inRange: true, scores: { plain: 0.5, stake: 0.5, loop: 0.5, care: 0.5, reward: 0.5 }, sameStory: true };
  const number = buildCopyTaskBlock({ bucket: 'the_number', framework: 'arousal', members: [], rewriteOf: [line] });
  assert.match(number, /Every copy opens on something of the viewer's/);
  assert.doesNotMatch(number, /0\.50/);
  const saga = buildCopyTaskBlock({ bucket: 'the_saga', framework: 'arousal', members: [], rewriteOf: [line] });
  assert.match(saga, /Every copy opens on the story as the bucket says/);
});

test('round 4 (v22): the polish call varies the nearest misses blind', () => {
  const lineOf = (copy: string, plain: number, stake: number, inRange = true) => ({
    index: 0, callIndex: 0, lineIndex: 0, onScreenCopy: copy, words: 10, inRange, eligible: false, winner: false,
    plain, stake, loop: 0.5, care: 0.5, reward: 0.5, sameStory: 0.9, payoff: null,
  });
  const picked = polishLines([
    lineOf('low', 0.5, 0.5), lineOf('near', 0.74, 0.72), lineOf('out', 0.9, 0.9, false), lineOf('mid', 0.7, 0.6), lineOf('next', 0.72, 0.7),
  ] as never, 3);
  assert.deepEqual(picked.map((line) => line.onScreenCopy), ['near', 'next', 'mid']);
  const task = buildCopyTaskBlock({ bucket: 'the_number', framework: 'arousal', members: [], polishOf: picked });
  assert.match(task, /These on-screen copies are the ones to build on/);
  assert.match(task, /Write 3 new on-screen copies, one close variation of each/);
  assert.doesNotMatch(task, /0\.7|0\.6|Plain|Stake/);
});

test('a wide miss is held out for good and a near miss may try again (D-258)', () => {
  assert.equal(isWideMiss(0.62, 0.6), true, 'both more than 0.10 short');
  assert.equal(isWideMiss(0.82, 0.45), true, 'one 0.25 or more short');
  assert.equal(isWideMiss(0.8, 0.68), false);
  assert.equal(isWideMiss(0.7, 0.66), false);
  assert.equal(isWideMiss(0.65, 0.65), false, 'exactly 0.10 short on both is a near miss');
  assert.equal(isWideMiss(0.5, 0.9), true, 'exactly 0.25 short on one is wide');
  assert.deepEqual(bestLineScores([{ plain: 0.9, stake: 0.3 }, { plain: 0.7, stake: 0.68, payoff: null }, { plain: 0.95, stake: 0.95, inRange: false }]), { plain: 0.7, stake: 0.68 });
  assert.deepEqual(bestLineScores([{ plain: 0.4, payoff: 0.8, stake: 0.7 }]), { plain: 0.8, stake: 0.7 }, 'payoff stands in for plain on Ball Knowledge');
});
