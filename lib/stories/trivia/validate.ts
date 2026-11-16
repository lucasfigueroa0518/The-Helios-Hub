/**
 * The validator (code, CONTRACT.md §3): every rule the writer prompt states as
 * required is checked here. A question that fails is dropped and its cell
 * stays open.
 */
import { EMOJI_RUN } from '@/lib/stories/render/emoji';

import type { TriviaWriteItem } from './prompts';
import { LETTERS, OPTION_COUNT, SCORECARD_KEYS, type Letter, type Scorecard, type TriviaQuestion } from './types';

export const LIMITS = { question: 110, option: 32, answerLine: 120 } as const;

/** One emoji anywhere (the stories emoji pattern, plus flags and keycaps). Not global, so .test has no state. */
const EMOJI = new RegExp(`${EMOJI_RUN.source}|\\p{Regional_Indicator}|\\u20E3`, 'u');
/** The renderer's fixed lines (AT-25, CONTRACT-2 §1): the series name (old and new) and the tap line; the writer writes none. */
const FIXED_COPY = /\bai trivia\b|\bare you smarter than ai\b|\btap to reveal\b/i;

export type Validated = { ok: true; q: TriviaQuestion } | { ok: false; cellId: string; problems: string[]; lengthOnly: boolean };

/** The problem text copyProblems writes for a field over its limit. */
const OVER_LIMIT = / chars \(max \d+\)$/;

function text(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
}

/** Problems in one line of viewer-facing copy. */
function copyProblems(label: string, s: string, max: number): string[] {
  const out: string[] = [];
  if (!s) out.push(`${label}: empty`);
  if (s.length > max) out.push(`${label}: ${s.length} chars (max ${max})`);
  if (s.includes('!')) out.push(`${label}: exclamation mark`);
  if (EMOJI.test(s)) out.push(`${label}: emoji`);
  if (FIXED_COPY.test(s)) out.push(`${label}: repeats the fixed copy`);
  return out;
}

function scorecard(v: unknown, problems: string[]): Scorecard {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const out = {} as Scorecard;
  for (const k of SCORECARD_KEYS) {
    const n = typeof o[k] === 'number' ? (o[k] as number) : Number.NaN;
    if (!(n >= 0 && n <= 1)) problems.push(`score.${k}: not a number from 0 to 1`);
    out[k] = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
  }
  return out;
}

/**
 * Check one writer item. `offered` is the day's cells, `open` the cells open
 * right now, `taken` the cells earlier items of the same output already hold.
 */
export function validateQuestion(item: TriviaWriteItem, ctx: { offered: ReadonlySet<string>; open: ReadonlySet<string>; taken?: ReadonlySet<string> }): Validated {
  const problems: string[] = [];
  const cellId = text(item?.cell_id);
  if (!ctx.offered.has(cellId)) problems.push(`cell ${cellId || '(empty)'}: not one of the cells offered`);
  else if (!ctx.open.has(cellId)) problems.push(`cell ${cellId}: not open`);
  if (ctx.taken?.has(cellId)) problems.push(`cell ${cellId}: already used by another question`);

  const question = text(item?.question);
  problems.push(...copyProblems('question', question, LIMITS.question));

  const raw = Array.isArray(item?.options) ? item.options : [];
  const options = raw.map((o) => ({ letter: text(o?.letter).toUpperCase() as Letter, text: text(o?.text) }));
  if (options.length !== OPTION_COUNT) problems.push(`options: ${options.length} (needs ${OPTION_COUNT})`);
  options.forEach((o, i) => {
    if (o.letter !== LETTERS[i]) problems.push(`option ${i + 1}: letter ${o.letter || '(empty)'} (expected ${LETTERS[i] ?? 'none'})`);
    problems.push(...copyProblems(`option ${o.letter || i + 1}`, o.text, LIMITS.option));
  });
  const texts = options.map((o) => o.text.toLowerCase());
  if (new Set(texts).size !== texts.length) problems.push('options: two options say the same thing');

  const correct = text(item?.correct).toUpperCase() as Letter;
  if (!options.some((o) => o.letter === correct)) problems.push(`correct: ${correct || '(empty)'} is not one of the options`);

  const answerLine = text(item?.answer_line);
  problems.push(...copyProblems('answer line', answerLine, LIMITS.answerLine));

  const sources = (Array.isArray(item?.sources) ? item.sources : []).map(text).filter((u) => /^https?:\/\//i.test(u));
  const writerScore = scorecard(item?.score, problems);

  // lengthOnly: every problem is a field over its limit, so one shortening try may save it (AT-58).
  if (problems.length) return { ok: false, cellId, problems, lengthOnly: problems.every((p) => OVER_LIMIT.test(p)) };
  return { ok: true, q: { cellId, question, options, correct, answerLine, sources, writerScore } };
}
