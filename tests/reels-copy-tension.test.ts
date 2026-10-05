/**
 * Offline tests for copy-caption-v18 (D-250 to D-252): every on-screen copy is
 * a complete thought with tension, The Number and Ball Knowledge run to 22
 * words, and close nearest misses are picked on loop, care, and reward.
 * No model calls.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCopyTaskBlock, copyStrategySystem } from '@/lib/reels/copy/assemble';
import { NEAREST_MISS_PLAIN_TIE, rankCopyLines, type CopyLineJudgment } from '@/lib/reels/copy/pick';
import { ON_SCREEN_WORD_RANGE, REPORT_COPY_TOOL, parseCopyReport } from '@/lib/reels/copy/report';
import { COPY_PROMPT_VERSION, COPY_SKILL, FRAMEWORK_WRITING_LOGIC } from '@/lib/reels/copy/skill';
import { BUCKET_SPEC_TEXT } from '@/lib/reels/copy/source-text.generated';

test('the copy is defined as a complete thought with tension, as a hard constraint', () => {
  assert.equal(COPY_PROMPT_VERSION, 'copy-caption-v18');
  assert.match(COPY_SKILL, /HARD CONSTRAINT\. The whole on-screen copy is the hook, and it is a complete thought with tension, never a fact that stops\./);
  assert.match(COPY_SKILL, /a reversal, a contradiction, an escalation, a consequence, an absurd detail, or a stake out of proportion to its cause/);
  assert.match(COPY_SKILL, /These are kinds to choose from, never a template/);
  assert.match(COPY_SKILL, /is a failed report, the same as a word count outside the range/);
  assert.match(COPY_SKILL, /never drop the tension to make the copy plainer/);
  assert.doesNotMatch(COPY_SKILL, /it has two jobs, in this order/);
  assert.doesNotMatch(COPY_SKILL, /with a turn|the turn:|a turn\b/i, 'the rule is named tension, not turn');
});

test('the writer names the tension before drafting and checks every copy against it', () => {
  assert.match(COPY_SKILL, /3\. Where is the tension\? Point to the words that carry it\./);
  assert.match(COPY_SKILL, /Then name the tension the sources hold and report it in the tension field\. If the sources hold none, say so there\. Never invent one\./);
  assert.match(COPY_SKILL, /carries the stake and the tension\. Keep two that both pass every hook question/);
  assert.match(COPY_SKILL, /in The Saga, hook question 5/);
});

test('the framework logic agrees: no bare fact, the tension stays on screen', () => {
  assert.doesNotMatch(FRAMEWORK_WRITING_LOGIC.arousal.onScreen, /Lead with the fact/);
  assert.match(FRAMEWORK_WRITING_LOGIC.arousal.onScreen, /give it its tension/);
  assert.match(FRAMEWORK_WRITING_LOGIC.curiosity.onScreen, /The tension is on screen\. The gap opens after it and never takes its place\./);
  assert.match(FRAMEWORK_WRITING_LOGIC.identity.onScreen, /what changes for that group\. Announcing that something exists is not a stance\./);
});

test('the bucket rules agree, and The Number and Ball Knowledge run to 22 words', () => {
  assert.doesNotMatch(BUCKET_SPEC_TEXT.the_number.body, /The stat is the payload/);
  assert.match(BUCKET_SPEC_TEXT.the_number.body, /the whole thought, with its tension, lands on screen/);
  assert.match(BUCKET_SPEC_TEXT.the_number.body, /Up to 22 words/);
  assert.match(BUCKET_SPEC_TEXT.ball_knowledge.body, /why the get is worth stopping for/);
  assert.match(BUCKET_SPEC_TEXT.ball_knowledge.body, /8–22 words/);
  assert.match(BUCKET_SPEC_TEXT.the_saga.body, /with the tension carried to the last beat/);
  assert.deepEqual(ON_SCREEN_WORD_RANGE.the_number, { min: 1, max: 22 });
  assert.deepEqual(ON_SCREEN_WORD_RANGE.ball_knowledge, { min: 8, max: 22 });
  assert.match(copyStrategySystem('the_number', 'curiosity'), /1 to 22 words/);
  assert.match(copyStrategySystem('ball_knowledge', 'identity'), /8 to 22 words/);
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
  assert.match(task, /A rewrite keeps the tension: a plainer copy that drops it is a failed report\./);
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
