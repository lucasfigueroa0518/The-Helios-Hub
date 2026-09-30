/**
 * Jev grader questions — versioned per docs/JEV-GRADING-PASS.md §8.
 * When any question text or threshold changes, bump the tag
 * (jev-grader-YYYY-MM-DD), commit, and re-run calibration + sanity tests.
 *
 * This is the CANONICAL question list. All Jev-grader callers must
 * import from this file (or a later dated version). Grader runs record
 * `GRADER_VERSION` alongside their output so a stored verdict can be
 * traced back to the exact wording that produced it.
 */

export const GRADER_VERSION = 'jev-grader-2026-09-29';

/**
 * Every instruction starts with the same reader line — pasted once and
 * concatenated to each question's `instructions` field so a rewording
 * of the reader line only happens in one place.
 */
export const READER_LINE =
  'The reader is smart and busy, curious about AI, but does not follow AI news.';

export type PostQuestionId =
  | 'cover_says_what'
  | 'pulls_through'
  | 'clear_to_outsider'
  | 'why_it_matters'
  | 'worth_sharing';

export type SlideQuestionId = `slide_${number}_earns_place`;

export type QuestionSpec = {
  id: string;
  instructions: string;
  true: string;
  false: string;
  /** Pass threshold (per calibration §6). Starts at 0.75 across the board;
   *  post-calibration each question gets its own. */
  threshold: number;
};

export const POST_QUESTIONS: Record<PostQuestionId, QuestionSpec> = {
  cover_says_what: {
    id: 'cover_says_what',
    instructions:
      `${READER_LINE} Read only the COVER.`,
    true: 'The cover alone tells the reader who did what.',
    false: 'The cover teases, is vague, or needs another slide to make sense.',
    threshold: 0.75,
  },
  pulls_through: {
    id: 'pulls_through',
    instructions:
      `${READER_LINE} The reader has seen the COVER and SLIDE 2 in their feed.`,
    true:
      'They want to keep swiping: what they have read raises something the next slides answer.',
    false: 'They already have the gist; the rest feels optional.',
    threshold: 0.75,
  },
  clear_to_outsider: {
    id: 'clear_to_outsider',
    instructions:
      `${READER_LINE} Read every slide.`,
    true:
      'Every slide makes sense without prior AI knowledge; any unfamiliar term or name is explained where it appears.',
    false:
      'At least one slide relies on a term, name or idea the reader would not know and is not explained.',
    threshold: 0.75,
  },
  why_it_matters: {
    id: 'why_it_matters',
    instructions:
      `${READER_LINE} Read to the last slide.`,
    true:
      'The reader could say in one sentence what changes because of this news.',
    false:
      'The reader knows what was announced, but not what it changes or why it matters.',
    threshold: 0.75,
  },
  worth_sharing: {
    id: 'worth_sharing',
    instructions:
      `${READER_LINE} Read the whole post.`,
    true:
      'A reader would save it or send it to someone, because it tells them something specific they did not know.',
    false: 'It is accurate but forgettable; nothing in it is worth passing on.',
    threshold: 0.75,
  },
};

/**
 * Slide-question factory. One question per story slide (SLIDE 2, SLIDE 3, …
 * up to SLIDE 9). Instructions reference SLIDE N by number.
 *
 * TRUE / FALSE wording is per JEV-GRADING-PASS §3 with the addition from
 * Tommy today (2026-09-29): "A short slide passes if its point is new."
 * That guards against the grader marking a landing whose only content is
 * a specific number as filler because it's short — brevity ≠ filler.
 */
export function slideEarnsPlaceQuestion(position: number): QuestionSpec {
  return {
    id: `slide_${position}_earns_place`,
    instructions:
      `${READER_LINE} Compare SLIDE ${position} with the COVER and every slide before it. A short slide passes if its point is new.`,
    true:
      `SLIDE ${position} gives the reader a fact, number, reason, quote or consequence they have not already been told.`,
    false:
      `SLIDE ${position} mostly repeats what the cover or an earlier slide said, even in different words, or is filler (logistics, a label, a restated headline).`,
    threshold: 0.75,
  };
}

/**
 * Every question the grader will ask for a post with story slides at the
 * given positions. Returned as an ordered array so the order in the
 * systemOne request is deterministic.
 */
export function buildQuestionSet(storySlidePositions: readonly number[]): QuestionSpec[] {
  return [
    POST_QUESTIONS.cover_says_what,
    POST_QUESTIONS.pulls_through,
    POST_QUESTIONS.clear_to_outsider,
    POST_QUESTIONS.why_it_matters,
    POST_QUESTIONS.worth_sharing,
    ...storySlidePositions.map((p) => slideEarnsPlaceQuestion(p)),
  ];
}

/**
 * Pass rule (JEV-GRADING-PASS §4):
 *   - **Pass** = every question at or above its threshold, with AT MOST
 *     ONE `slide_N_earns_place` allowed to fail. The post-level questions
 *     (cover_says_what, pulls_through, etc.) must all pass — no exceptions.
 *
 * Returns the specific failures so the caller can turn them into rewrite
 * feedback (JEV-GRADING-PASS §5).
 */
export type PassRuleResult = {
  passed: boolean;
  postFailures: PostQuestionId[];
  slideFailures: number[]; // slide positions that failed
};

export function evaluatePass(
  probabilities: Record<string, number>,
  storySlidePositions: readonly number[],
): PassRuleResult {
  const postFailures: PostQuestionId[] = [];
  for (const id of Object.keys(POST_QUESTIONS) as PostQuestionId[]) {
    const q = POST_QUESTIONS[id];
    const p = probabilities[id];
    if (p === undefined || p < q.threshold) postFailures.push(id);
  }
  const slideFailures: number[] = [];
  for (const pos of storySlidePositions) {
    const id = `slide_${pos}_earns_place`;
    const q = slideEarnsPlaceQuestion(pos);
    const p = probabilities[id];
    if (p === undefined || p < q.threshold) slideFailures.push(pos);
  }
  const passed = postFailures.length === 0 && slideFailures.length <= 1;
  return { passed, postFailures, slideFailures };
}

/**
 * Failed-question → rewrite instruction map (JEV-GRADING-PASS §5). Code,
 * not Jev. Callers concatenate the relevant lines and hand the result to
 * the Writer as REVIEWER NOTES.
 */
export const REWRITE_FEEDBACK: Record<PostQuestionId, string> = {
  cover_says_what: 'The cover must say who did what on its own.',
  pulls_through:
    'Slide 2 gives away the rest. Lead with the first new fact and leave the reader a reason to swipe.',
  clear_to_outsider:
    'A slide relies on something the reader would not know. Explain it where it appears or cut it.',
  why_it_matters:
    'The post never says what changes. Use the fact that answers "why does this matter?"',
  worth_sharing:
    'Nothing here is specific enough to pass on. Lead with the most concrete fact: a number, a named consequence, a direct quote.',
};

export function slideFeedback(position: number): string {
  return `SLIDE ${position} repeats what the reader already knows. Replace it with a fact from UNUSED FACTS, or cut it.`;
}
