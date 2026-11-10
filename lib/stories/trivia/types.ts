/**
 * AI Trivia shapes (CONTRACT.md §3). Shared by the daily writer, the pool,
 * the builder, the renderer (Builder B) and the plumbing (Builder C).
 */
import type { AnswerData, QuestionData } from '@/lib/stories/render/types';

import type { TriviaMusic } from './music';

export type Difficulty = 'hard' | 'medium' | 'easy';
export type Letter = 'A' | 'B' | 'C' | 'D';
export type TriviaOption = { letter: Letter; text: string };
export type PhotoKind = 'person' | 'company' | 'thematic';
export const PHOTO_KINDS: readonly PhotoKind[] = ['person', 'company', 'thematic'];
/** Each 0–1: the writer's and Jev's answers to the same three trivia-score@1 questions. */
export type Scorecard = { surprise: number; about_you: number; social_currency: number };

export type TriviaQuestion = {
  cellId: string;
  question: string;
  difficulty: Difficulty;
  options: TriviaOption[];
  correct: Letter;
  /** Why the answer matters to the viewer. */
  answerLine: string;
  /** Queries for findPhoto: slide 1 and slide 2 (AT-28). */
  photoSubject: string;
  answerPhotoSubject: string;
  /** person / company: the photo shows that named subject; thematic: a scene or object. */
  photoKind: PhotoKind;
  photoName: string;
  answerPhotoKind: PhotoKind;
  answerPhotoName: string;
  /** URLs the writer used. */
  sources: string[];
  writerScore: Scorecard;
};

export type TriviaPoolPayload = { kind: 'trivia'; q: TriviaQuestion; jevScore: Scorecard; score: number; writtenOn: string };

/** pass = clean, problems empty. */
export type FactCheck = { verdict: 'pass' | 'fail'; problems: string[]; sources: string[] };

/** Option count by difficulty (AT-9): code owns it, the writer never chooses it. */
export const OPTION_COUNT: Record<Difficulty, number> = { hard: 2, medium: 3, easy: 4 };
export const LETTERS: readonly Letter[] = ['A', 'B', 'C', 'D'];
export const SCORECARD_KEYS = ['surprise', 'about_you', 'social_currency'] as const;

export const TRIVIA_SERIES = 'ai_trivia' as const;
export const TRIVIA_KEY_PREFIX = 'trivia:';
export const triviaPoolKey = (cellId: string) => `${TRIVIA_KEY_PREFIX}${cellId}`;

/** Score = the mean of the 6 numbers (3 writer + 3 Jev), 4 decimals. */
export function triviaScore(writer: Scorecard, jev: Scorecard): number {
  const all = SCORECARD_KEYS.flatMap((k) => [writer[k], jev[k]]);
  return Number((all.reduce((s, v) => s + v, 0) / all.length).toFixed(4));
}

/** The copy of an AI Trivia frame: lib/stories/render/types.ts QuestionData / AnswerData (the whole question on both). */
export type TriviaFrameCopy = QuestionData | AnswerData;

/** The music plan Builder B's pickTriviaMusic returns. */
export type { TriviaMusic } from './music';

/** What a built AI Trivia set carries under payload.trivia. */
export type TriviaSetPayload = {
  q: TriviaQuestion;
  scores: { writer: Scorecard; jev: Scorecard; score: number };
  factCheck: FactCheck;
  music: TriviaMusic;
};
