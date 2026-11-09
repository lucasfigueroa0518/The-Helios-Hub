import { noul } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';
import type { RealCaseJevRunner } from '@/lib/real-case/jev/runner';

/**
 * The understanding test for AI News Explained (RC-23 as rebuilt for RC-26). The plan session has a
 * stranger (the `first-viewer` agent, with this format's prompt: lib/real-case/render/agents.ts) read
 * the whole reel and answer. Code reads the stranger's raw answers, and Jev judges what code cannot:
 * did the viewer get what happened, did they get why (the concept), and does the reveal answer the
 * question the fallout asked. Serious misses block: one fix session before audio, and a flag on the
 * reel if they remain. Anything else the stranger found confusing is minor: recorded, never blocking.
 * The close (frame 8, the logo) is never judged.
 */
export const NEWS_UNDERSTANDING = defineQuestionSet({
  id: 'news-understanding',
  version: 'news-understanding-v1',
  questions: {
    story_match: noul({
      question: "Does the viewer's account of what happened match the story the reel meant to tell?",
      judge:
        "Compare viewer_story, a first-time viewer's own words after watching the reel, with meant_story. Answer yes when the viewer got the same events and outcome, even in plain or partial words; answer no when they missed the outcome, mixed up who did what, or described a different story.",
    }),
    reveal_match: noul({
      question: "Does the viewer's account of why it happened match the reason the reel meant to reveal?",
      judge:
        "Compare viewer_why, a first-time viewer's own words for why the story happened, with meant_why, the mechanism the reel set out to reveal. Answer yes when the viewer understood the same mechanism, even in plain or partial words; answer no when they missed it, gave a different cause, or gave none.",
    }),
    question_answered: noul({
      question: "Does the reveal answer the question the reel asked?",
      judge:
        'Read question, the question the reel asked after the fallout, and reveal, the narration that follows it. Answer yes when the reveal gives the viewer the answer to that question in real terms; answer no when it leaves the question open, answers a different question, or only restates it.',
    }),
  },
});

/** A comparison fails below this: Jev's "yes" (they match, it answers) is under even odds. */
export const UNDERSTANDING_MIN = 0.5;

export type NewsUnderstandingKind = 'cold_open' | 'story' | 'reveal' | 'question_unanswered';
export type NewsUnderstandingFinding = { kind: NewsUnderstandingKind; detail: string; beats?: number[] };
export type NewsUnderstandingVerdict = {
  blocking: NewsUnderstandingFinding[];
  minor: string[];
  jev: { story_match?: number; reveal_match?: number; question_answered?: number };
};

type ViewerBeat = { beat?: unknown; confused?: unknown };
type ViewerAnswers = {
  beats?: ViewerBeat[];
  what_happened?: unknown;
  why_it_happened?: unknown;
  concept_in_my_words?: unknown;
  keep?: unknown;
  keep_watching?: unknown;
  confused_overall?: unknown;
};

/** The first-seconds answers (the cold-open test, RC-35). */
type ColdOpenAnswers = { happening?: unknown; question?: unknown; keep_watching?: unknown; confused?: unknown };

/** `.hyperframes/comprehension-check.json`, as the director writes it (director SKILL.md, plan steps 5–6). */
export type NewsComprehensionCheck = {
  meant?: { what_happened?: unknown; why_it_happened?: unknown; term_in_plain_words?: unknown };
  cold_open?: ColdOpenAnswers;
  answers?: ViewerAnswers;
};

/** A cold open blocks below this "keep watching" (1–5), or when it leaves no question (RC-35). */
export const COLD_OPEN_MIN = 4;

/** Where the worker writes the findings for the fix session (director SKILL.md, Phase: fix). */
export const FINDINGS_FILE = '.hyperframes/understanding-findings.json';
/** The close, voiceless and code-built: never judged. */
const CLOSE_BEAT = 8;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/** The storyboard's `question:` (frame 4), or null. */
export function storyboardQuestion(storyboard: string): string | null {
  const block = /^##\s+Frame\s+4\b[\s\S]*?(?=^##\s|$(?![\s\S]))/im.exec(storyboard)?.[0] ?? '';
  const m = /^\s*-\s*question:\s*(.+?)\s*$/im.exec(block);
  return m ? m[1].replace(/^["“]|["”]$/g, '').trim() || null : null;
}

/** The spoken words of SCRIPT.md's line for frame `n` (the four-space block under its heading), or null. */
export function scriptLine(script: string, n: number): string | null {
  const lines = script.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^##\\s+Line\\s+\\d+.*\\(Frame\\s+${n}\\)\\s*$`, 'i').test(l));
  if (start < 0) return null;
  const words: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    if (/^ {4}\S/.test(line)) words.push(line.trim());
  }
  return words.join(' ').trim() || null;
}

