/**
 * Jev grader sanity tests — docs/JEV-GRADING-PASS.md §7. Offline. Stubs
 * `systemOne` so CI never spends. The stub is deliberately naive: it
 * inspects the state text for the shape of the perturbation the test
 * introduces and returns hand-picked probabilities that match how a
 * well-calibrated grader would react.
 *
 *   1. Take a passing post and add a slide that restates the cover in
 *      new words → that slide must fail.
 *   2. Remove the slide that says what changes → `why_it_matters` drops.
 *   3. Replace a gloss with bare jargon → `clear_to_outsider` drops.
 *   4. Run the same post twice → same verdict.
 */
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { jevGrade } from '@/lib/social/jev-grader/grader';
import { buildJevStateFromParsed } from '@/lib/social/jev-grader/state';
import type { ParsedPost } from '@/lib/social/editorial/v2/parse';

/** Build a small passing post as a ParsedPost. */
function passingPost(): ParsedPost {
  return {
    cover: { kind: 'edited', text: 'Google Labs makes CC a household agent.' } as unknown as ParsedPost['cover'],
    slides: [
      { position: 2, headline: 'Six accounts, one CC', body: 'Google Labs announced on September 17 that CC joins up to six family members into one shared agent.' },
      { position: 3, headline: 'How many can join', bigNumber: '6', numberNote: 'family members per CC household group' },
      { position: 4, headline: 'Why families now', body: 'Tom Shane, Senior Product Manager at Google Labs, said the top user request was CC helping run a household.' },
      { position: 5, headline: 'The daily brief CC sends', body: 'Every morning CC writes a shared brief and adds due dates to a shared family calendar.' },
      { position: 6, headline: 'A hard limit', body: 'The pilot is U.S. adults only with a personal Gmail account; school-provided accounts are not supported.' },
    ] as unknown as ParsedPost['slides'],
    follow: '',
  } as ParsedPost;
}

/**
 * Build a stub for `systemOne` that returns per-question probabilities
 * driven by simple text-shape rules:
 *   - Every post-question defaults to 0.85 unless a rule fires.
 *   - Every slide-question defaults to 0.85 unless the slide's payload
 *     (looked up from the state serialization) matches a "repeat" or
 *     "vague jargon" pattern, in which case the probability drops to 0.30.
 */
import type { JevGraderDeps } from '@/lib/social/jev-grader/grader';
type SystemOneArgs = Parameters<JevGraderDeps['systemOne']>[0];

function makeStub(perturbations: {
  restatesCover?: number[];
  removedWhyItMatters?: boolean;
  glossReplacedWithJargon?: boolean;
}) {
  return async (args: SystemOneArgs) => {
    const answers: Record<string, { noul: number }> = {};
    for (const [id] of Object.entries(args.questions)) {
      // Slide-earns-place: fail the slides listed in `restatesCover`.
      const slideMatch = id.match(/^slide_(\d+)_earns_place$/);
      if (slideMatch) {
        const pos = Number(slideMatch[1]);
        answers[id] = { noul: perturbations.restatesCover?.includes(pos) ? 0.30 : 0.85 };
        continue;
      }
      switch (id) {
        case 'why_it_matters':
          answers[id] = { noul: perturbations.removedWhyItMatters ? 0.30 : 0.85 };
          break;
        case 'clear_to_outsider':
          answers[id] = { noul: perturbations.glossReplacedWithJargon ? 0.30 : 0.85 };
          break;
        default:
          answers[id] = { noul: 0.85 };
      }
    }
    return { answers, usage: { inputTokens: 800 }, model: 'jev-stub' };
  };
}

describe('Jev grader — sanity tests (JEV-GRADING-PASS §7)', () => {
  test('1. adding a restate-the-cover slide fails that slide-question', async () => {
    // Sanity test 1 per JEV-GRADING-PASS §7: the SLIDE question must
    // fail (probability below threshold), not necessarily the whole
    // post — the pass rule allows at most one slide failure. That's
    // the point of the rule: a single fluke slide flag doesn't kill
    // an otherwise-strong post, but it does show up in the report.
    const base = passingPost();
    (base.slides as ParsedPost['slides']).push({
      position: 7,
      headline: 'CC now works for the whole family',
      body: 'The household agent brings six accounts together.',
    } as unknown as ParsedPost['slides'][number]);
    const state = buildJevStateFromParsed(base);
    const stub = makeStub({ restatesCover: [7] });
    const result = await jevGrade({ state }, { systemOne: stub });
    assert.ok(result.probabilities.slide_7_earns_place! < 0.75, 'slide_7 probability must drop below threshold');
    assert.ok(result.verdict.slideFailures.includes(7), 'slide 7 must appear in slideFailures');
  });

  test('2. removing the "why it matters" slide drops why_it_matters', async () => {
    const post = passingPost();
    // Remove the last slide (imagine it was the "what changes" line).
    (post.slides as ParsedPost['slides']).pop();
    const state = buildJevStateFromParsed(post);
    const stub = makeStub({ removedWhyItMatters: true });
    const result = await jevGrade({ state }, { systemOne: stub });
    assert.ok(result.probabilities.why_it_matters < 0.75, 'why_it_matters must drop');
    assert.equal(result.verdict.passed, false);
    assert.ok(result.verdict.postFailures.includes('why_it_matters'));
  });

  test('3. replacing a gloss with jargon drops clear_to_outsider', async () => {
    const post = passingPost();
    // Swap out a friendly sentence for a jargon-heavy one.
    (post.slides as ParsedPost['slides'])[0]!.body =
      'CC joins six ADP subjects into a single RBAC household under a shared IAM role.';
    const state = buildJevStateFromParsed(post);
    const stub = makeStub({ glossReplacedWithJargon: true });
    const result = await jevGrade({ state }, { systemOne: stub });
    assert.ok(result.probabilities.clear_to_outsider < 0.75, 'clear_to_outsider must drop');
    assert.equal(result.verdict.passed, false);
    assert.ok(result.verdict.postFailures.includes('clear_to_outsider'));
  });

  test('4. running the same post twice returns the same verdict', async () => {
    const state = buildJevStateFromParsed(passingPost());
    const stub = makeStub({});
    const first = await jevGrade({ state }, { systemOne: stub });
    const second = await jevGrade({ state }, { systemOne: stub });
    assert.equal(first.verdict.passed, second.verdict.passed);
    assert.deepEqual(first.verdict.postFailures, second.verdict.postFailures);
    assert.deepEqual(first.verdict.slideFailures, second.verdict.slideFailures);
    assert.deepEqual(first.probabilities, second.probabilities);
  });

  test('grader version tag is recorded on every result', async () => {
    const state = buildJevStateFromParsed(passingPost());
    const stub = makeStub({});
    const result = await jevGrade({ state }, { systemOne: stub });
    assert.equal(result.version, 'jev-grader-2026-09-29');
  });
});
