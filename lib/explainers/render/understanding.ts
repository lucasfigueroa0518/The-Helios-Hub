import { noul } from '@typesafe-ai/sdk';

import { DEFINITION_CHECK } from '@/lib/explainers/jev/questions/definition-check';
import type { ExplainersJevRunner } from '@/lib/explainers/jev/runner';
import type { AnalogyMapping } from '@/lib/explainers/types';
import { defineQuestionSet } from '@/lib/reels/jev/question-set';

/**
 * The blocking understanding test (Explainers 3.9, EX3-133; Lucas's gap-analysis decision 2, 2026-10-25:
 * "block serious only"). Session A's reel test has a stranger (the `first-viewer` agent) read the whole
 * reel and answer. Code reads the stranger's raw answers, not the director's own verdict, and Jev
 * judges the two comparisons code cannot: the mechanism and the example answer. Serious
 * misunderstandings block: one fix session before audio, and a flag on the reel if they remain.
 * Anything else the stranger found confusing is minor: recorded, never blocking.
 *
 * Questions and judge rules are the register's verbatim ("Understanding test v1");
 * tests/explainers-questions.test.ts fails if they drift.
 */
export const UNDERSTANDING = defineQuestionSet({
  id: 'explainers-understanding',
  version: 'explainers-understanding-v1',
  questions: {
    mechanism_match: noul({
      question: "Does the viewer's own-words explanation match the mechanism the reel meant?",
      judge:
        "Compare viewer_explanation, a first-time viewer's own words after watching the reel, with meant, what the reel set out to teach about the term. Answer yes when the viewer understood the same mechanism, even in plain or partial words; answer no when they missed it, got it wrong, or described something else.",
    }),
    example_match: noul({
      question: "Is the viewer's example answer the same as the meant one?",
      judge:
        'Compare viewer_example_answer, the answer a first-time viewer reached in the reel\'s worked example, with meant_example_answer. Answer yes when they reach the same answer, even worded differently; answer no when the answers differ or the viewer gave none.',
    }),
    gap_answered: noul({
      question: "Does the reel's payoff line answer the question the reel asked?",
      judge:
        'Read question, the question the reel asked near its start, and payoff, the line that ends its teaching. Answer yes when the payoff gives the viewer the answer to that question in real terms; answer no when it leaves the question open, answers a different question, or only restates it.',
    }),
  },
});

export const UNDERSTANDING_FIELDS = {
  mechanism_match: ['term', 'meant', 'viewer_explanation', 'meant_example_answer', 'viewer_example_answer'],
  example_match: ['term', 'meant', 'viewer_explanation', 'meant_example_answer', 'viewer_example_answer'],
  gap_answered: ['question', 'payoff'],
} as const;

/** A comparison fails below this: Jev's "yes" (they match, it answers) is under even odds. */
export const UNDERSTANDING_MIN = 0.5;

export type UnderstandingKind = 'mechanism' | 'example' | 'example_ambiguous' | 'character_changed' | 'gap_unanswered' | 'definition_mapping';
export type UnderstandingFinding = { kind: UnderstandingKind; detail: string; beats?: number[] };
export type UnderstandingVerdict = {
  blocking: UnderstandingFinding[];
  minor: string[];
  /** Jev's probabilities, for the record. */
  jev: { mechanism_match?: number; example_match?: number; gap_answered?: number; definition_same_part?: number };
};