/** The stranger's answers, judged. Null when the reel test never ran or wrote no answers. */
export async function checkNewsUnderstanding(input: {
  jev: RealCaseJevRunner;
  storyId: string;
  comprehension: NewsComprehensionCheck | null;
  storyboard: string;
  script: string;
}): Promise<NewsUnderstandingVerdict | null> {
  const answers = input.comprehension?.answers;
  if (!answers || typeof answers !== 'object') return null;
  const meant = input.comprehension?.meant ?? {};
  const verdict: NewsUnderstandingVerdict = { blocking: [], minor: [], jev: {} };
  const p = (asked: { answers: unknown }, key: string) => {
    const v = (asked.answers as Record<string, { noul?: number }>)[key]?.noul;
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Jev returned no ${key} answer`);
    return v;
  };

  // The cold open (RC-35): code reads the stranger's first-seconds answers directly.
  const cold = input.comprehension?.cold_open;
  if (!cold || typeof cold !== 'object') verdict.minor.push('The cold-open test did not run.');
  else {
    const keep = Number(cold.keep_watching);
    const question = str(cold.question);
    if (!Number.isFinite(keep) || keep < COLD_OPEN_MIN || !question) {
      verdict.blocking.push({
        kind: 'cold_open',
        detail: `A stranger who saw only the cold open: keep watching ${Number.isFinite(keep) ? keep : '?'} of 5, ${question ? `wondering "${question}"` : 'with no question left open'}; they saw "${str(cold.happening)}".`,
        beats: [1],
      });
    }
    for (const c of list(cold.confused)) verdict.minor.push(`Cold open: ${c}`);
  }

  const state = {
    meant_story: str(meant.what_happened),
    viewer_story: str(answers.what_happened),
    meant_why: [str(meant.why_it_happened), str(meant.term_in_plain_words)].filter(Boolean).join(' '),
    viewer_why: [str(answers.why_it_happened), str(answers.concept_in_my_words)].filter(Boolean).join(' '),
  };
  const asked = await input.jev.ask({
    component: 'understanding',
    state,
    set: NEWS_UNDERSTANDING,
    questions: { story_match: NEWS_UNDERSTANDING.questions.story_match, reveal_match: NEWS_UNDERSTANDING.questions.reveal_match },
    storyId: input.storyId,
  });
  verdict.jev.story_match = p(asked, 'story_match');
  verdict.jev.reveal_match = p(asked, 'reveal_match');
  if (verdict.jev.story_match < UNDERSTANDING_MIN) {
    verdict.blocking.push({ kind: 'story', detail: `The viewer told it as: "${state.viewer_story}". The reel meant: "${state.meant_story}".`, beats: [2, 3, 4] });
  }
  if (verdict.jev.reveal_match < UNDERSTANDING_MIN) {
    verdict.blocking.push({ kind: 'reveal', detail: `The viewer said it happened because: "${state.viewer_why}". The reel meant: "${state.meant_why}".`, beats: [5] });
  }

  const question = storyboardQuestion(input.storyboard);
  const reveal = scriptLine(input.script, 5);
  if (question && reveal) {
    const gap = await input.jev.ask({
      component: 'understanding',
      state: { question, reveal },
      set: NEWS_UNDERSTANDING,
      questions: { question_answered: NEWS_UNDERSTANDING.questions.question_answered },
      storyId: input.storyId,
    });
    verdict.jev.question_answered = p(gap, 'question_answered');
    if (verdict.jev.question_answered < UNDERSTANDING_MIN) {
      verdict.blocking.push({ kind: 'question_unanswered', detail: `Frame 5 ("${reveal}") does not answer frame 4's question ("${question}").`, beats: [5] });
    }
  } else {
    verdict.minor.push("The question check could not run: the storyboard's frame 4 question or SCRIPT.md's frame 5 line is missing.");
  }

  for (const b of answers.beats ?? []) {
    if (Number(b?.beat) === CLOSE_BEAT) continue;
    for (const c of list(b?.confused)) verdict.minor.push(`Beat ${str(String(b?.beat ?? '?'))}: ${c}`);
  }
  for (const c of list(answers.confused_overall)) verdict.minor.push(c);
  const keepWatching = Number(answers.keep_watching);
  if (Number.isFinite(keepWatching) && keepWatching <= 2) verdict.minor.push(`The viewer would likely stop watching (${keepWatching} of 5).`);
  return verdict;
}
