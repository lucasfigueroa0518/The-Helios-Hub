/**
 * "Are you smarter than AI?" shapes (series key ai_trivia; CONTRACT.md §3, CONTRACT-2.md §3). Shared by the daily writer, the pool,
 * the builder, the renderer (Builder B) and the plumbing (Builder C).
 */
import type { AnswerData, QuestionData } from '@/lib/stories/render/types';

import { QUALITY_KEYS, RANK_KEYS, type QualityKey } from './quality';

export type Letter = 'A' | 'B' | 'C';
export type TriviaOption = { letter: Letter; text: string };
/** Each 0–1: the writer's and Jev's answers to tests 1 to 4 of quality.ts (trivia-score@3). */
export type Scorecard = Record<QualityKey, number>;

export type TriviaQuestion = {
  cellId: string;
  /** Its number in the cell (AT-78); absent on questions pooled before cells held many. */
  n?: number;
  question: string;
  options: TriviaOption[];
  correct: Letter;
  /** Why the answer matters to the viewer. */
  answerLine: string;
  /** URLs the writer used. */
  sources: string[];
  writerScore: Scorecard;
};

export type TriviaPoolPayload = {
  kind: 'trivia';
  q: TriviaQuestion;
  jevScore: Scorecard;
  score: number;
  writtenOn: string;
  /** The opponent's one answer (AT-75), stored the first time it is asked so it is never asked again. */
  opponent?: import('./opponent').Opponent;
};

/** pass = clean, problems empty. `repeats`: the repeat check's version it was given under (repeats.ts REPEAT_CHECK_VERSION). */
export type FactCheck = { verdict: 'pass' | 'fail'; problems: string[]; sources: string[]; repeats?: number };

/** Always three options (AT-54). */
export const OPTION_COUNT = 3;
export const LETTERS: readonly Letter[] = ['A', 'B', 'C'];
export const SCORECARD_KEYS = QUALITY_KEYS;


export const TRIVIA_SERIES = 'ai_trivia' as const;
export const TRIVIA_KEY_PREFIX = 'trivia:';
/** `trivia:<cellId>:<n>` (AT-78); questions pooled before cells held many keep `trivia:<cellId>`. */
export const triviaPoolKey = (cellId: string, n?: number) => `${TRIVIA_KEY_PREFIX}${cellId}${n ? `:${n}` : ''}`;
/** A question's pool key. */
export const poolKeyOf = (q: Pick<TriviaQuestion, 'cellId' | 'n'>) => triviaPoolKey(q.cellId, q.n);
/** The cell id in a pool key, either form. */
export const cellOfKey = (key: string) => (key.startsWith(TRIVIA_KEY_PREFIX) ? key.slice(TRIVIA_KEY_PREFIX.length).split(':')[0]! : key);

/** Pool score (AT-61) = the mean of the writer's and Jev's scores on the ranking test (3), 4 decimals. */
export function triviaScore(writer: Scorecard, jev: Scorecard): number {
  const all = RANK_KEYS.flatMap((k) => [writer[k], jev[k]]);
  return Number((all.reduce((s, v) => s + v, 0) / all.length).toFixed(4));
}

/** The copy of an AI Trivia frame: lib/stories/render/types.ts QuestionData / AnswerData (the whole question on both). */
export type TriviaFrameCopy = QuestionData | AnswerData;

/** What a built AI Trivia set carries under payload.trivia. */
export type TriviaSetPayload = {
  q: TriviaQuestion;
  scores: { writer: Scorecard; jev: Scorecard; score: number };
  factCheck: FactCheck;
  /** The opponent's one answer (AT-74, opponent.ts); absent when it could not answer. */
  opponent?: import('./opponent').Opponent;
};
