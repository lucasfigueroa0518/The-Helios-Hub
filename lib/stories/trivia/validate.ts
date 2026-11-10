/**
 * The validator (code, CONTRACT.md §3): every rule the writer prompt states as
 * required is checked here. A question that fails is dropped and its cell
 * stays open.
 */
import { EMOJI_RUN } from '@/lib/stories/render/emoji';

import type { TriviaWriteItem } from './prompts';
import { LETTERS, OPTION_COUNT, PHOTO_KINDS, SCORECARD_KEYS, type Difficulty, type Letter, type PhotoKind, type Scorecard, type TriviaQuestion } from './types';

export const LIMITS = { question: 110, option: 32, answerLine: 120, photoSubject: 80 } as const;

/** One emoji anywhere (the stories emoji pattern, plus flags and keycaps). Not global, so .test has no state. */
const EMOJI = new RegExp(`${EMOJI_RUN.source}|\\p{Regional_Indicator}|\\u20E3`, 'u');
/** The renderer's fixed lines (AT-25): the writer writes neither. */
const FIXED_COPY = /\bai trivia\b|\btap to reveal\b/i;

export type Validated = { ok: true; q: TriviaQuestion } | { ok: false; cellId: string; problems: string[] };

const DIFFICULTIES: readonly Difficulty[] = ['hard', 'medium', 'easy'];

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

  const difficulty = item?.difficulty as Difficulty;
  if (!DIFFICULTIES.includes(difficulty)) problems.push(`difficulty: ${String(item?.difficulty)} is not hard, medium or easy`);

  const raw = Array.isArray(item?.options) ? item.options : [];
  const options = raw.map((o) => ({ letter: text(o?.letter).toUpperCase() as Letter, text: text(o?.text) }));
  const want = OPTION_COUNT[difficulty];
  if (want && options.length !== want) problems.push(`options: ${options.length} for ${difficulty} (needs ${want})`);
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

  const photoSubject = text(item?.photo_subject);
  const answerPhotoSubject = text(item?.answer_photo_subject);
  if (!photoSubject) problems.push('photo subject: empty');
  if (!answerPhotoSubject) problems.push('answer photo subject: empty');
  if (photoSubject.length > LIMITS.photoSubject) problems.push(`photo subject: ${photoSubject.length} chars (max ${LIMITS.photoSubject})`);
  if (answerPhotoSubject.length > LIMITS.photoSubject) problems.push(`answer photo subject: ${answerPhotoSubject.length} chars (max ${LIMITS.photoSubject})`);

  // AT-28: named photos. Slide 1 may name only who the question names, and never points at the answer.
  const kindOf = (v: unknown): PhotoKind => (PHOTO_KINDS.includes(text(v) as PhotoKind) ? (text(v) as PhotoKind) : 'thematic');
  const photoKind = kindOf(item?.photo_kind);
  const answerPhotoKind = kindOf(item?.answer_photo_kind);
  const photoName = photoKind === 'thematic' ? '' : text(item?.photo_name);
  const answerPhotoName = answerPhotoKind === 'thematic' ? '' : text(item?.answer_photo_name);
  if (photoKind !== 'thematic' && !photoName) problems.push('photo name: empty for a named photo');
  if (answerPhotoKind !== 'thematic' && !answerPhotoName) problems.push('answer photo name: empty for a named photo');
  if (photoName && !question.toLowerCase().includes(photoName.toLowerCase())) problems.push('photo name: slide 1 names someone the question does not');
  const correctText = (options.find((o) => o.letter === correct)?.text ?? '').toLowerCase();
  if (correctText && [photoSubject, photoName].some((s) => s.toLowerCase().includes(correctText))) problems.push('photo: slide 1 gives the answer away');

  const sources = (Array.isArray(item?.sources) ? item.sources : []).map(text).filter((u) => /^https?:\/\//i.test(u));
  const writerScore = scorecard(item?.score, problems);

  if (problems.length) return { ok: false, cellId, problems };
  return { ok: true, q: { cellId, question, difficulty, options, correct, answerLine, photoSubject, answerPhotoSubject, photoKind, photoName, answerPhotoKind, answerPhotoName, sources, writerScore } };
}