type ViewerBeat = { beat?: unknown; same_characters?: unknown; confused?: unknown };
type ViewerAnswers = {
  beats?: ViewerBeat[];
  concept_in_my_words?: unknown;
  example_answer?: unknown;
  example_ambiguous?: unknown;
  other_reading?: unknown;
  example_is_the_scene?: unknown;
  confused_overall?: unknown;
};
/** `.hyperframes/comprehension-check.json`, as the director writes it (SKILL.md, step 5b). */
export type ComprehensionCheck = {
  meant?: { term_in_plain_words?: unknown; example_answer?: unknown };
  answers?: ViewerAnswers;
  second?: { answers?: ViewerAnswers };
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/** The storyboard's `gap_question:` (frame 2), or null. */
export function storyboardGapQuestion(storyboard: string): string | null {
  const m = /^\s*-?\s*gap_question:\s*(.+?)\s*$/im.exec(storyboard);
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

/**
 * The stranger's final answers (the second try when the director ran one), judged. Null when the
 * reel test never ran or wrote no answers: nothing to judge.
 */
export async function checkUnderstanding(input: {
  jev: ExplainersJevRunner;
  topicId: string;
  term: string;
  comprehension: ComprehensionCheck | null;
  storyboard: string;
  script: string;
}): Promise<UnderstandingVerdict | null> {
  const answers = input.comprehension?.second?.answers ?? input.comprehension?.answers;
  if (!answers || typeof answers !== 'object') return null;
  const meant = input.comprehension?.meant ?? {};
  const verdict: UnderstandingVerdict = { blocking: [], minor: [], jev: {} };

  const state = {
    term: input.term,
    meant: str(meant.term_in_plain_words),
    viewer_explanation: str(answers.concept_in_my_words),
    meant_example_answer: str(meant.example_answer),
    viewer_example_answer: str(answers.example_answer),
  };
  const asked = await input.jev.ask({
    component: 'understanding',
    state,
    set: UNDERSTANDING,
    questions: { mechanism_match: UNDERSTANDING.questions.mechanism_match, example_match: UNDERSTANDING.questions.example_match },
    topicId: input.topicId,
  });
  const p = (key: string) => {
    const v = (asked.answers as Record<string, { noul?: number }>)[key]?.noul;
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Jev returned no ${key} answer`);
    return v;
  };
  verdict.jev.mechanism_match = p('mechanism_match');
  verdict.jev.example_match = p('example_match');
  if (verdict.jev.mechanism_match < UNDERSTANDING_MIN) {
    verdict.blocking.push({ kind: 'mechanism', detail: `The viewer explained it as: "${state.viewer_explanation}". The reel meant: "${state.meant}".` });
  }
  if (verdict.jev.example_match < UNDERSTANDING_MIN) {
    verdict.blocking.push({ kind: 'example', detail: `The viewer's example answer: "${state.viewer_example_answer}". The meant answer: "${state.meant_example_answer}".` });
  }
  if (answers.example_ambiguous === true) {
    verdict.blocking.push({ kind: 'example_ambiguous', detail: `The viewer could read the example another way: "${str(answers.other_reading)}".`, beats: [6] });
  }
  const changed = (answers.beats ?? []).filter((b) => b?.same_characters === false).map((b) => Number(b.beat)).filter(Number.isFinite);
  if (changed.length) {
    verdict.blocking.push({ kind: 'character_changed', detail: `The viewer thought a character changed in beat ${changed.join(', ')}.`, beats: changed });
  }

  const question = storyboardGapQuestion(input.storyboard);
  const payoff = scriptLine(input.script, 7);
  if (question && payoff) {
    const gap = await input.jev.ask({
      component: 'understanding',
      state: { question, payoff },
      set: UNDERSTANDING,
      questions: { gap_answered: UNDERSTANDING.questions.gap_answered },
      topicId: input.topicId,
    });
    const v = (gap.answers as Record<string, { noul?: number }>).gap_answered?.noul;
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('Jev returned no gap_answered answer');
    verdict.jev.gap_answered = v;
    if (v < UNDERSTANDING_MIN) verdict.blocking.push({ kind: 'gap_unanswered', detail: `Frame 7 ("${payoff}") does not answer frame 2's question ("${question}").`, beats: [7] });
  } else {
    verdict.minor.push("The gap check could not run: the storyboard's gap_question or SCRIPT.md's frame 7 line is missing.");
  }

  for (const b of answers.beats ?? []) {
    for (const c of list(b?.confused)) verdict.minor.push(`Beat ${str(String(b?.beat ?? '?'))}: ${c}`);
  }
  for (const c of list(answers.confused_overall)) verdict.minor.push(c);
  if (answers.example_is_the_scene === true) verdict.minor.push('The viewer thought the example was the opening scene retold.');
  return verdict;
}

// ── The definition check (Explainers 4.1) ─────────────────────────────────────────────────

/** A `- key: value` field of the storyboard's `## Frame <n>` block, unquoted, or null. */
export function storyboardFrameField(storyboard: string, n: number, key: string): string | null {
  const lines = storyboard.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^##\\s+Frame\\s+${n}\\b`, 'i').test(l));
  if (start < 0) return null;
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    const m = new RegExp(`^\\s*-\\s*${key}:\\s*(.+?)\\s*$`, 'i').exec(line);
    if (m) return m[1].replace(/^["“]|["”]$/g, '').trim() || null;
  }
  return null;
}

const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The mapping row whose concept side is the term: an exact match, else a row whose concept names the
 * term as a whole word ("the cache", not "a cached copy"), else the first row (the mapping's most
 * important). Null for an empty mapping.
 */
export function termRow(mapping: readonly AnalogyMapping[], term: string): AnalogyMapping | null {
  const t = norm(term);
  if (!mapping.length) return null;
  const exact = mapping.find((r) => norm(r.concept).replace(/^(the|a|an) /, '') === t);
  if (exact) return exact;
  const word = new RegExp(`(^| )${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`);
  return mapping.find((r) => word.test(norm(r.concept))) ?? mapping[0];
}

/**
 * Frame 3's definition against the analogy's mapping (DEFINITION_CHECK): the spoken definition
 * (SCRIPT.md's frame 3 line) and the dictionary card (the storyboard's frame 3 `definition:`), the
 * mapping and its term row, and what the voice says over the analogy (frames 4 and 5). Null when
 * there is nothing to compare (no definition, or no mapping); else Jev's p(yes) and, below
 * UNDERSTANDING_MIN, a blocking finding for the fix session.
 */
export async function checkDefinitionMapping(input: {
  jev: ExplainersJevRunner;
  topicId: string;
  term: string;
  storyboard: string;
  script: string;
  mapping: readonly AnalogyMapping[] | null | undefined;
}): Promise<{ p: number; finding: UnderstandingFinding | null } | null> {
  const line = scriptLine(input.script, 3) ?? '';
  const card = storyboardFrameField(input.storyboard, 3, 'definition') ?? '';
  const mapping = input.mapping ?? [];
  // a paired term ("X vs Y", "X and Y") is defined side by side: each side has its own row
  const sides = input.term.split(/\s+(?:vs\.?|versus|and)\s+|\s*\/\s*/i).map((x) => x.trim()).filter(Boolean);
  const rows = [...new Set((sides.length > 1 ? sides : [input.term]).map((side) => termRow(mapping, side)).filter((r): r is AnalogyMapping => !!r))];
  const row = rows[0] ?? null;
  if ((!line && !card) || !row) return null;
  const analogyLines = [4, 5].map((n) => scriptLine(input.script, n)).filter(Boolean).join('\n');
  const asked = await input.jev.ask({
    component: 'understanding',
    state: {
      term: input.term,
      definition_line: line,
      definition_card: card,
      mapping: mapping.map((r) => `${r.analogy} = ${r.concept}`).join('\n'),
      term_row: rows.map((r) => `${r.analogy} = ${r.concept}`).join('\n'),
      analogy_lines: analogyLines,
    },
    set: DEFINITION_CHECK,
    questions: { same_part: DEFINITION_CHECK.questions.same_part },
    topicId: input.topicId,
  });
  const p = (asked.answers as Record<string, { noul?: number }>).same_part?.noul;
  if (typeof p !== 'number' || !Number.isFinite(p)) throw new Error('Jev returned no same_part answer');
  const said = line || card;
  return {
    p,
    finding:
      p < UNDERSTANDING_MIN
        ? {
            kind: 'definition_mapping',
            detail: `Frame 3 defines "${input.term}" as "${said}", but in the analogy's mapping ${rows.map((r) => `"${r.analogy}" stands for ${r.concept}`).join(' and ')}: define the thing that part stands for, and call the same part "${input.term}" in frames 4 and 5 (principles.md §5, keep the mapping straight).`,
            beats: [3],
          }
        : null,
  };
}

/** Where the worker writes the findings for the fix session (SKILL.md, Phase: fix). */
export const FINDINGS_FILE = '.hyperframes/understanding-findings.json';

export const FIX_PROMPT =
  'Use the helios-explainer-director skill to run this reel. PHASE: fix. .hyperframes/understanding-findings.json lists what a first-time viewer misunderstood. Fix it, then stop.';
