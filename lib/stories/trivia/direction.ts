/**
 * The critter's direction for a question (PLAN.md AT-66 to AT-73). The host is on every set: the builder asks the
 * model for what depends on the question (what it wears and holds, how it feels), code turns that into beats, and
 * the renderer falls back to `defaultDirection` when a frame carries none, so no clip renders without the critter.
 * Where it stands, what it looks at and its reaction to the payoff are code's.
 */
import type { CritterBeat, CritterDirection } from './render/critter';
import { REVEAL_S } from './render/timeline';

/** The wear.js and cast.js closed lists this may pick from (tests hold them equal to the kit). */
export const DIRECT_HEADS = ['toque', 'hardhat', 'nursecap', 'cap', 'beanie', 'gradcap', 'beret', 'fedora', 'sunhat', 'headphones', 'glasses'] as const;
export const DIRECT_HANDS = ['cup', 'briefcase', 'book', 'palette', 'tray', 'football', 'docbag', 'magnifier', 'envelope', 'wateringcan', 'flask', 'camera'] as const;
export const DIRECT_MOODS = ['happy', 'curious', 'focused', 'surprised', 'sly', 'worried', 'proud'] as const;

export type DirectOut = { head: string; hand: string; opening_mood: string; pondering_mood: string };

const pick = <T extends string>(list: readonly T[], v: unknown): T | undefined => (list.includes(v as T) ? (v as T) : undefined);

/** The beats around one question: greet, read it, weigh the choices, watch the clock, then react to the answer. */
export function directionFrom(out: Partial<DirectOut> = {}): CritterDirection {
  const head = pick(DIRECT_HEADS, out.head);
  const hand = pick(DIRECT_HANDS, out.hand);
  const opening = pick(DIRECT_MOODS, out.opening_mood) ?? 'happy';
  const pondering = pick(DIRECT_MOODS, out.pondering_mood) ?? 'curious';
  const question: CritterBeat[] = [
    { at: 0, mood: opening, lookAt: 'viewer' },
    { at: 1.6, mood: pondering, lookAt: 'question', point: 'question' },
    // the thinking arm is the prop's arm, so the prop goes down for it
    { at: 3.8, state: 'think', lookAt: 'choices', propDown: true },
    { at: 6.4, mood: 'focused', lookAt: 'timer' },
    { at: 8.2, mood: 'sly', lookAt: 'viewer' },
  ];
  // With an opponent, its result replaces everything from the reveal on (critter.ts answerBeats).
  const answer: CritterBeat[] = [
    { at: 0.1, mood: 'focused', lookAt: 'choices' },
    { at: REVEAL_S, mood: 'surprised', lookAt: 'correct', point: 'correct' },
    { at: REVEAL_S + 1.3, mood: 'happy', lookAt: 'viewer' },
  ];
  return { spot: 'sign-right', ...(head ? { head } : {}), ...(hand ? { hand } : {}), ...(!head && !hand ? { head: 'headphones' } : {}), question, answer };
}

export const defaultDirection = (): CritterDirection => directionFrom();
